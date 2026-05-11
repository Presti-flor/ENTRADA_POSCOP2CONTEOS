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
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
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
  app.get("/api/test", (req, res) => {
  res.send("API OK");
});

  const code = String(codeRaw || "").trim();

  if (!/^\d{3,}$/.test(code)) {
    throw new Error("Barcode inválido");
  }

  const tipo = code.slice(0, 2);
  const serial = code.slice(2);

  return {
    barcode: code,
    tipo,
    serial
  };
}

// =====================================================
// VIAJE ACTIVO
// =====================================================
app.get("/api/viaje-activo", async (req, res) => {

  try {

    const viajeActivo = Object.keys(sesionesViaje)
      .find(nombre => sesionesViaje[nombre]?.activa === true);

    if (!viajeActivo) {

      return res.json({
        ok: false,
        error: "No hay viaje activo"
      });
    }

    return res.json({
      ok: true,
      viaje: viajeActivo
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// LISTAR VIAJES
// =====================================================
app.get("/api/viajes", async (_req, res) => {

  res.json({
    ok: true,
    data: getViajesFijos()
  });
});

// =====================================================
// ACTIVAR VIAJE
// =====================================================
app.post("/api/viajes/activar", async (req, res) => {

  try {

    const nombre = String(req.body.nombre || "").trim();

    if (!nombre) {

      return res.status(400).json({
        ok: false,
        error: "Falta nombre del viaje"
      });
    }

    // DESACTIVAR TODOS
    Object.keys(sesionesViaje).forEach((v) => {

      sesionesViaje[v].activa = false;

    });

    // ACTIVAR SOLO ESTE
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

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// FINALIZAR VIAJE
// =====================================================
app.post("/api/viajes/finalizar", async (req, res) => {

  try {

    const nombre = String(req.body.nombre || "").trim();

    if (!nombre || !sesionesViaje[nombre]) {

      return res.status(404).json({
        ok: false,
        error: "Viaje no encontrado"
      });
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

    res.status(500).json({
      ok: false,
      error: err.message
    });
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

      return res.status(400).json({
        ok: false,
        error: "Debes seleccionar un viaje"
      });
    }

    const viaje = asegurarViaje(viajeNombre);

    if (!viaje.activa) {

      return res.status(400).json({
        ok: false,
        error: "El viaje está finalizado"
      });
    }

    const { barcode, tipo, serial } = parseCode(codeInput);

    // =====================================================
    // BUSCAR EN tipos_variedad
    // =====================================================
    const tipoRow = await pool.query(
      `
      SELECT
        tipo,
        variedad,
        bloque,
        tamano,
        tallos
      FROM tipos_variedad
      WHERE tipo = $1
      LIMIT 1
      `,
      [tipo]
    );

    // =====================================================
    // NO EXISTE
    // =====================================================
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

    // =====================================================
    // INSERTAR EN BD
    // =====================================================
    const insert = await pool.query(
      `
      INSERT INTO registros
      (
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        etapa,
        viaje
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9
      )
      ON CONFLICT (barcode) DO NOTHING
      RETURNING barcode
      `,
      [
        barcode,
        tipo,
        serial,
        t.variedad,
        t.bloque,
        t.tamano,
        t.tallos,
        "Ingreso",
        viajeNombre
      ]
    );

    let resultado = "OK";
    let observacion = "Escaneo registrado correctamente";

    // =====================================================
    // DUPLICADO
    // =====================================================
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

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// RESUMEN
// =====================================================
app.get("/api/viajes/:nombre/resumen", async (req, res) => {

  try {

    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT
        COUNT(*) FILTER (WHERE barcode IS NOT NULL) AS total,
        COUNT(*) AS ok,
        0 AS duplicados,
        0 AS errores
      FROM registros
      WHERE viaje = $1
    `;

    const r = await pool.query(q, [nombre]);

    res.json({
      ok: true,
      viaje: {
        nombre,
        activa: true
      },
      resumen: r.rows[0]
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// PIVOT DESDE BD
// =====================================================
app.get("/api/viajes/:nombre/pivot", async (req, res) => {

  try {

    const nombre = decodeURIComponent(req.params.nombre);

    const r = await pool.query(`
      SELECT
        bloque,
        variedad,
        tamano,
        tallos,
        etapa,
        COUNT(*) AS tabacos,
        SUM(tallos) AS suma_tallos

      FROM registros

      WHERE viaje = $1

      GROUP BY
        bloque,
        variedad,
        tamano,
        tallos,
        etapa

      ORDER BY
        bloque,
        variedad
    `, [nombre]);

    return res.json({
      ok: true,
      data: r.rows
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }

});

// =====================================================
// DETALLE DESDE BD
// =====================================================
app.get("/api/viajes/:nombre/resumen", async (req, res) => {

  try {

    const nombre = decodeURIComponent(req.params.nombre);

    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,

        COUNT(*) FILTER (
          WHERE es_reregistro IS NOT TRUE
        ) AS ok,

        COUNT(*) FILTER (
          WHERE es_reregistro = true
        ) AS duplicados

      FROM registros
      WHERE viaje = $1
    `, [nombre]);

    const row = r.rows[0];

    return res.json({
      ok: true,
      viaje: {
        nombre,
        activa: true
      },
      resumen: {
        total: Number(row.total || 0),
        ok: Number(row.ok || 0),
        duplicados: Number(row.duplicados || 0),
        errores: 0
      }
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }

});
app.get("/api/viajes/:nombre/resumen-db", async (req, res) => {

  try {

    const nombre = decodeURIComponent(req.params.nombre);

    const q = `
      SELECT COUNT(*) AS ok
      FROM registros
      WHERE viaje = $1
    `;

    const r = await pool.query(q, [nombre]);

    res.json({
      ok: true,
      data: {
        ok: Number(r.rows[0]?.ok || 0),
        reregistrados: 0
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// CONSULTA REGISTRO
// =====================================================
app.get("/api/registro/:barcode", async (req, res) => {

  try {

    const barcode = String(req.params.barcode || "").trim();

    const r = await pool.query(
      `
      SELECT
        barcode,
        tipo,
        serial,
        variedad,
        bloque,
        tamano,
        tallos,
        created_at,
        etapa,
        form_id,
        viaje
      FROM registros
      WHERE barcode = $1
      LIMIT 1
      `,
      [barcode]
    );

    res.json({
      ok: true,
      data: r.rows[0] || null
    });

  } catch (err) {

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =====================================================
// START
// =====================================================

app.get("/api/contador-general-bd", async (req, res) => {
  try {

    const r = await pool.query(`
      SELECT COUNT(*) AS total
      FROM registros
    `);

    return res.json({
      ok: true,
      total: Number(r.rows[0].total || 0)
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
app.listen(port, () => {

  console.log(`✅ Servidor activo en http://localhost:${port}`);

});