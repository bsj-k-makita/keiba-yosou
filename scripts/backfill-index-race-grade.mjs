#!/usr/bin/env node
/**
 * 各 `src/data/races/{raceId}.json` の meta にある raceGrade / netkeibaGradeType を
 * `src/data/index.json` の対応行へ反映する（再インポートせず index のみ更新したいとき）。
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INDEX_PATH = join(ROOT, "src/data/index.json");
const RACES_DIR = join(ROOT, "src/data/races");

function gradeLabelFromType(n) {
  const map = { 1: "G1", 2: "G2", 3: "G3", 15: "L", 16: "S" };
  return map[n];
}

function main() {
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  let patched = 0;
  const next = index.map((row) => {
    const fp = join(RACES_DIR, `${row.raceId}.json`);
    if (!existsSync(fp)) return row;
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    const m = doc.meta;
    if (m == null) return row;
    let changed = false;
    const out = { ...row };
    if (m.netkeibaGradeType != null && row.netkeibaGradeType !== m.netkeibaGradeType) {
      out.netkeibaGradeType = m.netkeibaGradeType;
      changed = true;
    }
    const rg =
      m.raceGrade != null ? m.raceGrade : gradeLabelFromType(m.netkeibaGradeType);
    if (rg != null && row.raceGrade !== rg) {
      out.raceGrade = rg;
      changed = true;
    }
    if (changed) patched += 1;
    return out;
  });
  writeFileSync(INDEX_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  process.stdout.write(`done. patched ${patched} index rows from race JSON meta.\n`);
}

main();
