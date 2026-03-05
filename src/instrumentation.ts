import { logPlaywrightHealth } from "@/lib/startup/playwright-health";

export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void logPlaywrightHealth();
}
