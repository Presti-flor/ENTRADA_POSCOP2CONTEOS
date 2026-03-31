let viajeActivo = "";
let cacheDetalle = [];
let autoRefreshTimer = null;
let scanBuffer = "";
let scanTimer = null;

const SCAN_GAP_MS = 900;

const cardDuplicados = document.getElementById("card-duplicados");
const cardErrores = document.getElementById("card-errores");
const finalizarBtn = document.getElementById("finalizar-viaje-btn");
const barcodeInput = document.getElementById("barcode");
const formInput = document.getElementById("form");
const statusBar = document.getElementById("status-bar");
const resumenVariedadBody = document.getElementById("resumen-variedad-body");
const viajeActivoLabel = document.getElementById("viaje-activo-label");
const totalEscaneados = document.getElementById("total-escaneados");
const totalDuplicados = document.getElementById("total-duplicados");
const totalErrores = document.getElementById("total-errores");
const totalAcumuladoGeneral = document.getElementById("total-acumulado-general");

const pivotBody = document.getElementById("pivot-body");
const detalleBody = document.getElementById("detalle-body");
const yaRegistradosLista = document.getElementById("ya-registrados-lista");

const contadorGeneralBd = document.getElementById("contador-general-bd");
const contadorTallosGeneralBd = document.getElementById("contador-tallos-general-bd");
const bloqueGeneralSelect = document.getElementById("bloque-general-select");
const variedadGeneralSelect = document.getElementById("variedad-general-select");
const generalBloqueBody = document.getElementById("general-bloque-body");
const generalBloqueDetalleBody = document.getElementById("general-bloque-detalle-body");

function setText(el, value) {
  if (el) el.textContent = value;
}

function setHTML(el, value) {
  if (el) el.innerHTML = value;
}

function setStatus(texto, tipo = "neutral") {
  if (!statusBar) return;
  statusBar.textContent = texto;
  statusBar.className = `status-bar status-${tipo}`;
}

function mantenerFoco() {
  // intencionalmente vacío para no mover la pantalla
}

function guardarEstadoUI() {
  localStorage.setItem("viajeActivoUI", viajeActivo || "");
  localStorage.setItem("bloqueGeneralUI", bloqueGeneralSelect?.value || "");
  localStorage.setItem("variedadGeneralUI", variedadGeneralSelect?.value || "");
}

function restaurarEstadoUI() {
  return {
    viajeGuardado: localStorage.getItem("viajeActivoUI") || "",
    bloqueGuardado: localStorage.getItem("bloqueGeneralUI") || "",
    variedadGuardada: localStorage.getItem("variedadGeneralUI") || ""
  };
}

function actualizarAlertasResumen(duplicados, errores) {
  if (cardDuplicados) {
    cardDuplicados.classList.toggle("alerta-duplicados", Number(duplicados || 0) > 0);
  }

  if (cardErrores) {
    cardErrores.classList.toggle("alerta-errores", Number(errores || 0) > 0);
  }
}

function limpiarResumenViaje() {
  setText(totalEscaneados, 0);
  setText(totalDuplicados, 0);
  setText(totalErrores, 0);
  setText(totalAcumuladoGeneral, 0);
  setText(viajeActivoLabel, "Sin viaje");

  actualizarAlertasResumen(0, 0);

  if (resumenVariedadBody) {
    resumenVariedadBody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-row">Sin registros por variedad.</td>
      </tr>
    `;
  }

  if (pivotBody) {
    pivotBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">Sin datos para mostrar.</td>
      </tr>
    `;
  }

  if (detalleBody) {
    detalleBody.innerHTML = `
      <tr>
        <td colspan="14" class="empty-row">Sin registros todavía.</td>
      </tr>
    `;
  }

  if (yaRegistradosLista) {
    yaRegistradosLista.innerHTML = `<div class="ya-registrado-item">Sin novedades.</div>`;
  }

  cacheDetalle = [];
}

function limpiarConsultaGeneral() {
  setHTML(generalBloqueBody, `
    <tr>
      <td colspan="7" class="empty-row">Selecciona un bloque o variedad para consultar.</td>
    </tr>
  `);

  setHTML(generalBloqueDetalleBody, `
    <tr>
      <td colspan="13" class="empty-row">Sin datos para mostrar.</td>
    </tr>
  `);
}

async function cargarContadorGeneralBD() {
  try {
    const res = await fetch("/api/general/contador");

    if (!res.ok) {
      console.error("Error cargando contador general BD: HTTP", res.status);
      return;
    }

    const json = await res.json();
    if (!json.ok) return;

    setText(contadorGeneralBd, json.total ?? 0);
    setText(contadorTallosGeneralBd, json.total_tallos ?? 0);
  } catch (err) {
    console.error("Error cargando contador general BD:", err);
  }
}

async function cargarBloquesGenerales() {
  if (!bloqueGeneralSelect) return;

  try {
    const res = await fetch("/api/general/bloques");
    if (!res.ok) return;

    const json = await res.json();
    if (!json.ok) return;

    const seleccionado = bloqueGeneralSelect.value || "";
    bloqueGeneralSelect.innerHTML = `<option value="">Seleccionar bloque</option>`;

    json.data.forEach((bloque) => {
      const option = document.createElement("option");
      option.value = String(bloque);
      option.textContent = String(bloque);
      if (String(bloque) === String(seleccionado)) {
        option.selected = true;
      }
      bloqueGeneralSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error cargando bloques generales:", err);
  }
}

async function cargarVariedadesGeneralesPorBloque(bloque, variedadSeleccionada = "") {
  if (!variedadGeneralSelect) return;

  if (!bloque) {
    variedadGeneralSelect.innerHTML = `<option value="">Seleccionar variedad</option>`;
    return;
  }

  try {
    const res = await fetch(`/api/general/bloque/${encodeURIComponent(bloque)}/variedades`);
    if (!res.ok) return;

    const json = await res.json();
    variedadGeneralSelect.innerHTML = `<option value="">Seleccionar variedad</option>`;

    if (!json.ok) return;

    json.data.forEach((variedad) => {
      const option = document.createElement("option");
      option.value = variedad;
      option.textContent = variedad;
      if (variedadSeleccionada && variedadSeleccionada === variedad) {
        option.selected = true;
      }
      variedadGeneralSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error cargando variedades por bloque:", err);
  }
}

async function cargarResumenGeneralPorBloque(bloque, variedad = "") {
  if (!generalBloqueBody) return;

  if (!bloque) {
    limpiarConsultaGeneral();
    return;
  }

  try {
    const url = variedad
      ? `/api/general/bloque/${encodeURIComponent(bloque)}?variedad=${encodeURIComponent(variedad)}`
      : `/api/general/bloque/${encodeURIComponent(bloque)}`;

    const res = await fetch(url);
    if (!res.ok) {
      setHTML(generalBloqueBody, `
        <tr>
          <td colspan="7" class="empty-row">Error cargando el resumen del bloque.</td>
        </tr>
      `);
      return;
    }

    const json = await res.json();

    if (!json.ok || !json.data.length) {
      setHTML(generalBloqueBody, `
        <tr>
          <td colspan="7" class="empty-row">No hay datos para este filtro.</td>
        </tr>
      `);
      return;
    }

    generalBloqueBody.innerHTML = "";

    json.data.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.bloque ?? ""}</td>
        <td>${row.variedad ?? ""}</td>
        <td>${row.tamano ?? ""}</td>
        <td>${row.tallos ?? ""}</td>
        <td>${row.etapa ?? ""}</td>
        <td class="cell-green">${row.tabacos ?? 0}</td>
        <td class="cell-blue">${row.suma_tallos ?? 0}</td>
      `;
      generalBloqueBody.appendChild(tr);
    });
  } catch (err) {
    setHTML(generalBloqueBody, `
      <tr>
        <td colspan="7" class="empty-row">Error cargando el resumen del bloque.</td>
      </tr>
    `);
  }
}

async function cargarDetalleGeneralPorBloque(bloque, variedad = "") {
  if (!generalBloqueDetalleBody) return;

  if (!bloque) {
    setHTML(generalBloqueDetalleBody, `
      <tr>
        <td colspan="13" class="empty-row">Sin datos para mostrar.</td>
      </tr>
    `);
    return;
  }

  try {
    const url = variedad
      ? `/api/general/bloque/${encodeURIComponent(bloque)}/detalle?variedad=${encodeURIComponent(variedad)}`
      : `/api/general/bloque/${encodeURIComponent(bloque)}/detalle`;

    const res = await fetch(url);
    if (!res.ok) {
      setHTML(generalBloqueDetalleBody, `
        <tr>
          <td colspan="13" class="empty-row">Error cargando el detalle del bloque.</td>
        </tr>
      `);
      return;
    }

    const json = await res.json();

    if (!json.ok || !json.data.length) {
      setHTML(generalBloqueDetalleBody, `
        <tr>
          <td colspan="13" class="empty-row">No hay registros para este filtro.</td>
        </tr>
      `);
      return;
    }

    generalBloqueDetalleBody.innerHTML = "";

    json.data.forEach((row) => {
      const fecha = row.created_at
        ? new Date(row.created_at).toLocaleString("es-CO")
        : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fecha}</td>
        <td>${row.barcode ?? ""}</td>
        <td>${row.tipo ?? ""}</td>
        <td>${row.serial ?? ""}</td>
        <td>${row.variedad ?? ""}</td>
        <td>${row.bloque ?? ""}</td>
        <td>${row.tamano ?? ""}</td>
        <td>${row.tallos ?? ""}</td>
        <td>${row.etapa ?? ""}</td>
        <td>${row.form ?? ""}</td>
        <td>${row.barcode_origen ?? ""}</td>
        <td>${row.es_reregistro === true ? "Sí" : "No"}</td>
        <td><button class="btn-delete-general" data-barcode="${row.barcode}">Eliminar</button></td>
      `;
      generalBloqueDetalleBody.appendChild(tr);
    });

    document.querySelectorAll(".btn-delete-general").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const barcode = btn.dataset.barcode;
        await eliminarRegistroReal(barcode);
      });
    });
  } catch (err) {
    setHTML(generalBloqueDetalleBody, `
      <tr>
        <td colspan="13" class="empty-row">Error cargando el detalle del bloque.</td>
      </tr>
    `);
  }
}

async function cargarViajes() {
  const contenedor = document.getElementById("viajes-botones");
  if (!contenedor) return;

  try {
    const res = await fetch("/api/viajes");
    if (!res.ok) {
      contenedor.innerHTML = "";
      return;
    }

    const json = await res.json();

    if (!json.ok || !Array.isArray(json.data)) {
      contenedor.innerHTML = "";
      return;
    }

    contenedor.innerHTML = "";

    json.data.forEach((nombre) => {
      const btn = document.createElement("button");
      btn.className = "btn-viaje";
      btn.textContent = nombre;

      btn.addEventListener("click", async () => {
        await activarViaje(nombre);
      });

      contenedor.appendChild(btn);
    });
  } catch (err) {
    console.error("Error cargando viajes:", err);
  }
}

function iniciarAutoRefreshViaje() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    if (!viajeActivo) return;

    await refrescarResumen();        // sesión actual
    await refrescarDetalle();        // sesión actual
    await refrescarPivot();          // sesión actual
    await refrescarResumenDesdeBD(); // acumulado histórico
    await cargarContadorGeneralBD();
  }, 3000);
}

function detenerAutoRefreshViaje() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function activarViaje(nombre) {
  try {
    const viajeNombre = String(nombre || "").trim();

    if (!viajeNombre) {
      setStatus("Debes seleccionar un viaje", "warn");
      return;
    }

    const res = await fetch("/api/viajes/activar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: viajeNombre }),
    });

    const json = await res.json();

    if (!json.ok) {
      setStatus(json.error || "No se pudo activar el viaje", "error");
      return;
    }

    viajeActivo = viajeNombre;
    guardarEstadoUI();
    detenerAutoRefreshViaje();

    document.querySelectorAll(".btn-viaje").forEach((b) => {
      b.classList.remove("activo");
      if (b.textContent === viajeNombre) {
        b.classList.add("activo");
      }
    });

    setText(viajeActivoLabel, viajeNombre);

    // reiniciar SOLO la sesión actual
    setText(totalEscaneados, 0);
    setText(totalDuplicados, 0);
    setText(totalErrores, 0);
    actualizarAlertasResumen(0, 0);

    cacheDetalle = [];

    if (detalleBody) {
      detalleBody.innerHTML = `
        <tr>
          <td colspan="14" class="empty-row">Sin registros todavía.</td>
        </tr>
      `;
    }

    if (pivotBody) {
      pivotBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-row">Sin datos para mostrar.</td>
        </tr>
      `;
    }

    if (yaRegistradosLista) {
      yaRegistradosLista.innerHTML = `<div class="ya-registrado-item">Sin novedades.</div>`;
    }

    if (resumenVariedadBody) {
      resumenVariedadBody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-row">Sin registros por variedad.</td>
        </tr>
      `;
    }

    // solo acumulado histórico
    await refrescarResumenDesdeBD();
    await cargarContadorGeneralBD();

    setStatus(`Viaje ${viajeNombre} activado`, "ok");
    iniciarAutoRefreshViaje();
  } catch (err) {
    console.error("Error activando viaje:", err);
    setStatus("Error activando viaje", "error");
  }
}

async function finalizarViaje() {
  if (!viajeActivo) {
    setStatus("No hay viaje activo", "warn");
    return;
  }

  try {
    const nombreFinalizar = viajeActivo;

    const res = await fetch("/api/viajes/finalizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombreFinalizar }),
    });

    const json = await res.json();

    if (!json.ok) {
      setStatus(json.error || "No se pudo finalizar", "error");
      return;
    }

    setStatus(`Viaje ${nombreFinalizar} finalizado`, "ok");
    viajeActivo = "";
    guardarEstadoUI();
    detenerAutoRefreshViaje();

    setText(viajeActivoLabel, "Sin viaje");

    document.querySelectorAll(".btn-viaje").forEach((b) => {
      b.classList.remove("activo");
    });

    limpiarResumenViaje();

    if (barcodeInput) barcodeInput.value = "";
  } catch (err) {
    console.error("Error finalizando viaje:", err);
    setStatus("Error finalizando viaje", "error");
  }
}

async function escanearCodigo(barcode) {
  try {
    const barcodeLimpio = String(barcode || "").trim();

    if (!viajeActivo) {
      setStatus("Debes activar un viaje antes de escanear", "warn");
      return;
    }

    if (!barcodeLimpio) {
      setStatus("El barcode está vacío", "warn");
      return;
    }

    const res = await fetch("/api/escanear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        barcode: barcodeLimpio,
        viaje: viajeActivo,
        form: formInput?.value?.trim() || ""
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      setStatus(data.error || "Error al escanear", "error");
      console.error("Error backend:", data);
      return;
    }

    if (data.resultado === "OK") {
      setStatus(`${barcodeLimpio} → REGISTRADO`, "ok");
    } else if (data.resultado === "YA_REGISTRADO") {
      setStatus(`${barcodeLimpio} → YA REGISTRADO`, "warn");
    } else if (data.resultado === "REREGISTRADO") {
      setStatus(`${barcodeLimpio} → RE-REGISTRADO`, "ok");
    } else if (data.resultado === "NO_EXISTE") {
      setStatus(`${barcodeLimpio} → NO EXISTE`, "error");
    } else {
      setStatus(`Escaneo procesado: ${barcodeLimpio}`, "ok");
    }

    await refrescarTodo();
  } catch (error) {
    console.error("Error escaneando:", error);
    setStatus("Error escaneando", "error");
  }
}

async function reregistrarCodigo(barcodeOriginal) {
  if (!viajeActivo) {
    setStatus("Debes activar un viaje antes de re-registrar", "warn");
    return;
  }

  const confirmar = confirm(`¿Deseas re-registrar el código ${barcodeOriginal}?`);
  if (!confirmar) return;

  try {
    const res = await fetch("/api/reregistrar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        viaje: viajeActivo,
        barcode: barcodeOriginal,
      }),
    });

    const json = await res.json();

    if (!json.ok) {
      setStatus(json.error || "No se pudo re-registrar", "error");
      return;
    }

    setStatus(`${barcodeOriginal} → RE-REGISTRADO como ${json.data.barcode}`, "ok");

    // quitar el original de la vista local
    cacheDetalle = cacheDetalle.filter(r => r.barcode !== barcodeOriginal);

    renderDetalle(cacheDetalle);
    renderYaRegistrados(cacheDetalle);
    refrescarResumenPorVariedad();

    await refrescarTodo();
  } catch (err) {
    console.error("Error en re-registro:", err);
    setStatus("Error en re-registro", "error");
  }
}

async function refrescarResumen() {
  if (!viajeActivo) {
    limpiarResumenViaje();
    return;
  }

  try {
    const res = await fetch(`/api/viajes/${encodeURIComponent(viajeActivo)}/resumen`);
    if (!res.ok) return;

    const json = await res.json();

    const okSesion = json.sesionActual?.ok ?? 0;
    const reregSesion = json.sesionActual?.reregistrados ?? 0;
    const duplicados = json.sesionActual?.duplicados ?? 0;
    const errores = json.sesionActual?.errores ?? 0;
    const okAcumulado = json.acumulado?.ok ?? 0;
    const reregAcumulado = json.acumulado?.reregistrados ?? 0;

    setText(totalEscaneados, okSesion + reregSesion);
    setText(totalDuplicados, duplicados);
    setText(totalErrores, errores);
    setText(totalAcumuladoGeneral, okAcumulado + reregAcumulado);

    actualizarAlertasResumen(duplicados, errores);
  } catch (err) {
    console.error("Error refrescando resumen:", err);
  }
}

async function refrescarResumenDesdeBD() {
  if (!viajeActivo) return;

  try {
    const res = await fetch(`/api/viajes/${encodeURIComponent(viajeActivo)}/resumen-db`);

    if (!res.ok) {
      console.error("Error refrescando resumen DB: HTTP", res.status);
      return;
    }

    const json = await res.json();
    if (!json.ok) return;

    const row = json.data || {};
    const ok = Number(row.ok || 0);
    const rereg = Number(row.reregistrados || 0);

    // solo acumulado
    setText(totalAcumuladoGeneral, ok + rereg);
  } catch (err) {
    console.error("Error refrescando resumen DB:", err);
  }
}

async function refrescarPivot() {
  if (!pivotBody) return;

  if (!viajeActivo) {
    setHTML(pivotBody, `
      <tr>
        <td colspan="8" class="empty-row">Sin datos para mostrar.</td>
      </tr>
    `);
    return;
  }

  try {
    const res = await fetch(`/api/viajes/${encodeURIComponent(viajeActivo)}/pivot`);
    if (!res.ok) return;

    const json = await res.json();

    if (!json.data.length) {
      setHTML(pivotBody, `
        <tr>
          <td colspan="8" class="empty-row">Sin datos para mostrar.</td>
        </tr>
      `);
      return;
    }

    pivotBody.innerHTML = "";

    json.data.forEach((row) => {
      const tr = document.createElement("tr");

      tr.dataset.bloque = row.bloque ?? "";
      tr.dataset.variedad = row.variedad ?? "";
      tr.dataset.tamano = row.tamano ?? "NA";
      tr.dataset.tallos = row.tallos ?? "";
      tr.dataset.tabacos = row.tabacos ?? 0;
      tr.dataset.suma = row.suma_tallos ?? 0;
      tr.dataset.etapa = row.etapa ?? "";

      tr.innerHTML = `
        <td>${row.bloque ?? ""}</td>
        <td>${row.variedad ?? ""}</td>
        <td>${row.tamano ?? ""}</td>
        <td>${row.tallos ?? ""}</td>
        <td>${row.etapa ?? ""}</td>
        <td class="cell-green">${row.tabacos ?? 0}</td>
        <td class="cell-blue">${row.suma_tallos ?? 0}</td>
        <td><button onclick="verDetalleFila(this)">Ver</button></td>
      `;

      pivotBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error refrescando pivot:", err);
  }
}

function refrescarResumenPorVariedad() {
  if (!resumenVariedadBody) return;

  if (!viajeActivo || !cacheDetalle.length) {
    resumenVariedadBody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-row">Sin registros por variedad.</td>
      </tr>
    `;
    return;
  }

  const agrupado = {};

  cacheDetalle.forEach((row) => {
    if (!["OK", "REREGISTRADO"].includes(row.resultado)) return;

    const variedad = String(row.variedad || "Sin variedad").trim();

    if (!agrupado[variedad]) {
      agrupado[variedad] = {
        variedad,
        tabacos: 0,
        totalTallos: 0
      };
    }

    agrupado[variedad].tabacos += 1;
    agrupado[variedad].totalTallos += Number(row.tallos || 0);
  });

  const filas = Object.values(agrupado).sort((a, b) =>
    a.variedad.localeCompare(b.variedad)
  );

  if (!filas.length) {
    resumenVariedadBody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-row">Sin registros por variedad.</td>
      </tr>
    `;
    return;
  }

  resumenVariedadBody.innerHTML = filas.map((item) => `
    <tr>
      <td>${item.variedad}</td>
      <td class="cell-green">${item.tabacos}</td>
      <td class="cell-blue">${item.totalTallos}</td>
    </tr>
  `).join("");
}

function badgeResultado(resultado) {
  if (resultado === "OK") return `<span class="badge badge-ok">OK</span>`;
  if (resultado === "YA_REGISTRADO") return `<span class="badge badge-dup">YA REGISTRADO</span>`;
  if (resultado === "NO_EXISTE") return `<span class="badge badge-bad">NO EXISTE</span>`;
  if (resultado === "REREGISTRADO") return `<span class="badge badge-ok">RE-REGISTRADO</span>`;
  return resultado || "";
}

function renderYaRegistrados(data) {
  if (!yaRegistradosLista) return;

  const duplicados = data
    .filter((x) => x.resultado === "YA_REGISTRADO" && !x.reregistrado_hecho)
    .slice(0, 8);

  if (!duplicados.length) {
    yaRegistradosLista.innerHTML = `<div class="ya-registrado-item">Sin novedades.</div>`;
    return;
  }

  yaRegistradosLista.innerHTML = duplicados.map((row) => {
    const fecha = row.fechaAnterior
      ? new Date(row.fechaAnterior).toLocaleString("es-CO")
      : "Fecha no disponible";

    return `
      <div class="ya-registrado-item">
        <strong>${row.barcode}</strong><br>
        Variedad: ${row.variedad ?? "-"} | Bloque: ${row.bloque ?? "-"} | Tamaño: ${row.tamano ?? "-"}<br>
        Ya existía desde: ${fecha}<br><br>
        <button class="btn-primary btn-reregistrar" data-barcode="${row.barcode}">
          Re-registrar
        </button>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-reregistrar").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const barcode = btn.dataset.barcode;
      await reregistrarCodigo(barcode);
    });
  });
}

function renderDetalle(data) {
  if (!detalleBody) return;

  const visibles = data.filter(r => !r.reregistrado_hecho);

  if (!visibles.length) {
    setHTML(detalleBody, `
      <tr>
        <td colspan="14" class="empty-row">Sin registros todavía.</td>
      </tr>
    `);
    return;
  }

  detalleBody.innerHTML = "";

  visibles.forEach((row) => {
    const fecha = new Date(row.fecha).toLocaleString("es-CO");

    let acciones = `<button class="btn-delete" data-id="${row.id_local}">Eliminar</button>`;

    if (row.resultado === "YA_REGISTRADO" && !row.reregistrado_hecho) {
      acciones += ` <button class="btn-primary btn-reregistrar-tabla" data-barcode="${row.barcode}">Re-registrar</button>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fecha}</td>
      <td>${viajeActivo}</td>
      <td>${row.barcode ?? ""}</td>
      <td>${row.tipo ?? ""}</td>
      <td>${row.serial ?? ""}</td>
      <td>${row.bloque ?? ""}</td>
      <td>${row.variedad ?? ""}</td>
      <td>${row.tamano ?? ""}</td>
      <td>${row.tallos ?? ""}</td>
      <td>${row.etapa ?? ""}</td>
      <td>${row.form ?? ""}</td>
      <td>${badgeResultado(row.resultado)}</td>
      <td>${row.observacion ?? ""}</td>
      <td>${acciones}</td>
    `;
    detalleBody.appendChild(tr);
  });

  detalleBody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idLocal = btn.dataset.id;
      await eliminarRegistro(idLocal);
    });
  });

  detalleBody.querySelectorAll(".btn-reregistrar-tabla").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const barcode = btn.dataset.barcode;
      await reregistrarCodigo(barcode);
    });
  });
}

async function refrescarDetalle() {
  if (!detalleBody) return;

  if (!viajeActivo) {
    setHTML(detalleBody, `
      <tr>
        <td colspan="14" class="empty-row">Sin registros todavía.</td>
      </tr>
    `);

    if (resumenVariedadBody) {
      resumenVariedadBody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-row">Sin registros por variedad.</td>
        </tr>
      `;
    }

    return;
  }

  try {
    const res = await fetch(`/api/viajes/${encodeURIComponent(viajeActivo)}/detalle`);
    if (!res.ok) return;

    const json = await res.json();

    cacheDetalle = (json.data || []).filter(r => !r.reregistrado_hecho);

    renderYaRegistrados(cacheDetalle);
    renderDetalle(cacheDetalle);
    refrescarResumenPorVariedad();
  } catch (err) {
    console.error("Error refrescando detalle:", err);
  }
}

async function eliminarRegistro(idLocal) {
  if (!viajeActivo) return;

  const confirmar = confirm("¿Eliminar este registro del viaje actual?");
  if (!confirmar) return;

  try {
    const res = await fetch(`/api/viajes/${encodeURIComponent(viajeActivo)}/detalle/${idLocal}`, {
      method: "DELETE",
    });

    const json = await res.json();

    if (!json.ok) {
      setStatus(json.error || "No se pudo eliminar", "error");
      return;
    }

    setStatus("Registro eliminado del viaje actual", "ok");
    await refrescarTodo();
  } catch (err) {
    console.error("Error eliminando registro:", err);
    setStatus("Error al eliminar registro", "error");
  }
}

async function eliminarRegistroReal(barcode) {
  const confirmar = confirm(`¿Eliminar definitivamente el registro ${barcode} de la base de datos?`);
  if (!confirmar) return;

  try {
    const res = await fetch(`/api/registros/${encodeURIComponent(barcode)}`, {
      method: "DELETE"
    });

    const json = await res.json();

    if (!json.ok) {
      setStatus(json.error || "No se pudo eliminar de la base de datos", "error");
      return;
    }

    setStatus(`Registro ${barcode} eliminado de la base de datos`, "ok");

    await refrescarTodo();

    const bloque = bloqueGeneralSelect?.value || "";
    const variedad = variedadGeneralSelect?.value || "";

    if (bloque) {
      await cargarResumenGeneralPorBloque(bloque, variedad);
      await cargarDetalleGeneralPorBloque(bloque, variedad);
    }
  } catch (err) {
    console.error("Error eliminando registro real:", err);
    setStatus("Error eliminando de la base de datos", "error");
  }
}

async function refrescarTodo() {
  await refrescarResumen();         // sesión actual
  await refrescarPivot();           // sesión actual
  await refrescarDetalle();         // sesión actual
  await refrescarResumenDesdeBD();  // acumulado histórico
  await cargarContadorGeneralBD();

  const bloqueSeleccionado = bloqueGeneralSelect?.value || "";
  const variedadSeleccionada = variedadGeneralSelect?.value || "";

  await cargarBloquesGenerales();

  if (bloqueSeleccionado) {
    await cargarVariedadesGeneralesPorBloque(bloqueSeleccionado, variedadSeleccionada);
    await cargarResumenGeneralPorBloque(bloqueSeleccionado, variedadSeleccionada);
    await cargarDetalleGeneralPorBloque(bloqueSeleccionado, variedadSeleccionada);
  }
}

function limpiarScanBuffer() {
  scanBuffer = "";
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
}

async function procesarScanBuffer() {
  const codigo = String(scanBuffer || "").trim();
  limpiarScanBuffer();

  if (!codigo) return;

  if (barcodeInput) {
    barcodeInput.value = "";
  }

  await escanearCodigo(codigo);
}

document.addEventListener("keydown", async (e) => {
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") {
    return;
  }

  const tag = (document.activeElement?.tagName || "").toLowerCase();
  const esCampoEditable =
    tag === "input" ||
    tag === "textarea" ||
    document.activeElement?.isContentEditable;

  if (esCampoEditable && document.activeElement !== barcodeInput) {
    return;
  }

  if (e.key === "Enter") {
    if (scanBuffer.trim()) {
      e.preventDefault();
      await procesarScanBuffer();
    }
    return;
  }

  if (e.key.length === 1) {
    scanBuffer += e.key;

    if (barcodeInput) {
      barcodeInput.value = scanBuffer;
    }

    if (scanTimer) {
      clearTimeout(scanTimer);
    }

    scanTimer = setTimeout(async () => {
      await procesarScanBuffer();
    }, SCAN_GAP_MS);
  }
});

function verDetalleFila(btn) {
  const tr = btn.closest("tr");

  const bloque = tr.dataset.bloque;
  const variedad = tr.dataset.variedad;
  const tamano = tr.dataset.tamano;
  const tallos = tr.dataset.tallos;
  const tabacos = tr.dataset.tabacos;
  const suma = tr.dataset.suma;

  alert(
    `DETALLE\n\n` +
    `Bloque: ${bloque}\n` +
    `Variedad: ${variedad}\n` +
    `Tamaño: ${tamano}\n` +
    `Tallos por tabaco: ${tallos}\n` +
    `Tabacos: ${tabacos}\n` +
    `Suma de tallos: ${suma}`
  );
}

if (finalizarBtn) {
  finalizarBtn.addEventListener("click", finalizarViaje);
}

if (bloqueGeneralSelect) {
  bloqueGeneralSelect.addEventListener("change", async () => {
    const bloque = bloqueGeneralSelect.value;

    await cargarVariedadesGeneralesPorBloque(bloque, "");
    if (variedadGeneralSelect) {
      variedadGeneralSelect.value = "";
    }

    guardarEstadoUI();

    await cargarResumenGeneralPorBloque(bloque, "");
    await cargarDetalleGeneralPorBloque(bloque, "");
  });
}

if (variedadGeneralSelect) {
  variedadGeneralSelect.addEventListener("change", async () => {
    const bloque = bloqueGeneralSelect?.value || "";
    const variedad = variedadGeneralSelect.value;

    guardarEstadoUI();

    await cargarResumenGeneralPorBloque(bloque, variedad);
    await cargarDetalleGeneralPorBloque(bloque, variedad);
  });
}

window.addEventListener("load", async () => {
  await cargarContadorGeneralBD();
  await cargarBloquesGenerales();
  await cargarViajes();
  limpiarResumenViaje();
  limpiarConsultaGeneral();

  const { viajeGuardado, bloqueGuardado, variedadGuardada } = restaurarEstadoUI();

  if (viajeGuardado) {
    viajeActivo = viajeGuardado;
    setText(viajeActivoLabel, viajeGuardado);

    document.querySelectorAll(".btn-viaje").forEach((b) => {
      if (b.textContent === viajeGuardado) {
        b.classList.add("activo");
      } else {
        b.classList.remove("activo");
      }
    });

    // sesión actual limpia
    setText(totalEscaneados, 0);
    setText(totalDuplicados, 0);
    setText(totalErrores, 0);
    actualizarAlertasResumen(0, 0);

    cacheDetalle = [];

    if (detalleBody) {
      detalleBody.innerHTML = `
        <tr>
          <td colspan="14" class="empty-row">Sin registros todavía.</td>
        </tr>
      `;
    }

    if (pivotBody) {
      pivotBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-row">Sin datos para mostrar.</td>
        </tr>
      `;
    }

    if (yaRegistradosLista) {
      yaRegistradosLista.innerHTML = `<div class="ya-registrado-item">Sin novedades.</div>`;
    }

    if (resumenVariedadBody) {
      resumenVariedadBody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-row">Sin registros por variedad.</td>
        </tr>
      `;
    }

    // solo acumulado histórico
    await refrescarResumenDesdeBD();
    await cargarContadorGeneralBD();
    iniciarAutoRefreshViaje();
  }

  if (bloqueGuardado) {
    bloqueGeneralSelect.value = bloqueGuardado;
    await cargarVariedadesGeneralesPorBloque(bloqueGuardado, variedadGuardada || "");

    if (variedadGuardada) {
      variedadGeneralSelect.value = variedadGuardada;
    }

    await cargarResumenGeneralPorBloque(bloqueGuardado, variedadGuardada || "");
    await cargarDetalleGeneralPorBloque(bloqueGuardado, variedadGuardada || "");
  }
});