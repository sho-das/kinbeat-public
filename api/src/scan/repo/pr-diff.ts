// The lines a pull request adds or removes, read from its diff. Only these lines are scanned for a PR history.
// A diff is GitHub's patch text: a header per file, then hunks that start with "@@ -old +new @@".

export interface DiffLine {
  path: string;
  // Line number in the new file for added lines, in the old file for removed lines.
  line: number;
  kind: 'added' | 'removed';
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Git puts a file name in double quotes when it has spaces, tabs, or non-English letters, and writes those letters as codes such as \303\251.
// This turns such a name back into plain text. A plain name is returned as it is, without a trailing tab that git adds after a name with spaces.
function gitName(raw: string): string {
  let name = raw.replace(/\t$/, '');
  if (!name.startsWith('"') || !name.endsWith('"')) return name;
  name = name.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = name[i + 1];
    if (next === undefined) {
      bytes.push(92);
      break;
    }
    const octal = /^[0-7]{3}/.exec(name.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    const simple: Record<string, number> = { n: 10, t: 9, '"': 34, '\\': 92 };
    bytes.push(simple[next] ?? next.charCodeAt(0));
    i++;
  }
  return Buffer.from(bytes).toString('utf8');
}

export function changedLines(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let path = '';
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      inHunk = false;
      path = '';
      continue;
    }
    if (!inHunk && raw.startsWith('--- ')) {
      // A deleted file reads "+++ /dev/null", so its name is taken from the old side.
      if (!path && !raw.startsWith('--- /dev/null')) path = gitName(raw.slice('--- '.length)).replace(/^a\//, '');
      continue;
    }
    if (!inHunk && raw.startsWith('+++ ')) {
      if (!raw.startsWith('+++ /dev/null')) path = gitName(raw.slice('+++ '.length)).replace(/^b\//, '');
      continue;
    }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !path) continue;
    if (raw.startsWith('+')) {
      out.push({ path, line: newLine++, kind: 'added', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      out.push({ path, line: oldLine++, kind: 'removed', text: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
    // A line such as "\ No newline at end of file" changes no line numbers and is skipped.
  }
  return out;
}
