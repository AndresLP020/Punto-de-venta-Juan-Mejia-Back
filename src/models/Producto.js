import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: String,
  codigo: String,
  categoria: String,
  precio: Number,
  costo: Number,
  stock: Number,
  stockMinimo: Number,
  estado: { type: String, default: 'Activo' },
  esGranel: { type: Boolean, default: false },
  proveedorId: Number,
});

export const Producto = mongoose.model('Producto', schema);
