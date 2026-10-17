import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  clave: { type: String, default: 'pagos', unique: true },
  titular: { type: String, default: '' },
  banco: { type: String, default: '' },
  cuenta: { type: String, default: '' },
  clabe: { type: String, default: '' },
  tarjeta: { type: String, default: '' },
  whatsapp: { type: String, default: '' },
  costoEnvio: { type: Number, default: 10 },
});

export const ConfigPago = mongoose.model('ConfigPago', schema);
