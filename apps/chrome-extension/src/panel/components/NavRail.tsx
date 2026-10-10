/**
 * Left-side navigation rail: Inspect / Components / Files / Settings.
 * Every destination renders a real view with selected-state styling.
 */

import { S } from "../theme";
import type { PanelView } from "../navigation";
import { VIEW_ORDER, VIEWS } from "../navigation";
import { NavIcons } from "./branding";

interface NavRailProps {
  active: PanelView;
  onNavigate: (view: PanelView) => void;
}

export function NavRail({ active, onNavigate }: NavRailProps) {
  return (
    <nav style={S.rail} aria-label="DevBridge sections">
      {VIEW_ORDER.map((id) => {
        const selected = id === active;
        return (
          <button
            key={id}
            className="db-rail-btn"
            style={{ ...S.railBtn, ...(selected ? S.railBtnActive : {}) }}
            onClick={() => onNavigate(id)}
            aria-current={selected ? "page" : undefined}
            aria-label={VIEWS[id].label}
            title={`${VIEWS[id].label} — ${VIEWS[id].hint}`}
          >
            {NavIcons[id]}
            <span>{VIEWS[id].label}</span>
          </button>
        );
      })}
    </nav>
  );
}
