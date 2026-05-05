import type { AbilityKey, HorseAbility, HorseScoreResult, RaceCondition } from "./abilityTypes";
import { ABILITY_KEYS, ABILITY_LABELS } from "./abilityTypes";
import { BIAS_ADJUSTMENTS, GROUND_ADJUSTMENTS } from "./adjustments";
import { collectDismissIds } from "./dismissalRules";
import { extractStrongAbilities } from "./strongAbilities";
import { getBaseWeights, getFinalWeights } from "./weightResolver";

export type RaceTypeProfile = {
  id: string;
  label: string;
  primaryAbilities: AbilityKey[];
  secondaryAbilities: AbilityKey[];
  buyWithHints: string[];
  avoidHints: string[];
};

function isHeavyGround(ground: string): boolean {
  return ground === "heavy" || ground === "bad" || ground === "yielding";
}

/** 条件から「今回の展開グループ」ラベルと能力の軸を推定 */
export function resolveRaceTypeProfile(condition: RaceCondition): RaceTypeProfile {
  const biasLabel = BIAS_ADJUSTMENTS[condition.bias]?.label ?? "フラット";
  const groundLabel = GROUND_ADJUSTMENTS[condition.ground]?.label ?? "良";

  if (isHeavyGround(condition.ground)) {
    return {
      id: "heavy",
      label: `重馬場型（${groundLabel}）`,
      primaryAbilities: ["power", "stamina"],
      secondaryAbilities: ["sustain"],
      buyWithHints: ["パワーとスタミナがある", "不良・重でも消耗に耐える", "脚元が健全そう"],
      avoidHints: ["スピードだけの軽めの脚", "末脚一発だけに寄せている"],
    };
  }

  if (condition.bias === "front_favor") {
    return {
      id: "front",
      label: `前残り型（${biasLabel}）`,
      primaryAbilities: ["speed", "sustain"],
      secondaryAbilities: ["power"],
      buyWithHints: ["先行できる", "持続力がある", "パワーも最低限ある"],
      avoidHints: ["後方待機が基本", "末脚だけに寄った馬"],
    };
  }

  if (condition.bias === "closer_favor") {
    return {
      id: "closer",
      label: `差し有利型（${biasLabel}）`,
      primaryAbilities: ["kick", "sustain"],
      secondaryAbilities: ["stamina"],
      buyWithHints: ["末脚が信頼できる", "長く脚を使える", "位置取りの柔軟性"],
      avoidHints: ["前に行くと燃える", "スピードが伸びない"],
    };
  }

  return {
    id: "neutral",
    label: `バランス型（${biasLabel}・${groundLabel}）`,
    primaryAbilities: ["kick", "sustain"],
    secondaryAbilities: ["speed"],
    buyWithHints: ["バランス型で欠けが少ない", "コース適性が明確"],
    avoidHints: ["極端な癖に依存している"],
  };
}

export type PeerDismissEntry = {
  horseId: string;
  horseName: string;
  gate?: number;
};

export type SameTypePeerResult = {
  profile: RaceTypeProfile;
  topMarkHorseId?: string;
  /** 補正後1位（本命）の馬ID */
  anchorHorseId?: string;
  /** ◎馬と同じ恩恵を受けやすい相手候補（本命自身は除く） */
  peerHorseIds: string[];
  /** 表示用：一緒に買いたい馬 */
  peerEntries: PeerDismissEntry[];
  /** 表示用：消し候補（下位） */
  dismissEntries: PeerDismissEntry[];
};

function abilityEmphasisWeights(
  condition: RaceCondition,
): Record<AbilityKey, number> {
  const base = getBaseWeights(condition);
  const fin = getFinalWeights(condition);
  const raw = ABILITY_KEYS.map((k) => Math.abs(fin[k] - base[k]));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum < 1e-9) {
    const u = 1 / ABILITY_KEYS.length;
    return {
      speed: u,
      stamina: u,
      kick: u,
      sustain: u,
      power: u,
    };
  }
  return {
    speed: raw[0]! / sum,
    stamina: raw[1]! / sum,
    kick: raw[2]! / sum,
    sustain: raw[3]! / sum,
    power: raw[4]! / sum,
  };
}

/** 補正で重みが動いた能力ほど距離計算に効かせる */
export function profileDistanceWeighted(
  a: HorseAbility,
  b: HorseAbility,
  emphasis: Record<AbilityKey, number>,
): number {
  let d = 0;
  for (const k of ABILITY_KEYS) {
    const w = 0.2 + emphasis[k] * 0.8;
    d += w * Math.abs(a[k] - b[k]);
  }
  return d;
}

function entryFromHorse(
  horse: HorseAbility,
): PeerDismissEntry {
  const gate = "gate" in horse ? (horse as HorseAbility & { gate?: number }).gate : undefined;
  return {
    horseId: horse.horseId,
    horseName: horse.horseName,
    gate,
  };
}

/**
 * 補正後1位を基準に、近い能力プロファイルの馬を抽出（同タイプで買える相手候補）。
 */
export function findSameTypePeers(
  horses: HorseAbility[],
  results: HorseScoreResult[],
  condition: RaceCondition,
): SameTypePeerResult {
  const profile = resolveRaceTypeProfile(condition);
  const emphasis = abilityEmphasisWeights(condition);

  const byAdj = [...results].sort(
    (a, b) => (a.finalRank ?? a.adjustedRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99),
  );
  const leader = byAdj[0];
  const anchor = leader ? horses.find((h) => h.horseId === leader.horseId) : undefined;

  const topMark = results.find((r) => r.mark === "◎");

  if (!anchor) {
    return {
      profile,
      topMarkHorseId: topMark?.horseId,
      anchorHorseId: undefined,
      peerHorseIds: [],
      peerEntries: [],
      dismissEntries: [],
    };
  }

  const scored = horses
    .filter((h) => h.horseId !== anchor.horseId)
    .map((h) => ({
      horse: h,
      dist: profileDistanceWeighted(anchor, h, emphasis),
    }))
    .sort((a, b) => a.dist - b.dist);

  const peerHorseIds = scored.slice(0, 2).map((row) => row.horse.horseId);
  const peerEntries = scored.slice(0, 2).map((row) => entryFromHorse(row.horse));

  const dismissIds = collectDismissIds(horses, results, condition);
  const dismissEntries = results
    .filter((r) => dismissIds.has(r.horseId))
    .slice(0, 6)
    .map((r) => {
      const h = horses.find((x) => x.horseId === r.horseId)!;
      return entryFromHorse(h);
    });

  return {
    profile,
    topMarkHorseId: topMark?.horseId,
    anchorHorseId: anchor.horseId,
    peerHorseIds,
    peerEntries,
    dismissEntries,
  };
}

export function formatAbilityList(keys: AbilityKey[]): string {
  return keys.map((k) => ABILITY_LABELS[k]).join("・");
}

/** 馬の能力分布と今回のプロファイルから表示用タイプ文言 */
export function inferHorseAbilityTypeLabel(
  horse: HorseAbility,
  condition: RaceCondition,
): string {
  const profile = resolveRaceTypeProfile(condition);
  const strong = extractStrongAbilities(horse);
  const overlap = profile.primaryAbilities.filter((k) => strong.includes(k));
  if (overlap.length >= 2) {
    return `${profile.label}に合う脚質`;
  }
  if (overlap.length === 1) {
    return `${ABILITY_LABELS[overlap[0]!]}が軸の脚質`;
  }
  return "バランス型（突出が薄い）";
}
