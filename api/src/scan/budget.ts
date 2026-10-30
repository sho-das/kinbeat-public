const MAX_SCAN_TOKENS = 250_000;

const estimate = (prompt: string): number => Math.ceil(prompt.length / 4) + 40;

export class ScanBudget {
  limited = false;

  constructor(private left = MAX_SCAN_TOKENS) {}

  take(prompt: string): boolean {
    const cost = estimate(prompt);
    if (cost > this.left) {
      this.limited = true;
      return false;
    }
    this.left -= cost;
    return true;
  }
}
