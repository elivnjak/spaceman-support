let hasRun = false;

export async function logPlaywrightHealth(): Promise<void> {
  if (hasRun) return;
  hasRun = true;

  try {
    // Dynamic import to avoid bundling Playwright in Edge Runtime and to stay within Edge's no-eval rules.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.log("[startup] Playwright Chromium is available.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[startup] Playwright Chromium unavailable; JS-rendered URL ingestion may fall back to non-JS extraction. ${message}`
    );
  }
}
