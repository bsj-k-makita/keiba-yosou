import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./app/home/page";
import { RacesListPage } from "./app/races/page";
import { RaceDetailPage } from "./app/race/[raceId]/page";
import BacktestDashboardPage from "./app/backtest/page";

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
  const navItems = [
    { to: "/", title: "TOP", subtitle: "Mission", icon: "◆" },
    { to: "/races", title: "レース探索", subtitle: "Explore", icon: "◉" },
    { to: "/backtest", title: "回収率BT", subtitle: "Lab", icon: "▲" },
  ];

  return (
    <nav className="app-nav" aria-label="サイトナビ">
      <Link to="/" className="app-nav__logo">
        <img
          className="app-nav__logo-img"
          src="/logo.png"
          alt="競馬AI分析"
          decoding="async"
          loading="lazy"
        />
        <span className="app-nav__logo-text">競馬AI分析</span>
      </Link>
      <div className="app-nav__right">
        <div className="app-nav__menu" aria-label="主要メニュー">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav__pill${isActive ? " app-nav__pill--active" : ""}`}
            >
              <span className="app-nav__pill-icon" aria-hidden>{item.icon}</span>
              <span className="app-nav__pill-text">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </NavLink>
          ))}
        </div>
        <button
          type="button"
          className="app-nav__theme-btn"
          onClick={onToggleTheme}
          aria-label={`テーマ切替（現在: ${theme === "dark" ? "ダーク" : "ライト"}）`}
          title={`現在: ${theme === "dark" ? "ダーク" : "ライト"}`}
        >
          {theme === "dark" ? "☀" : "◐"}
        </button>
      </div>
    </nav>
  );
}

function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="app-footer">
      <div className="app-footer__logo">
        <img
          className="app-footer__logo-img"
          src="/logo.png"
          alt=""
          decoding="async"
        />
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
        <Route path="/" element={<HomePage />} />
        <Route path="/races" element={<RacesListPage />} />
        <Route path="/race/:raceId" element={<RaceDetailPage />} />
        <Route path="/backtest" element={<BacktestDashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
