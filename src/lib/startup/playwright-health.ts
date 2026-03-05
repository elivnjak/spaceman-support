let hasRun = false;

export async function logPlaywrightHealth(): Promise<void> {
  if (hasRun) return;
  hasRun = true;

  try {
    // Load Playwright at runtime to avoid bundling its internal assets in Turbopack.
    const runtimeRequire = eval("require") as (id: string) => {
      chromium: { launch: (options: { headless: boolean }) => Promise<{ close: () => Promise<void> }> };
    };
    const { chromium } = runtimeRequire("playwright");
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
