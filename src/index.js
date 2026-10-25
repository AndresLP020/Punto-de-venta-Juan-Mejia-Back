// Debe ser el primer import: los módulos leen process.env al cargarse (los imports se evalúan antes que el código).
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import { conectarMongo } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { migrarDatos } from './migraciones.js';
import { Usuario } from './models/Usuario.js';
import { normalizarPermisos } from './routes/usuarios.js';
import productosRouter from './routes/productos.js';
import ventasRouter from './routes/ventas.js';
import categoriasRouter from './routes/categorias.js';
import clientesRouter from './routes/clientes.js';
import proveedoresRouter from './routes/proveedores.js';
import deudasRouter from './routes/deudas.js';
import gastosAdminRouter from './routes/gastosAdmin.js';
import empleadosRouter from './routes/empleados.js';
import nominasRouter from './routes/nominas.js';
import adelantosRouter from './routes/adelantos.js';
import devolucionesRouter from './routes/devoluciones.js';
import usuariosRouter from './routes/usuarios.js';
import authRouter from './routes/auth.js';
import cuentasProveedoresRouter from './routes/cuentasProveedores.js';
import lienzoCharroRouter from './routes/lienzoCharro.js';
import ticketsRouter from './routes/tickets.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Render (y la mayoría de hostings) ponen un proxy delante: necesario para obtener la IP real del cliente.
app.set('trust proxy', 1);
// Los parámetros de la URL se leen como texto plano (evita que ?campo[$ne]=x se convierta en un operador de Mongo).
app.set('query parser', 'simple');
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const origenes = (process.env.FRONT_URL || 'http://localhost:3000').split(',').map((o) => o.trim().replace(/\/$/, ''));
app.use(cors({ origin: origenes }));
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'POS API' }));

// Rutas públicas: solo el inicio de sesión.
app.use('/api/auth', authRouter);

// A partir de aquí todo requiere sesión.
app.use('/api', requireAuth);

// Los usuarios creados en Configuración se revalidan en cada petición: si se eliminan o cambian sus
// permisos, el cambio aplica de inmediato aunque tengan una sesión abierta.
app.use('/api', async (req, res, next) => {
  try {
    if (req.sesion.principal) return next();
    const u = await Usuario.findOne({ id: req.sesion.uid }).lean();
    if (!u) return res.status(401).json({ error: 'Tu usuario ya no existe. Inicia sesión de nuevo.' });
    req.sesion.permisos = normalizarPermisos(u.permisos);
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/productos', productosRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/categorias', categoriasRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/proveedores', proveedoresRouter);
app.use('/api/cuentas-proveedores', cuentasProveedoresRouter);

// Apartados exclusivos del modo administrador.
app.use('/api/deudas', requireAdmin, deudasRouter);
app.use('/api/gastos-admin', requireAdmin, gastosAdminRouter);
app.use('/api/empleados', requireAdmin, empleadosRouter);
app.use('/api/nominas', requireAdmin, nominasRouter);
app.use('/api/adelantos', requireAdmin, adelantosRouter);
app.use('/api/devoluciones', requireAdmin, devolucionesRouter);
app.use('/api/usuarios', requireAdmin, usuariosRouter);
app.use('/api/lienzo-charro', requireAdmin, lienzoCharroRouter);
app.use('/api/tickets', ticketsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

conectarMongo()
  .then(async () => {
    // Crear índices (id único, etc.). Si hay datos duplicados se avisa en consola pero el servidor arranca.
    for (const model of Object.values(mongoose.models)) {
      await model.init().catch((err) => console.error(`[índices] ${model.modelName}: ${err.message}`));
    }
    await migrarDatos().catch((err) => console.error('[migración] Error:', err));
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Servidor POS en el puerto ' + PORT);
    });
  })
  .catch((err) => {
    console.error('No se pudo iniciar:', err.message || err);
    process.exit(1);
  });
