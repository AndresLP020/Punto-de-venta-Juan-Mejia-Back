import nodemailer from 'nodemailer';

// Notificaciones por correo de pedidos (Gmail con contraseña de aplicación).
// Las variables se leen al usarse porque dotenv se carga después de los imports.
// Si SMTP_USER / SMTP_PASS no están definidos, no se envía nada.

let transporter = null;

function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS || '').replace(/\s/g, '');
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  }
  return transporter;
}

const frontUrl = () => (process.env.FRONT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
const correoTienda = () => process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia', stripe: 'Tarjeta (Stripe)', mercadopago: 'Mercado Pago' };

function tablaItems(pedido) {
  const filas = (pedido.items || [])
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #34144D;color:#fff">${esc(i.nombre)} <span style="color:#9787A7">x${esc(i.cantidad)}</span></td>
        <td style="padding:8px 0;border-bottom:1px solid #34144D;color:#fff;text-align:right">${dinero(i.precio * i.cantidad)}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${filas}
    ${pedido.envio ? `<tr><td style="padding:8px 0;color:#C9B8D9">Envío</td><td style="padding:8px 0;color:#C9B8D9;text-align:right">${dinero(pedido.envio)}</td></tr>` : ''}
    <tr><td style="padding:10px 0;color:#fff;font-weight:bold">Total</td><td style="padding:10px 0;color:#FF00E5;font-weight:bold;font-size:18px;text-align:right">${dinero(pedido.total)}</td></tr>
  </table>`;
}

function plantilla({ titulo, intro, pedido, boton, nota }) {
  return `<!doctype html><html><body style="margin:0;background:#07050B;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:12px 0 20px">
      <span style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#fff">ARISE</span><br>
      <span style="font-size:11px;letter-spacing:4px;color:#D98BFF">ATHLETIC SHOP</span>
    </div>
    <div style="background:#160A24;border:1px solid #34144D;border-radius:16px;padding:24px">
      <h1 style="margin:0 0 8px;font-size:20px;color:#fff">${titulo}</h1>
      <p style="margin:0 0 18px;color:#C9B8D9;font-size:14px;line-height:1.5">${intro}</p>
      <p style="margin:0 0 6px;color:#9787A7;font-size:12px;text-transform:uppercase;letter-spacing:1px">Pedido #${esc(pedido.id)} · ${esc(METODO[pedido.metodoPago] || pedido.metodoPago)} · ${pedido.entrega === 'envio' ? 'Envío a domicilio' : 'Recoger en tienda'}</p>
      ${tablaItems(pedido)}
      ${nota ? `<p style="margin:16px 0 0;color:#C9B8D9;font-size:13px;line-height:1.5">${nota}</p>` : ''}
      ${boton ? `<div style="text-align:center;margin-top:22px"><a href="${boton.url}" style="display:inline-block;background:#A100FF;background-image:linear-gradient(135deg,#7900FF,#A100FF,#FF00E5);color:#fff;text-decoration:none;font-weight:bold;letter-spacing:1px;padding:12px 24px;border-radius:12px">${esc(boton.texto)}</a></div>` : ''}
    </div>
    <p style="text-align:center;color:#9787A7;font-size:11px;margin-top:18px">ARISE Athletic Shop · Tu estilo. Tu fuerza. Tu evolución.</p>
  </div></body></html>`;
}

function datosCliente(pedido) {
  const c = pedido.cliente || {};
  return [
    `<strong style="color:#fff">${esc(c.nombre)}</strong>`,
    c.telefono && `Tel. ${esc(c.telefono)}`,
    c.email && esc(c.email),
    pedido.entrega === 'envio' && c.direccion && `Dirección: ${esc(c.direccion)}${c.referencias ? ` (${esc(c.referencias)})` : ''}`,
    pedido.notas && `Notas: ${esc(pedido.notas)}`,
  ]
    .filter(Boolean)
    .join('<br>');
}

async function enviar(to, subject, html) {
  const t = getTransporter();
  if (!t || !to) return;
  await t.sendMail({ from: `"ARISE Athletic Shop" <${process.env.SMTP_USER}>`, to, subject, html });
  console.log(`[notificaciones] enviado a ${to}: ${subject}`);
}

// Envía sin bloquear la respuesta de la API; un fallo de correo nunca rompe el pedido.
function enSegundoPlano(nombre, fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`[notificaciones] ${nombre}:`, err.message));
}

const esTransferencia = (p) => p?.metodoPago === 'transferencia';

/** Pedido nuevo por transferencia: aviso a la tienda y confirmación al cliente. */
export function notificarPedidoTransferencia(pedido) {
  if (!esTransferencia(pedido)) return;
  const urlPedido = `${frontUrl()}/pedido/${pedido.id}`;
  enSegundoPlano('pedido nuevo (tienda)', () =>
    enviar(
      correoTienda(),
      `Nuevo pedido #${pedido.id} por transferencia · ${dinero(pedido.total)}`,
      plantilla({
        titulo: 'Nuevo pedido por transferencia',
        intro: `Entró un pedido que espera la transferencia del cliente.<br><br>${datosCliente(pedido)}`,
        pedido,
        boton: { texto: 'Revisar en el POS', url: `${frontUrl()}/pos/pedidos` },
      })
    )
  );
  enSegundoPlano('pedido nuevo (cliente)', () =>
    enviar(
      pedido.cliente?.email,
      `Recibimos tu pedido #${pedido.id} · ARISE Athletic Shop`,
      plantilla({
        titulo: `¡Gracias, ${esc(pedido.cliente?.nombre || '')}!`,
        intro: 'Recibimos tu pedido. Para completarlo realiza la transferencia y sube tu comprobante desde la página de tu pedido; te avisaremos en cuanto verifiquemos el pago.',
        pedido,
        boton: { texto: 'Ver mi pedido y datos de pago', url: urlPedido },
      })
    )
  );
}

/** El cliente subió su comprobante: aviso a la tienda para verificar. */
export function notificarComprobante(pedido) {
  if (!esTransferencia(pedido)) return;
  enSegundoPlano('comprobante (tienda)', () =>
    enviar(
      correoTienda(),
      `Comprobante recibido · pedido #${pedido.id} · ${dinero(pedido.total)}`,
      plantilla({
        titulo: 'El cliente subió su comprobante',
        intro: `Verifica que la transferencia se haya reflejado y confirma o rechaza el pago desde el POS.<br><br>${datosCliente(pedido)}`,
        pedido,
        boton: { texto: 'Verificar pago', url: `${frontUrl()}/pos/pedidos` },
      })
    )
  );
}

/** Pedido pagado en línea (Stripe / Mercado Pago): aviso a la tienda y confirmación al cliente. */
export function notificarPagoEnLinea(pedido) {
  const metodo = METODO[pedido.metodoPago] || pedido.metodoPago;
  enSegundoPlano('pago en línea (tienda)', () =>
    enviar(
      correoTienda(),
      `Nuevo pedido #${pedido.id} pagado · ${metodo} · ${dinero(pedido.total)}`,
      plantilla({
        titulo: `Nuevo pedido pagado con ${esc(metodo)}`,
        intro: `El pago ya fue aprobado; solo falta preparar el pedido.<br><br>${datosCliente(pedido)}`,
        pedido,
        boton: { texto: 'Ver en el POS', url: `${frontUrl()}/pos/pedidos` },
      })
    )
  );
  notificarPagoConfirmado(pedido);
}

/** Pago confirmado por la tienda: aviso al cliente. */
export function notificarPagoConfirmado(pedido) {
  enSegundoPlano('pago confirmado (cliente)', () =>
    enviar(
      pedido.cliente?.email,
      `Pago confirmado · pedido #${pedido.id} · ARISE Athletic Shop`,
      plantilla({
        titulo: '¡Tu pago fue confirmado!',
        intro:
          pedido.entrega === 'envio'
            ? 'Ya estamos preparando tu pedido para enviarlo a tu domicilio.'
            : 'Ya estamos preparando tu pedido. Te avisaremos cuando esté listo para recoger en tienda.',
        pedido,
        boton: { texto: 'Ver mi pedido', url: `${frontUrl()}/pedido/${pedido.id}` },
      })
    )
  );
}

/** Pago rechazado por la tienda: aviso al cliente. */
export function notificarPagoRechazado(pedido, motivo) {
  enSegundoPlano('pago rechazado (cliente)', () =>
    enviar(
      pedido.cliente?.email,
      `No pudimos confirmar tu pago · pedido #${pedido.id}`,
      plantilla({
        titulo: 'No pudimos confirmar tu pago',
        intro: 'No encontramos la transferencia de este pedido, por lo que fue cancelado. Si ya realizaste el pago, contáctanos respondiendo a este correo.',
        pedido,
        nota: motivo ? `Motivo: ${esc(motivo)}` : '',
        boton: { texto: 'Ver mi pedido', url: `${frontUrl()}/pedido/${pedido.id}` },
      })
    )
  );
}

/** Comprueba la conexión con el servidor de correo (para pruebas). */
export async function verificarCorreo() {
  const t = getTransporter();
  if (!t) throw new Error('SMTP_USER / SMTP_PASS no configurados');
  await t.verify();
}
