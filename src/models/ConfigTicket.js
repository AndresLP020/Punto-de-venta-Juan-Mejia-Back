import mongoose from 'mongoose';

/**
 * Configuración del ticket (un solo documento por negocio).
 * Los logos se guardan como data URL PNG (son archivos pequeños de 1 bit), así funcionan igual
 * en la nube y en la impresora local sin depender de archivos en disco.
 */
const schema = new mongoose.Schema(
  {
    clave: { type: String, default: 'ticket', unique: true },
    anchoPapel: { type: Number, enum: [58, 80], default: 80 },
    mostrarLogo: { type: Boolean, default: true },
    ticketLogo58: { type: String, default: '' },
    ticketLogo80: { type: String, default: '' },
  },
  { timestamps: true }
);

export const ConfigTicket = mongoose.model('ConfigTicket', schema);
