import { useEffect, useRef, useState } from "react";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          AR
        </span>
        <span className="user-menu__name">Ava Rossi</span>
        <span aria-hidden="true" className="user-menu__chevron">
          ▾
        </span>
      </button>
      {open && (
        <ul className="user-menu__dropdown" role="menu" aria-label="User menu">
          <li role="none">
            <button type="button" role="menuitem" className="user-menu__item">
              Profile
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="user-menu__item">
              Team settings
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="user-menu__item">
              Billing
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="user-menu__item user-menu__item--danger">
              Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
