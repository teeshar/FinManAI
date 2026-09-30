/**
 * Stop the local dev processes.
 *
 * Ctrl+C works when you started the server in a terminal you still have. It
 * does not when it was backgrounded, or when a previous run outlived its
 * terminal — which is how this project has ended up with two servers fighting
 * over one `.next` directory more than once.
 *
 * So: find them by port and by command, kill them, and report what is actually
 * still listening rather than assuming the kill worked.
 *
 * PostgreSQL is deliberately left alone. It is a long-running service you
 * probably started with `brew services`, not part of this app's session.
 */

import { execFileSync } from 'node:child_process';

const TARGETS = [
  { name: 'next dev', match: 'next dev', ports: [3000, 3001, 3002] },
  { name: 'prisma studio', match: 'prisma studio', ports: [5555] },
  { name: 'mailpit', match: 'mailpit', ports: [8025, 1025] },
];

const quiet = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // pgrep and lsof exit non-zero when nothing matches
  }
};

const listeners = (port: number) =>
  quiet('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n').filter(Boolean);

let killed = 0;

for (const target of TARGETS) {
  const byName = quiet('pgrep', ['-f', target.match]).split('\n').filter(Boolean);
  if (byName.length === 0) {
    console.log(`  ${target.name.padEnd(14)} not running`);
    continue;
  }
  quiet('pkill', ['-f', target.match]);
  killed += byName.length;
  console.log(`  ${target.name.padEnd(14)} stopped (${byName.length} process${byName.length === 1 ? '' : 'es'})`);
}

// Give the sockets a moment to close before reporting.
await new Promise((r) => setTimeout(r, 1500));

const stillUp = TARGETS.flatMap((t) => t.ports).filter((p) => listeners(p).length > 0);

console.log('');
if (stillUp.length === 0) {
  console.log(
    killed > 0
      ? `\x1b[32mAll stopped.\x1b[0m Ports 3000, 5555, 8025 and 1025 are free.`
      : `Nothing was running.`,
  );
  console.log('PostgreSQL was left alone — stop it with: brew services stop postgresql@18');
} else {
  console.error(
    `\x1b[31mStill listening on ${stillUp.join(', ')}.\x1b[0m ` +
      `Something else owns those ports:\n` +
      stillUp.map((p) => `  lsof -nP -iTCP:${p} -sTCP:LISTEN`).join('\n'),
  );
  process.exit(1);
}
