import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({ id: Number, nombre: String, precio: Number, cantidad: Number, costo: Number }, { _id: false });

/**
 * Pedido tomado en Ventas que el cliente paga en caja.
 * Flujo: 'por_pagar' → (caja cobra) 'pagado' → (quien lo tomó entrega) 'entregado'.
 * 'cancelado' solo desde 'por_pagar'. Los productos se apartan del inventario al crear el pedido.
 */
const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  fecha: { type: String, required: true },
  items: [itemSchema],
  total: Number,
  cliente: String,
  clienteId: Number,
  estado: { type: String, enum: ['por_pagar', 'pagado', 'entregado', 'cancelado'], default: 'por_pagar' },
  /** Quién tomó el pedido. */
  usuario: String,
  usuarioNombre: String,
  /** Quién cobró en caja. */
  cajero: String,
  cajeroNombre: String,
  fechaPago: String,
  /** Venta que se registró al cobrar. */
  ventaId: Number,
  /** Quién entregó la mercancía. */
  entregadoPor: String,
  entregadoPorNombre: String,
  fechaEntrega: String,
  fechaCancelacion: String,
  canceladoPor: String,
});

schema.index({ estado: 1, id: -1 });

export const Pedido = mongoose.model('Pedido', schema);
