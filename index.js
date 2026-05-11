require("dotenv").config();

const express = require("express");
const path = require("path");
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

function getViajesFijos() {
  return Array.from({ length: 20 }, (_, i) => `Viaje ${i + 1}`);
}

function asegurarViaje(nombre) {
  if (!sesionesViaje[nombre]) {
    sesionesViaje[nombre] = {
      activa: true,
      historial: []
    };
  }
  return sesionesViaje[nombre];
}

// =====================================================
// HELPERS
// =====================================================
function parseCode(codeRaw) {
  const code = String(codeRaw || "").trim();

  if (!/^\d{3,}$/.test(code)) {
    throw new Error("Barcode inválido");
  }

  const tipo = code.slice(0, 2);
  const serial = code.slice(2);

  return { barcode: code, tipo, serial };
}

app.get("/api/viaje-activo", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT valor
      FROM sistema_estado
      WHERE clave = 'viaje_activo'
      LIMIT 1
    `);

    if (!r.rows.length) {
      return res.json({
        ok: false,
        error: "No hay viaje activo"
      });
    }

    return res.json({
      ok: true,
      viaje: r.rows[0].valor
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
// =====================================================
// API VIAJES
// =====================================================
app.get("/api/viajes", async (_req, res) => {
  res.json({
    ok: true,
    data: getViajesFijos()
  });
});

app.post("/api/viajes/activar", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();

    if (!nombre) {
      return res.status(400).json({ ok: false, error: "Falta nombre del viaje" });
    }

    const viaje = asegurarViaje(nombre);
    viaje.activa = true;

    res.json({
      ok: true,
      data: {
        nombre,
        activa: true
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/viajes/finalizar", async (req, res) => {
  try {
    const nombre = String(req.body.nombre || "").trim();

    if (!nombre || !sesionesViaje[nombre]) {
      return res.status(404).json({ ok: false, error: "Viaje no encontrado" });
    }

    sesionesViaje[nombre].activa = false;

    res.json({
      ok: true,
      data: {
        nombre,
        activa: false
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// ESCANEO
// =====================================================
app.post("/api/escanear", async (req, res) => {
  try {
    const viajeNombre = String(req.body.viaje || "").trim();
    const codeInput = String(req.body.barcode || "").trim();

    if (!viajeNombre) {
      return res.status(400).json({ ok: false, error: "Debes seleccionar un viaje" });
    }

    const viaje = asegurarViaje(viajeNombre);

    if (!viaje.activa) {
      return res.status(400).json({ ok: false, error: "El viaje está finalizado" });
    }

    const { barcode, tipo, serial } = parseCode(codeInput);

    // 1. Buscar metadata en tipos_variedad
    const tipoRow = await pool.query(
      `SELECT tipo, variedad, bloque, tamano, tallos
       FROM tipos_variedad
       WHERE tipo = $1
       LIMIT 1`,
      [tipo]
    );

    if (tipoRow.rowCount === 0) {
      const evento = {
        fecha: new Date().toISOString(),
        barcode,
        tipo,
        serial,
        bloque: null,
        variedad: null,
        tamano: null,
        tallos: null,
        etapa: "Ingreso",
        form_id: null,
        resultado: "NO_EXISTE",
        observacion: "Tipo no existe en tipos_variedad"
      };

      viaje.historial.unshift(evento);

      return res.json({
        ok: true,
        resultado: "NO_EXISTE",
        mensaje: "El tipo no existe en tipos_variedad",
        data: evento
      });
    }

    const t = tipoRow.rows[0];

    // 2. Insertar en registros
    const insert = await pool.query(
      `INSERT INTO registros
       (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (barcode) DO NOTHING
       RETURNING barcode`,
      [
        barcode,
        tipo,
        serial,
        t.variedad,
        t.bloque,
        t.tamano,
        t.tallos,
        "Ingreso"
      ]
    );

    let resultado = "OK";
    let observacion = "Escaneo registrado correctamente";

    if (insert.rowCount === 0) {
      resultado = "YA_REGISTRADO";
      observacion = "El barcode ya existe en registros";
    }

    const evento = {
      fecha: new Date().toISOString(),
      barcode,
      tipo,
      serial,
      bloque: t.bloque,
      variedad: t.variedad,
      tamano: t.tamano,
      tallos: t.tallos,
      etapa: "Ingreso",
      form_id: null,
      resultado,
      observacion
    };

    viaje.historial.unshift(evento);

    return res.json({
      ok: true,
      resultado,
      mensaje: observacion,
      data: evento
    });

  } catch (err) {
    console.error("❌ /api/escanear:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// RESUMEN DEL VIAJE
// =====================================================
app.get("/api/viajes/:nombre/resumen", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);

    const r = await pool.query(`
      SELECT COUNT(*) AS total
      FROM registros
      WHERE viaje = $1
    `, [nombre]);

    const total = Number(r.rows[0]?.total || 0);

    return res.json({
      ok: true,
      sesionActual: {
        ok: total,
        reregistrados: 0,
        duplicados: 0,
        errores: 0
      }
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
// =====================================================
// TABLA DINÁMICA DEL VIAJE
// =====================================================
app.get("/api/viajes/:nombre/pivot", async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const viaje = sesionesViaje[nombre];

    if (!viaje) {
      return res.json({ ok: true, data: [] });
    }

    const agrupado = {};

    for (const row of viaje.historial) {
      if (row.resultado !== "OK") continue;

      const key = [
        row.bloque ?? "",
        row.variedad ?? "",
        row.tamano ?? "",
        row.tallos ?? "",
        row.etapa ?? ""
      ].join("|");

      if (!agrupado[key]) {
        agrupado[key] = {
          bloque: row.bloque ?? "",
          variedad: row.variedad ?? "",
          tamano: row.tamano ?? "",
          tallos: row.tallos ?? "",
          etapa: row.etapa ?? "",
          tabacos: 0,
          suma_tallos: 0
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
// DETALLE DEL VIAJE
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
      data: viaje.historial
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// CONSULTA EN BD POR BARCODE
// =====================================================
app.get("/api/registro/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    const r = await pool.query(
      `SELECT barcode, tipo, serial, variedad, bloque, tamano, tallos, created_at, etapa, form_id
       FROM registros
       WHERE barcode = $1
       LIMIT 1`,
      [barcode]
    );

    res.json({
      ok: true,
      data: r.rows[0] || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor activo en http://localhost:${port}`);
});