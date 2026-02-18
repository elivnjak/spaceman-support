const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }
  throw lastErr;
}
