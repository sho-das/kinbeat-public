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
  confidence?: number;
  reason?: string;
  model?: string;
  slice?: string;
  error?: string;
}

export interface Finding {
  id: string;
  type: string;
  encoding: string;
  found?: string;
  line?: { before: string; mark: string; after: string };
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
  summary: { findings: number; blocked: number; errors: number; unread?: number; unverified?: number; timeouts?: number; limited?: number };
  findings: Finding[];
}

export type VerdictKind = "real" | "possible" | "example" | "off" | "unavailable" | "timeout" | "limit" | "blocked";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ENCODINGS: Record<string, string> = {
  plain: "Plain text, nothing hidden",
  base64: "Scrambled text (base64)",
  hex: "Hex code",
  url: "URL codes",
  spelled: "Spelled-out letters or words",
  stitched: "Split over messages",
  reversed: "Written backwards",
};

const SOURCES: Record<string, string> = {
  text: "Text",
  "pdf-text": "PDF text",
  "pdf-read": "PDF page read as a picture",
  "image-read": "Image read as a picture",
  docx: "Word document",
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

export function sourceLabel(finding: Finding): string | null {
  return finding.source ? SOURCES[finding.source] ?? finding.source : null;
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

export function verdictKind(finding: Finding): VerdictKind {
  const status = finding.judge.status;
  if (status === "skipped") return "off";
  if (status === "unverified") return "possible";
  if (status === "timeout") return "timeout";
  if (status === "limit") return "limit";
  if (status === "blocked") return "blocked";
  if (status !== "ok") return "unavailable";
  // A rule that found only a word like "token", with no key shape, is not enough to call a finding real.
  if (finding.judge.verdict === "real") return finding.confidence.level === "low" ? "possible" : "real";
  if (finding.judge.verdict === "example") return "example";
  return "possible";
}

export function confidenceLevel(finding: Finding): number {
  return finding.confidence.level === "high" ? 3 : finding.confidence.level === "medium" ? 2 : 1;
}

export function confidenceText(finding: Finding): string {
  const level = finding.confidence.level.charAt(0).toUpperCase() + finding.confidence.level.slice(1);
  return `${level} (${Math.round(finding.confidence.score * 100)} of 100)`;
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
