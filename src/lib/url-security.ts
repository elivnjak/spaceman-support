import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return numbers;
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  return false;
}

function isBlockedIp(address: string): boolean {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isBlockedIpv4(address);
  if (ipVersion === 6) return isBlockedIpv6(address);
  return false;
}

export async function validateExternalHttpUrl(urlValue: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return "Invalid URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs are allowed";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return "Invalid URL host";
  if (BLOCKED_HOSTNAMES.has(hostname)) return "Blocked host";
  if (hostname.endsWith(".local")) return "Blocked host";
  if (hostname === "169.254.169.254") return "Blocked host";
  if (isBlockedIp(hostname)) return "Blocked host";

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) {
      return "Unable to resolve host";
    }
    if (records.some((record) => isBlockedIp(record.address))) {
      return "Host resolves to a private or local IP";
    }
  } catch {
    return "Unable to resolve host";
  }

  return null;
}
