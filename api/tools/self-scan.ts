// KinBeat scans its own changes before they are merged. It reads the files changed between two commits and runs
// KinBeat's secret rules over them; any hit fails the check, so a real key cannot slip into the public repository.
// Usage, from the api folder: npx ts-node --transpile-only tools/self-scan.ts <base> <head>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findCandidates } from '../src/scan/candidates';

// Files that hold made-up secrets on purpose: the samples visitors can try, and the rules themselves.
const ALLOWED = new Set(['api/src/scan/templates.ts', 'api/src/scan/detectors.ts', 'api/src/scan/placeholders.ts']);
const TEXT = /\.(ts|tsx|js|mjs|json|md|yml|yaml|css|sql|txt|example|sh)$/;

// Source code is full of words like "token" and "secret" next to variable names, so the loose name: value rule is left out
// here. Keys, tokens and private keys have their own shapes and are what must never land in the repository.
const LOOSE = new Set(['generic_secret']);

const root = resolve(__dirname, '..', '..');
const [base, head] = process.argv.slice(2);
// "worktree" scans uncommitted changes; two commits scan what changed between them.
const args = base === 'worktree' ? ['diff', '--name-only', '--diff-filter=AM', 'HEAD'] : ['diff', '--name-only', '--diff-filter=AM', base && head ? `${base}...${head}` : 'HEAD~1...HEAD'];
const changed = execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((name) => name && TEXT.test(name) && !ALLOWED.has(name));

let hits = 0;
for (const name of changed) {
  let text: string;
  try {
    text = readFileSync(join(root, name), 'utf8');
  } catch {
    continue;
  }
  for (const candidate of findCandidates(text).filter((c) => !LOOSE.has(c.type) && !c.weak)) {
    hits++;
    // The value itself is never printed: only where it is and what kind it looks like.
    const line = text.slice(0, candidate.spans[0]?.start ?? 0).split('\n').length;
    console.log(`${name}:${line}: looks like a ${candidate.type}`);
  }
}
console.log(`self-scan: ${changed.length} changed files, ${hits} possible secrets`);
process.exit(hits ? 1 : 0);
