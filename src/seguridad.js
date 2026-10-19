import crypto from 'crypto';

// Sesiones del POS con tokens firmados (HMAC-SHA256) y contraseñas con scrypt.
// Las variables se leen al usarse porque dotenv puede cargarse después de los imports.

const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas

function secreto() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  // Sin AUTH_SECRET se deriva uno estable de otros secretos del servidor.
  return crypto
    .createHash('sha256')
    .update(`${process.env.MONGODB_URI || ''}|${process.env.LOGIN_PASSWORD || ''}|${process.env.ADMIN_PASSWORD || ''}`)
    .digest('hex');
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (datos) => crypto.createHmac('sha256', secreto()).update(datos).digest('base64url');

export function crearToken(payload) {
  const datos = b64(JSON.stringify({ ...payload, exp: Date.now() + DURACION_MS }));
  return `${datos}.${firmar(datos)}`;
}

export function leerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [datos, firma] = token.split('.');
  if (!datos || !firma) return null;
  const esperada = firmar(datos);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const payload = JSON.parse(Buffer.from(datos, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sesionDe(req) {
  const h = req.headers.authorization || '';
  return leerToken(h.startsWith('Bearer ') ? h.slice(7) : '');
}

// --- Contraseñas ---
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export const esHash = (guardado) => String(guardado || '').startsWith('scrypt$');

export function verificarPassword(password, guardado) {
  if (!esHash(guardado)) return String(password) === String(guardado || ''); // contraseñas antiguas en texto plano
  const [, salt, hash] = guardado.split('$');
  const calculado = crypto.scryptSync(String(password), salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

// --- Permisos ---
// admin: modo administrador activo (contraseña de administrador).
// rol 'admin' (usuario principal) puede vender; lo demás requiere modo administrador.
// rol 'usuario' (cajeros) usa los permisos que se le asignaron en Configuración.
export function puede(sesion, permiso) {
  if (!sesion) return false;
  if (sesion.admin) return true;
  if (sesion.rol === 'admin') return permiso === 'hacerVentas';
  return sesion.permisos?.[permiso] === true;
}

// --- Middlewares ---
export function requiereSesion(req, res, next) {
  const sesion = sesionDe(req);
  if (!sesion) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  req.sesion = sesion;
  next();
}

export function requiereAdmin(req, res, next) {
  const sesion = sesionDe(req);
  if (!sesion) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  if (!sesion.admin) return res.status(403).json({ error: 'Requiere modo administrador' });
  req.sesion = sesion;
  next();
}

export function requierePermiso(permiso) {
  return (req, res, next) => {
    const sesion = sesionDe(req);
    if (!sesion) return res.status(401).json({ error: 'Inicia sesión para continuar' });
    if (!puede(sesion, permiso)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    req.sesion = sesion;
    next();
  };
}

// Token aleatorio para que solo el cliente que hizo un pedido pueda verlo.
export const tokenPedido = () => crypto.randomBytes(16).toString('hex');
