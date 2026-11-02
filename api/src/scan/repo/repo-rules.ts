// What a public repository link may look like, which branch it means, and which files a repository scan leaves out.
// The free scan reads current files only. The full version will also read what is skipped here (dependencies, logs,
// pictures, lock files, minified files), old commits, deleted files and private repositories.

export interface RepoLink {
  owner: string;
  repo: string;
  // The text after /tree/ (a branch name, maybe followed by a folder), or null for the default branch.
  refPath: string | null;
}

const LINK = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:\/tree\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))?\/?$/;
const MAX_BRANCH_TRIES = 5;

export function parseRepoLink(text: string): RepoLink | null {
  const match = LINK.exec(text.trim());
  if (!match) return null;
  const repo = match[2].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') return null;
  const refPath = match[3] ?? null;
  if (refPath?.split('/').some((part) => part === '.' || part === '..')) return null;
  return { owner: match[1], repo, refPath };
}

// A branch name may hold slashes, so "feature/login/src" could be a branch and a folder in several ways.
// Git does not allow both "feature" and "feature/login" as branches, so the shortest name that exists is the right one.
export function branchCandidates(refPath: string): string[] {
  const parts = refPath.split('/');
  const out: string[] = [];
  for (let i = 1; i <= Math.min(parts.length, MAX_BRANCH_TRIES); i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

const SKIPPED_FOLDERS = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', 'bower_components']);
// Folders of tests, sample data and evals. The free scan leaves them out because they hold made-up secrets on purpose.
// Folders that hold only tests and test data. Names are compared in lowercase, so TestData counts too.
const TEST_FOLDERS = new Set(['test', 'tests', '__tests__', 'testing', 'testdata', 'test-data', 'test_data', 'spec', 'specs', 'e2e', 'fixtures', '__fixtures__', 'mocks', '__mocks__', 'evals']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff']);
const MEDIA_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'flac', 'ogg', 'm4a']);
// Files that package tools write, holding only versions and hashes. Tool-written files that copy in settings, such as
// terraform.tfstate, .npmrc or a docker config.json, can hold real secrets and are scanned.
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'gemfile.lock', 'composer.lock', 'poetry.lock', 'go.sum', 'go.work.sum',
  'pipfile.lock', 'uv.lock', 'mix.lock', 'pubspec.lock', 'podfile.lock', 'flake.lock', 'packages.lock.json', 'gradle.lockfile', '.terraform.lock.hcl',
]);

// a.test.ts, a.spec.js, a_test.go, a_test.py, test_a.py
const isTestFile = (name: string) => /\.(test|spec)\.[a-z0-9]+$/.test(name) || /_test\.(go|py)$/.test(name) || /^test_.+\.py$/.test(name);

// Pictures are read like an uploaded picture, up to a limit per scan, so they are counted by the caller and not skipped here.
export const isPicture = (path: string) => IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase());

// The reason a file is not scanned, or null when it is. The path is the path inside the repository.
export function skipReason(path: string): string | null {
  const parts = path.split('/');
  const name = (parts.pop() ?? '').toLowerCase();
  if (parts.some((part) => SKIPPED_FOLDERS.has(part))) return 'dependencies and build output';
  if (parts.some((part) => TEST_FOLDERS.has(part.toLowerCase())) || isTestFile(name)) return 'test files';
  if (name.endsWith('.log')) return 'log files';
  if (MEDIA_EXTENSIONS.has(name.slice(name.lastIndexOf('.') + 1))) return 'audio and video';
  if (LOCK_FILES.has(name)) return 'lock files';
  // Word lists of an AI tokenizer: thousands of base64 word pieces, never settings.
  if (name.endsWith('.tiktoken')) return 'tokenizer word lists';
  if (name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.map')) return 'minified files and source maps';
  return null;
}

// GitHub puts every file in one top folder named like "repo-1a2b3c4". The path inside the repository starts below it.
export function insideRepo(zipPath: string): string | null {
  const slash = zipPath.indexOf('/');
  if (slash < 0 || slash === zipPath.length - 1) return null;
  return zipPath.slice(slash + 1);
}
