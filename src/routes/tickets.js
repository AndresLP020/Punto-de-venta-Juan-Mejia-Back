import { Router } from 'express';
import { armarEscPos, imprimirRawEnWindows } from '../imprimirTicket.js';

const router = Router();

router.post('/imprimir', async (req, res) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  if (!texto || texto.length > 8000) {
    return res.status(400).json({ error: 'Ticket vacío o demasiado largo' });
  }
  try {
    const out = await imprimirRawEnWindows(armarEscPos(texto));
    res.json({ ok: true, detalle: out });
  } catch (err) {
    console.error('[ticket] No se pudo imprimir:', err.message);
    res.status(503).json({ error: 'No se pudo enviar el ticket a la impresora' });
  }
});

export default router;
