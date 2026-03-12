import { readFile, writeFile } from "fs/promises";
import path from "path";

function escapeEnvValue(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export async function upsertEnvValue(key: string, value: string): Promise<void> {
  const envPath = path.join(process.cwd(), ".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") throw err;
  }

  const lines = content === "" ? [] : content.split(/\r?\n/);
  const entry = `${key}=${escapeEnvValue(value)}`;
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return entry;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push(entry);
    } else if (nextLines.length === 0) {
      nextLines.push(entry);
    } else {
      nextLines.splice(nextLines.length - 1, 0, entry);
    }
  }

  await writeFile(envPath, `${nextLines.join("\n").replace(/\n*$/, "\n")}`, "utf8");
  process.env[key] = value;
}
