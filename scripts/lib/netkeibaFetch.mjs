import { execSync } from "child_process";
import iconv from "iconv-lite";

/**
 * netkeiba HTML を UTF-8 で取得（日本語ページは EUC-JP 想定）
 */
export function fetchUtf8(url) {
  const bin = execSync(`curl -sL -A 'Mozilla/5.0 (compatible; keiba-yosou/1.0)' ${JSON.stringify(url)}`, {
    maxBuffer: 8 * 1024 * 1024,
    encoding: "buffer",
  });
  const asUtf8 = bin.toString("utf8");
  const asEuc = iconv.decode(bin, "EUC-JP");
  const looksLikeHtml = (s) => /<(?:!doctype|html|head|body)\b/i.test(s) || /<title>/i.test(s);
  const score = (s) => (looksLikeHtml(s) ? 10 : 0) + (s.length > 1000 ? 5 : 0) + (s.includes("netkeiba") ? 3 : 0);
  return score(asEuc) >= score(asUtf8) ? asEuc : asUtf8;
}

/**
 * race.sp.netkeiba.com 向け（モバイルUA + EUC-JP優先）
 */
export function fetchSpUtf8(url) {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const bin = execSync(`curl -sL -A ${JSON.stringify(ua)} ${JSON.stringify(url)}`, {
    maxBuffer: 8 * 1024 * 1024,
    encoding: "buffer",
  });
  const asEuc = iconv.decode(bin, "EUC-JP");
  const asUtf8 = bin.toString("utf8");
  const looksLikeHtml = (s) => /<(?:!doctype|html|head|body)\b/i.test(s) || /<title>/i.test(s);
  const score = (s) => (looksLikeHtml(s) ? 10 : 0) + (s.length > 1000 ? 5 : 0) + (s.includes("netkeiba") ? 3 : 0);
  return score(asEuc) >= score(asUtf8) ? asEuc : asUtf8;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
