/**
 * Staging and applying a change to the versioned assumptions.
 *
 * Phase 6 §1 puts live data feeds behind one non-negotiable discipline:
 *
 *   **A feed writes a NEW dated assumptions version. It never edits one in
 *   place.** A plan generated in March 2027 must stay reproducible against the
 *   assumptions stamped on it. An automated pipeline that silently mutates the
 *   current version destroys the property the entire engine is built around —
 *   and it does so invisibly, because every test still passes.
 *
 * So the shape here is: a feed (or a person) STAGES a proposal, a human
 * REVIEWS it, and applying it writes a new dated file and forces `golden.ts` to
 * run so the blast radius across all nine personas is visible BEFORE it reaches
 * a client. The web application has no path to any of this. It is a deliberate
 * manual gate on the numbers that drive every recommendation.
 *
 * The network fetchers (AMFI NAV, gold spot, MoSPI CPI) are not built — they
 * need credentials and live endpoints. What is built is the part that must be
 * right regardless of where the numbers come from.
 *
 * Usage:
 *   assumptions.ts list
 *   assumptions.ts stage --source small_savings --set SMALL_SAVINGS.ppf=0.072 --note "Q3 notification"
 *   assumptions.ts review <id> --approve | --reject --note "…"
 *   assumptions.ts apply <id>
 */

import './env.ts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ASSUMPTIONS_VERSION } from '../../engine/src/assumptions/v2026-08.ts';
import { prisma } from '../src/lib/db.ts';
import { recordAudit } from '../src/lib/audit.ts';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const assumptionsDir = join(repoRoot, 'engine', 'src', 'assumptions');

const [command, ...rest] = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i > -1 ? rest[i + 1] : undefined;
};
const has = (name: string) => rest.includes(`--${name}`);

/** Next month's dated version. Assumptions versions are `YYYY-MM`. */
function nextVersion(from: string): string {
  const [y, m] = from.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

switch (command) {
  /* ---------------------------------------------------------------- */
  case 'list': {
    const rows = await prisma.assumptionsProposal.findMany({ orderBy: { stagedAt: 'desc' } });
    if (rows.length === 0) {
      console.log('No proposals staged.');
      break;
    }
    for (const r of rows) {
      console.log(
        `${r.id}\n  ${r.status.toUpperCase().padEnd(9)} ${r.sourceKey}  ${r.fromVersion} → ${r.proposedVersion}` +
          `\n  ${r.payload}` +
          (r.note ? `\n  note: ${r.note}` : '') +
          `\n  staged ${r.stagedAt.toISOString()}` +
          (r.reviewedAt ? ` · reviewed ${r.reviewedAt.toISOString()} by ${r.reviewedBy}` : '') +
          '\n',
      );
    }
    break;
  }

  /* ---------------------------------------------------------------- */
  case 'stage': {
    const source = flag('source');
    const sets = rest.filter((_, i) => rest[i - 1] === '--set');
    if (!source || sets.length === 0) {
      console.error('Need --source <key> and at least one --set PATH=value');
      process.exit(1);
    }

    const payload: Record<string, number | string> = {};
    for (const s of sets) {
      const [path, raw] = s.split('=');
      if (!path || raw === undefined) {
        console.error(`Malformed --set "${s}". Expected PATH=value.`);
        process.exit(1);
      }
      const n = Number(raw);
      payload[path] = Number.isNaN(n) ? raw : n;
    }

    const proposed = nextVersion(ASSUMPTIONS_VERSION);
    const row = await prisma.assumptionsProposal.create({
      data: {
        sourceKey: source,
        fromVersion: ASSUMPTIONS_VERSION,
        proposedVersion: proposed,
        payload: JSON.stringify(payload),
        status: 'staged',
        note: flag('note') ?? null,
      },
    });

    await recordAudit('assumptions.proposed', 'AssumptionsProposal', row.id, {
      userId: null, actorId: null,
    }, { sourceKey: source, fromVersion: ASSUMPTIONS_VERSION, proposedVersion: proposed });

    console.log(`Staged ${row.id}: ${source}, ${ASSUMPTIONS_VERSION} → ${proposed}`);
    console.log(`Review it:  assumptions.ts review ${row.id} --approve`);
    break;
  }

  /* ---------------------------------------------------------------- */
  case 'review': {
    const id = rest[0];
    const approve = has('approve');
    const reject = has('reject');
    if (!id || approve === reject) {
      console.error('Usage: review <id> --approve | --reject [--note "…"]');
      process.exit(1);
    }

    const reviewer = process.env.USER ?? 'unknown';
    const row = await prisma.assumptionsProposal.update({
      where: { id },
      data: {
        status: approve ? 'approved' : 'rejected',
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        note: flag('note') ?? undefined,
      },
    });

    await recordAudit('assumptions.reviewed', 'AssumptionsProposal', id, {
      userId: null, actorId: null,
    }, { decision: row.status, reviewedBy: reviewer });

    console.log(`${row.status}: ${row.sourceKey} ${row.fromVersion} → ${row.proposedVersion}`);
    if (approve) console.log(`Apply it:  assumptions.ts apply ${id}`);
    break;
  }

  /* ---------------------------------------------------------------- */
  case 'apply': {
    const id = rest[0];
    if (!id) {
      console.error('Usage: apply <id>');
      process.exit(1);
    }

    const row = await prisma.assumptionsProposal.findUnique({ where: { id } });
    if (!row) {
      console.error(`No proposal ${id}.`);
      process.exit(1);
    }
    if (row.status !== 'approved') {
      // The gate. An unreviewed feed must never reach a client's plan.
      console.error(
        `Proposal is "${row.status}", not "approved". A human reviews the numbers before they ` +
          `move any advice.`,
      );
      process.exit(1);
    }

    const sourceFile = join(assumptionsDir, `v${row.fromVersion}.ts`);
    const targetFile = join(assumptionsDir, `v${row.proposedVersion}.ts`);

    if (existsSync(targetFile)) {
      console.error(
        `${targetFile} already exists. Versions are never edited in place — pick a later ` +
          `version, or reconcile the two proposals by hand.`,
      );
      process.exit(1);
    }

    let contents = readFileSync(sourceFile, 'utf8');
    contents = contents
      .replace(
        `export const ASSUMPTIONS_VERSION = '${row.fromVersion}';`,
        `export const ASSUMPTIONS_VERSION = '${row.proposedVersion}';`,
      )
      .replace(
        /export const EFFECTIVE_FROM = '[^']+';/,
        `export const EFFECTIVE_FROM = '${new Date().toISOString().slice(0, 10)}';`,
      );

    // The changed figures are written as a header rather than applied
    // automatically. Patching a dotted path into a TypeScript literal by regex
    // is exactly the kind of clever that silently corrupts a tax slab, and this
    // file drives every rupee of every recommendation. A human makes the edit;
    // this script makes sure they cannot forget what it was or skip the diff.
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    const header =
      `/*\n * DERIVED FROM v${row.fromVersion} — proposal ${row.id} (${row.sourceKey}).\n` +
      ` * Staged ${row.stagedAt.toISOString().slice(0, 10)}, approved by ${row.reviewedBy}.\n` +
      (row.note ? ` * Note: ${row.note}\n` : '') +
      ` *\n * APPLY THESE BY HAND, then delete this block:\n` +
      Object.entries(payload)
        .map(([path, value]) => ` *   ${path} = ${JSON.stringify(value)}\n`)
        .join('') +
      ` *\n * Then: update the import in engine/src/engine.ts and run golden.ts.\n */\n\n`;

    writeFileSync(targetFile, header + contents);
    await prisma.assumptionsProposal.update({ where: { id }, data: { status: 'applied' } });

    console.log(`Wrote ${targetFile}`);
    console.log('\nNow, in order:');
    console.log('  1. Apply the figures listed at the top of the file, then delete that block.');
    console.log(`  2. Point engine/src/engine.ts at v${row.proposedVersion}.ts.`);
    console.log('  3. Run the golden suite and read EVERY moved figure:');
    console.log('       node --experimental-strip-types engine/tests/golden.ts');
    console.log('  4. Only accept the diff once you can explain each change.');

    // Run it now so the current blast radius is on screen before anyone forgets.
    console.log('\nGolden suite against the CURRENT version, for a baseline:\n');
    try {
      const out = execFileSync(
        'node',
        ['--experimental-strip-types', join(repoRoot, 'engine', 'tests', 'golden.ts')],
        { encoding: 'utf8' },
      );
      console.log(out.split('\n').slice(-4).join('\n'));
    } catch {
      console.error('Golden suite did not run cleanly. Fix that before applying anything.');
    }
    break;
  }

  /* ---------------------------------------------------------------- */
  default:
    console.log(
      'Usage:\n' +
        '  assumptions.ts list\n' +
        '  assumptions.ts stage --source <key> --set PATH=value [--note "…"]\n' +
        '  assumptions.ts review <id> --approve | --reject [--note "…"]\n' +
        '  assumptions.ts apply <id>\n',
    );
}

await prisma.$disconnect();
