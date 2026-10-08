import type { NavKey } from "../data/mock";

const items: Array<{ key: NavKey; label: string; icon: string }> = [
  { key: "dashboard", label: "Dashboard", icon: "◧" },
  { key: "projects", label: "Projects", icon: "▤" },
  { key: "analytics", label: "Analytics", icon: "▦" },
  { key: "settings", label: "Settings", icon: "⚙" },
];

export function Sidebar({ active, onNavigate }: { active: NavKey; onNavigate: (key: NavKey) => void }) {
  return (
    <nav className="sidebar" aria-label="Primary">
      <ul className="sidebar__list">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key} className="sidebar__item">
              <button
                type="button"
                className={isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(item.key)}
              >
                <span aria-hidden="true" className="sidebar__icon">
                  {item.icon}
                </span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sidebar__footer">
        <p className="sidebar__plan-title">Pro trial</p>
        <p className="sidebar__plan-sub">12 days left</p>
        <button type="button" className="secondary-button secondary-button--block">
          Upgrade
        </button>
      </div>
    </nav>
  );
}
