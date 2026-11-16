import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { ConfigTicket } from '../models/ConfigTicket.js';
import { aRespuesta, obtenerConfigTicket } from '../configTicket.js';
import { HttpError, serverError } from '../utils.js';

const router = Router();
const MAX_LOGO = 90_000; // caracteres del data URL (~65 KB de PNG); los logos de ticket pesan unos pocos KB.

function validarLogo(valor, campo) {
  if (valor === '' || valor == null) return '';
  const s = String(valor);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) throw new HttpError(400, `${campo}: debe ser una imagen PNG`);
  if (s.length > MAX_LOGO) throw new HttpError(400, `${campo}: la imagen es demasiado grande (máx. ~65 KB)`);
  return s;
}

router.get('/', async (req, res) => {
  try {
    res.json(aRespuesta(await obtenerConfigTicket()));
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    await obtenerConfigTicket();
    const b = req.body || {};
    const set = {};
    if (b.anchoPapel !== undefined) {
      const ancho = Number(b.anchoPapel);
      if (ancho !== 58 && ancho !== 80) throw new HttpError(400, 'El ancho de papel debe ser 58 u 80 mm');
      set.anchoPapel = ancho;
    }
    if (b.mostrarLogo !== undefined) set.mostrarLogo = Boolean(b.mostrarLogo);
    if (b.ticketLogo58 !== undefined) set.ticketLogo58 = validarLogo(b.ticketLogo58, 'Logo 58 mm');
    if (b.ticketLogo80 !== undefined) set.ticketLogo80 = validarLogo(b.ticketLogo80, 'Logo 80 mm');
    const c = await ConfigTicket.findOneAndUpdate({ clave: 'ticket' }, { $set: set }, { new: true }).lean();
    res.json(aRespuesta(c));
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
