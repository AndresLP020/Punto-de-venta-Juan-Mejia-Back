export const APP_TZ = process.env.APP_TZ || 'America/Mexico_City';

export const redondear2 = (n) => Math.round(Number(n) * 100) / 100;

/** Número finito o el valor por defecto (evita guardar NaN / Infinity). */
export function numero(v, porDefecto = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

/** Error con código HTTP para devolver mensajes de validación al cliente. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Responde un error: los de validación (HttpError) con su mensaje, el resto con un mensaje genérico. */
export function serverError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

/** Fecha YYYY-MM-DD en la zona horaria del negocio (no la del servidor, que en Render es UTC). */
export function fechaLocalISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/** Normaliza una fecha recibida del cliente: 'YYYY-MM-DD' se conserva, cualquier otra se convierte a ISO. */
export function normalizarFecha(valor) {
  if (valor == null || valor === '') return null;
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Fecha inválida');
  return d.toISOString();
}

/** Lunes (YYYY-MM-DD) de la semana de la fecha dada, calculado en la zona horaria del negocio. */
export function lunesDeSemana(d = new Date()) {
  const local = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) : fechaLocalISO(d);
  const [y, m, dia] = local.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, dia));
  const diaSemana = fecha.getUTCDay();
  fecha.setUTCDate(fecha.getUTCDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
  return fecha.toISOString().slice(0, 10);
}

export function texto(v, max = 500) {
  return v == null ? '' : String(v).trim().slice(0, max);
}
