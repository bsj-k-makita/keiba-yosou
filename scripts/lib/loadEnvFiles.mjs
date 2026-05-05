import { existsSync, readFileSync } from "fs";
import { join } from "path";

function stripQuotes(value) {
  const v = String(value ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseEnvText(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rawValue = m[2] ?? "";
    out[key] = stripQuotes(rawValue);
  }
  return out;
}

export function loadLocalEnv(rootDir) {
  const files = [".env", ".env.local"];
  for (const file of files) {
    const path = join(rootDir, file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvText(readFileSync(path, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] == null || process.env[k] === "") {
        process.env[k] = v;
      }
    }
  }
}
