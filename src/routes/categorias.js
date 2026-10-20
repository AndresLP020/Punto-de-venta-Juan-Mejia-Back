import { Router } from 'express';
import { Categoria } from '../models/Categoria.js';
import { Producto } from '../models/Producto.js';
import { requirePermiso } from '../auth.js';
import { serverError, texto } from '../utils.js';

const router = Router();
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listar() {
  const docs = await Categoria.find().sort({ nombre: 1 }).lean();
  return docs.map((c) => c.nombre);
}

router.get('/', async (req, res) => {
  try {
    res.json(await listar());
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', requirePermiso('actualizarProductos'), async (req, res) => {
  try {
    const name = texto(req.body?.nombre, 80);
    if (!name) return res.status(400).json({ error: 'El nombre de la categoría es requerido' });
    const existe = await Categoria.findOne({ nombre: { $regex: new RegExp('^' + escaparRegex(name) + '$', 'i') } });
    if (existe) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    await Categoria.create({ nombre: name });
    res.status(201).json(await listar());
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    serverError(res, err);
  }
});

router.delete('/:nombre', requirePermiso('borrarProductos'), async (req, res) => {
  try {
    const nombre = String(req.params.nombre);
    const enUso = await Producto.countDocuments({ categoria: nombre });
    if (enUso > 0) {
      return res.status(400).json({ error: `No se puede eliminar: ${enUso} producto(s) usan esta categoría. Cámbialos de categoría primero.` });
    }
    const r = await Categoria.deleteOne({ nombre });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.status(200).json(await listar());
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
