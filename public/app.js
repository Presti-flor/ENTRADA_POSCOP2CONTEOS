/////////////////////// CLAVE /////////////////////////////// const CLAVE = "123"; // cámbiala

function pedirAcceso() { const guardado = localStorage.getItem("acceso_ok");

if (guardado === "true") return true;

const intento = prompt("Ingrese contraseña:");

if (intento === CLAVE) { localStorage.setItem("acceso_ok", "true"); return true; }

alert("Acceso denegado"); location.reload(); return false; } /////////////////////// CLAVE ///////////////////////////////

let viajeActivo = ""; let cacheDetalle = []; let autoRefreshTimer = null; let ultimoAcumulado = null; let scannerActivo = true; let bufferScanner = ""; let scannerTimer = null;

let cardDuplicados; let cardErrores; let finalizarBtn; let barcodeInput; let formInput; let statusBar; let resumenVariedadBody; let viajeActivoLabel; let totalEscaneados; let totalDuplicados; let totalErrores; let totalAcumuladoGeneral; let pivotBody; let detalleBody; let yaRegistradosLista; let contadorGeneralBd; let contadorTallosGeneralBd; let bloqueGeneralSelect; let variedadGeneralSelect; let generalBloqueBody; let generalBloqueDetalleBody;

function obtenerElemento(id) { return document.getElementById(id); }

function cargarElementosDOM() { cardDuplicados = obtenerElemento("card-duplicados"); cardErrores = obtenerElemento("card-errores"); finalizarBtn = obtenerElemento("finalizar-viaje-btn"); barcodeInput = obtenerElemento("barcode"); formInput = obtenerElemento("form"); statusBar = obtenerElemento("status-bar"); resumenVariedadBody = obtenerElemento("resumen-variedad-body"); viajeActivoLabel = obtenerElemento("viaje-activo-label"); totalEscaneados = obtenerElemento("total-escaneados"); totalDuplicados = obtenerElemento("total-duplicados"); totalErrores = obtenerElemento("total-errores"); totalAcumuladoGeneral = obtenerElemento("total-acumulado-general"); pivotBody = obtenerElemento("pivot-body"); detalleBody = obtenerElemento("detalle-body"); yaRegistradosLista = obtenerElemento("ya-registrados-lista"); contadorGeneralBd = obtenerElemento("contador-general-bd"); contadorTallosGeneralBd = obtenerElemento("contador-tallos-general-bd"); bloqueGeneralSelect = obtenerElemento("bloque-general-select"); variedadGeneralSelect = obtenerElemento("variedad-general-select"); generalBloqueBody = obtenerElemento("general-bloque-body"); generalBloqueDetalleBody = obtenerElemento("general-bloque-detalle-body"); }

function setText(el, value) { if (el) el.textContent = value; }

function setHTML(el, value) { if (el) el.innerHTML = value; }

function valorSeguro(value, fallback) { if (value === null || value === undefined) return fallback; return value; }

function setAcumuladoSeguro(valor) { if (valor !== ultimoAcumulado) { ultimoAcumulado = valor; setText(totalAcumuladoGeneral, valor); } }

function setStatus(texto, tipo) { if (!tipo) tipo = "neutral"; if (!statusBar) return; statusBar.textContent = texto; statusBar.className = "status-bar status-" + tipo; }

function mantenerFoco() { if (!scannerActivo || !barcodeInput) return;

const x = window.scrollX; const y = window.scrollY;

setTimeout(function () { if (!scannerActivo || !barcodeInput) return;

try {
  barcodeInput.focus({ preventScroll: true });
} catch (err) {
  barcodeInput.focus();
}

window.scrollTo(x, y);

}, 80); }

function pausarScanner() { scannerActivo = false; }

function activarScanner() { scannerActivo = true; mantenerFoco(); }

function valorInput(el) { if (!el) return ""; return String(el.value || "").trim(); }

function guardarEstadoUI() { localStorage.setItem("viajeActivoUI", viajeActivo || ""); localStorage.setItem("bloqueGeneralUI", bloqueGeneralSelect ? bloqueGeneralSelect.value : ""); localStorage.setItem("variedadGeneralUI", variedadGeneralSelect ? variedadGeneralSelect.value : ""); }

function restaurarEstadoUI() { return { viajeGuardado: localStorage.getItem("viajeActivoUI") || "", bloqueGuardado: localStorage.getItem("bloqueGeneralUI") || "", variedadGuardada: localStorage.getItem("variedadGeneralUI") || "" }; }

function actualizarAlertasResumen(duplicados, errores) { if (cardDuplicados) { cardDuplicados.classList.toggle("alerta-duplicados", Number(duplicados || 0) > 0); }

if (cardErrores) { cardErrores.classList.toggle("alerta-errores", Number(errores || 0) > 0); } }

function limpiarResumenViaje() { setText(totalEscaneados, 0); setText(totalDuplicados, 0); setText(totalErrores, 0); setText(totalAcumuladoGeneral, 0); ultimoAcumulado = null; setText(viajeActivoLabel, "Sin viaje");

actualizarAlertasResumen(0, 0);

setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>'); setHTML(pivotBody, '<tr><td colspan="8" class="empty-row">Sin datos para mostrar.</td></tr>'); setHTML(detalleBody, '<tr><td colspan="11" class="empty-row">Sin registros todavía.</td></tr>'); setHTML(yaRegistradosLista, '<div class="ya-registrado-item">Sin novedades.</div>');

cacheDetalle = []; }

function limpiarConsultaGeneral() { setHTML(generalBloqueBody, '<tr><td colspan="7" class="empty-row">Selecciona un bloque o variedad para consultar.</td></tr>'); setHTML(generalBloqueDetalleBody, '<tr><td colspan="13" class="empty-row">Sin datos para mostrar.</td></tr>'); }

async function fetchJSON(url, opciones) { const res = await fetch(url, opciones || {}); let json = {};

try { json = await res.json(); } catch (err) { json = {}; }

return { okHTTP: res.ok, status: res.status, json: json }; }

async function cargarContadorGeneralBD() { try { const respuesta = await fetchJSON("/api/general/contador"); const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) return;

setText(contadorGeneralBd, valorSeguro(json.total, 0));
setText(contadorTallosGeneralBd, valorSeguro(json.total_tallos, 0));

} catch (err) { console.error("Error cargando contador general BD:", err); } }

async function cargarBloquesGenerales() { if (!bloqueGeneralSelect) return;

try { const seleccionado = bloqueGeneralSelect.value || ""; const respuesta = await fetchJSON("/api/general/bloques"); const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok || !Array.isArray(json.data)) return;

bloqueGeneralSelect.innerHTML = '<option value="">Seleccionar bloque</option>';

json.data.forEach(function (bloque) {
  const option = document.createElement("option");
  option.value = String(bloque);
  option.textContent = String(bloque);

  if (String(bloque) === String(seleccionado)) {
    option.selected = true;
  }

  bloqueGeneralSelect.appendChild(option);
});

} catch (err) { console.error("Error cargando bloques generales:", err); } }

async function cargarVariedadesGeneralesPorBloque(bloque, variedadSeleccionada) { if (!variedadGeneralSelect) return; if (!variedadSeleccionada) variedadSeleccionada = "";

variedadGeneralSelect.innerHTML = '<option value="">Seleccionar variedad</option>';

if (!bloque) return;

try { const url = "/api/general/bloque/" + encodeURIComponent(bloque) + "/variedades"; const respuesta = await fetchJSON(url); const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok || !Array.isArray(json.data)) return;

json.data.forEach(function (variedad) {
  const option = document.createElement("option");
  option.value = variedad;
  option.textContent = variedad;

  if (variedadSeleccionada && variedadSeleccionada === variedad) {
    option.selected = true;
  }

  variedadGeneralSelect.appendChild(option);
});

} catch (err) { console.error("Error cargando variedades por bloque:", err); } }

async function cargarResumenGeneralPorBloque(bloque, variedad) { if (!generalBloqueBody) return; if (!variedad) variedad = "";

if (!bloque) { limpiarConsultaGeneral(); return; }

try { let url = "/api/general/bloque/" + encodeURIComponent(bloque);

if (variedad) {
  url += "?variedad=" + encodeURIComponent(variedad);
}

const respuesta = await fetchJSON(url);
const json = respuesta.json;

if (!respuesta.okHTTP) {
  setHTML(generalBloqueBody, '<tr><td colspan="7" class="empty-row">Error cargando el resumen del bloque.</td></tr>');
  return;
}

if (!json.ok || !Array.isArray(json.data) || json.data.length === 0) {
  setHTML(generalBloqueBody, '<tr><td colspan="7" class="empty-row">No hay datos para este filtro.</td></tr>');
  return;
}

generalBloqueBody.innerHTML = "";

json.data.forEach(function (row) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    "<td>" + valorSeguro(row.bloque, "") + "</td>" +
    "<td>" + valorSeguro(row.variedad, "") + "</td>" +
    "<td>" + valorSeguro(row.tamano, "") + "</td>" +
    "<td>" + valorSeguro(row.tallos, "") + "</td>" +
    "<td>" + valorSeguro(row.etapa, "") + "</td>" +
    '<td class="cell-green">' + valorSeguro(row.tabacos, 0) + "</td>" +
    '<td class="cell-blue">' + valorSeguro(row.suma_tallos, 0) + "</td>";

  generalBloqueBody.appendChild(tr);
});

} catch (err) { console.error("Error cargando resumen del bloque:", err); setHTML(generalBloqueBody, '<tr><td colspan="7" class="empty-row">Error cargando el resumen del bloque.</td></tr>'); } }

async function cargarDetalleGeneralPorBloque(bloque, variedad) { if (!generalBloqueDetalleBody) return; if (!variedad) variedad = "";

if (!bloque) { setHTML(generalBloqueDetalleBody, '<tr><td colspan="13" class="empty-row">Sin datos para mostrar.</td></tr>'); return; }

try { let url = "/api/general/bloque/" + encodeURIComponent(bloque) + "/detalle";

if (variedad) {
  url += "?variedad=" + encodeURIComponent(variedad);
}

const respuesta = await fetchJSON(url);
const json = respuesta.json;

if (!respuesta.okHTTP) {
  setHTML(generalBloqueDetalleBody, '<tr><td colspan="13" class="empty-row">Error cargando el detalle del bloque.</td></tr>');
  return;
}

if (!json.ok || !Array.isArray(json.data) || json.data.length === 0) {
  setHTML(generalBloqueDetalleBody, '<tr><td colspan="13" class="empty-row">No hay registros para este filtro.</td></tr>');
  return;
}

generalBloqueDetalleBody.innerHTML = "";

json.data.forEach(function (row) {
  const fecha = row.created_at ? new Date(row.created_at).toLocaleString("es-CO") : "";
  const tr = document.createElement("tr");
  const barcode = valorSeguro(row.barcode, "");

  tr.innerHTML =
    "<td>" + fecha + "</td>" +
    "<td>" + barcode + "</td>" +
    "<td>" + valorSeguro(row.tipo, "") + "</td>" +
    "<td>" + valorSeguro(row.serial, "") + "</td>" +
    "<td>" + valorSeguro(row.variedad, "") + "</td>" +
    "<td>" + valorSeguro(row.bloque, "") + "</td>" +
    "<td>" + valorSeguro(row.tamano, "") + "</td>" +
    "<td>" + valorSeguro(row.tallos, "") + "</td>" +
    "<td>" + valorSeguro(row.etapa, "") + "</td>" +
    "<td>" + valorSeguro(row.form, "") + "</td>" +
    "<td>" + valorSeguro(row.barcode_origen, "") + "</td>" +
    "<td>" + (row.es_reregistro === true ? "Sí" : "No") + "</td>" +
    '<td><button type="button" class="btn-delete-general" data-barcode="' + barcode + '">Eliminar</button></td>';

  generalBloqueDetalleBody.appendChild(tr);
});

generalBloqueDetalleBody.querySelectorAll(".btn-delete-general").forEach(function (btn) {
  btn.addEventListener("click", async function () {
    await eliminarRegistroReal(btn.getAttribute("data-barcode"));
  });
});

} catch (err) { console.error("Error cargando detalle del bloque:", err); setHTML(generalBloqueDetalleBody, '<tr><td colspan="13" class="empty-row">Error cargando el detalle del bloque.</td></tr>'); } }

async function cargarViajes() { const contenedor = obtenerElemento("viajes-botones"); if (!contenedor) return;

try { const respuesta = await fetchJSON("/api/viajes"); const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok || !Array.isArray(json.data)) {
  contenedor.innerHTML = "";
  return;
}

contenedor.innerHTML = "";

json.data.forEach(function (nombre) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-viaje";
  btn.textContent = nombre;

  btn.addEventListener("click", async function () {
    await activarViaje(nombre);
  });

  contenedor.appendChild(btn);
});

} catch (err) { console.error("Error cargando viajes:", err); } }

function iniciarAutoRefreshViaje() { if (autoRefreshTimer) clearInterval(autoRefreshTimer);

autoRefreshTimer = setInterval(async function () { if (!viajeActivo) return;

await refrescarResumen();
await refrescarDetalle();
await refrescarPivot();
await refrescarResumenDesdeBD();
await cargarContadorGeneralBD();

}, 3000); }

function detenerAutoRefreshViaje() { if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; } }

async function activarViaje(nombre) { try { const viajeNombre = String(nombre || "").trim();

if (!viajeNombre) {
  setStatus("Debes seleccionar un viaje", "warn");
  mantenerFoco();
  return;
}

const respuesta = await fetchJSON("/api/viajes/activar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ nombre: viajeNombre })
});

const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) {
  setStatus(json.error || "No se pudo activar el viaje", "error");
  mantenerFoco();
  return;
}

viajeActivo = viajeNombre;
guardarEstadoUI();
detenerAutoRefreshViaje();

document.querySelectorAll(".btn-viaje").forEach(function (b) {
  b.classList.remove("activo");
  if (b.textContent === viajeNombre) b.classList.add("activo");
});

setText(viajeActivoLabel, viajeNombre);
setText(totalEscaneados, 0);
setText(totalDuplicados, 0);
setText(totalErrores, 0);
actualizarAlertasResumen(0, 0);

cacheDetalle = [];

setHTML(detalleBody, '<tr><td colspan="11" class="empty-row">Sin registros todavía.</td></tr>');
setHTML(pivotBody, '<tr><td colspan="8" class="empty-row">Sin datos para mostrar.</td></tr>');
setHTML(yaRegistradosLista, '<div class="ya-registrado-item">Sin novedades.</div>');
setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>');

await refrescarResumenDesdeBD();
await cargarContadorGeneralBD();

setStatus("Viaje " + viajeNombre + " activado", "ok");
iniciarAutoRefreshViaje();
mantenerFoco();

} catch (err) { console.error("Error activando viaje:", err); setStatus("Error activando viaje", "error"); mantenerFoco(); } }

async function finalizarViaje() { if (!viajeActivo) { setStatus("No hay viaje activo", "warn"); mantenerFoco(); return; }

pausarScanner(); const confirmar = confirm("¿Finalizar el viaje " + viajeActivo + "?"); scannerActivo = true;

if (!confirmar) { mantenerFoco(); return; }

try { const nombreFinalizar = viajeActivo;

const respuesta = await fetchJSON("/api/viajes/finalizar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ nombre: nombreFinalizar })
});

const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) {
  setStatus(json.error || "No se pudo finalizar", "error");
  mantenerFoco();
  return;
}

setStatus("Viaje " + nombreFinalizar + " finalizado", "ok");
viajeActivo = "";
guardarEstadoUI();
detenerAutoRefreshViaje();

document.querySelectorAll(".btn-viaje").forEach(function (b) {
  b.classList.remove("activo");
});

limpiarResumenViaje();
if (barcodeInput) barcodeInput.value = "";
mantenerFoco();

} catch (err) { console.error("Error finalizando viaje:", err); setStatus("Error finalizando viaje", "error"); mantenerFoco(); } }

async function escanearCodigo(barcode) { try { const barcodeLimpio = String(barcode || "").trim();

if (!viajeActivo) {
  setStatus("Debes activar un viaje antes de escanear", "warn");
  mantenerFoco();
  return;
}

if (!barcodeLimpio) {
  setStatus("El barcode está vacío", "warn");
  mantenerFoco();
  return;
}

const respuesta = await fetchJSON("/api/escanear", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    barcode: barcodeLimpio,
    viaje: viajeActivo,
    form: valorInput(formInput)
  })
});

const data = respuesta.json;

if (!respuesta.okHTTP || !data.ok) {
  setStatus(data.error || "Error al escanear", "error");
  console.error("Error backend /api/escanear:", data);
  mantenerFoco();
  return;
}

if (data.resultado === "OK") {
  setStatus(barcodeLimpio + " → REGISTRADO", "ok");
} else if (data.resultado === "YA_REGISTRADO") {
  setStatus(barcodeLimpio + " → YA REGISTRADO", "warn");
} else if (data.resultado === "REREGISTRADO") {
  setStatus(barcodeLimpio + " → RE-REGISTRADO", "ok");
} else if (data.resultado === "NO_EXISTE") {
  setStatus(barcodeLimpio + " → NO EXISTE", "error");
} else {
  setStatus("Escaneo procesado: " + barcodeLimpio, "ok");
}

await refrescarTodo();
mantenerFoco();

} catch (error) { console.error("Error escaneando:", error); setStatus("Error escaneando", "error"); mantenerFoco(); } }

async function reregistrarCodigo(barcodeOriginal) { if (!viajeActivo) { setStatus("Debes activar un viaje antes de re-registrar", "warn"); mantenerFoco(); return; }

pausarScanner(); const confirmar = confirm("¿Deseas re-registrar el código " + barcodeOriginal + "?"); scannerActivo = true;

if (!confirmar) { mantenerFoco(); return; }

try { const respuesta = await fetchJSON("/api/reregistrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viaje: viajeActivo, barcode: barcodeOriginal }) });

const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) {
  setStatus(json.error || "No se pudo re-registrar", "error");
  mantenerFoco();
  return;
}

const nuevoBarcode = json.data && json.data.barcode ? json.data.barcode : "nuevo registro";
setStatus(barcodeOriginal + " → RE-REGISTRADO como " + nuevoBarcode, "ok");

await refrescarTodo();
mantenerFoco();

} catch (err) { console.error("Error en re-registro:", err); setStatus("Error en re-registro", "error"); mantenerFoco(); } }

async function refrescarResumen() { if (!viajeActivo) { limpiarResumenViaje(); return; }

try { const respuesta = await fetchJSON("/api/viajes/" + encodeURIComponent(viajeActivo) + "/resumen"); const json = respuesta.json;

if (!respuesta.okHTTP) return;

const sesion = json.sesionActual || {};
const okSesion = Number(sesion.ok || 0);
const reregSesion = Number(sesion.reregistrados || 0);
const duplicados = Number(sesion.duplicados || 0);
const errores = Number(sesion.errores || 0);

setText(totalEscaneados, okSesion + reregSesion);
setText(totalDuplicados, duplicados);
setText(totalErrores, errores);

actualizarAlertasResumen(duplicados, errores);

} catch (err) { console.error("Error refrescando resumen:", err); } }

async function refrescarResumenDesdeBD() { if (!viajeActivo) return;

try { const respuesta = await fetchJSON("/api/viajes/" + encodeURIComponent(viajeActivo) + "/resumen-db"); const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) return;

const row = json.data || {};
const ok = Number(row.ok || 0);
const rereg = Number(row.reregistrados || 0);

setAcumuladoSeguro(ok + rereg);

} catch (err) { console.error("Error refrescando resumen DB:", err); } }

async function refrescarPivot() { if (!pivotBody) return;

if (!viajeActivo) { setHTML(pivotBody, '<tr><td colspan="8" class="empty-row">Sin datos para mostrar.</td></tr>'); return; }

try { const respuesta = await fetchJSON("/api/viajes/" + encodeURIComponent(viajeActivo) + "/pivot"); const json = respuesta.json;

if (!respuesta.okHTTP || !Array.isArray(json.data) || json.data.length === 0) {
  setHTML(pivotBody, '<tr><td colspan="8" class="empty-row">Sin datos para mostrar.</td></tr>');
  return;
}

pivotBody.innerHTML = "";

json.data.forEach(function (row) {
  const tr = document.createElement("tr");

  tr.setAttribute("data-bloque", valorSeguro(row.bloque, ""));
  tr.setAttribute("data-variedad", valorSeguro(row.variedad, ""));
  tr.setAttribute("data-tamano", valorSeguro(row.tamano, "NA"));
  tr.setAttribute("data-tallos", valorSeguro(row.tallos, ""));
  tr.setAttribute("data-tabacos", valorSeguro(row.tabacos, 0));
  tr.setAttribute("data-suma", valorSeguro(row.suma_tallos, 0));
  tr.setAttribute("data-etapa", valorSeguro(row.etapa, ""));

  tr.innerHTML =
    "<td>" + valorSeguro(row.bloque, "") + "</td>" +
    "<td>" + valorSeguro(row.variedad, "") + "</td>" +
    "<td>" + valorSeguro(row.tamano, "") + "</td>" +
    "<td>" + valorSeguro(row.tallos, "") + "</td>" +
    "<td>" + valorSeguro(row.etapa, "") + "</td>" +
    '<td class="cell-green">' + valorSeguro(row.tabacos, 0) + "</td>" +
    '<td class="cell-blue">' + valorSeguro(row.suma_tallos, 0) + "</td>" +
    '<td><button type="button" class="btn-ver-detalle">Ver</button></td>';

  pivotBody.appendChild(tr);
});

pivotBody.querySelectorAll(".btn-ver-detalle").forEach(function (btn) {
  btn.addEventListener("click", function () {
    verDetalleFila(btn);
  });
});

} catch (err) { console.error("Error refrescando pivot:", err); } }

function refrescarResumenPorVariedad() { if (!resumenVariedadBody) return;

if (!viajeActivo || !cacheDetalle.length) { setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>'); return; }

const agrupado = {};

cacheDetalle.forEach(function (row) { if (row.resultado !== "OK" && row.resultado !== "REREGISTRADO") return;

const bloque = String(row.bloque || "N/A").trim();
const variedad = String(row.variedad || "Sin variedad").trim();
const tamano = String(row.tamano || "NA").trim();
const tallos = Number(row.tallos || 0);
const form = String(row.form || "").trim();
const etapa = String(row.etapa || "Ingreso").trim();
const tipo = String(row.tipo || "").trim();

const key = bloque + "|" + variedad + "|" + tamano + "|" + tallos + "|" + form + "|" + etapa + "|" + tipo;

if (!agrupado[key]) {
  agrupado[key] = {
    bloque: bloque,
    variedad: variedad,
    tamano: tamano,
    tallos: tallos,
    form: form,
    etapa: etapa,
    tipo: tipo,
    tabacos: 0,
    totalTallos: 0
  };
}

agrupado[key].tabacos += 1;
agrupado[key].totalTallos += tallos;

});

const filas = Object.keys(agrupado).map(function (key) { return agrupado[key]; });

filas.sort(function (a, b) { if (String(a.bloque) < String(b.bloque)) return -1; if (String(a.bloque) > String(b.bloque)) return 1; return String(a.variedad).localeCompare(String(b.variedad)); });

if (!filas.length) { setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>'); return; }

resumenVariedadBody.innerHTML = "";

filas.forEach(function (item) { const tr = document.createElement("tr");

tr.innerHTML =
  "<td>" + item.bloque + "</td>" +
  "<td>" + item.variedad + "</td>" +
  "<td>" + (item.tamano || "NA") + "</td>" +
  '<td class="cell-green">' + item.tabacos + "</td>" +
  '<td class="cell-blue">' + item.totalTallos + "</td>" +
  '<td><button type="button" class="btn-add-manual" title="Agregar un registro igual">+</button></td>';

const btn = tr.querySelector(".btn-add-manual");
btn.setAttribute("data-bloque", item.bloque);
btn.setAttribute("data-variedad", item.variedad);
btn.setAttribute("data-tamano", item.tamano || "");
btn.setAttribute("data-tallos", String(item.tallos));
btn.setAttribute("data-form", item.form || "");
btn.setAttribute("data-etapa", item.etapa || "Ingreso");
btn.setAttribute("data-tipo", item.tipo || "");

btn.addEventListener("click", async function () {
  await agregarRegistroManualDesdeResumen({
    bloque: btn.getAttribute("data-bloque"),
    variedad: btn.getAttribute("data-variedad"),
    tamano: btn.getAttribute("data-tamano"),
    tallos: Number(btn.getAttribute("data-tallos") || 0),
    form: btn.getAttribute("data-form"),
    etapa: btn.getAttribute("data-etapa"),
    tipo: btn.getAttribute("data-tipo")
  });
});

resumenVariedadBody.appendChild(tr);

}); }

function badgeResultado(resultado) { if (resultado === "OK") return '<span class="badge badge-ok">OK</span>'; if (resultado === "YA_REGISTRADO") return '<span class="badge badge-dup">YA REGISTRADO</span>'; if (resultado === "NO_EXISTE") return '<span class="badge badge-bad">NO EXISTE</span>'; if (resultado === "REREGISTRADO") return '<span class="badge badge-ok">RE-REGISTRADO</span>'; return resultado || ""; }

function renderYaRegistrados(data) { if (!yaRegistradosLista) return;

const duplicados = (data || []).filter(function (x) { return x.resultado === "YA_REGISTRADO" && x.puede_reregistrar === true; }).slice(0, 8);

if (!duplicados.length) { yaRegistradosLista.innerHTML = '<div class="ya-registrado-item">Sin novedades.</div>'; return; }

yaRegistradosLista.innerHTML = "";

duplicados.forEach(function (row) { const fecha = row.fechaAnterior ? new Date(row.fechaAnterior).toLocaleString("es-CO") : "Fecha no disponible"; const div = document.createElement("div"); div.className = "ya-registrado-item";

div.innerHTML =
  "<strong>" + valorSeguro(row.barcode, "") + "</strong><br>" +
  "Variedad: " + valorSeguro(row.variedad, "-") +
  " | Bloque: " + valorSeguro(row.bloque, "-") +
  " | Tamaño: " + valorSeguro(row.tamano, "-") + "<br>" +
  "Ya existía desde: " + fecha + "<br><br>" +
  '<button type="button" class="btn-primary btn-reregistrar" data-barcode="' + valorSeguro(row.barcode, "") + '">Re-registrar</button>';

yaRegistradosLista.appendChild(div);

});

yaRegistradosLista.querySelectorAll(".btn-reregistrar").forEach(function (btn) { btn.addEventListener("click", async function () { await reregistrarCodigo(btn.getAttribute("data-barcode")); }); }); }

function renderDetalle(data) { if (!detalleBody) return;

const visibles = data || [];

if (!visibles.length) { setHTML(detalleBody, '<tr><td colspan="11" class="empty-row">Sin registros todavía.</td></tr>'); return; }

detalleBody.innerHTML = "";

visibles.forEach(function (row) { const fecha = row.fecha ? new Date(row.fecha).toLocaleString("es-CO") : ""; const barcode = valorSeguro(row.barcode, "");

let acciones = '<button type="button" class="btn-delete" data-barcode="' + barcode + '">Eliminar</button>';

if (row.resultado === "YA_REGISTRADO" && row.puede_reregistrar === true) {
  acciones += ' <button type="button" class="btn-primary btn-reregistrar-tabla" data-barcode="' + barcode + '">Re-registrar</button>';
}

const observacionTexto = row.resultado === "REREGISTRADO" && row.barcode_origen
  ? "Re-registro de " + row.barcode_origen
  : valorSeguro(row.observacion, "");

const tr = document.createElement("tr");
tr.innerHTML =
  "<td>" + fecha + "</td>" +
  "<td>" + viajeActivo + "</td>" +
  "<td>" + barcode + "</td>" +
  "<td>" + valorSeguro(row.bloque, "") + "</td>" +
  "<td>" + valorSeguro(row.variedad, "") + "</td>" +
  "<td>" + valorSeguro(row.tamano, "") + "</td>" +
  "<td>" + valorSeguro(row.tallos, "") + "</td>" +
  "<td>" + valorSeguro(row.form, "") + "</td>" +
  "<td>" + badgeResultado(row.resultado) + "</td>" +
  "<td>" + observacionTexto + "</td>" +
  "<td>" + acciones + "</td>";

detalleBody.appendChild(tr);

});

detalleBody.querySelectorAll(".btn-delete").forEach(function (btn) { btn.addEventListener("click", async function () { await eliminarRegistroReal(btn.getAttribute("data-barcode")); }); });

detalleBody.querySelectorAll(".btn-reregistrar-tabla").forEach(function (btn) { btn.addEventListener("click", async function () { await reregistrarCodigo(btn.getAttribute("data-barcode")); }); }); }

async function agregarRegistroManualDesdeResumen(data) { if (!viajeActivo) { setStatus("Debes activar un viaje antes de agregar registros", "warn"); mantenerFoco(); return; }

try { const respuesta = await fetchJSON("/api/registros/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viaje: viajeActivo, bloque: data.bloque, variedad: data.variedad, tamano: data.tamano, tallos: data.tallos, form: data.form, etapa: data.etapa || "Ingreso", tipo: data.tipo }) });

const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) {
  setStatus(json.error || "No se pudo agregar el registro manual", "error");
  mantenerFoco();
  return;
}

setStatus("Registro agregado: " + data.variedad + " / " + (data.tamano || "NA") + " / " + data.tallos + " tallos", "ok");

await refrescarTodo();
mantenerFoco();

} catch (err) { console.error("Error agregando registro manual:", err); setStatus("Error agregando registro manual", "error"); mantenerFoco(); } }

async function refrescarDetalle() { if (!detalleBody) return;

if (!viajeActivo) { setHTML(detalleBody, '<tr><td colspan="11" class="empty-row">Sin registros todavía.</td></tr>'); setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>'); return; }

try { const respuesta = await fetchJSON("/api/viajes/" + encodeURIComponent(viajeActivo) + "/detalle"); const json = respuesta.json;

if (!respuesta.okHTTP || !Array.isArray(json.data)) return;

cacheDetalle = json.data || [];

renderYaRegistrados(cacheDetalle);
renderDetalle(cacheDetalle);
refrescarResumenPorVariedad();

} catch (err) { console.error("Error refrescando detalle:", err); } }

async function eliminarRegistroReal(barcode) { if (!barcode) { setStatus("No se encontró el barcode para eliminar", "error"); mantenerFoco(); return; }

pausarScanner(); const confirmar = confirm("¿Eliminar definitivamente el registro " + barcode + " de la base de datos?"); scannerActivo = true;

if (!confirmar) { mantenerFoco(); return; }

try { const respuesta = await fetchJSON("/api/registros/" + encodeURIComponent(barcode), { method: "DELETE" });

const json = respuesta.json;

if (!respuesta.okHTTP || !json.ok) {
  setStatus(json.error || "No se pudo eliminar de la base de datos", "error");
  mantenerFoco();
  return;
}

setStatus("Registro " + barcode + " eliminado de la base de datos", "ok");

await refrescarTodo();

const bloque = bloqueGeneralSelect ? bloqueGeneralSelect.value : "";
const variedad = variedadGeneralSelect ? variedadGeneralSelect.value : "";

if (bloque) {
  await cargarResumenGeneralPorBloque(bloque, variedad);
  await cargarDetalleGeneralPorBloque(bloque, variedad);
}

mantenerFoco();

} catch (err) { console.error("Error eliminando registro real:", err); setStatus("Error eliminando de la base de datos", "error"); mantenerFoco(); } }

async function refrescarTodo() { await refrescarResumen(); await refrescarPivot(); await refrescarDetalle(); await refrescarResumenDesdeBD(); await cargarContadorGeneralBD();

const bloqueSeleccionado = bloqueGeneralSelect ? bloqueGeneralSelect.value : ""; const variedadSeleccionada = variedadGeneralSelect ? variedadGeneralSelect.value : "";

await cargarBloquesGenerales();

if (bloqueSeleccionado) { if (bloqueGeneralSelect) bloqueGeneralSelect.value = bloqueSeleccionado; await cargarVariedadesGeneralesPorBloque(bloqueSeleccionado, variedadSeleccionada); if (variedadGeneralSelect) variedadGeneralSelect.value = variedadSeleccionada; await cargarResumenGeneralPorBloque(bloqueSeleccionado, variedadSeleccionada); await cargarDetalleGeneralPorBloque(bloqueSeleccionado, variedadSeleccionada); } }

function verDetalleFila(btn) { const tr = btn.closest("tr"); if (!tr) return;

const bloque = tr.getAttribute("data-bloque") || ""; const variedad = tr.getAttribute("data-variedad") || ""; const tamano = tr.getAttribute("data-tamano") || ""; const tallos = tr.getAttribute("data-tallos") || ""; const tabacos = tr.getAttribute("data-tabacos") || ""; const suma = tr.getAttribute("data-suma") || "";

pausarScanner(); alert( "DETALLE\n\n" + "Bloque: " + bloque + "\n" + "Variedad: " + variedad + "\n" + "Tamaño: " + tamano + "\n" + "Tallos por tabaco: " + tallos + "\n" + "Tabacos: " + tabacos + "\n" + "Suma de tallos: " + suma ); scannerActivo = true; mantenerFoco(); }

function configurarEventos() { if (finalizarBtn) { finalizarBtn.addEventListener("click", finalizarViaje); }

if (bloqueGeneralSelect) { bloqueGeneralSelect.addEventListener("focus", pausarScanner);

bloqueGeneralSelect.addEventListener("blur", function () {
  scannerActivo = true;
  mantenerFoco();
});

bloqueGeneralSelect.addEventListener("change", async function () {
  const bloque = bloqueGeneralSelect.value;

  await cargarVariedadesGeneralesPorBloque(bloque, "");
  if (variedadGeneralSelect) variedadGeneralSelect.value = "";

  guardarEstadoUI();

  await cargarResumenGeneralPorBloque(bloque, "");
  await cargarDetalleGeneralPorBloque(bloque, "");

  scannerActivo = true;
  mantenerFoco();
});

}

if (variedadGeneralSelect) { variedadGeneralSelect.addEventListener("focus", pausarScanner);

variedadGeneralSelect.addEventListener("blur", function () {
  scannerActivo = true;
  mantenerFoco();
});

variedadGeneralSelect.addEventListener("change", async function () {
  const bloque = bloqueGeneralSelect ? bloqueGeneralSelect.value : "";
  const variedad = variedadGeneralSelect.value;

  guardarEstadoUI();

  await cargarResumenGeneralPorBloque(bloque, variedad);
  await cargarDetalleGeneralPorBloque(bloque, variedad);

  scannerActivo = true;
  mantenerFoco();
});

}

if (barcodeInput) { barcodeInput.setAttribute("autocomplete", "off"); barcodeInput.setAttribute("autocorrect", "off"); barcodeInput.setAttribute("autocapitalize", "off"); barcodeInput.setAttribute("spellcheck", "false");

barcodeInput.addEventListener("keydown", async function (e) {
  if (e.key !== "Enter" && e.key !== "Tab") return;

  e.preventDefault();
  e.stopPropagation();

  const codigo = valorInput(barcodeInput);

  if (!codigo) {
    setStatus("El barcode está vacío", "warn");
    mantenerFoco();
    return;
  }

  barcodeInput.value = "";
  bufferScanner = "";

  await escanearCodigo(codigo);
});

barcodeInput.addEventListener("blur", function () {
  mantenerFoco();
});

}

document.addEventListener("keydown", async function (e) { if (!scannerActivo) return;

const target = e.target;
const tag = target && target.tagName ? target.tagName : "";
const id = target && target.id ? target.id : "";

if (tag === "TEXTAREA" || tag === "SELECT") return;
if (tag === "INPUT" && id !== "barcode") return;
if (id === "barcode") return;

if (e.key === "Enter" || e.key === "Tab") {
  const codigo = String(bufferScanner || "").trim();

  if (codigo) {
    e.preventDefault();
    bufferScanner = "";
    if (barcodeInput) barcodeInput.value = "";
    await escanearCodigo(codigo);
  }

  return;
}

if (e.key.length === 1) {
  bufferScanner += e.key;

  clearTimeout(scannerTimer);
  scannerTimer = setTimeout(function () {
    bufferScanner = "";
  }, 350);
}

});

document.addEventListener("click", function (e) { const target = e.target; const tag = target && target.tagName ? target.tagName : "";

if (tag === "SELECT" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return;

mantenerFoco();

}); }

async function iniciarAplicacion() { cargarElementosDOM();

if (!barcodeInput) { console.error('No existe el input con id="barcode". Revisa el HTML.'); alert('No existe el input con id="barcode". Revisa el HTML.'); return; }

if (!pedirAcceso()) return;

configurarEventos();

await cargarContadorGeneralBD(); await cargarBloquesGenerales(); await cargarViajes(); limpiarResumenViaje(); limpiarConsultaGeneral();

const estado = restaurarEstadoUI();

if (estado.viajeGuardado) { viajeActivo = estado.viajeGuardado; setText(viajeActivoLabel, estado.viajeGuardado);

document.querySelectorAll(".btn-viaje").forEach(function (b) {
  if (b.textContent === estado.viajeGuardado) {
    b.classList.add("activo");
  } else {
    b.classList.remove("activo");
  }
});

setText(totalEscaneados, 0);
setText(totalDuplicados, 0);
setText(totalErrores, 0);
actualizarAlertasResumen(0, 0);

cacheDetalle = [];

setHTML(detalleBody, '<tr><td colspan="11" class="empty-row">Sin registros todavía.</td></tr>');
setHTML(pivotBody, '<tr><td colspan="8" class="empty-row">Sin datos para mostrar.</td></tr>');
setHTML(yaRegistradosLista, '<div class="ya-registrado-item">Sin novedades.</div>');
setHTML(resumenVariedadBody, '<tr><td colspan="6" class="empty-row">Sin registros por variedad.</td></tr>');

await refrescarResumenDesdeBD();
await cargarContadorGeneralBD();
iniciarAutoRefreshViaje();

}

if (estado.bloqueGuardado && bloqueGeneralSelect) { bloqueGeneralSelect.value = estado.bloqueGuardado; await cargarVariedadesGeneralesPorBloque(estado.bloqueGuardado, estado.variedadGuardada || "");

if (estado.variedadGuardada && variedadGeneralSelect) {
  variedadGeneralSelect.value = estado.variedadGuardada;
}

await cargarResumenGeneralPorBloque(estado.bloqueGuardado, estado.variedadGuardada || "");
await cargarDetalleGeneralPorBloque(estado.bloqueGuardado, estado.variedadGuardada || "");

}

mantenerFoco(); }

if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", iniciarAplicacion); } else { iniciarAplicacion(); }