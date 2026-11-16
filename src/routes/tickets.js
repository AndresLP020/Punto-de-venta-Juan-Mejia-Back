import { Router } from 'express';
import { armarEscPos, encabezadoLogo, imprimirRawEnWindows } from '../imprimirTicket.js';
import { obtenerConfigTicket } from '../configTicket.js';

const router = Router();

/** Nombre que se imprime en texto si el logo no se puede imprimir como imagen. */
const NOMBRE_NEGOCIO = process.env.NOMBRE_NEGOCIO || 'EL POLLITO MIXTECO';

router.post('/imprimir', async (req, res) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  if (!texto || texto.length > 8000) {
    return res.status(400).json({ error: 'Ticket vacío o demasiado largo' });
  }
  try {
    let encabezado = null;
    try {
      const c = await obtenerConfigTicket();
      if (c.mostrarLogo) {
        encabezado = encabezadoLogo(c.anchoPapel === 58 ? c.ticketLogo58 : c.ticketLogo80, NOMBRE_NEGOCIO);
      }
    } catch (err) {
      // El logo nunca debe impedir que salga el ticket.
      console.error('[ticket] No se pudo leer la configuración del logo:', err.message);
    }
    const out = await imprimirRawEnWindows(armarEscPos(texto, encabezado));
    res.json({ ok: true, detalle: out });
  } catch (err) {
    console.error('[ticket] No se pudo imprimir:', err.message);
    res.status(503).json({ error: 'No se pudo enviar el ticket a la impresora' });
  }
});

export default router;
