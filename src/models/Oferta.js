import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true },
  titulo: String,
  descripcion: { type: String, default: '' },
  imagen: { type: String, default: '' },
  precioNormal: { type: Number, default: 0 },
  precioOferta: { type: Number, default: 0 },
  // Nombres o referencias de los productos incluidos en la oferta
  productos: { type: [String], default: [] },
  activa: { type: Boolean, default: true },
  fechaInicio: String,
  fechaFin: String,
  creadaEn: String,
});

export const Oferta = mongoose.model('Oferta', schema);
