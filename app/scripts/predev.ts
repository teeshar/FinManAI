/**
 * Refuse to start a second dev server.
 *
 * Two `next dev` processes share one `.next` directory and overwrite each
 * other's compiled output. The symptom is a route returning 500 with
 * `ENOENT … route.js`, or a page that 404s and then 500s — and it looks exactly
 * like broken application code, which is why it has cost real debugging time
 * more than once here.
 *
 * Next's own behaviour makes it worse rather than better: when port 3000 is
 * taken it quietly starts on 3001 instead, so you end up with two servers, a
 * browser pointed at whichever you opened first, and edits landing in the other
 * one.
 *
 * So: stop, and say plainly what to do. Runs automatically before `npm run dev`.
 */

import { execFileSync } from 'node:child_process';

function pidsOn(port: number): string[] {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // lsof exits non-zero when nothing is listening
  }
}

const port = Number(process.env.PORT ?? 3000);
const busy = pidsOn(port);

if (busy.length > 0) {
  console.error(
    `\n\x1b[31mPort ${port} is already in use (pid ${busy.join(', ')}).\x1b[0m\n\n` +
      `Next would quietly start on ${port + 1} instead, leaving two servers sharing one\n` +
      `.next directory and overwriting each other's build. That surfaces later as a route\n` +
      `500ing with "ENOENT … route.js", which looks nothing like its actual cause.\n\n` +
      `If the running server is the one you want, just use it: http://localhost:${port}\n` +
      `To replace it:\n` +
      `  pkill -f "next dev" && rm -rf .next && npm run dev\n`,
  );
  process.exit(1);
}
