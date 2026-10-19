import { Router } from 'express';
import { Usuario } from '../models/Usuario.js';
import { crearToken, verificarPassword, hashPassword, esHash, requiereSesion } from '../seguridad.js';

const router = Router();

// Credenciales del usuario principal (página de login). En producción definir en Render:
// LOGIN_USER y LOGIN_PASSWORD. Por defecto: admin / juanmejia123
const loginUser = () => (process.env.LOGIN_USER || 'admin').trim().toLowerCase();
const loginPassword = () => (process.env.LOGIN_PASSWORD || 'juanmejia123').trim();

// Contraseña de administrador (modo admin en dashboard). En producción definir ADMIN_PASSWORD en .env
const adminPassword = () =>
  (process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin')).trim();

const PERMISOS_PRINCIPAL = { hacerVentas: true, darDeBajaProductos: false, actualizarProductos: false, borrarProductos: false };

function sesionPublica(s) {
  return { usuario: s.sub, nombre: s.nombre, rol: s.rol, permisos: s.permisos, admin: Boolean(s.admin) };
}

router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    const user = usuario != null ? String(usuario).trim().toLowerCase() : '';
    const pass = password != null ? String(password) : '';
    if (!user || !pass) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    let sesion = null;
    if (user === loginUser() && pass.trim() === loginPassword()) {
      sesion = { sub: user, nombre: 'Administrador', rol: 'admin', permisos: PERMISOS_PRINCIPAL };
    } else {
      // Usuarios creados en Configuración (inician sesión con su correo)
      const u = await Usuario.findOne({ email: user });
      if (u && verificarPassword(pass, u.password)) {
        if (!esHash(u.password)) {
          u.password = hashPassword(pass); // migra contraseñas antiguas a hash
          await u.save();
        }
        sesion = {
          sub: u.email,
          uid: u.id,
          nombre: u.nombre || u.email,
          rol: 'usuario',
          permisos: {
            hacerVentas: u.permisos?.hacerVentas !== false,
            darDeBajaProductos: u.permisos?.darDeBajaProductos === true,
            actualizarProductos: u.permisos?.actualizarProductos !== false,
            borrarProductos: u.permisos?.borrarProductos === true,
          },
        };
      }
    }
    if (!sesion) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    res.json({ ok: true, token: crearToken(sesion), sesion: sesionPublica(sesion) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activa el modo administrador: devuelve un token con permisos de administrador.
router.post('/verify-admin', requiereSesion, (req, res) => {
  const { password } = req.body || {};
  const provided = password != null ? String(password).trim() : '';
  if (!adminPassword()) {
    return res.status(503).json({ error: 'Contraseña de administrador no configurada (ADMIN_PASSWORD)' });
  }
  if (provided !== adminPassword()) {
    return res.status(400).json({ error: 'Contraseña incorrecta' });
  }
  const { exp, ...base } = req.sesion;
  const sesion = { ...base, admin: true };
  res.json({ ok: true, token: crearToken(sesion), sesion: sesionPublica(sesion) });
});

router.get('/me', requiereSesion, (req, res) => {
  res.json(sesionPublica(req.sesion));
});

export default router;
