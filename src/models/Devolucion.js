import mongoose from 'mongoose';

const itemDevolucionSchema = new mongoose.Schema({
  productoId: { type: Number, required: true },
  nombre: { type: String, required: true },
  cantidad: { type: Number, required: true },
  precio: { type: Number, required: true },
  costo: { type: Number, default: 0 },
  tipo: { type: String, enum: ['revendible', 'perdida'], required: true },
});

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: { type: String, required: true },
  ventaId: { type: Number, default: 0 },
  items: [itemDevolucionSchema],
  /** Dinero devuelto al cliente por esta devolución. */
  reembolso: { type: Number, default: 0 },
  /**
   * Ajuste al costo de lo vendido en la fecha de la devolución:
   *  - con venta: + costo de lo que se perdió (la venta ya no lo incluye)
   *  - sin venta: − costo de lo que regresó al inventario
   */
  ajusteCosto: { type: Number, default: 0 },
  /** true si las cantidades devueltas ya se descontaron del ticket de la venta. */
  aplicadaAVenta: { type: Boolean, default: false },
});

export const Devolucion = mongoose.model('Devolucion', schema);
