import { ABILITY_KEYS, ABILITY_LABELS, type AbilityKey, type HorseAbility } from "./abilityTypes";

/** 相対等級（出走頭内）。UI全体で色と対応。 */
export type DisplayGrade = "S" | "A+" | "A" | "B" | "C";

export type AbilityGradeRow = Record<AbilityKey, string>;

const ORDER: readonly DisplayGrade[] = ["S", "A+", "A", "B", "C"];

/**
 * 同一能力値での並び順用に、（安定した）2次キーとしてIDでタイブレーク。
 * idx は 0=最強, n-1=最弱
 */
function indexToDisplayGrade(idx: number, n: number): DisplayGrade {
  if (n <= 0) return "A";
  if (n === 1) return "A";
  const t = Math.min(ORDER.length - 1, Math.floor((idx * (ORDER.length - 1)) / (n - 1) + 1e-9));
  return ORDER[t]!;
}

export function computeAbilityLetterGrades(horses: HorseAbility[]): Map<string, AbilityGradeRow> {
  const map = new Map<string, AbilityGradeRow>();
  const n = horses.length;

  for (const h of horses) {
    map.set(h.horseId, {
      speed: "C",
      stamina: "C",
      kick: "C",
      sustain: "C",
      power: "C",
    });
  }

  for (const key of ABILITY_KEYS) {
    const sorted = [...horses]
      .map((h) => h)
      .sort((a, b) => {
        const d = b[key] - a[key];
        if (d !== 0) return d;
        return a.horseId.localeCompare(b.horseId);
      });
    sorted.forEach((h, idx) => {
      const row = map.get(h.horseId)!;
      row[key] = indexToDisplayGrade(idx, n);
    });
  }

  return map;
}

export function formatStrongAbilitiesWithGrades(
  horseId: string,
  strongAbilities: AbilityKey[],
  grades: Map<string, AbilityGradeRow>,
): string {
  const row = grades.get(horseId);
  if (!row) return "";
  return strongAbilities
    .map((k) => `${ABILITY_LABELS[k]} ${row[k]}`)
    .join(" / ");
}

/** 等級文字列から色クラス用トークン（A+ も a 扱い） */
export function gradeToColorToken(grade: string): "s" | "a" | "b" | "c" {
  if (grade === "S") return "s";
  if (grade === "A+" || grade === "A") return "a";
  if (grade === "B") return "b";
  return "c";
}
