import { Router } from 'express';
import { Usuario } from '../models/Usuario.js';
import {
  ADMIN_PASSWORD,
  LOGIN_PASSWORD,
  LOGIN_USER,
  PERMISOS_PRINCIPAL,
  compararSeguro,
  esHash,
  firmarToken,
  hashPassword,
  limiteIntentos,
  requireAuth,
  tokenAdmin,
  verificarPassword,
} from '../auth.js';
import { serverError } from '../utils.js';
import { normalizarPermisos } from './usuarios.js';

const router = Router();
const limiteLogin = limiteIntentos('login');
const limiteAdmin = limiteIntentos('admin');

const MSG_BLOQUEO = 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.';

function respuestaSesion(sesion) {
  return {
    ok: true,
    token: firmarToken(sesion),
    usuario: { nombre: sesion.nombre, email: sesion.sub, principal: sesion.principal, permisos: sesion.permisos },
  };
}

router.post('/login', async (req, res) => {
  try {
    if (limiteLogin.bloqueado(req)) return res.status(429).json({ error: MSG_BLOQUEO });
    const { usuario, password } = req.body || {};
    const user = usuario != null ? String(usuario).trim().toLowerCase() : '';
    const pass = password != null ? String(password) : '';
    if (!user || !pass) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    // Usuario principal (definido en variables de entorno)
    if (LOGIN_PASSWORD && user === LOGIN_USER && compararSeguro(pass, LOGIN_PASSWORD)) {
      limiteLogin.exito(req);
      return res.json(respuestaSesion({ sub: LOGIN_USER, nombre: 'Administrador', principal: true, permisos: PERMISOS_PRINCIPAL, admin: false }));
    }

    // Usuarios creados en Configuración (inician sesión con su correo)
    const doc = await Usuario.findOne({ email: user });
    if (doc && (await verificarPassword(pass, doc.password))) {
      if (!esHash(doc.password)) {
        doc.password = await hashPassword(pass);
        await doc.save();
      }
      limiteLogin.exito(req);
      return res.json(
        respuestaSesion({ sub: doc.email, uid: doc.id, nombre: doc.nombre || doc.email, principal: false, permisos: normalizarPermisos(doc.permisos), admin: false })
      );
    }

    limiteLogin.fallo(req);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/verify-admin', requireAuth, (req, res) => {
  if (limiteAdmin.bloqueado(req)) return res.status(429).json({ error: MSG_BLOQUEO });
  const { password } = req.body || {};
  const provided = password != null ? String(password).trim() : '';
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Contraseña de administrador no configurada (ADMIN_PASSWORD)' });
  }
  if (provided && compararSeguro(provided, ADMIN_PASSWORD)) {
    limiteAdmin.exito(req);
    return res.json({ ok: true, token: tokenAdmin(req.sesion) });
  }
  limiteAdmin.fallo(req);
  return res.status(401).json({ error: 'Contraseña incorrecta' });
});

router.get('/me', requireAuth, (req, res) => {
  const s = req.sesion;
  res.json({ nombre: s.nombre, email: s.sub, principal: s.principal, permisos: s.permisos, admin: Boolean(s.admin) });
});

export default router;
