import { useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Footer } from "./components/Footer";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";
import type { NavKey } from "./data/mock";

/**
 * App shell — owns top-level navigation state and composes the
 * header / sidebar / page / footer layout. Individual views live in
 * src/pages/* so DevBridge source mapping has distinct files per area.
 */
export function App() {
  const [route, setRoute] = useState<NavKey>("dashboard");
  const [search, setSearch] = useState("");

  return (
    <div className="app-shell">
      <Header onSearch={setSearch} />
      <div className="app-body">
        <Sidebar active={route} onNavigate={setRoute} />
        <main className="app-main">
          {search.trim() !== "" && (
            <p className="search-note" role="status">
              Filtering for “{search.trim()}” — demo search, list content unchanged.
            </p>
          )}
          {route === "dashboard" && <Dashboard />}
          {route === "projects" && <Projects />}
          {route === "analytics" && <Analytics />}
          {route === "settings" && <Settings />}
        </main>
      </div>
      <Footer />
    </div>
  );
}
