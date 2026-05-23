import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  fetchRaceResultFromNetkeiba,
  isRaceResultNotReadyError,
} from "./scripts/lib/fetchRaceResultFromNetkeiba.mjs";

/** 開発時も本番同様 /api/race-result を提供（一覧の一括結果取得用） */
function attachRaceResultApi(
  middlewares: import("connect").Connect.Server,
): void {
  middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/race-result")) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }

        try {
          const parsed = new URL(url, "http://localhost");
          const raceId = parsed.searchParams.get("raceId") ?? "";
          if (!/^\d{12}$/.test(raceId)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "raceId は12桁の数字で指定してください" }));
            return;
          }

          const data = await fetchRaceResultFromNetkeiba(raceId);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(JSON.stringify(data));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          if (isRaceResultNotReadyError(err)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: msg }));
          } else {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: `netkeiba取得失敗: ${msg}` }));
          }
        }
      });
}

function raceResultDevApiPlugin(): Plugin {
  return {
    name: "race-result-dev-api",
    configureServer(server) {
      attachRaceResultApi(server.middlewares);
    },
    configurePreviewServer(server) {
      attachRaceResultApi(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), raceResultDevApiPlugin()],
});
