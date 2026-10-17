import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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
import lienzoCharroRouter from './routes/lienzoCharro.js';
import ofertasRouter from './routes/ofertas.js';
import pedidosRouter from './routes/pedidos.js';
import pagosRouter, { stripeWebhookHandler } from './routes/pagos.js';

dotenv.config(); // Carga .env (Stripe, WhatsApp, Mongo)

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONT_URL || 'http://localhost:3000' }));

// El webhook de Stripe necesita el cuerpo crudo para verificar la firma.
// Debe registrarse ANTES de express.json().
app.post('/api/pagos/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'POS API' }));

app.use('/api/productos', productosRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/categorias', categoriasRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/proveedores', proveedoresRouter);
app.use('/api/cuentas-proveedores', cuentasProveedoresRouter);
app.use('/api/deudas', deudasRouter);
app.use('/api/gastos-admin', gastosAdminRouter);
app.use('/api/empleados', empleadosRouter);
app.use('/api/nominas', nominasRouter);
app.use('/api/adelantos', adelantosRouter);
app.use('/api/devoluciones', devolucionesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/auth', authRouter);
app.use('/api/lienzo-charro', lienzoCharroRouter);
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
