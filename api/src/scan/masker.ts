export const MIN_REVEAL_LENGTH = 12;
const MAX_STARS = 16;

export function mask(value: string): string {
  if (value.length < MIN_REVEAL_LENGTH) return '*'.repeat(value.length);
  const stars = Math.min(value.length - 4, MAX_STARS);
  return value.slice(0, 2) + '*'.repeat(stars) + value.slice(-2);
}
