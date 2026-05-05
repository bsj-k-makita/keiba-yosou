import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { RacesListPage } from "./app/races/page";
import { RaceDetailPage } from "./app/race/[raceId]/page";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "keiba-theme-mode";

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeToDocument(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
}

function AppNav({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <nav className="app-nav" aria-label="サイトナビ">
      <Link to="/races" className="app-nav__logo">
        <span className="app-nav__logo-icon" aria-hidden />
        <span className="app-nav__logo-text">競馬AI分析</span>
      </Link>
      <div className="app-nav__right">
        <button
          type="button"
          className="app-nav__theme-btn"
          onClick={onToggleTheme}
          aria-label={`テーマ切替（現在: ${theme === "dark" ? "ダーク" : "ライト"}）`}
          title={`現在: ${theme === "dark" ? "ダーク" : "ライト"}`}
        >
          {theme === "dark" ? "☀ LIGHT" : "🌙 DARK"}
        </button>
        <span className="app-nav__live" aria-label="ライブ分析中">
          <span className="app-nav__live-dot" aria-hidden />
          LIVE
        </span>
      </div>
    </nav>
  );
}

function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="app-footer">
      <div className="app-footer__logo">
        <span className="app-footer__logo-mark" aria-hidden />
        <span>競馬AI分析</span>
      </div>
      <p className="app-footer__copy">© {year} 競馬AI分析. All rights reserved.</p>
    </footer>
  );
}

function AppShell({
  children,
  theme,
  onToggleTheme,
}: {
  children: React.ReactNode;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <div className="app-shell">
      <AppNav theme={theme} onToggleTheme={onToggleTheme} />
      <main className="app-shell__body">{children}</main>
      <AppFooter />
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <AppShell
      theme={theme}
      onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/races" replace />} />
        <Route path="/races" element={<RacesListPage />} />
        <Route path="/race/:raceId" element={<RaceDetailPage />} />
      </Routes>
    </AppShell>
  );
}
