import { Router } from 'express';
import Stripe from 'stripe';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { Pedido } from '../models/Pedido.js';
import { ConfigPago } from '../models/ConfigPago.js';
import { descontarStockPedido } from './pedidos.js';
import { notificarPagoEnLinea } from '../notificaciones.js';

const router = Router();
const ahora = () => new Date().toISOString();
const CURRENCY = (process.env.CURRENCY || 'mxn').toLowerCase();
const FRONT_URL = process.env.FRONT_URL || 'http://localhost:3000';

// --- Inicialización perezosa de las pasarelas ---
function claveStripe() {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = claveStripe();
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}

function mensajeErrorStripe(err) {
  const msg = String(err?.message || '');
  const tipo = err?.type || '';
  console.error('Stripe error:', tipo, err?.code || '', msg);
  if (
    tipo === 'StripeAuthenticationError' ||
    /invalid api key/i.test(msg) ||
    /sk_(live|test)_/i.test(msg)
  ) {
    return 'Stripe rechazó la clave secreta. En dashboard.stripe.com/apikeys abre el modo Live, pulsa “Reveal live key”, copia la Secret key completa a STRIPE_SECRET_KEY en el .env del backend y reinicia el servidor.';
  }
  if (/payment method types/i.test(msg)) {
    return 'Stripe no tiene activado el pago con tarjeta para esta moneda. Actívalo en dashboard.stripe.com/settings/payment_methods';
  }
  return 'No se pudo iniciar el pago con tarjeta. Inténtalo de nuevo o elige efectivo o transferencia.';
}

let _cuentaStripe = { at: 0, data: null };
async function cuentaStripe() {
  const stripe = getStripe();
  if (!stripe) return null;
  if (_cuentaStripe.data && Date.now() - _cuentaStripe.at < 60_000) return _cuentaStripe.data;
  try {
    const data = await stripe.accounts.retrieve();
    _cuentaStripe = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error('Stripe account:', err.message);
    return _cuentaStripe.data;
  }
}

let _mpClient = null;
function getMP() {
  if (_mpClient) return _mpClient;
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) return null;
  _mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
  return _mpClient;
}

async function leerBanco() {
  const cfg = await ConfigPago.findOne({ clave: 'pagos' }).lean();
  return {
    titular: cfg?.titular || process.env.BANK_HOLDER || 'Andres Lopez Piña',
    banco: cfg?.banco || process.env.BANK_NAME || 'Mercado Pago',
    cuenta: cfg?.cuenta || process.env.BANK_ACCOUNT || '5428785233937142',
    clabe: cfg?.clabe || process.env.BANK_CLABE || '',
    tarjeta: cfg?.tarjeta || process.env.BANK_CARD || '5428785233937142',
    whatsapp: cfg?.whatsapp || process.env.WHATSAPP_NUMBER || '527121537999',
    costoEnvio: cfg?.costoEnvio != null ? Number(cfg.costoEnvio) : 10,
  };
}

// GET /api/pagos/config -> qué métodos están habilitados + datos bancarios
router.get('/config', async (_req, res) => {
  try {
    const banco = await leerBanco();
    const cuenta = await cuentaStripe();
    const stripeListo = Boolean(claveStripe()) && cuenta?.charges_enabled === true;
    res.json({
      currency: CURRENCY,
      metodos: {
        efectivo: true,
        transferencia: true,
        stripe: stripeListo,
        mercadopago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
      },
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      stripePendienteActivacion: Boolean(claveStripe()) && cuenta?.charges_enabled !== true,
      banco: {
        titular: banco.titular,
        banco: banco.banco,
        cuenta: banco.cuenta,
        clabe: banco.clabe,
        tarjeta: banco.tarjeta,
      },
      whatsapp: banco.whatsapp,
      costoEnvio: banco.costoEnvio,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pagos/config — el administrador guarda titular, cuenta y CLABE
router.put('/config', async (req, res) => {
  try {
    const { titular, banco, cuenta, clabe, tarjeta, whatsapp, costoEnvio } = req.body || {};
    const doc = await ConfigPago.findOneAndUpdate(
      { clave: 'pagos' },
      {
        $set: {
          titular: titular != null ? String(titular).trim() : '',
          banco: banco != null ? String(banco).trim() : '',
          cuenta: cuenta != null ? String(cuenta).trim() : '',
          clabe: clabe != null ? String(clabe).trim() : '',
          tarjeta: tarjeta != null ? String(tarjeta).trim() : '',
          whatsapp: whatsapp != null ? String(whatsapp).replace(/\D/g, '') : '',
          costoEnvio: costoEnvio != null ? Number(costoEnvio) : 10,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({
      titular: doc.titular,
      banco: doc.banco,
      cuenta: doc.cuenta,
      clabe: doc.clabe,
      tarjeta: doc.tarjeta,
      whatsapp: doc.whatsapp,
      costoEnvio: doc.costoEnvio,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function marcarPedidoPagadoStripe(pedido, paymentIntentId) {
  if (!pedido || pedido.estadoPago === 'pagado') return pedido;
  pedido.estadoPago = 'pagado';
  if (pedido.estadoPedido === 'nuevo') pedido.estadoPedido = 'confirmado';
  if (paymentIntentId) pedido.stripePaymentIntentId = String(paymentIntentId);
  await descontarStockPedido(pedido);
  pedido.actualizadoEn = ahora();
  await pedido.save();
  notificarPagoEnLinea(pedido.toObject());
  return pedido;
}

async function confirmarPedidoConSesionStripe(pedido, session) {
  if (session?.payment_status !== 'paid') return pedido;
  return marcarPedidoPagadoStripe(pedido, session.payment_intent);
}

// POST /api/pagos/stripe/checkout { pedidoId }
router.post('/stripe/checkout', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });
    const cuenta = await cuentaStripe();
    if (!cuenta?.charges_enabled) {
      return res.status(503).json({
        error:
          'La cuenta de Stripe aún no está activada para cobrar. En dashboard.stripe.com completa la verificación del negocio (INE, RFC y cuenta bancaria) y espera a que Stripe la apruebe. Mientras tanto usa efectivo o transferencia.',
      });
    }
    const pedido = await Pedido.findOne({ id: Number(req.body.pedidoId) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estadoPago === 'pagado') {
      return res.status(400).json({ error: 'Este pedido ya está pagado' });
    }

    const line_items = (pedido.items || []).map((it) => ({
      quantity: Math.max(1, Math.round(Number(it.cantidad) || 1)),
      price_data: {
        currency: CURRENCY,
        unit_amount: Math.round((Number(it.precio) || 0) * 100),
        product_data: { name: it.nombre || 'Producto' },
      },
    }));
    if (Number(pedido.envio) > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: Math.round(Number(pedido.envio) * 100),
          product_data: { name: 'Envío a domicilio' },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'es',
      payment_method_types: ['card'],
      line_items,
      client_reference_id: String(pedido.id),
      metadata: { pedidoId: String(pedido.id) },
      payment_intent_data: {
        metadata: { pedidoId: String(pedido.id) },
        description: `ARISE Athletic Shop pedido #${pedido.id}`,
        statement_descriptor: 'ARISE ATHLETIC',
      },
      custom_text: {
        submit: { message: 'Pago seguro con Stripe · ARISE Athletic Shop' },
      },
      success_url: `${FRONT_URL}/pedido/${pedido.id}?pago=exito`,
      cancel_url: `${FRONT_URL}/pedido/${pedido.id}?pago=cancelado`,
      customer_email: pedido.cliente?.email || undefined,
    });

    pedido.stripeSessionId = session.id;
    pedido.actualizadoEn = ahora();
    await pedido.save();
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: mensajeErrorStripe(err) });
  }
});

// POST /api/pagos/stripe/confirmar { pedidoId }
// El cliente vuelve de Stripe: consultamos la sesión y marcamos el pedido si ya pagó.
router.post('/stripe/confirmar', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });
    const pedido = await Pedido.findOne({ id: Number(req.body.pedidoId) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estadoPago === 'pagado') return res.json(pedido);
    if (!pedido.stripeSessionId) {
      return res.status(400).json({ error: 'Este pedido no tiene un pago de Stripe' });
    }

    const session = await stripe.checkout.sessions.retrieve(pedido.stripeSessionId);
    await confirmarPedidoConSesionStripe(pedido, session);
    res.json(pedido);
  } catch (err) {
    res.status(500).json({ error: mensajeErrorStripe(err) });
  }
});

// Webhook de Stripe (se monta con express.raw en index.js)
export async function stripeWebhookHandler(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe no configurado');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET no está configurado');
    return res.status(503).send('Webhook de Stripe no configurado');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const pedidoId = Number(session.metadata?.pedidoId || session.client_reference_id);
      if (pedidoId) {
        const pedido = await Pedido.findOne({ id: pedidoId });
        if (pedido) await confirmarPedidoConSesionStripe(pedido, session);
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
}

// POST /api/pagos/mercadopago/preference { pedidoId }
router.post('/mercadopago/preference', async (req, res) => {
  try {
    const client = getMP();
    if (!client) return res.status(503).json({ error: 'Mercado Pago no está configurado' });
    const pedido = await Pedido.findOne({ id: Number(req.body.pedidoId) });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = (pedido.items || []).map((it) => ({
      title: it.nombre || 'Producto',
      quantity: Math.max(1, Math.round(Number(it.cantidad) || 1)),
      unit_price: Number(it.precio) || 0,
      currency_id: CURRENCY.toUpperCase(),
    }));
    if (Number(pedido.envio) > 0) {
      items.push({
        title: 'Envío a domicilio',
        quantity: 1,
        unit_price: Number(pedido.envio),
        currency_id: CURRENCY.toUpperCase(),
      });
    }

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items,
        metadata: { pedido_id: pedido.id },
        external_reference: String(pedido.id),
        back_urls: {
          success: `${FRONT_URL}/pedido/${pedido.id}?pago=exito`,
          failure: `${FRONT_URL}/pedido/${pedido.id}?pago=cancelado`,
          pending: `${FRONT_URL}/pedido/${pedido.id}?pago=pendiente`,
        },
        auto_return: 'approved',
        notification_url: `${process.env.PUBLIC_API_URL || ''}/api/pagos/mercadopago/webhook`,
      },
    });

    pedido.mpPreferenceId = result.id;
    pedido.actualizadoEn = ahora();
    await pedido.save();
    res.json({ init_point: result.init_point, preferenceId: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook / IPN de Mercado Pago
router.post('/mercadopago/webhook', async (req, res) => {
  try {
    const client = getMP();
    if (!client) return res.sendStatus(200);
    const paymentId = req.query['data.id'] || req.body?.data?.id || req.query.id;
    const tipo = req.query.type || req.body?.type;
    if ((tipo === 'payment' || req.query.topic === 'payment') && paymentId) {
      const payment = new Payment(client);
      const info = await payment.get({ id: paymentId });
      if (info && info.status === 'approved') {
        const pedidoId = Number(info.external_reference || info.metadata?.pedido_id);
        if (pedidoId) {
          const pedido = await Pedido.findOne({ id: pedidoId });
          if (pedido && pedido.estadoPago !== 'pagado') {
            pedido.estadoPago = 'pagado';
            pedido.estadoPedido = 'confirmado';
            pedido.mpPaymentId = String(paymentId);
            await descontarStockPedido(pedido);
            pedido.actualizadoEn = ahora();
            await pedido.save();
            notificarPagoEnLinea(pedido.toObject());
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    // Mercado Pago reintenta si no respondemos 200; registramos y respondemos 200
    console.error('MP webhook error:', err.message);
    res.sendStatus(200);
  }
});

export default router;
