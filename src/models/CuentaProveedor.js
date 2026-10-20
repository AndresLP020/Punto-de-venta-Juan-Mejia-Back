import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  proveedorId: { type: Number, required: true },
  proveedorNombre: { type: String, required: true },
  tipo: { type: String, enum: ['deuda', 'pago'], required: true },
  fecha: { type: String, required: true },
  descripcion: { type: String, default: '' },
  monto: { type: Number, required: true },
});

export const CuentaProveedor = mongoose.model('CuentaProveedor', schema);

