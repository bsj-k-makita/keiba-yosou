/**
 * netkeiba 出馬表（shutuba）を取得し、既存 app が読む `analysisJson` 互換の JSON を保存する。
 * 取り込み時に各馬の直近5走（pastRuns）も同時に取得して保存する。
 * 起動: node scripts/fetch-races-from-netkeiba.mjs [--date=YYYY-MM-DD] [--skip-past-runs]
 * 2026年 対象日「全レース」= 各日 3場 × 12R。
 * index からは対象日の 2025 誤取り込み分も除去してから 2026 行を差し替える。
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { load } from "cheerio";
import { fetchPastRunsForHorse } from "./lib/parseNetkeibaPastRuns.mjs";
import { enrichInvestmentSignalsInRaceData } from "./lib/investmentSignals.mjs";
import { fetchUtf8, fetchSpUtf8 } from "./lib/netkeibaFetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RACES_DIR = join(ROOT, "src/data/races");
const INDEX_PATH = join(ROOT, "src/data/index.json");

const SLEEP_MS = 350;
const PAST_RUN_SLEEP_MS = 400;
const PAST_RUN_RETRY_MAX = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchShutubaHtml(raceId) {
  const pcUrl = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  try {
    const pc = fetchUtf8(pcUrl);
    if (String(pc ?? "").length > 1000) return pc;
  } catch {
    // fallback below
  }
  return fetchSpUtf8(`https://race.sp.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
}

function hashAbilities(horseId) {
  let h = 0;
  for (let i = 0; i < horseId.length; i += 1) h = Math.imul(31, h) + horseId.charCodeAt(i);
  h |= 0;
  const b = (shift) => 20 + (Math.abs((h + shift * 7919) | 0) % 61);
  return { speed: b(0), stamina: b(1), kick: b(2), sustain: b(3), power: b(4) };
}

function makeDayJobs({ date, placeCodes }) {
  const out = [];
  for (const code of placeCodes) {
    for (let r = 1; r <= 12; r += 1) {
      out.push({ raceId: `2026${code}${String(r).padStart(2, "0")}`, date });
    }
  }
  return out;
}

function makeJobs(targetDate = null) {
  const out = [
    ...makeDayJobs({
      date: "2026-04-25",
      placeCodes: ["030105", "050201", "080301"], // 福島 / 東京 / 京都
    }),
    ...makeDayJobs({
      date: "2026-04-26",
      placeCodes: ["030106", "050202", "080302"], // 福島 / 東京 / 京都
    }),
    ...makeDayJobs({
      date: "2026-05-02",
      placeCodes: ["040101", "050203", "080303"], // 新潟 / 東京 / 京都
    }),
    ...makeDayJobs({
      date: "2026-05-03",
      placeCodes: ["040102", "050204", "080304"], // 新潟 / 東京 / 京都
    }),
    ...makeDayJobs({
      date: "2026-05-09",
      placeCodes: ["040103", "050205", "080305"], // 新潟 / 東京 / 京都
    }),
    ...makeDayJobs({
      date: "2026-05-10",
      placeCodes: ["040104", "050206", "080306"], // 新潟 / 東京 / 京都
    }),
  ];
  if (!targetDate) return out;
  return out.filter((j) => j.date === targetDate);
}

function parseGroundAndWeather($) {
  const text = $(".RaceData01, .RaceData02").text().replace(/\s+/g, " ").trim();
  const weatherMatch = text.match(/天候[:：]?\s*(晴|曇|雨|雪|小雨|小雪)/);
  const groundMatch = text.match(/馬場[:：]?\s*(良|稍重|重|不良)/);
  return {
    weather: weatherMatch ? weatherMatch[1] : null,
    groundLabel: groundMatch ? groundMatch[1] : null,
  };
}

/** `h1.RaceName` 先頭の `Icon_GradeType{n}`（netkeiba のグレードアイコン番号） */
function parseNetkeibaGradeType($) {
  const cls = $("h1.RaceName span.Icon_GradeType").first().attr("class") ?? "";
  const m = cls.match(/Icon_GradeType(\d+)/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * アイコン番号 → 表示ラベル（実ページで確認: 1=GI,2=GII,3=GIII,15=L,16=その他重賞 S 等）
 * 未マップ番号はラベル無し（netkeibaGradeType のみ meta に残す）
 */
function netkeibaGradeTypeToRaceGrade(typeNum) {
  const map = {
    1: "G1",
    2: "G2",
    3: "G3",
    15: "L",
    16: "S",
  };
  return map[typeNum];
}

function validateEntries(entries, raceId) {
  const horseNos = entries.map((e) => Number(e.horseNumber)).filter((n) => Number.isFinite(n) && n > 0);
  const frameNos = entries.map((e) => Number(e.frameNumber)).filter((n) => Number.isFinite(n) && n > 0);
  if (horseNos.length !== entries.length) {
    throw new Error(`invalid horseNumber exists: raceId=${raceId}`);
  }
  const uniqueHorseNos = new Set(horseNos);
  if (uniqueHorseNos.size !== horseNos.length) {
    throw new Error(`duplicate horseNumber exists: raceId=${raceId}`);
  }
  // 枠連・枠番は未確定の出馬表では空欄のことがある（早期に全馬枠なしのケースを許可）
  if (frameNos.length > 0 && frameNos.some((n) => n < 1 || n > 8)) {
    throw new Error(`frameNumber out of range: raceId=${raceId}`);
  }
}

function parseShutuba(html, { raceId, date }) {
  const $ = load(html);
  const observedAt = new Date().toISOString();
  const trackMeta = parseGroundAndWeather($);

  if ($("title").text().includes("エラー") || /お探しのページ/.test(html)) {
    throw new Error("ページ取得失敗または非表示");
  }

  const raceName = $("h1.RaceName").text().replace(/\s+/g, " ").trim();
  const raceData01 = $(".RaceData01").text().replace(/\s+/g, " ");
  const wholeText = $("body").text().replace(/\s+/g, " ");
  // 例: 芝1600m / ダ1700m / 障3170m (芝 ダート) — 障害は `RaceEvaluation` の surface が芝|ダのため ダート に寄せる
  const mObstacle = (raceData01 || wholeText).match(/障[・\s]*(\d{3,4})m/);
  const mTurfDirt = (raceData01 || wholeText).match(/(芝|ダ)(?:ート)?[・\s]*(\d{3,4})m/);
  let surface;
  let distance;
  if (mObstacle) {
    distance = parseInt(mObstacle[1], 10);
    surface = "ダート";
  } else if (mTurfDirt) {
    surface = mTurfDirt[1] === "ダ" ? "ダート" : "芝";
    distance = parseInt(mTurfDirt[2], 10);
  } else {
    throw new Error(`距離を解析できません: ${raceData01.slice(0, 120)}`);
  }
  const rm = $(".RaceList_Item01 .RaceNum").text().match(/(\d+)R/);
  const raceNumber =
    rm != null
      ? parseInt(rm[1], 10)
      : parseInt(String(raceId).slice(-2), 10);
  if (!Number.isFinite(raceNumber) || raceNumber < 1 || raceNumber > 12) {
    throw new Error("R番号を取得できません");
  }
  const venue = $(".RaceData02 span").eq(1).text().trim() || "—";

  const gradeType = parseNetkeibaGradeType($);
  const raceGradeLabel = gradeType != null ? netkeibaGradeTypeToRaceGrade(gradeType) : undefined;

  const entries = [];
  const pickHorseNoFromRow = (tr) => {
    const textNo = parseInt($(tr).children("td").eq(1).text().replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(textNo) && textNo >= 1) return textNo;
    const idCandidates = [
      $(tr).find('span[id^="uno-1_"]').first().attr("id"),
      $(tr).find('span[id^="odds-1_"]').first().attr("id"),
      $(tr).find('span[id^="ninki-1_"]').first().attr("id"),
    ];
    for (const id of idCandidates) {
      const m = String(id ?? "").match(/_(\d{1,2})$/);
      if (!m) continue;
      const no = parseInt(m[1], 10);
      if (Number.isFinite(no) && no >= 1) return no;
    }
    return undefined;
  };
  const parseOddsAndPopularity = (tr, cells, horseNo) => {
    const oddsNode =
      horseNo != null
        ? $(tr).find(`span[id="odds-1_${String(horseNo).padStart(2, "0")}"], span[id="odds-1_${horseNo}"]`).first()
        : $(tr).find('span[id^="odds-1_"]').first();
    const oddsByIdText = oddsNode.text().replace(/\s+/g, "").trim();
    const oddsByIdMatch = oddsByIdText.match(/^(\d+(?:\.\d+)?)$/);
    const oddsById = oddsByIdMatch ? parseFloat(oddsByIdMatch[1]) : undefined;
    const ninkiNode =
      horseNo != null
        ? $(tr).find(`span[id="ninki-1_${String(horseNo).padStart(2, "0")}"], span[id="ninki-1_${horseNo}"]`).first()
        : $(tr).find('span[id^="ninki-1_"]').first();
    const ninkiByIdText = ninkiNode.text().replace(/\s+/g, "").trim();
    const ninkiByIdMatch = ninkiByIdText.match(/^(\d{1,2})$/);
    const popularityById = ninkiByIdMatch ? parseInt(ninkiByIdMatch[1], 10) : undefined;
    if (oddsById != null) {
      return {
        actual_odds: oddsById,
        odds_source: "actual",
        odds_observed_at: observedAt,
        marketWinOdds: undefined,
        market_win_odds_source: "estimated",
        marketPopularity: popularityById,
        market_popularity_source: popularityById != null ? "actual" : "estimated",
        ...(popularityById != null ? { market_observed_at: observedAt } : {}),
      };
    }

    const texts = cells
      .toArray()
      .map((td) => $(td).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const popularityText = texts.find((s) => /(\d+)人気/.test(s)) ?? "";
    const popMatch = popularityText.match(/(\d+)人気/);
    const popularity = popMatch ? parseInt(popMatch[1], 10) : undefined;
    const rangeText = texts.find((s) => /\d+\.\d+\s*[-~]\s*\d+\.\d+/.test(s)) ?? "";
    const rangeMatch = rangeText.match(/(\d+\.\d+)\s*[-~]\s*(\d+\.\d+)/);
    if (rangeMatch) {
      return {
        actual_odds: parseFloat(rangeMatch[1]),
        odds_source: "actual",
        odds_observed_at: observedAt,
        marketWinOdds: parseFloat(rangeMatch[2]),
        market_win_odds_source: "actual",
        market_observed_at: observedAt,
        marketPopularity: popularity,
        market_popularity_source: popularity != null ? "actual" : "estimated",
      };
    }
    // 単一小数（例: 55.0）は斤量列と誤判定しやすいため採用しない。
    return {
      actual_odds: undefined,
      marketWinOdds: undefined,
      market_win_odds_source: "estimated",
      marketPopularity: popularity,
      market_popularity_source: popularity != null ? "actual" : "estimated",
      ...(popularity != null ? { market_observed_at: observedAt } : {}),
    };
  };
  const parseSexAge = (text) => {
    const m = String(text ?? "").replace(/\s+/g, "").match(/(牡|牝|セ)(\d{1,2})/);
    if (!m) return { sex: undefined, age: undefined };
    return { sex: m[1], age: parseInt(m[2], 10) };
  };
  const parseBodyWeight = (text) => {
    const m = String(text ?? "").match(/(\d{3})\s*(?:\(([+-]?\d+)\))?/);
    if (!m) return undefined;
    const v = parseInt(m[1], 10);
    return Number.isFinite(v) ? v : undefined;
  };
  $("tr.HorseList").each((_, el) => {
    const $tr = $(el);
    const tds = $tr.children("td");
    if (tds.length < 7) return;
    const rawWaku = parseInt(tds.eq(0).text().trim().replace(/[^\d]/g, ""), 10);
    const umaban = pickHorseNoFromRow($tr);
    // 正しい馬番が取れない行は採用しない（行順推定は誤紐付けを招くため禁止）
    if (!Number.isFinite(umaban) || umaban < 1) return;
    const wakuValid = Number.isFinite(rawWaku) && rawWaku >= 1 && rawWaku <= 8;
    const a = tds.eq(3).find('a[href*="/horse/"]').first();
    const href = a.attr("href");
    if (!href) return;
    const idm = href.match(/horse\/([0-9]+)/);
    if (!idm) return;
    const horseId = idm[1];
    const horseName = (a.attr("title") || a.text()).replace(/\s+/g, " ").trim();
    // 列レイアウト: 0枠1番2印3馬4性齢5斤量6騎手 — 9列以上版（Fav 列）でも 0–6 は同位置
    const wMatch = tds.eq(5).text().trim().match(/(\d{1,2}(?:\.\d)?)/);
    let wVal = wMatch ? parseFloat(wMatch[1]) : 57.0;
    if (Number.isNaN(wVal)) wVal = 57.0;
    const jName = tds
      .eq(6)
      .find("a")
      .first()
      .text()
      .replace(/[▲△▶◆]/g, "")
      .trim();
    const jNameAlt = tds.eq(6).text().replace(/[▲△▶◆\s]+/g, " ").trim();
    const jockey = (jName || jNameAlt || "—").split(/\s+/).filter(Boolean)[0] || "—";
    const trainer =
      $tr.find('a[href*="/trainer/"]').first().text().replace(/\s+/g, " ").trim() || undefined;
    const sexAgeText = tds.eq(4).text().trim();
    const { sex, age } = parseSexAge(sexAgeText);
    const bodyWeightCellText =
      tds
        .toArray()
        .map((td) => $(td).text().trim())
        .find((s) => /\d{3}\s*(?:\([+-]?\d+\))/.test(s)) ?? "";
    const bodyWeightKg = parseBodyWeight(bodyWeightCellText);
    if (!horseName) return;

    const ab = hashAbilities(horseId);
    const market = parseOddsAndPopularity($tr, tds, umaban);
    entries.push({
      horseId,
      horseName,
      frameNumber: wakuValid ? rawWaku : undefined,
      horseNumber: umaban,
      sex,
      age,
      jockey: jockey.length > 0 ? jockey : "—",
      trainer,
      weight: wVal,
      bodyWeightKg,
      runningStyle: "好位",
      abilities: ab,
      ...market,
    });
  });

  if (entries.length === 0) {
    throw new Error("出走馬の行を1件も解釈できません");
  }
  validateEntries(entries, raceId);

  return enrichInvestmentSignalsInRaceData({
    raceId,
    meta: {
      date,
      venue,
      raceNumber,
      raceName: raceName.length ? raceName : "—",
      surface,
      distance,
      groundLabel: trackMeta.groundLabel,
      weather: trackMeta.weather,
      ...(gradeType != null ? { netkeibaGradeType: gradeType } : {}),
      ...(raceGradeLabel != null ? { raceGrade: raceGradeLabel } : {}),
    },
    entries: entries.sort((a, b) => a.horseNumber - b.horseNumber),
  });
}

async function enrichEntriesWithPastRuns(entries, raceLapCache) {
  let successCount = 0;
  let failedCount = 0;
  for (const entry of entries) {
    const horseId = String(entry.horseId ?? "");
    if (!horseId) {
      entry.pastRuns = [];
      failedCount += 1;
      continue;
    }
    process.stderr.write(`  past ${horseId} ${entry.horseName}… `);
    let done = false;
    for (let attempt = 0; attempt <= PAST_RUN_RETRY_MAX; attempt += 1) {
      try {
        const { pastRuns, horseProfile } = await fetchPastRunsForHorse(horseId, {
          sleepMs: PAST_RUN_SLEEP_MS,
          raceLapCache,
        });
        entry.pastRuns = pastRuns.slice(0, 5);
        entry.sex = entry.sex ?? horseProfile?.sex;
        entry.age = entry.age ?? horseProfile?.age;
        entry.trainer = entry.trainer ?? horseProfile?.trainer;
        entry.bodyWeightKg = entry.bodyWeightKg ?? horseProfile?.bodyWeightKg;
        if (horseProfile?.pedigree) {
          entry.pedigree = {
            ...(entry.pedigree ?? {}),
            ...(horseProfile.pedigree.sireName ? { sireName: horseProfile.pedigree.sireName } : {}),
            ...(horseProfile.pedigree.damSireName ? { damSireName: horseProfile.pedigree.damSireName } : {}),
          };
        }
        process.stderr.write(`${entry.pastRuns.length} runs\n`);
        successCount += 1;
        done = true;
        break;
      } catch (e) {
        if (attempt >= PAST_RUN_RETRY_MAX) {
          entry.pastRuns = [];
          failedCount += 1;
          process.stderr.write(`fail: ${e?.message || e}\n`);
          break;
        }
        const wait = PAST_RUN_SLEEP_MS * (attempt + 2);
        process.stderr.write(`retry${attempt + 1}(${wait}ms)… `);
        await sleep(wait);
      }
    }
    if (done) await sleep(PAST_RUN_SLEEP_MS);
  }
  return { successCount, failedCount };
}

function shouldFailByPastRunQuality(data, stats) {
  const total = data.entries?.length ?? 0;
  if (total < 8) return false;
  const successRate = total > 0 ? stats.successCount / total : 0;
  const raceName = String(data?.meta?.raceName ?? "");
  const isGradedOrOpen = /(G1|G2|G3|OP|L|\([Gg][123]\)|ステークス|天皇賞|桜花賞|皐月賞|菊花賞|大阪杯)/.test(
    raceName,
  );
  const ageKnown = data.entries.filter((e) => Number.isFinite(e.age));
  const avgAge =
    ageKnown.length > 0
      ? ageKnown.reduce((s, e) => s + Number(e.age), 0) / ageKnown.length
      : 3;

  // 完全に空は常にNG。重賞/古馬中心は取得率も要求する。
  if (stats.successCount === 0) return true;
  if ((isGradedOrOpen || avgAge >= 4.5) && successRate < 0.6) return true;
  return false;
}

function parseOptions() {
  const args = process.argv.slice(2);
  let targetDate = null;
  let skipPastRuns = false;
  for (const arg of args) {
    if (arg.startsWith("--date=")) {
      targetDate = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg === "--skip-past-runs") skipPastRuns = true;
  }
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`invalid --date format: ${targetDate}`);
  }
  return { targetDate, skipPastRuns };
}

const venueOrder = (v) => {
  const m = { 福島: 0, 新潟: 1, 東京: 2, 京都: 3 };
  return m[v] ?? 9;
};

async function main() {
  const { targetDate, skipPastRuns } = parseOptions();
  const jobs = makeJobs(targetDate);
  if (jobs.length === 0) {
    throw new Error(targetDate ? `no jobs for --date=${targetDate}` : "no jobs");
  }
  const metas = [];
  const raceLapCache = new Map();
  let ok = 0;
  let err = 0;
  for (const job of jobs) {
    process.stderr.write(`fetch ${job.raceId}… `);
    try {
      const html = fetchShutubaHtml(job.raceId);
      const data = parseShutuba(html, job);
      if (!skipPastRuns) {
        const stats = await enrichEntriesWithPastRuns(data.entries, raceLapCache);
        if (shouldFailByPastRunQuality(data, stats)) {
          throw new Error(
            `pastRuns quality too low: success=${stats.successCount}/${data.entries.length}`,
          );
        }
      } else {
        for (const entry of data.entries) {
          entry.pastRuns = Array.isArray(entry.pastRuns) ? entry.pastRuns : [];
        }
      }
      const out = join(RACES_DIR, `${job.raceId}.json`);
      writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      const idxRow = {
        raceId: data.raceId,
        date: data.meta.date,
        venue: data.meta.venue,
        raceNumber: data.meta.raceNumber,
        raceName: data.meta.raceName,
        surface: data.meta.surface,
        distance: data.meta.distance,
      };
      if (data.meta.netkeibaGradeType != null) idxRow.netkeibaGradeType = data.meta.netkeibaGradeType;
      if (data.meta.raceGrade != null) idxRow.raceGrade = data.meta.raceGrade;
      metas.push(idxRow);
      ok += 1;
      process.stderr.write("ok\n");
    } catch (e) {
      err += 1;
      process.stderr.write(`err: ${e?.message || e}\n`);
    }
    await sleep(SLEEP_MS);
  }

  if (metas.length === 0) {
    process.stderr.write("保存されたレースがありません。\n");
    process.exit(1);
  }

  const old = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const targetDates = new Set((targetDate ? jobs.filter((j) => j.date === targetDate) : jobs).map((j) => j.date));
  const replaceDates = new Set();
  for (const d of targetDates) {
    replaceDates.add(d);
    replaceDates.add(d.replace(/^2026/, "2025"));
  }
  const without = old.filter((row) => !replaceDates.has(row?.date));
  const next = [...without, ...metas].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const d = venueOrder(a.venue) - venueOrder(b.venue);
    if (d !== 0) return d;
    return a.raceNumber - b.raceNumber;
  });
  writeFileSync(INDEX_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  process.stdout.write(
    `done. wrote ${ok} race files, ${err} failed. index: ${metas.length} new rows (${targetDate ? `${targetDate} replaced` : "all configured dates replaced"}).\n`,
  );
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
