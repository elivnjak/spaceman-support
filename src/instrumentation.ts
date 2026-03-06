export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logPlaywrightHealth } = await import("@/lib/startup/playwright-health");
  void logPlaywrightHealth();
}
