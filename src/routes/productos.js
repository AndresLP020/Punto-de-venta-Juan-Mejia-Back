import { Router } from 'express';
import { getNextId } from '../db.js';
import { Producto } from '../models/Producto.js';
import { requirePermiso, tienePermiso } from '../auth.js';
import { HttpError, numero, redondear2, serverError, texto } from '../utils.js';

const router = Router();

function noNegativo(valor, campo) {
  const n = numero(valor, NaN);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${campo} debe ser un número mayor o igual a 0`);
  return n;
}

async function validarCodigoLibre(codigo, idActual) {
  if (!codigo) return;
  const otro = await Producto.findOne({ codigo, ...(idActual ? { id: { $ne: idActual } } : {}) }).select('nombre').lean();
  if (otro) throw new HttpError(400, `El código ${codigo} ya lo usa "${otro.nombre}"`);
}

router.get('/', async (req, res) => {
  try {
    const proveedorId = req.query.proveedorId != null ? Number(req.query.proveedorId) : null;
    const query = proveedorId != null && Number.isFinite(proveedorId) ? { proveedorId } : {};
    const productos = await Producto.find(query).sort({ id: 1 }).lean();
    res.json(productos);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/codigo/:codigo', async (req, res) => {
  try {
    const p = await Producto.findOne({ codigo: String(req.params.codigo) }).lean();
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Producto.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', requirePermiso('actualizarProductos'), async (req, res) => {
  try {
    const { nombre, codigo, categoria, precio, costo, stock, stockMinimo, estado, esGranel, proveedorId } = req.body || {};
    const nombreLimpio = texto(nombre, 200);
    if (!nombreLimpio) throw new HttpError(400, 'El nombre del producto es requerido');
    const codigoLimpio = texto(codigo, 60);
    await validarCodigoLibre(codigoLimpio);
    const id = await getNextId(Producto);
    const nuevo = await Producto.create({
      id,
      nombre: nombreLimpio,
      codigo: codigoLimpio || String(id).padStart(10, '0'),
      categoria: texto(categoria, 80),
      precio: redondear2(noNegativo(precio ?? 0, 'El precio')),
      costo: redondear2(noNegativo(costo ?? 0, 'El costo')),
      stock: noNegativo(stock ?? 0, 'El stock'),
      stockMinimo: noNegativo(stockMinimo ?? 0, 'El stock mínimo'),
      estado: estado === 'Inactivo' ? 'Inactivo' : 'Activo',
      esGranel: Boolean(esGranel),
      proveedorId: proveedorId != null && proveedorId !== '' ? Number(proveedorId) : undefined,
    });
    res.status(201).json(nuevo.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Producto.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Producto no encontrado' });
    const { nombre, codigo, categoria, precio, costo, stock, stockMinimo, estado, esGranel, proveedorId } = req.body || {};

    // Dar de baja (estado Inactivo) y modificar datos son permisos distintos.
    const cambiaEstado = estado != null && estado !== (doc.estado || 'Activo');
    // El formulario envía todos los campos: solo cuenta como modificación lo que realmente cambia.
    const distinto = (nuevo, actual) => {
      if (nuevo === undefined) return false;
      if (typeof actual === 'number' || typeof nuevo === 'number') return numero(nuevo, NaN) !== numero(actual, NaN);
      if (typeof actual === 'boolean') return Boolean(nuevo) !== actual;
      return String(nuevo ?? '').trim() !== String(actual ?? '').trim();
    };
    const cambiaDatos =
      distinto(nombre, doc.nombre) ||
      distinto(codigo, doc.codigo) ||
      distinto(categoria, doc.categoria) ||
      distinto(precio, doc.precio) ||
      distinto(costo, doc.costo) ||
      distinto(stock, doc.stock) ||
      distinto(stockMinimo, doc.stockMinimo) ||
      distinto(esGranel, doc.esGranel ?? false) ||
      (proveedorId !== undefined && (proveedorId ?? null) !== (doc.proveedorId ?? null) && Number(proveedorId) !== doc.proveedorId);
    if (cambiaEstado && !tienePermiso(req.sesion, 'darDeBajaProductos')) {
      return res.status(403).json({ error: 'No tienes permiso para dar de baja o reactivar productos' });
    }
    if (cambiaDatos && !tienePermiso(req.sesion, 'actualizarProductos')) {
      return res.status(403).json({ error: 'No tienes permiso para modificar productos' });
    }

    if (nombre != null) {
      const n = texto(nombre, 200);
      if (!n) throw new HttpError(400, 'El nombre del producto es requerido');
      doc.nombre = n;
    }
    if (codigo != null) {
      const c = texto(codigo, 60);
      if (c !== doc.codigo) await validarCodigoLibre(c, doc.id);
      doc.codigo = c || String(doc.id).padStart(10, '0');
    }
    if (categoria != null) doc.categoria = texto(categoria, 80);
    if (precio != null) doc.precio = redondear2(noNegativo(precio, 'El precio'));
    if (costo != null) doc.costo = redondear2(noNegativo(costo, 'El costo'));
    if (stock != null) doc.stock = noNegativo(stock, 'El stock');
    if (stockMinimo != null) doc.stockMinimo = noNegativo(stockMinimo, 'El stock mínimo');
    if (estado != null) doc.estado = estado === 'Inactivo' ? 'Inactivo' : 'Activo';
    if (esGranel != null) doc.esGranel = Boolean(esGranel);
    if (proveedorId !== undefined) doc.proveedorId = proveedorId != null && proveedorId !== '' ? Number(proveedorId) : null;
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', requirePermiso('borrarProductos'), async (req, res) => {
  try {
    const r = await Producto.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.status(204).send();
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
