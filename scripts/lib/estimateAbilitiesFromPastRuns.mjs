/**
 * 五能力（speed/stamina/kick/sustain/power）を過去走から推定する。
 * フロントの `performanceAbility.ts`（deriveAxesFromRuns / blend / layer1 / L2キレ）と
 * 同じ定数・同じ流れを保つ。変更時は TS 側と同期すること。
 */
const CLASS_SCORE = {
  G1: 1.0,
  G2: 0.88,
  G3: 0.78,
  OP: 0.66,
  "3勝": 0.56,
  "2勝": 0.48,
  "1勝": 0.4,
  新馬: 0.34,
  未勝利: 0.28,
  その他: 0.46,
};

const LAYER1_CLASS_WEIGHT = {
  G1: 1.12,
  G2: 1.09,
  G3: 1.06,
  OP: 1.02,
  "3勝": 0.98,
  "2勝": 0.95,
  "1勝": 0.92,
  新馬: 0.9,
  未勝利: 0.87,
  その他: 0.95,
};

const LAYER1_CLASS_BASE = {
  G1: 5,
  G2: 4,
  G3: 3,
  OP: 2,
  "3勝": 1,
  "2勝": 0,
  "1勝": -0.5,
  新馬: -1.5,
  未勝利: -3,
  その他: 0,
};

const LAP_STRUCTURE = {
  SPRINT: "瞬発戦",
  SUSTAIN: "持続戦",
  GRIND: "消耗戦",
  CRUISE: "高速巡航戦",
  NEUTRAL: "中間",
};

const VENUE_PHYSICAL_FACTORS = {
  東京: { straight: 525.9, uphill: 2.1, cornerRadius: "wide" },
  中山: { straight: 310.0, uphill: 2.2, cornerRadius: "tight" },
  京都外: { straight: 403.7, uphill: 0.0, cornerRadius: "wide" },
  京都内: { straight: 328.0, uphill: 0.0, cornerRadius: "medium" },
  阪神外: { straight: 473.6, uphill: 1.9, cornerRadius: "wide" },
  中京: { straight: 412.5, uphill: 2.0, cornerRadius: "medium" },
  福島: { straight: 292.0, uphill: 1.2, cornerRadius: "tight" },
  新潟外: { straight: 658.7, uphill: 0.0, cornerRadius: "wide" },
  小倉: { straight: 291.0, uphill: 0.0, cornerRadius: "tight" },
  札幌: { straight: 266.0, uphill: 0.0, cornerRadius: "wide" },
  函館: { straight: 262.0, uphill: 0.0, cornerRadius: "tight" },
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function runDistanceMeters(run) {
  if (run.section200mSec != null && run.section200mSec.length >= 4) {
    return run.section200mSec.length * 200;
  }
  return run.raceDistance ?? 1800;
}

function perf01(run) {
  if (run.marginToWinnerSec != null && Number.isFinite(run.marginToWinnerSec)) {
    return clamp((100 - run.marginToWinnerSec * 30) / 100, 0, 1);
  }
  if (run.place != null && run.place >= 1) {
    return clamp((100 - (run.place - 1) * 7) / 100, 0, 1);
  }
  return 0.45;
}

function class01(run) {
  return CLASS_SCORE[run.raceClass ?? "その他"] ?? CLASS_SCORE["その他"] ?? 0.46;
}

function longness01(distance) {
  if (distance <= 1400) return 0.18;
  if (distance <= 1800) return 0.35;
  if (distance <= 2200) return 0.5;
  if (distance <= 2800) return 0.7;
  return 0.84;
}

function inferCornerRankApprox(run) {
  const cp = run.corner_positions;
  if (cp && cp.length > 0) {
    const last = cp[cp.length - 1];
    if (last != null && Number.isFinite(last)) return last;
  }
  const po = run.passingOrder ?? run.cornerPassing;
  if (po && /\d/.test(String(po))) {
    const parts = String(po).split(/[-\s]+/).filter(Boolean);
    const lastTok = parts[parts.length - 1];
    if (lastTok) {
      const n = Number.parseInt(lastTok, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function l2SlowdownVsMinSection(run) {
  const sec = run.section200mSec;
  if (!sec || sec.length < 4) return null;
  const l2 = sec[sec.length - 2];
  if (l2 == null || !Number.isFinite(l2)) return null;
  const nums = sec.filter((x) => x != null && Number.isFinite(x));
  if (nums.length === 0) return null;
  const best = Math.min(...nums);
  return l2 - best;
}

function expansionTripMismatchForgive(run) {
  const cr = inferCornerRankApprox(run);
  const f3 = run.final3fRank;
  const slow = l2SlowdownVsMinSection(run);
  if (cr != null && cr <= 3 && f3 != null && f3 >= 10 && slow != null && slow > 1.0) {
    return true;
  }
  return false;
}

function last4(s) {
  const n = s.length;
  return {
    l1: s[n - 1],
    l2: s[n - 2],
    l3: s[n - 3],
    l4: s[n - 4],
    l5: n >= 5 ? s[n - 5] : null,
  };
}

function mean(a) {
  return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
}

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

function classifyLapStructure(section200mSec) {
  const s = section200mSec;
  if (s.length < 4) {
    return LAP_STRUCTURE.NEUTRAL;
  }
  const { l1, l2, l3, l4, l5 } = last4(s);
  const n = s.length;
  if (l3 - l2 >= 0.45 && l2 <= 11.5) {
    return LAP_STRUCTURE.SPRINT;
  }
  if (n >= 6) {
    const f3 = s[0] + s[1] + s[2];
    const b3 = s[n - 3] + s[n - 2] + s[n - 1];
    if (f3 + 1.0 <= b3 && l1 > l2 + 0.12) {
      return LAP_STRUCTURE.GRIND;
    }
  }
  if (n >= 5 && l5 != null) {
    const last4m = stdev([l1, l2, l3, l4]);
    if (last4m < 0.32 && l1 < l2 - 0.02 && l2 < l3 - 0.02) {
      return LAP_STRUCTURE.SUSTAIN;
    }
  }
  const mAll = mean([...s]);
  const head3 = s.length >= 3 ? mean(s.slice(0, 3)) : mAll;
  if (mAll < 11.85 && head3 < 12.0 && mAll < 12.0) {
    return LAP_STRUCTURE.CRUISE;
  }
  return LAP_STRUCTURE.NEUTRAL;
}

function resolveRunLapKind(run) {
  if (run.lapStructure != null && run.lapStructure !== LAP_STRUCTURE.NEUTRAL) {
    return run.lapStructure;
  }
  if (run.section200mSec != null && run.section200mSec.length >= 4) {
    return classifyLapStructure(run.section200mSec);
  }
  return null;
}

function paceCollapseForgive(run, runningStyle) {
  const lk = resolveRunLapKind(run);
  if (lk !== LAP_STRUCTURE.GRIND && lk !== LAP_STRUCTURE.SUSTAIN) return false;
  const front = runningStyle === "逃げ" || runningStyle === "先行";
  if (!front) return false;
  return perf01(run) < 0.42 && (run.marginToWinnerSec ?? 0) >= 1.2;
}

function resolvePastRunVenueFactorKey(venue) {
  if (!venue) return null;
  const v = String(venue).trim();
  if (v.includes("東京")) return "東京";
  if (v.includes("中山")) return "中山";
  if (v.includes("京都")) return v.includes("内") ? "京都内" : "京都外";
  if (v.includes("阪神")) return "阪神外";
  if (v.includes("中京")) return "中京";
  if (v.includes("福島")) return "福島";
  if (v.includes("新潟")) return "新潟外";
  if (v.includes("小倉")) return "小倉";
  if (v.includes("函館")) return "函館";
  if (v.includes("札幌")) return "札幌";
  return null;
}

function resolveVenuePhysicalFactorKey(condition) {
  if (!condition) return null;
  const venue = condition.courseKey ?? condition.venue;
  const blob = `${condition.courseKey ?? ""} ${condition.venue ?? ""} ${condition.raceName ?? ""}`;
  if (/京都内/.test(blob) || condition.courseKey === "京都内") {
    return "京都内";
  }
  if (/京都/.test(blob) || (venue && String(venue).includes("京都"))) {
    return "京都外";
  }
  if (venue === "阪神外" || /阪神外/.test(blob) || (venue && String(venue).includes("阪神"))) {
    return "阪神外";
  }
  if (venue && String(venue).includes("新潟")) {
    return "新潟外";
  }
  if (venue === "札幌函館") {
    if (/函館/.test(blob)) return "函館";
    return "札幌";
  }
  if (venue && String(venue).includes("函館")) return "函館";
  if (venue && String(venue).includes("札幌")) return "札幌";
  if (venue && venue in VENUE_PHYSICAL_FACTORS) return venue;
  return null;
}

function physicsVectorFromVenueKey(key, surface) {
  const f = key ? VENUE_PHYSICAL_FACTORS[key] : null;
  if (!f) return [0.5, 0.5, 0.5, 0.5];
  const rad = f.cornerRadius === "tight" ? 0 : f.cornerRadius === "wide" ? 1 : 0.55;
  const dirt = surface === "ダート" ? 1 : 0;
  return [clamp(f.straight / 700, 0, 1), clamp(f.uphill / 3, 0, 1), rad, dirt];
}

function physicsVectorFromCondition(condition) {
  const key = resolveVenuePhysicalFactorKey(condition);
  const surf = condition.surface ?? "芝";
  return physicsVectorFromVenueKey(key, surf === "ダート" ? "ダート" : "芝");
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d < 1e-9 ? 0 : dot / d;
}

function courseMismatchForgiveRun(run, condition) {
  const rk = resolvePastRunVenueFactorKey(run.venue);
  const ck = resolveVenuePhysicalFactorKey(condition);
  if (!rk || !ck) return false;
  const rf = VENUE_PHYSICAL_FACTORS[rk];
  const cf = VENUE_PHYSICAL_FACTORS[ck];
  if (!rf || !cf) return false;
  if (perf01(run) >= 0.42) return false;
  const runWide = rf.cornerRadius === "wide";
  const condTight = cf.cornerRadius === "tight";
  const runTight = rf.cornerRadius === "tight";
  const condWide = cf.cornerRadius === "wide";
  return (runWide && condTight) || (runTight && condWide);
}

function scoreRunQuality(run, idx, condition, runningStyle) {
  const recency = Math.max(0.55, 1 - idx * 0.1);
  const perf = perf01(run);
  const cls = class01(run);
  const badBeat =
    run.marginToWinnerSec != null &&
    run.marginToWinnerSec >= 2.2 &&
    run.place != null &&
    run.place >= 10;
  const trouble = run.tripTrouble01 ?? 0;
  const benefit = run.tripBenefit01 ?? 0;

  const forgiveTrip =
    expansionTripMismatchForgive(run) ||
    (condition != null && courseMismatchForgiveRun(run, condition)) ||
    paceCollapseForgive(run, runningStyle);

  let unreliable = badBeat && trouble < 0.38 && benefit < 0.42 && !forgiveTrip;
  let forgiven = forgiveTrip;

  if (forgiveTrip) {
    unreliable = false;
  }

  let quality = perf * 0.72 + cls * 0.28;
  if (unreliable) quality -= 0.28;
  if (forgiven) quality = Math.max(quality, 0.52);

  return {
    run,
    idx,
    recency,
    quality: Math.max(0.06, quality),
    unreliable,
    forgiven,
  };
}

function pickRunsForDerivedAxes(target, condition, runningStyle) {
  const scored = target.map((run, idx) => scoreRunQuality(run, idx, condition, runningStyle));
  scored.sort((a, b) => b.quality - a.quality);
  const reliable = scored.filter((s) => !s.unreliable);
  if (reliable.length >= 2) return reliable.slice(0, 2);
  if (reliable.length === 1) return [reliable[0]];
  return scored.slice(0, Math.min(2, scored.length));
}

function deriveKickScoreFromL2Runs(runs) {
  if (!runs?.length) return null;
  let minL2 = Infinity;
  let bestRun = null;
  for (const run of runs.slice(0, 5)) {
    const sec = run.section200mSec;
    if (sec == null || sec.length < 4) continue;
    const l2 = sec[sec.length - 2];
    if (l2 == null || !Number.isFinite(l2)) continue;
    if (l2 < minL2) {
      minL2 = l2;
      bestRun = run;
    }
  }
  if (bestRun == null || !Number.isFinite(minL2)) return null;
  const l2Perf01 = clamp((13.5 - minL2) / 2.7, 0, 1);
  const cls = class01(bestRun);
  return clamp(34 + l2Perf01 * 56 * (0.5 + cls * 0.5), 26, 94);
}

function deriveAxesFromRuns(runs, runningStyle, condition) {
  if (!runs || runs.length === 0) return null;
  const target = runs.slice(0, 6);
  if (target.length === 0) return null;

  const picks = pickRunsForDerivedAxes(target, condition, runningStyle);
  if (picks.length === 0) return null;

  let wSum = 0;
  let speed = 0;
  let stamina = 0;
  let kickAcc = 0;
  let sustain = 0;
  let power = 0;

  for (const s of picks) {
    const { run, recency } = s;
    const perf = perf01(run);
    const cls = class01(run);
    const dist = runDistanceMeters(run);
    const lng = longness01(dist);
    const runScore = clamp(perf * 0.7 + cls * 0.3, 0, 1);
    const top3Boost = run.place != null && run.place <= 3 ? 0.06 : 0;
    const winBoost = run.place === 1 ? 0.08 : 0;

    speed += recency * runScore * (1.1 - lng * 0.7);
    stamina += recency * runScore * (0.45 + lng * 0.95);
    kickAcc += recency * runScore * (0.55 + top3Boost + winBoost * 0.4);
    sustain += recency * runScore * (0.45 + lng * 0.75);
    power += recency * runScore * (0.55 + lng * 0.65);
    wSum += recency;
  }

  if (wSum <= 0) return null;
  const scale = 100 / wSum;
  const kickFromL2 = deriveKickScoreFromL2Runs(target);
  const kick = kickFromL2 ?? clamp(kickAcc * scale, 20, 92);

  return {
    speed: clamp(speed * scale, 20, 92),
    stamina: clamp(stamina * scale, 20, 95),
    kick,
    sustain: clamp(sustain * scale, 20, 95),
    power: clamp(power * scale, 20, 95),
    confidence: clamp(target.length / 5, 0.25, 1),
  };
}

function dominantPastTierKey(runs) {
  if (!runs?.length) return "その他";
  let best = runs[0];
  let bestC = class01(runs[0]);
  for (const r of runs.slice(0, 8)) {
    const c = class01(r);
    if (c > bestC) {
      bestC = c;
      best = r;
    }
  }
  const k = best.raceClass ?? "その他";
  return k in LAYER1_CLASS_WEIGHT ? k : "その他";
}

function applyLayer1ClassCorrection(horse) {
  const tier = dominantPastTierKey(horse.pastRuns);
  const W = LAYER1_CLASS_WEIGHT[tier] ?? LAYER1_CLASS_WEIGHT["その他"] ?? 1;
  const B = LAYER1_CLASS_BASE[tier] ?? LAYER1_CLASS_BASE["その他"] ?? 0;
  const adjAxis = (v) => clamp(v * W + B, 12, 99);
  return {
    ...horse,
    speed: round1(adjAxis(horse.speed)),
    stamina: round1(adjAxis(horse.stamina)),
    kick: round1(adjAxis(horse.kick)),
    sustain: round1(adjAxis(horse.sustain)),
    power: round1(adjAxis(horse.power)),
  };
}

function kickL2BlendAlpha(condition) {
  const key = resolveVenuePhysicalFactorKey(condition);
  if (key != null) {
    const f = VENUE_PHYSICAL_FACTORS[key];
    if (f != null && f.straight >= 520) return 0.82;
    if (f != null && f.straight >= 480) return 0.68;
  }
  const blob = `${condition?.courseKey ?? ""} ${condition?.venue ?? ""}`.toLowerCase();
  if (blob.includes("東京") || blob.includes("新潟")) return 0.78;
  return 0.44;
}

function applyKickL2Emphasis(horse, condition) {
  const l2 = deriveKickScoreFromL2Runs(horse.pastRuns);
  if (l2 == null) return horse;
  const alpha = kickL2BlendAlpha(condition);
  const merged = horse.kick * (1 - alpha) + l2 * alpha;
  return { ...horse, kick: Math.round(merged * 10) / 10 };
}

function buildConditionFromMeta(meta) {
  return {
    venue: String(meta?.venue ?? "東京").trim(),
    surface: meta?.surface ?? "芝",
    distance: Number(meta?.distance ?? 1600) || 1600,
    raceName: meta?.raceName != null ? String(meta.raceName) : "",
  };
}

const NEUTRAL = { speed: 52, stamina: 52, kick: 52, sustain: 52, power: 52 };

/**
 * 出走馬配列に対し abilities / abilities_source を上書きする。
 * @param {object[]} entries
 * @param {object} meta - parseShutubaCore の meta（venue, surface, distance, raceName）
 */
export function applyEstimatedAbilitiesToEntries(entries, meta) {
  if (!Array.isArray(entries)) return;
  const condition = buildConditionFromMeta(meta);
  for (const entry of entries) {
    const runs = Array.isArray(entry.pastRuns) ? entry.pastRuns : [];
    const style = entry.runningStyle ?? "好位";
    const derived = deriveAxesFromRuns(runs, style, condition);
    if (derived == null) {
      entry.abilities = { ...NEUTRAL };
      entry.abilities_source = runs.length === 0 ? "neutral_no_past_runs" : "neutral_no_usable_runs";
      delete entry.abilitiesSource;
      continue;
    }
    const blend = 0.2 + derived.confidence * 0.55;
    const keep = 1 - blend;
    const b = 50;
    const horse0 = {
      horseId: String(entry.horseId ?? ""),
      horseName: String(entry.horseName ?? ""),
      runningStyle: style,
      speed: round1(b * keep + derived.speed * blend),
      stamina: round1(b * keep + derived.stamina * blend),
      kick: round1(b * keep + derived.kick * blend),
      sustain: round1(b * keep + derived.sustain * blend),
      power: round1(b * keep + derived.power * blend),
      pastRuns: runs,
    };
    let horse1 = applyLayer1ClassCorrection(horse0);
    horse1 = applyKickL2Emphasis(horse1, condition);
    entry.abilities = {
      speed: horse1.speed,
      stamina: horse1.stamina,
      kick: horse1.kick,
      sustain: horse1.sustain,
      power: horse1.power,
    };
    entry.abilities_source = "past_runs_estimated";
    delete entry.abilitiesSource;
  }
}

/** 出馬表パース直後の仮値（過去走マージ前）。後段で必ず applyEstimatedAbilitiesToEntries が上書きする。 */
export function neutralPlaceholderAbilities() {
  return { speed: 50, stamina: 50, kick: 50, sustain: 50, power: 50 };
}
