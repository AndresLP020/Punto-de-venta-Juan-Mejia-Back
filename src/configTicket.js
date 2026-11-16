import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfigTicket } from './models/ConfigTicket.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tickets');

/** Logos que se cargan por defecto la primera vez (los del cliente instalado en este servidor). */
const LOGOS_INICIALES = {
  ticketLogo58: 'pollito-mixteco-ticket-58mm.png',
  ticketLogo80: 'pollito-mixteco-ticket-80mm.png',
};

async function leerComoDataUrl(archivo) {
  try {
    const buf = await fs.readFile(path.join(ASSETS, archivo));
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch {
    return '';
  }
}

/** Devuelve la configuración del ticket; si no existe, la crea con los logos de assets/tickets. */
export async function obtenerConfigTicket() {
  const existente = await ConfigTicket.findOne({ clave: 'ticket' }).lean();
  if (existente) return existente;
  const datos = { clave: 'ticket', anchoPapel: 80 };
  for (const [campo, archivo] of Object.entries(LOGOS_INICIALES)) datos[campo] = await leerComoDataUrl(archivo);
  datos.mostrarLogo = Boolean(datos.ticketLogo58 || datos.ticketLogo80);
  try {
    await ConfigTicket.create(datos);
  } catch (err) {
    if (err.code !== 11000) throw err; // Otra petición la creó al mismo tiempo.
  }
  return ConfigTicket.findOne({ clave: 'ticket' }).lean();
}

export function aRespuesta(c) {
  return {
    anchoPapel: c.anchoPapel === 58 ? 58 : 80,
    mostrarLogo: Boolean(c.mostrarLogo),
    ticketLogo58: c.ticketLogo58 || '',
    ticketLogo80: c.ticketLogo80 || '',
  };
}
