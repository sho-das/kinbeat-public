import { Candidate } from './types';

const SHAPES: Record<string, string> = {
  api_key: 'an API key',
  aws_key: 'a cloud access key',
  github_token: 'an access token',
  jwt: 'a login token',
  private_key: 'a private key',
  slack_token: 'a chat token',
};

const LABEL = /(password|passwd|passcode|pwd|secret|api[_ -]?key|token|recovery[_ -]?code)[A-Za-z0-9_-]{0,40}\s*(?:[:=]|is\b)\s*["']?$/i;

// A plain sentence on why the rules flagged this value, shown beside the model's own reason.
export function foundBecause(text: string, candidate: Candidate): string {
  const shape = SHAPES[candidate.type];
  if (shape) return `Found because it has the shape of ${shape}.`;
  const start = candidate.spans[0].start;
  const word = LABEL.exec(text.slice(Math.max(0, start - 70), start))?.[1];
  return word ? `Found because the word "${word.toLowerCase()}" came right before a value.` : 'Found because it looks like a password or secret.';
}
