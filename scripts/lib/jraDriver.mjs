/**
 * JRA 公式（スマホサイト sp.jra.jp）から単勝オッズを Playwright で取得する。
 * 負荷軽減のためレース間はランダムウェイトを挟み、画像等は route でブロックする。
 */
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SP_BASE = "https://sp.jra.jp/";
const SP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function randomPoliteMs(min = 1500, max = 3000) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('playwright').BrowserContext} context
 */
async function installLightRoutes(context) {
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * トップメニューの「オッズ」から JRADB への入口パラメータを拾う（失敗時はフォールバック）。
 * 先頭にマッチするのが別パターンだと開催選択に進めないため、オッズ用 onclick を優先する。
 */
async function extractOddsMenuAction(page) {
  const parsed = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[onclick*="accessO.html"]')];
    const parseDo = (a) => {
      const oc = a.getAttribute("onclick") ?? "";
      const m = oc.match(/doAction\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      return m ? { path: m[1], arg: m[2] } : null;
    };
    const rank = (a) => {
      const t = (a.textContent ?? "").trim();
      const oc = a.getAttribute("onclick") ?? "";
      if (t === "オッズ") return 100;
      if (/オッズ/.test(t) && t.length < 12) return 90;
      if (/sw\d+oli|oli\d+i/i.test(oc)) return 70;
      return 0;
    };
    links.sort((a, b) => rank(b) - rank(a));
    for (const a of links) {
      const p = parseDo(a);
      if (p) return p;
    }
    return null;
  });
  return parsed ?? { path: "/JRADB/accessO.html", arg: "sw15oli00/FA" };
}

async function waitForTanOddsTable(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForSelector("table td.umaban", { timeout: 45000 });
  await page.waitForSelector("table td.oztan", { timeout: 45000 });
}

/**
 * 開催選択トップに注目レースとして並ぶ「東京11R〜」形式をクリック。
 * @returns {Promise<{ ok: boolean, samples?: string[] }>}
 */
async function clickDirectFeaturedRaceLink(page, ctx) {
  const { venue, raceNumber, compactDate, raceName } = ctx;
  return page.evaluate(
    ({ venue: vn, raceNumber: rn, compactDate: cd, raceName: rname }) => {
      const normalizeLinkBlob = (s) => {
        let t = String(s ?? "").normalize("NFKC");
        t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
        return t.replace(/\s+/g, "");
      };
      const escapeRx = (v) => String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const vx = escapeRx(String(vn).trim());
      const raceReFull = new RegExp(`${vx}(\\d+)(?=[RＲ])`);
      const want = Number(rn);
      const links = [...document.querySelectorAll("a")];
      const candidates = [];
      for (const a of links) {
        const blob = normalizeLinkBlob(a.textContent);
        const m = blob.match(raceReFull);
        if (!m || parseInt(m[1], 10) !== want) continue;
        candidates.push(a);
      }
      const samples = links
        .map((a) => normalizeLinkBlob(a.textContent))
        .filter((t) => /\d+[RＲ]/.test(t))
        .slice(0, 14);
      if (candidates.length === 0) return { ok: false, samples };

      const norm = (s) => normalizeLinkBlob(s);
      const byDate = candidates.filter((a) => (a.getAttribute("onclick") ?? "").includes(cd));
      const hit =
        byDate[0] ??
        (rname
          ? candidates.find((a) => {
              const blob = norm(a.textContent);
              const key = norm(rname).slice(0, 8);
              return key.length >= 2 && blob.includes(key);
            })
          : null) ??
        candidates[0];

      if (hit) {
        hit.click();
        return { ok: true, samples };
      }
      return { ok: false, samples };
    },
    { venue, raceNumber, compactDate, raceName },
  );
}

/**
 * 「場名のみ」（同日 onclick）→ レース選択の「1R9:45」形式へ。
 */
async function drillDownVenueThenRaceRow(page, ctx) {
  const { venue, raceNumber, compactDate } = ctx;

  const stepVenue = await page.evaluate(
    ({ venue: vn, compactDate: cd }) => {
      const venueShort = String(vn).trim();
      const links = [...document.querySelectorAll("a")];
      const hit = links.find((a) => {
        if ((a.textContent ?? "").trim() !== venueShort) return false;
        const oc = a.getAttribute("onclick") ?? "";
        return oc.includes(cd) && oc.includes("doAction");
      });
      if (!hit) return { ok: false };
      hit.click();
      return { ok: true };
    },
    { venue, compactDate },
  );

  if (!stepVenue.ok) return { ok: false, samples: [] };

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(700);

  await page
    .waitForFunction(
      ({ rn }) => {
        const normalizeLinkBlob = (s) => {
          let t = String(s ?? "").normalize("NFKC");
          t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
          return t.replace(/\s+/g, "");
        };
        const want = Number(rn);
        const re = new RegExp(`^${want}R`);
        return [...document.querySelectorAll("a")].some((a) => re.test(normalizeLinkBlob(a.textContent)));
      },
      { raceNumber },
      { timeout: 25000 },
    )
    .catch(() => {});

  const stepRace = await page.evaluate(({ raceNumber: rn }) => {
    const normalizeLinkBlob = (s) => {
      let t = String(s ?? "").normalize("NFKC");
      t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      return t.replace(/\s+/g, "");
    };
    const want = Number(rn);
    const re = new RegExp(`^${want}R`);
    const links = [...document.querySelectorAll("a")];
    for (const a of links) {
      const blob = normalizeLinkBlob(a.textContent);
      if (re.test(blob)) {
        a.click();
        return { ok: true, samples: [] };
      }
    }
    const samples = links
      .map((a) => normalizeLinkBlob(a.textContent))
      .filter((t) => /\d+R/.test(t))
      .slice(0, 16);
    return { ok: false, samples };
  }, { raceNumber });

  return stepRace;
}

/**
 * @param {object} ctx resolveRaceNavigationContext の戻り値
 * @param {import('playwright').Page} page
 */
async function openOddsRacePage(ctx, page) {
  const { venue, raceNumber, compactDate, raceName } = ctx;
  const entry = await extractOddsMenuAction(page);
  await page.evaluate(
    ({ path, arg }) => {
      if (typeof doAction !== "function") throw new Error("JRA doAction is not available");
      doAction(path, arg);
    },
    { path: entry.path.startsWith("/") ? entry.path : `/${entry.path}`, arg: entry.arg },
  );

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(600);

  await page
    .waitForFunction(
      ({ vn, cd }) =>
        [...document.querySelectorAll("a")].some((a) => {
          const t = (a.textContent ?? "").trim();
          const oc = a.getAttribute("onclick") ?? "";
          return t === vn && oc.includes(cd);
        }),
      { vn: venue.trim(), cd: compactDate },
      { timeout: 35000 },
    )
    .catch(() => {});

  const direct = await clickDirectFeaturedRaceLink(page, ctx);
  if (direct.ok) {
    await waitForTanOddsTable(page);
    return;
  }

  const drilled = await drillDownVenueThenRaceRow(page, ctx);
  if (drilled.ok) {
    await waitForTanOddsTable(page);
    return;
  }

  const samples = [...(direct.samples ?? []), ...(drilled.samples ?? [])].filter(Boolean);
  const uniq = [...new Set(samples)].slice(0, 14);
  if (uniq.length > 0) {
    process.stderr.write(
      `[jraDriver] no odds link for ${venue} ${raceNumber}R (date ${compactDate}). Sample texts: ${uniq.join(" | ")}\n`,
    );
  }
  throw new Error(`JRA: could not find odds link for ${venue} ${raceNumber}R (no_matching_race_link)`);
}

/**
 * 単勝テーブルを「人気順」に切り替え（ドロップダウンの値は doAction の第2引数）。
 * @returns {Promise<boolean>}
 */
async function switchOddsTableToPopularityOrder(page) {
  const payload = await page.evaluate(() => {
    const sel =
      document.querySelector("select.dropdown-select.odds_type-list") ??
      document.querySelector("select.odds_type-list") ??
      [...document.querySelectorAll("select.dropdown-select")].find((s) =>
        [...s.querySelectorAll("option")].some((o) => (o.textContent ?? "").includes("人気順")),
      );
    if (!sel) return null;
    const opt = [...sel.querySelectorAll("option")].find((o) => (o.textContent ?? "").trim() === "人気順");
    const v = opt?.value?.trim() ?? "";
    return v.length > 0 ? v : null;
  });

  if (!payload) return false;

  await page.evaluate(
    ({ arg }) => {
      if (typeof doAction !== "function") throw new Error("JRA doAction is not available");
      doAction("/JRADB/accessO.html", arg);
    },
    { arg: payload },
  );

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(600);
  await page
    .waitForFunction(
      () =>
        document.title.includes("人気順") &&
        document.querySelector("table td.ninki") &&
        document.querySelector("table td.umaban"),
      { timeout: 45000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
  const ok = await page.evaluate(
    () => document.title.includes("人気順") && Boolean(document.querySelector("table td.ninki")),
  );
  return ok;
}

/**
 * 人気順表示時: 人気・馬番・単勝を1行から取得（馬番順でも td.ninki が無ければ人気は null）。
 * @returns {Promise<{ horseNumber: number, marketWinOdds: number | null, marketPopularity: number | null, excluded?: boolean }[]>}
 */
async function scrapeTanOddsAndPopularityFromPage(page) {
  return page.evaluate(() => {
    /** @type {{ horseNumber: number, marketWinOdds: number | null, marketPopularity: number | null, excluded?: boolean }[]} */
    const out = [];
    const tables = [...document.querySelectorAll("table")];
    const table = tables.find((t) => {
      const tr = t.querySelector("tr");
      const tx = tr?.textContent ?? "";
      return tx.includes("馬番") && tx.includes("単勝");
    });
    if (!table) return out;

    const headerRow = table.querySelector("tr");
    const hasNinkiCol = (headerRow?.textContent ?? "").includes("人気");

    for (const tr of table.querySelectorAll("tr")) {
      if (tr.querySelector("th")) continue;

      const ub = tr.querySelector("td.umaban");
      const oz = tr.querySelector("td.oztan");
      if (!ub || !oz) continue;

      const horseNumber = parseInt(String(ub.textContent ?? "").replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(horseNumber) || horseNumber < 1) continue;

      const rowText = (tr.textContent ?? "").replace(/\s+/g, "");
      if (/取消|除外/.test(rowText)) {
        out.push({ horseNumber, marketWinOdds: null, marketPopularity: null, excluded: true });
        continue;
      }

      const nk = tr.querySelector("td.ninki");
      let marketPopularity = null;
      if (hasNinkiCol && nk) {
        const n = parseInt(String(nk.textContent ?? "").replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(n) && n >= 1) marketPopularity = n;
      }

      const ozText = String(oz.textContent ?? "")
        .replace(/\s+/g, "")
        .trim();
      let marketWinOdds = null;
      if (/^[\d.]+$/.test(ozText)) {
        const v = parseFloat(ozText);
        if (Number.isFinite(v) && v > 0) marketWinOdds = v;
      }

      out.push({
        horseNumber,
        marketWinOdds: marketWinOdds ?? null,
        marketPopularity,
      });
    }

    const seen = new Set();
    const uniq = [];
    for (const r of out) {
      if (seen.has(r.horseNumber)) continue;
      seen.add(r.horseNumber);
      uniq.push(r);
    }
    return uniq;
  });
}

/** 人気順へ切り替え後にスクレイプする（フォールバック: 馬番のみ・人気なし） */
async function scrapeOddsAfterPopularitySwitch(page) {
  const switched = await switchOddsTableToPopularityOrder(page);
  if (!switched) {
    process.stderr.write(
      "[jraDriver] could not switch to 人気順; odds CSV will omit marketPopularity.\n",
    );
  }
  return scrapeTanOddsAndPopularityFromPage(page);
}

/**
 * @param {object} ctx resolveRaceNavigationContext の戻り値
 * @param {{ observedAt?: string }} [opts]
 */
export async function fetchJraOfficialWinOddsForRace(ctx, opts = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    throw new Error("playwright package is required for JRA official odds (npm install playwright)");
  }

  const observedAt = opts.observedAt ?? new Date().toISOString();

  const launchOpts = { headless: true };
  const ch = process.env.ODDS_BROWSER_CHANNEL;
  if (ch && ch !== "0") launchOpts.channel = ch;

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: SP_UA,
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
  });
  await installLightRoutes(context);
  const page = await context.newPage();

  try {
    await page.goto(SP_BASE, { waitUntil: "networkidle", timeout: 90000 });
    await openOddsRacePage(ctx, page);
    await page.waitForTimeout(400);
    const raw = await scrapeOddsAfterPopularitySwitch(page);

    const rows = [];
    for (const r of raw) {
      rows.push({
        raceId: ctx.raceId,
        horseNumber: r.horseNumber,
        actualOdds: null,
        marketWinOdds: r.excluded ? null : r.marketWinOdds,
        marketPopularity: r.excluded ? null : r.marketPopularity,
        observedAt,
        source: "jra-official",
        _excluded: Boolean(r.excluded),
      });
    }
    return rows;
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * 同一プロセスで複数レースを順次取得するとき用のセッション（ブラウザは1回だけ起動）。
 */
export async function createJraOfficialOddsSession() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    throw new Error("playwright package is required for JRA official odds");
  }

  const launchOpts = { headless: true };
  const ch = process.env.ODDS_BROWSER_CHANNEL;
  if (ch && ch !== "0") launchOpts.channel = ch;

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: SP_UA,
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
  });
  await installLightRoutes(context);
  const page = await context.newPage();

  return {
    /**
     * @param {object} ctx
     */
    async fetchRows(ctx) {
      const observedAt = new Date().toISOString();
      await page.goto(SP_BASE, { waitUntil: "networkidle", timeout: 90000 });
      await openOddsRacePage(ctx, page);
      await page.waitForTimeout(400);
      const raw = await scrapeOddsAfterPopularitySwitch(page);
      const rows = [];
      for (const r of raw) {
        rows.push({
          raceId: ctx.raceId,
          horseNumber: r.horseNumber,
          actualOdds: null,
          marketWinOdds: r.excluded ? null : r.marketWinOdds,
          marketPopularity: r.excluded ? null : r.marketPopularity,
          observedAt,
          source: "jra-official",
          _excluded: Boolean(r.excluded),
        });
      }
      return rows;
    },

    async politeGap() {
      await sleep(randomPoliteMs(1500, 3000));
    },

    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export { randomPoliteMs, sleep };
