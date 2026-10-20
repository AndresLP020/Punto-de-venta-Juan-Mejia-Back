import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const isProd = process.env.NODE_ENV === 'production';

const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.AUTH_SECRET) {
  console.warn('[auth] AUTH_SECRET no está definido: se generó uno temporal. Las sesiones se cerrarán cada vez que se reinicie el servidor.');
}

const HORAS_SESION = 12;
const HORAS_ADMIN = 8;

/**
 * Permisos del usuario principal fuera del modo administrador: solo vender.
 * Administrar productos, gastos, etc. requiere entrar al modo administrador (o un usuario
 * de Configuración con esos permisos).
 */
export const PERMISOS_PRINCIPAL = {
  hacerVentas: true,
  darDeBajaProductos: false,
  actualizarProductos: false,
  borrarProductos: false,
};

// ---------------------------------------------------------------------------
// Contraseñas (scrypt con sal; formato "scrypt$sal$hash")
// ---------------------------------------------------------------------------

export function esHash(valor) {
  return typeof valor === 'string' && valor.startsWith('scrypt$');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarPassword(password, guardado) {
  if (!guardado) return false;
  if (!esHash(guardado)) return compararSeguro(String(password), String(guardado));
  const [, saltB64, hashB64] = guardado.split('$');
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(String(password), Buffer.from(saltB64, 'base64'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

/** Comparación en tiempo constante (evita ataques por tiempo de respuesta). */
export function compararSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

// ---------------------------------------------------------------------------
// Tokens firmados (HMAC-SHA256)
// ---------------------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function firmarToken(payload, horas = HORAS_SESION) {
  const exp = payload.exp ?? Date.now() + horas * 3600 * 1000;
  const cuerpo = b64url(JSON.stringify({ ...payload, exp }));
  const firma = crypto.createHmac('sha256', SECRET).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

export function verificarToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [cuerpo, firma] = token.split('.');
  const esperada = crypto.createHmac('sha256', SECRET).update(cuerpo).digest('base64url');
  if (!firma || firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function tokenAdmin(sesion) {
  const exp = Math.min(sesion.exp, Date.now() + HORAS_ADMIN * 3600 * 1000);
  return firmarToken({ ...sesion, admin: true, exp });
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const sesion = verificarToken(token);
  if (!sesion) return res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión de nuevo.' });
  req.sesion = sesion;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.sesion?.admin) return res.status(403).json({ error: 'Requiere modo administrador' });
  next();
}

export function tienePermiso(sesion, permiso) {
  return Boolean(sesion?.admin || sesion?.permisos?.[permiso]);
}

export function requirePermiso(permiso) {
  return (req, res, next) => {
    if (!tienePermiso(req.sesion, permiso)) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Límite de intentos fallidos (en memoria, por IP)
// ---------------------------------------------------------------------------

const MAX_INTENTOS = 10;
const VENTANA_MS = 15 * 60 * 1000;
const intentos = new Map();

export function limiteIntentos(clave) {
  return {
    bloqueado(req) {
      const k = `${clave}:${req.ip}`;
      const reg = intentos.get(k);
      if (!reg || reg.reinicio < Date.now()) return false;
      return reg.fallos >= MAX_INTENTOS;
    },
    fallo(req) {
      const k = `${clave}:${req.ip}`;
      const reg = intentos.get(k);
      if (!reg || reg.reinicio < Date.now()) intentos.set(k, { fallos: 1, reinicio: Date.now() + VENTANA_MS });
      else reg.fallos += 1;
    },
    exito(req) {
      intentos.delete(`${clave}:${req.ip}`);
    },
  };
}

setInterval(() => {
  const ahora = Date.now();
  for (const [k, reg] of intentos) if (reg.reinicio < ahora) intentos.delete(k);
}, VENTANA_MS).unref();

// ---------------------------------------------------------------------------
// Credenciales del usuario principal y del modo administrador
// ---------------------------------------------------------------------------

// En desarrollo hay valores por defecto para poder probar; en producción deben definirse en el entorno.
export const LOGIN_USER = (process.env.LOGIN_USER || 'admin').trim().toLowerCase();
export const LOGIN_PASSWORD = (process.env.LOGIN_PASSWORD || (isProd ? '' : 'juanmejia123')).trim();
export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || (isProd ? '' : 'admin')).trim();

if (isProd && !LOGIN_PASSWORD) {
  console.warn('[auth] LOGIN_PASSWORD no está definido: el usuario principal está deshabilitado. Solo podrán entrar los usuarios creados en Configuración.');
}
if (isProd && !ADMIN_PASSWORD) {
  console.warn('[auth] ADMIN_PASSWORD no está definido: el modo administrador está deshabilitado.');
}
