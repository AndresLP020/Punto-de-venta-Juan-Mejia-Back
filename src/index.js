import 'dotenv/config'; // primero: los módulos importados después ya ven las variables del .env
import express from 'express';
import cors from 'cors';

import { conectarMongo } from './db.js';
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
import ofertasRouter from './routes/ofertas.js';
import pedidosRouter from './routes/pedidos.js';
import pagosRouter, { stripeWebhookHandler } from './routes/pagos.js';
import { requiereSesion, requiereAdmin } from './seguridad.js';

const app = express();
const PORT = process.env.PORT || 4000;

function normalizarOrigen(url) {
  return String(url || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+$/, '');
}

const ORIGENES_PERMITIDOS = (process.env.FRONT_URL || 'http://localhost:3000')
  .split(',')
  .map(normalizarOrigen)
  .filter(Boolean);

function origenPermitido(origin) {
  const pedido = normalizarOrigen(origin);
  if (!pedido) return true;
  if (ORIGENES_PERMITIDOS.includes(pedido)) return true;
  if (/^https:\/\/punto-de-venta-juan-mejia-front[\w-]*\.vercel\.app$/i.test(pedido)) return true;
  if (/^http:\/\/localhost(:\d+)?$/i.test(pedido)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (origenPermitido(origin)) return callback(null, true);
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  })
);

// El webhook de Stripe necesita el cuerpo crudo para verificar la firma.
// Debe registrarse ANTES de express.json().
app.post('/api/pagos/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'POS API' }));

// Rutas públicas o con permisos por ruta (tienda en línea + POS)
app.use('/api/auth', authRouter);
app.use('/api/productos', productosRouter);
app.use('/api/categorias', categoriasRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/devoluciones', devolucionesRouter);
// Solo personal con sesión iniciada
app.use('/api/clientes', requiereSesion, clientesRouter);
app.use('/api/proveedores', requiereSesion, proveedoresRouter);
app.use('/api/cuentas-proveedores', requiereSesion, cuentasProveedoresRouter);
// Solo modo administrador
app.use('/api/deudas', requiereAdmin, deudasRouter);
app.use('/api/gastos-admin', requiereAdmin, gastosAdminRouter);
app.use('/api/empleados', requiereAdmin, empleadosRouter);
app.use('/api/nominas', requiereAdmin, nominasRouter);
app.use('/api/adelantos', requiereAdmin, adelantosRouter);
app.use('/api/usuarios', requiereAdmin, usuariosRouter);
app.use('/api/ofertas', ofertasRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/pagos', pagosRouter);

conectarMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Servidor POS en http://localhost:' + PORT);
    });
  })
  .catch((err) => {
    console.error('No se pudo iniciar:', err);
    process.exit(1);
  });
