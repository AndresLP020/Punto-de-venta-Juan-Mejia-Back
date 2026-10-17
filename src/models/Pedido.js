import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    id: Number,
    nombre: String,
    precio: Number,
    cantidad: Number,
    costo: Number,
    esGranel: Boolean,
    imagen: String,
  },
  { _id: false }
);

const clienteSchema = new mongoose.Schema(
  {
    nombre: String,
    telefono: String,
    email: String,
    direccion: String,
    referencias: String,
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  id: { type: Number, required: true },
  fecha: { type: String, required: true },
  items: [itemSchema],
  subtotal: Number,
  envio: { type: Number, default: 0 },
  total: Number,
  cliente: clienteSchema,
  // Como se entrega: recoger en tienda o envio a domicilio
  entrega: { type: String, enum: ['pickup', 'envio'], default: 'pickup' },
  metodoPago: { type: String, enum: ['efectivo', 'transferencia', 'stripe', 'mercadopago'], required: true },
  // Estado del pago
  estadoPago: {
    type: String,
    enum: ['pendiente', 'en_revision', 'pagado', 'rechazado'],
    default: 'pendiente',
  },
  // Estado logistico del pedido
  estadoPedido: {
    type: String,
    enum: ['nuevo', 'confirmado', 'preparando', 'listo', 'entregado', 'cancelado'],
    default: 'nuevo',
  },
  // Comprobante de transferencia (imagen base64 o URL) que sube el cliente
  comprobante: { type: String, default: '' },
  // Referencias de pasarela
  stripeSessionId: String,
  stripePaymentIntentId: String,
  mpPreferenceId: String,
  mpPaymentId: String,
  notas: { type: String, default: '' },
  // Evita descontar stock dos veces
  stockDescontado: { type: Boolean, default: false },
  creadoEn: { type: String },
  actualizadoEn: { type: String },
});

export const Pedido = mongoose.model('Pedido', schema);
