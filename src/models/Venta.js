import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({ id: Number, nombre: String, precio: Number, cantidad: Number, costo: Number });
const movimientoSchema = new mongoose.Schema(
  { fecha: { type: String, required: true }, monto: { type: Number, required: true }, motivo: String },
  { _id: false }
);

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: { type: String, required: true },
  items: [itemSchema],
  total: Number,
  /** Dinero recibido del cliente (pago inicial + abonos). Nunca incluye el cambio entregado. */
  pagado: Number,
  pendiente: Number,
  cliente: String,
  clienteId: Number,
  /** 'pagado' | 'pendiente' | 'cancelada' */
  estado: String,
  /** Historial de abonos posteriores a la venta. */
  abonos: { type: [movimientoSchema], default: [] },
  /** Dinero devuelto al cliente (devoluciones, correcciones de ticket, cancelación). */
  reembolsos: { type: [movimientoSchema], default: [] },
  fechaCancelacion: String,
  usuario: String,
});

schema.index({ fecha: -1 });
schema.index({ clienteId: 1, estado: 1 });

export const Venta = mongoose.model('Venta', schema);
