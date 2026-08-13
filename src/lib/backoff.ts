export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function nextBackoffDelay(attempt: number, minDelayMs: number, maxDelayMs: number): number {
  const minDelay = Math.max(250, minDelayMs);
  const maxDelay = Math.max(minDelay, maxDelayMs);
  const baseDelay = minDelay * Math.pow(2, Math.max(0, attempt));
  return clamp(baseDelay, minDelay, maxDelay);
}

