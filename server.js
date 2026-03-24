require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    const c = await pool.connect();
    console.log("✅ Conectado a PostgreSQL");
    c.release();
  } catch (e) {
    console.error("❌ Error de conexión:", e.message);
  }
})();

// =====================================================
// VIAJES EN MEMORIA
// =====================================================

const sesionesViaje = {};
let secuenciaLocal = 1;
let viajeActivoGlobal = "";

function getViajesFijos() {
  return Array.from({ length: 20 }, (_, i) => `Viaje ${i + 1}`);
}

function asegurarViaje(nombre) {
  if (!sesionesViaje[nombre]) {
    sesionesViaje[nombre] = {
      activa: false,
      historial: [],
      historialSesion: [],
      acumulado: {
        ok: 0,
        duplicados: 0,
        errores: 0,
        reregistrados: 0,
      },
    };
  }
  return sesionesViaje[nombre];
}

// =====================================================
// HELPERS
// =====================================================

function parseCode(codeRaw) {
  const code = String(codeRaw || "").trim();

  if (!/^[A-Za-z0-9]{3,}$/.test(code)) {
    throw new Error("Barcode inválido");
  }

  const tipo = code.slice(0, 2);
  const serial = code.slice(2);

  return { barcode: code, tipo, serial };
}

function sumarAcumulado(viaje, resultado) {
  if (resultado === "OK") viaje.acumulado.ok += 1;
  if (resultado === "YA_REGISTRADO") viaje.acumulado.duplicados += 1;
  if (resultado === "NO_EXISTE") viaje.acumulado.errores += 1;
  if (resultado === "REREGISTRADO") viaje.acumulado.reregistrados += 1;
}

function restarAcumulado(viaje, resultado) {
  if (resultado === "OK" && viaje.acumulado.ok > 0) viaje.acumulado.ok -= 1;
  if (resultado === "YA_REGISTRADO" && viaje.acumulado.duplicados > 0) viaje.acumulado.duplicados -= 1;
  if (resultado === "NO_EXISTE" && viaje.acumulado.errores > 0) viaje.acumulado.errores -= 1;
  if (resultado === "REREGISTRADO" && viaje.acumulado.reregistrados > 0) viaje.acumulado.reregistrados -= 1;
}

async function generarSerial9Unico(prefijoTipo) {
  for (let i = 0; i < 50; i++) {
    const serial = crypto.randomInt(0, 1000000000).toString().padStart(9, "0");
    const barcode = `${prefijoTipo}${serial}`;

    const existe = await pool.query(
      `SELECT 1
       FROM public.registros
       WHERE barcode = $1
       LIMIT 1`,
      [barcode]
    );

    if (existe.rowCount === 0) {
      return { serial, barcode };
    }
  }

  throw new Error("No se pudo generar un serial único");
}

// =====================================================
// API VIAJES
// =====================================================

app.get("/api/viajes", (_req, res) => {
  res.json({
    ok: true,
    data: getViajesFijos(),
  });
});

app.post("/api/viajes/activar", (req, res) => {
  const nombre = String(req.body.nombre || "").trim();

  if (!nombre) {
    return res.status(400).json({ ok: false, error: "Falta nombre del viaje" });
  }

  const viaje = asegurarViaje(nombre);

  viaje.activa = true;
  viaje.historialSesion = [];

  viajeActivoGlobal = nombre;

  res.json({
    ok: true,
    data: { nombre, activa: true, viajeActivoGlobal },
  });
});

app.post("/api/viajes/finalizar", (req, res) => {
  const nombre = String(req.body.nombre || "").trim();

  if (!nombre || !sesionesViaje[nombre]) {
    return res.status(404).json({ ok: false, error: "Viaje no encontrado" });
  }

  sesionesViaje[nombre].activa = false;

  if (viajeActivoGlobal === nombre) {
    viajeActivoGlobal = "";
  }

  res.json({
    ok: true,
    data: { nombre, activa: false, viajeActivoGlobal },
  });
});

app.get("/api/viaje-activo-global", (_req, res) => {
  res.json({
    ok: true,
    viajeActivoGlobal,
  });
});

// =====================================================
// ESCANEO NORMAL
// =====================================================

app.post("/api/escanear", async (req, res) => {
  try {
    const viajeNombre = String(req.body.viaje || viajeActivoGlobal || "").trim();
    const codeInput = String(req.body.barcode || "").trim();
    const form = String(req.body.form || "").trim();

    if (!viajeNombre) {
      return res.status(400).json({ ok: false, error: "No hay viaje activo" });
    }

    const viaje = asegurarViaje(viajeNombre);

    if (!viaje.activa) {
      return res.status(400).json({ ok: false, error: "El viaje está finalizado" });
    }

    let barcode, tipo, serial;

    try {
      ({ barcode, tipo, serial } = parseCode(codeInput));
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: e.message,
      });
    }

    const tipoRow = await pool.query(
      `SELECT tipo, variedad, bloque, tamano, tallos
       FROM public.tipos_variedad
       WHERE TRIM(tipo) = TRIM($1)
       LIMIT 1`,
      [tipo]
    );

    if (tipoRow.rowCount === 0) {
      const evento = {
        id_local: secuenciaLocal++,
        fecha: new Date().toISOString(),
        barcode,
        tipo,
        serial,
        bloque: null,
        variedad: null,
        tamano: null,
        tallos: null,
        etapa: "Ingreso",
        form,
        resultado: "NO_EXISTE",
        observacion: "Tipo no existe",
        puede_reregistrar: false,
      };

      viaje.historial.unshift(evento);
      viaje.historialSesion.unshift(evento);
      sumarAcumulado(viaje, evento.resultado);

      return res.json({
        ok: true,
        resultado: "NO_EXISTE",
        data: evento,
      });
    }

    const t = tipoRow.rows[0];

    const existe = await pool.query(
      `SELECT barcode, created_at
       FROM public.registros
       WHERE barcode = $1
       LIMIT 1`,
      [barcode]
    );

    let resultado = "OK";
    let puede_reregistrar = false;
    let fechaAnterior = null;

    if (existe.rowCount > 0) {
      resultado = "YA_REGISTRADO";
      fechaAnterior = existe.rows[0].created_at;
      puede_reregistrar = true;

      const yaTieneReregistro = await pool.query(
        `SELECT 1
         FROM public.registros
         WHERE barcode_origen = $1
         LIMIT 1`,
        [barcode]
      );

      if (yaTieneReregistro.rowCount > 0) {
        puede_reregistrar = false;
      }
    } else {
      await pool.query(
        `INSERT INTO public.registros
        (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa, viaje, barcode_origen, es_reregistro, form)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          barcode,
          tipo,
          serial,
          t.variedad,
          t.bloque,
          t.tamano,
          t.tallos,
          "Ingreso",
          viajeNombre,
          null,
          false,
          form || null,
        ]
      );
    }

    const evento = {
      id_local: secuenciaLocal++,
      fecha: new Date().toISOString(),
      barcode,
      tipo,
      serial,
      bloque: t.bloque,
      variedad: t.variedad,
      tamano: t.tamano,
      tallos: t.tallos,
      etapa: "Ingreso",
      form,
      resultado,
      fechaAnterior,
      puede_reregistrar,
    };

    viaje.historial.unshift(evento);
    viaje.historialSesion.unshift(evento);
    sumarAcumulado(viaje, evento.resultado);

    return res.json({
      ok: true,
      resultado,
      data: evento,
    });
  } catch (err) {
    console.error("❌ ERROR REAL EN /api/escanear:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      detail: err.detail || null,
      code: err.code || null,
    });
  }
});

// =====================================================
// RE-REGISTRAR
// =====================================================

app.post("/api/reregistrar", async (req, res) => {
  try {
    const viajeNombre = String(req.body.viaje || viajeActivoGlobal || "").trim();
    const barcodeOrigen = String(req.body.barcode || "").trim();

    if (!viajeNombre) {
      return res.status(400).json({ ok: false, error: "No hay viaje activo" });
    }

    const viaje = asegurarViaje(viajeNombre);

    if (!viaje.activa) {
      return res.status(400).json({ ok: false, error: "El viaje está finalizado" });
    }

    const original = await pool.query(
      `SELECT *
       FROM public.registros
       WHERE barcode = $1
       LIMIT 1`,
      [barcodeOrigen]
    );

    if (original.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Barcode no existe" });
    }

    const base = original.rows[0];

    if (base.es_reregistro) {
      return res.status(400).json({
        ok: false,
        error: "Este código ya es un re-registro",
      });
    }

    const yaTiene = await pool.query(
      `SELECT 1
       FROM public.registros
       WHERE barcode_origen = $1
       LIMIT 1`,
      [barcodeOrigen]
    );

    if (yaTiene.rowCount > 0) {
      return res.status(400).json({
        ok: false,
        error: "Este código ya fue re-registrado",
      });
    }

    const { serial, barcode } = await generarSerial9Unico(base.tipo);

    await pool.query(
      `INSERT INTO public.registros
       (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa, viaje, barcode_origen, es_reregistro, form)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        barcode,
        base.tipo,
        serial,
        base.variedad,
        base.bloque,
        base.tamano,
        base.tallos,
        base.etapa,
        viajeNombre,
        barcodeOrigen,
        true,
        base.form || null,
      ]
    );

    const evento = {
      id_local: secuenciaLocal++,
      fecha: new Date().toISOString(),
      barcode,
      tipo: base.tipo,
      serial,
      bloque: base.bloque,
      variedad: base.variedad,
      tamano: base.tamano,
      tallos: base.tallos,
      etapa: base.etapa,
      form: base.form || "",
      resultado: "REREGISTRADO",
      barcode_origen: barcodeOrigen,
    };

    viaje.historial.unshift(evento);
    viaje.historialSesion.unshift(evento);
    sumarAcumulado(viaje, "REREGISTRADO");

    return res.json({
      ok: true,
      resultado: "REREGISTRADO",
      data: evento,
    });
  } catch (err) {
    console.error("❌ ERROR EN /api/reregistrar:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// GUARDAR REGISTRO MANUAL / EXTERNO
// =====================================================

app.post("/guardar", async (req, res) => {
  const {
    barcode,
    tipo,
    serial,
    variedad,
    bloque,
    tamano,
    tallos,
    etapa,
    form,
    viaje,
    barcode_origen,
    es_reregistro,
  } = req.body;

  try {
    const viajeFinal = String(viaje || viajeActivoGlobal || "").trim();

    if (!viajeFinal) {
      return res.status(400).json({ ok: false, error: "No hay viaje activo" });
    }

    const result = await pool.query(
      `INSERT INTO public.registros
      (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa, viaje, barcode_origen, es_reregistro, form)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa || "Ingreso",
        viajeFinal,
        barcode_origen || null,
        Boolean(es_reregistro),
        form || null,
      ]
    );

    return res.json({
      ok: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error al guardar:", error);
    return res.status(500).json({ ok: false, error: "No se pudo guardar" });
  }
});

// =====================================================
// CONTADOR GENERAL
// =====================================================

app.get("/api/general/contador", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(tallos), 0)::int AS total_tallos
      FROM public.registros
      WHERE (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
    `);

    res.json({
      ok: true,
      total: r.rows[0]?.total ?? 0,
      total_tallos: r.rows[0]?.total_tallos ?? 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// BLOQUES
// =====================================================

app.get("/api/general/bloque/:bloque", async (req, res) => {
  try {
    const bloque = String(req.params.bloque || "").trim();
    const variedad = String(req.query.variedad || "").trim();

    if (!bloque) {
      return res.status(400).json({ ok: false, error: "Falta bloque" });
    }

    let query = `
      SELECT
        bloque,
        variedad,
        COALESCE(tamano, '') AS tamano,
        tallos,
        etapa,
        COUNT(*)::int AS tabacos,
        COALESCE(SUM(tallos), 0)::int AS suma_tallos
      FROM public.registros
      WHERE CAST(bloque AS text) = $1
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
    `;

    const params = [bloque];

    if (variedad) {
      query += ` AND LOWER(variedad) = LOWER($2) `;
      params.push(variedad);
    }

    query += `
      GROUP BY bloque, variedad, tamano, tallos, etapa
      ORDER BY variedad, tamano, tallos
    `;

    const r = await pool.query(query, params);

    res.json({
      ok: true,
      data: r.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// DETALLE BLOQUE
// =====================================================

app.get("/api/general/bloque/:bloque/detalle", async (req, res) => {
  try {
    const bloque = String(req.params.bloque || "").trim();
    const variedad = String(req.query.variedad || "").trim();

    if (!bloque) {
      return res.status(400).json({ ok: false, error: "Falta bloque" });
    }

    let query = `
      SELECT
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa,
        form,
        created_at,
        barcode_origen,
        es_reregistro,
        viaje
      FROM public.registros
      WHERE CAST(bloque AS text) = $1
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
    `;

    const params = [bloque];

    if (variedad) {
      query += ` AND LOWER(variedad) = LOWER($2) `;
      params.push(variedad);
    }

    query += `
      ORDER BY created_at DESC
      LIMIT 500
    `;

    const r = await pool.query(query, params);

    res.json({
      ok: true,
      data: r.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// VARIEDADES POR BLOQUE
// =====================================================

app.get("/api/general/bloque/:bloque/variedades", async (req, res) => {
  try {
    const bloque = String(req.params.bloque || "").trim();

    if (!bloque) {
      return res.status(400).json({ ok: false, error: "Falta bloque" });
    }

    const r = await pool.query(`
      SELECT DISTINCT variedad
      FROM public.registros
      WHERE CAST(bloque AS text) = $1
        AND variedad IS NOT NULL
        AND TRIM(variedad) <> ''
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
      ORDER BY variedad
    `, [bloque]);

    res.json({
      ok: true,
      data: r.rows.map((x) => x.variedad),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// RESUMEN DEL VIAJE EN MEMORIA
// =====================================================

app.get("/api/viajes/:nombre/resumen", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const viaje = sesionesViaje[nombre];

    if (!viaje) {
      return res.json({
        ok: true,
        viaje: { nombre, activa: false },
        sesionActual: { ok: 0, duplicados: 0, errores: 0, reregistrados: 0, total: 0 },
        acumulado: { ok: 0, duplicados: 0, errores: 0, reregistrados: 0, total: 0 },
      });
    }

    const sesion = viaje.historialSesion || [];
    const historialTotal = viaje.historial || [];

    const sesionActual = {
      total: sesion.length,
      ok: sesion.filter((x) => x.resultado === "OK").length,
      duplicados: sesion.filter((x) => x.resultado === "YA_REGISTRADO").length,
      errores: sesion.filter((x) => x.resultado === "NO_EXISTE").length,
      reregistrados: sesion.filter((x) => x.resultado === "REREGISTRADO").length,
    };

    const acumulado = {
      total: historialTotal.length,
      ok: viaje.acumulado.ok,
      duplicados: viaje.acumulado.duplicados,
      errores: viaje.acumulado.errores,
      reregistrados: viaje.acumulado.reregistrados,
    };

    res.json({
      ok: true,
      viaje: { nombre, activa: viaje.activa },
      sesionActual,
      acumulado,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// TABLA DINÁMICA DEL VIAJE EN MEMORIA
// =====================================================

app.get("/api/viajes/:nombre/pivot", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const viaje = sesionesViaje[nombre];

    if (!viaje) {
      return res.json({ ok: true, data: [] });
    }

    const agrupado = {};

    for (const row of viaje.historialSesion || []) {
      if (!["OK", "REREGISTRADO"].includes(row.resultado)) continue;

      const key = [
        row.bloque ?? "",
        row.variedad ?? "",
        row.tamano ?? "",
        row.tallos ?? "",
        row.etapa ?? "",
      ].join("|");

      if (!agrupado[key]) {
        agrupado[key] = {
          bloque: row.bloque ?? "",
          variedad: row.variedad ?? "",
          tamano: row.tamano ?? "",
          tallos: row.tallos ?? "",
          etapa: row.etapa ?? "",
          tabacos: 0,
          suma_tallos: 0,
        };
      }

      agrupado[key].tabacos += 1;
      agrupado[key].suma_tallos += Number(row.tallos || 0);
    }

    const data = Object.values(agrupado).sort((a, b) => {
      if (String(a.bloque) < String(b.bloque)) return -1;
      if (String(a.bloque) > String(b.bloque)) return 1;
      return String(a.variedad).localeCompare(String(b.variedad));
    });

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// DETALLE DEL VIAJE EN MEMORIA
// =====================================================

app.get("/api/viajes/:nombre/detalle", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const viaje = sesionesViaje[nombre];

    if (!viaje) {
      return res.json({ ok: true, data: [] });
    }

    res.json({
      ok: true,
      data: viaje.historialSesion || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// ELIMINAR REGISTRO DEL VIAJE EN MEMORIA
// =====================================================

app.delete("/api/viajes/:nombre/detalle/:id_local", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const idLocal = Number(req.params.id_local);
    const viaje = sesionesViaje[nombre];

    if (!viaje) {
      return res.status(404).json({ ok: false, error: "Viaje no encontrado" });
    }

    const registro = viaje.historial.find((x) => x.id_local === idLocal);
    if (!registro) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado" });
    }

    viaje.historial = viaje.historial.filter((x) => x.id_local !== idLocal);
    viaje.historialSesion = viaje.historialSesion.filter((x) => x.id_local !== idLocal);
    restarAcumulado(viaje, registro.resultado);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// BLOQUES GENERALES (SOLO HOY)
// =====================================================

app.get("/api/general/bloques", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT bloque
      FROM public.registros
      WHERE bloque IS NOT NULL
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
      ORDER BY bloque
    `);

    res.json({
      ok: true,
      data: r.rows.map((x) => x.bloque),
    });
  } catch (err) {
    console.error("Error en /api/general/bloques:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// ELIMINAR REGISTRO REAL DE LA BASE DE DATOS
// =====================================================

app.delete("/api/registros/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    if (!barcode) {
      return res.status(400).json({ ok: false, error: "Falta barcode" });
    }

    const previo = await pool.query(
      `SELECT barcode, es_reregistro, barcode_origen
       FROM public.registros
       WHERE barcode = $1
       LIMIT 1`,
      [barcode]
    );

    if (previo.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Registro no encontrado" });
    }

    const row = previo.rows[0];

    await pool.query(
      `DELETE FROM public.registros
       WHERE barcode = $1`,
      [barcode]
    );

    if (!row.es_reregistro) {
      await pool.query(
        `DELETE FROM public.registros
         WHERE barcode_origen = $1`,
        [barcode]
      );
    }

    Object.keys(sesionesViaje).forEach((nombreViaje) => {
      const viaje = sesionesViaje[nombreViaje];

      viaje.historial = (viaje.historial || []).filter((x) => {
        if (x.barcode === barcode) return false;
        if (x.barcode_origen === barcode) return false;
        return true;
      });

      viaje.historialSesion = (viaje.historialSesion || []).filter((x) => {
        if (x.barcode === barcode) return false;
        if (x.barcode_origen === barcode) return false;
        return true;
      });

      viaje.acumulado = {
        ok: viaje.historial.filter((x) => x.resultado === "OK").length,
        duplicados: viaje.historial.filter((x) => x.resultado === "YA_REGISTRADO").length,
        errores: viaje.historial.filter((x) => x.resultado === "NO_EXISTE").length,
        reregistrados: viaje.historial.filter((x) => x.resultado === "REREGISTRADO").length,
      };
    });

    return res.json({
      ok: true,
      eliminado: barcode,
    });
  } catch (err) {
    console.error("❌ Error eliminando registro real:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// RESUMEN DEL VIAJE DESDE BD
// =====================================================

app.get("/api/viajes/:nombre/resumen-db", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE es_reregistro = false)::int AS ok,
        COUNT(*) FILTER (WHERE es_reregistro = true)::int AS reregistrados,
        COUNT(*)::int AS total,
        COALESCE(SUM(tallos), 0)::int AS total_tallos
      FROM public.registros
      WHERE viaje = $1
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
    `, [nombre]);

    res.json({
      ok: true,
      data: r.rows[0],
    });
  } catch (err) {
    console.error("Error resumen-db:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/viajes/:nombre/variedades-db", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const r = await pool.query(`
      SELECT
        variedad,
        COUNT(*)::int AS tabacos,
        COALESCE(SUM(tallos), 0)::int AS total_tallos
      FROM public.registros
      WHERE viaje = $1
        AND (created_at AT TIME ZONE 'America/Bogota')::date =
            (NOW() AT TIME ZONE 'America/Bogota')::date
      GROUP BY variedad
      ORDER BY variedad
    `, [nombre]);

    res.json({
      ok: true,
      data: r.rows,
    });
  } catch (err) {
    console.error("Error variedades-db:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor activo en http://localhost:${port}`);
});