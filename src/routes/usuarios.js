import { Router } from 'express';
import { getNextId } from '../db.js';
import { Usuario } from '../models/Usuario.js';
import { hashPassword } from '../auth.js';
import { HttpError, serverError, texto } from '../utils.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export function normalizarPermisos(p) {
  return {
    hacerVentas: p?.hacerVentas !== false,
    darDeBajaProductos: p?.darDeBajaProductos === true,
    actualizarProductos: p?.actualizarProductos !== false,
    borrarProductos: p?.borrarProductos === true,
  };
}

function toResponse(u) {
  return {
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    telefono: u.telefono,
    permisos: normalizarPermisos(u.permisos),
  };
}

function validarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Correo electrónico inválido');
  return e;
}

function validarPassword(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  return p;
}

router.get('/', async (req, res) => {
  try {
    const list = await Usuario.find().sort({ id: 1 }).lean();
    res.json(list.map(toResponse));
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const u = await Usuario.findOne({ id: Number(req.params.id) }).lean();
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(toResponse(u));
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, password, nombre, telefono, permisos } = req.body;
    const emailNorm = validarEmail(email);
    const pass = validarPassword(password);
    const existe = await Usuario.findOne({ email: emailNorm });
    if (existe) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    const id = await getNextId(Usuario);
    const usuario = await Usuario.create({
      id,
      email: emailNorm,
      password: await hashPassword(pass),
      nombre: texto(nombre, 120),
      telefono: texto(telefono, 40),
      permisos: normalizarPermisos(permisos),
    });
    res.status(201).json(toResponse(usuario.toObject()));
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    serverError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Usuario.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { email, password, nombre, telefono, permisos } = req.body;
    if (email != null) {
      const emailNorm = validarEmail(email);
      const otro = await Usuario.findOne({ email: emailNorm, id: { $ne: doc.id } });
      if (otro) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
      doc.email = emailNorm;
    }
    if (password != null && String(password).length > 0) doc.password = await hashPassword(validarPassword(password));
    if (nombre != null) doc.nombre = texto(nombre, 120);
    if (telefono != null) doc.telefono = texto(telefono, 40);
    if (permisos != null) doc.permisos = normalizarPermisos(permisos);
    await doc.save();
    res.json(toResponse(doc.toObject()));
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await Usuario.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
