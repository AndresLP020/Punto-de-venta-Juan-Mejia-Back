import { Router } from 'express';
import { getNextId } from '../db.js';
import { Producto } from '../models/Producto.js';
import { requiereAdmin, requierePermiso, puede } from '../seguridad.js';

const router = Router();
const redondear2 = (n) => Math.round(Number(n) * 100) / 100;

router.get('/', async (req, res) => {
  try {
    const proveedorId = req.query.proveedorId != null ? Number(req.query.proveedorId) : null;
    const query = proveedorId != null ? { proveedorId } : {};
    const productos = await Producto.find(query).sort({ id: 1 }).lean();
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importar productos desde CSV (ya convertido a filas por el POS).
// Si el código ya existe se actualiza el producto; si no, se crea.
router.post('/importar', requiereAdmin, async (req, res) => {
  try {
    const filas = Array.isArray(req.body?.productos) ? req.body.productos : [];
    if (filas.length === 0) return res.status(400).json({ error: 'El archivo no tiene productos' });
    if (filas.length > 2000) return res.status(400).json({ error: 'Máximo 2000 productos por archivo' });
    const num = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    };
    const bool = (v) => /^(si|sí|true|1|x)$/i.test(String(v ?? '').trim());
    let creados = 0;
    let actualizados = 0;
    const errores = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i] || {};
      const nombre = String(f.nombre ?? '').trim();
      const codigo = String(f.codigo ?? '').trim();
      const datos = {};
      if (nombre) datos.nombre = nombre;
      if (f.categoria != null && String(f.categoria).trim()) datos.categoria = String(f.categoria).trim();
      if (num(f.precio) !== undefined) datos.precio = redondear2(num(f.precio));
      if (num(f.costo) !== undefined) datos.costo = redondear2(num(f.costo));
      if (num(f.stock) !== undefined) datos.stock = num(f.stock);
      if (num(f.stockMinimo) !== undefined) datos.stockMinimo = num(f.stockMinimo);
      if (f.estado != null && String(f.estado).trim()) datos.estado = /inactivo/i.test(f.estado) ? 'Inactivo' : 'Activo';
      if (f.esGranel != null && String(f.esGranel).trim() !== '') datos.esGranel = bool(f.esGranel);
      if (f.destacado != null && String(f.destacado).trim() !== '') datos.destacado = bool(f.destacado);
      if (f.descripcion != null) datos.descripcion = String(f.descripcion);
      if (num(f.proveedorId) !== undefined) datos.proveedorId = num(f.proveedorId);
      try {
        const existente = codigo ? await Producto.findOne({ codigo }) : null;
        if (existente) {
          Object.assign(existente, datos);
          await existente.save();
          actualizados++;
        } else {
          if (!nombre) {
            errores.push(`Fila ${i + 2}: falta el nombre`);
            continue;
          }
          const id = await getNextId(Producto);
          await Producto.create({
            id,
            codigo: codigo || String(id).padStart(10, '0'),
            precio: 0,
            costo: 0,
            stock: 0,
            stockMinimo: 0,
            estado: 'Activo',
            ...datos,
          });
          creados++;
        }
      } catch (e) {
        errores.push(`Fila ${i + 2}: ${e.message}`);
      }
    }
    res.json({ creados, actualizados, errores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/codigo/:codigo', async (req, res) => {
  try {
    const p = await Producto.findOne({ codigo: req.params.codigo }).lean();
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await Producto.findOne({ id: Number(req.params.id) }).lean();
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requierePermiso('actualizarProductos'), async (req, res) => {
  try {
    if (!req.body?.nombre || !String(req.body.nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { nombre, codigo, categoria, precio, costo, stock, stockMinimo, estado, esGranel, proveedorId, descripcion, imagen, destacado } = req.body;
    const id = await getNextId(Producto);
    const nuevo = await Producto.create({
      id,
      nombre,
      codigo: codigo || String(id).padStart(10, '0'),
      categoria,
      precio: redondear2(precio) || 0,
      costo: redondear2(costo) || 0,
      stock: Number(stock) || 0,
      stockMinimo: Number(stockMinimo) || 0,
      estado: estado || 'Activo',
      esGranel: Boolean(esGranel),
      proveedorId: proveedorId != null ? Number(proveedorId) : undefined,
      descripcion: descripcion || '',
      imagen: imagen || '',
      destacado: Boolean(destacado),
    });
    res.status(201).json(nuevo.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requierePermiso('actualizarProductos'), async (req, res) => {
  try {
    const doc = await Producto.findOne({ id: Number(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Producto no encontrado' });
    const { nombre, codigo, categoria, precio, costo, stock, stockMinimo, estado, esGranel, proveedorId, descripcion, imagen, destacado } = req.body;
    if (nombre != null) doc.nombre = nombre;
    if (codigo != null) doc.codigo = codigo;
    if (categoria != null) doc.categoria = categoria;
    if (precio != null) doc.precio = redondear2(precio);
    if (costo != null) doc.costo = redondear2(costo);
    if (stock != null) doc.stock = Number(stock);
    if (stockMinimo != null) doc.stockMinimo = Number(stockMinimo);
    if (estado != null && estado !== doc.estado) {
      if (estado === 'Inactivo' && !puede(req.sesion, 'darDeBajaProductos')) {
        return res.status(403).json({ error: 'No tienes permiso para dar de baja productos' });
      }
      doc.estado = estado;
    }
    if (esGranel != null) doc.esGranel = Boolean(esGranel);
    if (proveedorId !== undefined) doc.proveedorId = proveedorId != null ? Number(proveedorId) : null;
    if (descripcion != null) doc.descripcion = descripcion;
    if (imagen != null) doc.imagen = imagen;
    if (destacado != null) doc.destacado = Boolean(destacado);
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requierePermiso('borrarProductos'), async (req, res) => {
  try {
    const r = await Producto.deleteOne({ id: Number(req.params.id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
