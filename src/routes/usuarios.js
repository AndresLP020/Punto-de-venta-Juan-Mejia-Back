import { Router } from 'express';
import { getNextId } from '../db.js';
import { Usuario } from '../models/Usuario.js';
import { hashPassword } from '../seguridad.js';

const router = Router();

const permisosDefault = () => ({
  hacerVentas: true,
  darDeBajaProductos: false,
  actualizarProductos: true,
  borrarProductos: false,
});

function normalizarPermisos(p) {
  if (!p) return permisosDefault();
  return {
    hacerVentas: p.hacerVentas !== false,
    darDeBajaProductos: p.darDeBajaProductos === true,
    actualizarProductos: p.actualizarProductos !== false,
    borrarProductos: p.borrarProductos === true,
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

router.get('/', async (req, res) => {
  try {
    const list = await Usuario.find().sort({ id: 1 }).lean();
    res.json(list.map(toResponse));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const u = await Usuario.findOne({ id: Number(req.params.id) }).lean();
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(toResponse(u));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email, password, nombre, telefono, permisos } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const existe = await Usuario.findOne({ email: String(email).trim().toLowerCase() });
    if (existe) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    const id = await getNextId(Usuario);
    const usuario = await Usuario.create({
      id,
      email: String(email).trim().toLowerCase(),
      password: hashPassword(password),
      nombre: nombre || '',
      telefono: telefono || '',
      permisos: {
        hacerVentas: permisos?.hacerVentas !== false,
        darDeBajaProductos: permisos?.darDeBajaProductos === true,
        actualizarProductos: permisos?.actualizarProductos !== false,
        borrarProductos: permisos?.borrarProductos === true,
      },
    });
    res.status(201).json(toResponse(usuario.toObject()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Usuario.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { email, password, nombre, telefono, permisos } = req.body;
    if (email != null) {
      const nuevoEmail = String(email).trim().toLowerCase();
      if (!nuevoEmail) return res.status(400).json({ error: 'El correo es obligatorio' });
      const otro = await Usuario.findOne({ email: nuevoEmail, id: { $ne: doc.id } }).lean();
      if (otro) return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
      doc.email = nuevoEmail;
    }
    if (password != null && String(password).length > 0) {
      if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      doc.password = hashPassword(password);
    }
    if (nombre != null) doc.nombre = String(nombre);
    if (telefono != null) doc.telefono = String(telefono);
    if (permisos != null) {
      doc.permisos = {
        hacerVentas: permisos.hacerVentas !== false,
        darDeBajaProductos: permisos.darDeBajaProductos === true,
        actualizarProductos: permisos.actualizarProductos !== false,
        borrarProductos: permisos.borrarProductos === true,
      };
    }
    await doc.save();
    res.json(toResponse(doc.toObject()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await Usuario.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
