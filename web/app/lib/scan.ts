export interface Template {
  id: string;
  title: string;
  kind: string;
  description: string;
  text: string;
}

interface Place {
  unit?: string;
  index?: number;
  endIndex?: number;
  file?: string;
  page?: number;
  line?: number;
}

interface Judge {
  status: string;
  mode?: string;
  width?: number;
  widened?: boolean;
  facts?: string;
  verdict?: string;
  reason?: string;
  model?: string;
  slice?: string;
}

export interface Finding {
  id: string;
  type: string;
  encoding: string;
  found?: string;
  // more: the other lines of a value split over several lines, such as two chat messages.
  line?: { before: string; mark: string; after: string; more?: Array<{ before: string; mark: string; after: string }> };
  source?: string;
  place: Place;
  preview: string;
  hash: string | null;
  confidence: { level: string; score: number };
  judge: Judge;
}

interface FileNote {
  file: string;
  type: string;
  pages?: number;
  imagePages?: number;
  notRead?: boolean;
  notReadPages?: number[];
  notSupportedPages?: number[];
  note?: string;
}

export interface ScanResult {
  scanId?: string;
  mode: string;
  model: string;
  confidenceNote?: string;
  files?: FileNote[];
  repo?: { owner: string; repo: string; sha: string; files: number; skipped: Record<string, number>; note: string };
  // A Slack scan: the chat, how many messages were read, and where the next scan carries on, if there are more.
  slack?: { messages: number; read: number; next?: string };
  summary: { findings: number; blocked: number; errors: number; unread?: number; unverified?: number; timeouts?: number; limited?: number };
  findings: Finding[];
}

type VerdictKind = "real" | "possible" | "example" | "off" | "unavailable" | "timeout" | "limit";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ENCODINGS: Record<string, string> = {
  plain: "Plain text, nothing hidden",
  base64: "Scrambled text (base64)",
  hex: "Hex code",
  url: "URL codes",
  spelled: "Spelled-out letters or words",
  stitched: "Split over messages",
  reversed: "Written backwards",
};

const TYPES: Record<string, string> = {
  api_key: "API key",
  aws_key: "Cloud access key",
  generic_secret: "Password or secret",
  github_token: "Access token",
  jwt: "Login token",
  private_key: "Private key",
  slack_token: "Chat token",
};

export function typeLabel(finding: Finding): string {
  return TYPES[finding.type] ?? finding.type;
}

export function encodingLabel(finding: Finding): string {
  return ENCODINGS[finding.encoding] ?? finding.encoding;
}

// The address of the line on GitHub, at the commit that was scanned, so the line numbers match. GitHub highlights the line on landing.
// Only for a line in a repository file. A page of a PDF or a picture has no line to open.
export function githubLineUrl(repo: { owner: string; repo: string; sha: string } | undefined, place: Place): string | null {
  // A file name the safety check hid is not a real path, so there is nothing to open.
  if (!repo || !place.file || place.file === "[file name hidden]" || place.line === undefined || place.page !== undefined) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(repo.owner) || !/^[A-Za-z0-9_.-]+$/.test(repo.repo) || !/^[0-9a-f]{40}$/.test(repo.sha)) return null;
  const path = place.file.split("/").map(encodeURIComponent).join("/");
  // plain=1 shows the file as text, so GitHub can mark the line even in files it would otherwise show formatted, such as Markdown.
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.sha}/${path}?plain=1#L${place.line}`;
}

export function placeLabel(place: Place): string {
  if (place.file !== undefined) {
    const page = place.page !== undefined ? `, page ${place.page}` : "";
    const line = place.line !== undefined ? `, line ${place.line}` : "";
    return `${place.file}${page}${line}`;
  }
  const noun = place.unit === "message" ? "message" : "line";
  if (place.endIndex !== undefined && place.endIndex !== place.index) return `${noun}s ${place.index} to ${place.endIndex}`;
  return `${noun} ${place.index}`;
}

// Both AI calls said example or not a secret, so the finding is not shown. The scan record still keeps it.
export function hiddenFromPage(finding: Finding): boolean {
  return finding.judge.status === "ok" && (finding.judge.verdict === "example" || finding.judge.verdict === "not_secret");
}

// The AI call for this finding failed, timed out or hit a limit, so it goes under Not scanned instead of the list.
export function notChecked(finding: Finding): boolean {
  return finding.judge.status === "timeout" || finding.judge.status === "error" || finding.judge.status === "limit";
}

export function verdictKind(finding: Finding): VerdictKind {
  const status = finding.judge.status;
  if (status === "skipped") return "off";
  if (status === "unverified") return "possible";
  if (status === "timeout") return "timeout";
  if (status === "limit") return "limit";
  // A finding the safety check hid is shown as real: it could not be judged, and the advice is to treat it as a real secret.
  if (status === "blocked") return "real";
  if (status !== "ok") return "unavailable";
  // A rule that found only a word like "token", with no key shape, is not enough to call a finding real.
  if (finding.judge.verdict === "real") return finding.confidence.level === "low" ? "possible" : "real";
  if (finding.judge.verdict === "example") return "example";
  return "possible";
}

export function fileProblem(file: File | null): string {
  if (!file) return "";
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
  return "";
}

// Only a public repository link of the form https://github.com/owner/repository. The server checks it again.
const REPO_LINK = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/tree\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)?\/?$/;

export function repoProblem(link: string): string {
  const text = link.trim();
  if (!text) return "";
  if (!REPO_LINK.test(text) || /\/\.\.?(\/|$)/.test(text.slice(19))) return "Use a link like https://github.com/owner/repository.";
  return "";
}
