import { useState } from "react";
import { UserMenu } from "./UserMenu";

export function Header({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState("");
  const [unread] = useState(3);

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="brand-mark" aria-hidden="true">
          DB
        </span>
        <div>
          <p className="brand-name">Northwind Studio</p>
          <p className="brand-sub">Operations dashboard</p>
        </div>
      </div>

      <div className="app-header__search">
        <label htmlFor="global-search" className="visually-hidden">
          Search projects, reports and people
        </label>
        <input
          id="global-search"
          type="search"
          className="search-input"
          placeholder="Search projects, reports, people…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onSearch(e.target.value);
          }}
        />
      </div>

      <div className="app-header__actions">
        <button type="button" className="notification-button" aria-label={`Notifications, ${unread} unread`}>
          <span aria-hidden="true">🔔</span>
          <span className="notification-button__dot" aria-hidden="true">
            {unread}
          </span>
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
