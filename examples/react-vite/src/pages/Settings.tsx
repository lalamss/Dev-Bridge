import { useState, type FormEvent } from "react";

export function Settings() {
  const [saved, setSaved] = useState(false);
  const [emailDigest, setEmailDigest] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(false);
  const [theme, setTheme] = useState("system");

  function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="page">
      <section className="page-head" aria-labelledby="settings-heading">
        <div>
          <h1 id="settings-heading" className="page-title">
            Settings
          </h1>
          <p className="page-sub">Manage your profile, notifications and appearance.</p>
        </div>
      </section>

      <form className="settings-form" onSubmit={handleSave}>
        <section className="panel" aria-labelledby="profile-heading">
          <div className="panel__header">
            <h2 id="profile-heading" className="panel__title">
              Profile
            </h2>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="full-name" className="form-label">
                Full name
              </label>
              <input id="full-name" name="fullName" className="text-input" defaultValue="Ava Rossi" autoComplete="name" />
            </div>
            <div className="form-field">
              <label htmlFor="email" className="form-label">
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="text-input"
                defaultValue="ava@northwind.studio"
                autoComplete="email"
              />
            </div>
            <div className="form-field form-field--full">
              <label htmlFor="role" className="form-label">
                Role
              </label>
              <input id="role" name="role" className="text-input" defaultValue="Operations lead" />
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="notifications-heading">
          <div className="panel__header">
            <h2 id="notifications-heading" className="panel__title">
              Notifications
            </h2>
          </div>
          <div className="toggle-list">
            <div className="toggle-row">
              <div>
                <p className="toggle-row__title">Weekly email digest</p>
                <p className="toggle-row__sub">A summary of project activity every Monday.</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={emailDigest} onChange={(e) => setEmailDigest(e.target.checked)} />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
                <span className="visually-hidden">Toggle weekly email digest</span>
              </label>
            </div>
            <div className="toggle-row">
              <div>
                <p className="toggle-row__title">Push alerts for at-risk projects</p>
                <p className="toggle-row__sub">Notify me when a project slips behind.</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={pushAlerts} onChange={(e) => setPushAlerts(e.target.checked)} />
                <span className="switch__track" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
                <span className="visually-hidden">Toggle push alerts for at-risk projects</span>
              </label>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="appearance-heading">
          <div className="panel__header">
            <h2 id="appearance-heading" className="panel__title">
              Appearance
            </h2>
          </div>
          <fieldset className="radio-group">
            <legend className="form-label">Theme</legend>
            {[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ].map((option) => (
              <label key={option.value} className="radio-row">
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme === option.value}
                  onChange={(e) => setTheme(e.target.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </section>

        <div className="settings-footer">
          {saved && (
            <p className="save-note" role="status">
              Settings saved
            </p>
          )}
          <button type="submit" className="primary-button">
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
