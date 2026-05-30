import { execSync } from "child_process";
import iconv from "iconv-lite";

const looksLikeHtml = (s) => /<(?:!doctype|html|head|body)\b/i.test(s) || /<title>/i.test(s);

/** 日本語文字数と文字化け（U+FFFD）からデコード候補を選ぶ */
function pickDecodedHtml(bin) {
  const headSample = bin.slice(0, 8192).toString("ascii");
  const charsetMatch = headSample.match(/charset\s*=\s*["']?([\w-]+)/i);
  const declared = charsetMatch?.[1]?.toLowerCase() ?? "";
  if (declared === "utf-8" || declared === "utf8") {
    return bin.toString("utf8");
  }
  if (declared === "euc-jp" || declared === "eucjp") {
    return iconv.decode(bin, "EUC-JP");
  }

  const asUtf8 = bin.toString("utf8");
  const asEuc = iconv.decode(bin, "EUC-JP");
  const score = (s) => {
    const jp = (s.match(/[ぁ-んァ-ン一-龥]/g) ?? []).length;
    const bad = (s.match(/\uFFFD/g) ?? []).length;
    return (
      jp * 2 -
      bad * 20 +
      (looksLikeHtml(s) ? 10 : 0) +
      (s.includes("netkeiba") ? 3 : 0) +
      (/charset\s*=\s*["']?utf-8/i.test(s) ? 5 : 0)
    );
  };
  return score(asUtf8) >= score(asEuc) ? asUtf8 : asEuc;
}

/**
 * netkeiba HTML を UTF-8 で取得（PC ページは EUC-JP / UTF-8 混在）
 */
export function fetchUtf8(url) {
  const bin = execSync(`curl -sL -A 'Mozilla/5.0 (compatible; keiba-yosou/1.0)' ${JSON.stringify(url)}`, {
    maxBuffer: 8 * 1024 * 1024,
    encoding: "buffer",
  });
  return pickDecodedHtml(bin);
}

/**
 * race.sp.netkeiba.com 向け（モバイル UA。2026-05 以降 UTF-8 が主流）
 */
export function fetchSpUtf8(url) {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const bin = execSync(`curl -sL -A ${JSON.stringify(ua)} ${JSON.stringify(url)}`, {
    maxBuffer: 8 * 1024 * 1024,
    encoding: "buffer",
  });
  return pickDecodedHtml(bin);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
