import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'raw-print.ps1');

/**
 * La OKI POS407II sale de fábrica en modo Star (DIP 1-1 ON), no ESC/POS.
 * En Star, ESC d n corta el papel: n=1 corte parcial (recomendado en horizontal).
 */
export function armarEscPos(texto) {
  const body = Buffer.from(String(texto ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'latin1');
  const feed = Buffer.from('\n\n\n\n', 'ascii');
  const cutStar = Buffer.from([0x1b, 0x64, 0x01]);
  return Buffer.concat([body, feed, cutStar]);
}

export async function imprimirRawEnWindows(buffer, printerName = process.env.PRINTER_NAME || 'POS-80') {
  if (process.platform !== 'win32') {
    throw new Error('La impresora solo está disponible en el equipo local (Windows).');
  }
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', printerName, '-Base64', buffer.toString('base64')],
    { windowsHide: true, timeout: 20000 }
  );
  if (stderr && /throw|error|fallo/i.test(stderr)) {
    throw new Error(stderr.trim());
  }
  return (stdout || '').trim();
}
