const weekly = [
  { label: "Mon", value: 42 },
  { label: "Tue", value: 58 },
  { label: "Wed", value: 51 },
  { label: "Thu", value: 74 },
  { label: "Fri", value: 66 },
  { label: "Sat", value: 31 },
  { label: "Sun", value: 24 },
];

const channels = [
  { name: "Organic search", share: 38 },
  { name: "Direct", share: 24 },
  { name: "Referral", share: 18 },
  { name: "Social", share: 12 },
  { name: "Email", share: 8 },
];

const max = Math.max(...weekly.map((d) => d.value));

export function Analytics() {
  return (
    <div className="page">
      <section className="page-head" aria-labelledby="analytics-heading">
        <div>
          <h1 id="analytics-heading" className="page-title">
            Analytics
          </h1>
          <p className="page-sub">Traffic and conversion for the last 7 days.</p>
        </div>
        <div className="welcome__actions">
          <button type="button" className="secondary-button">
            Last 7 days
          </button>
          <button type="button" className="primary-button">
            Export
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="traffic-heading">
        <div className="panel__header">
          <h2 id="traffic-heading" className="panel__title">
            Sessions by day
          </h2>
          <p className="panel__sub">Total: 12,480 sessions</p>
        </div>
        <div className="bars" role="img" aria-label="Bar chart of sessions by day, peak on Thursday">
          {weekly.map((day) => (
            <div key={day.label} className="bar-col">
              <div className="bar-col__track">
                <div className="bar-col__fill" style={{ height: `${Math.round((day.value / max) * 100)}%` }} />
              </div>
              <span className="bar-col__label">{day.label}</span>
              <span className="visually-hidden">
                {day.label}: {day.value * 100} sessions
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel" aria-labelledby="channels-heading">
          <div className="panel__header">
            <h2 id="channels-heading" className="panel__title">
              Acquisition channels
            </h2>
          </div>
          <ul className="channel-list">
            {channels.map((channel) => (
              <li key={channel.name} className="channel-list__item">
                <div className="channel-list__row">
                  <span className="channel-list__name">{channel.name}</span>
                  <span className="channel-list__share">{channel.share}%</span>
                </div>
                <div className="progress__track">
                  <div className="progress__fill" style={{ width: `${channel.share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="insights-heading">
          <div className="panel__header">
            <h2 id="insights-heading" className="panel__title">
              Insights
            </h2>
          </div>
          <ul className="insight-list">
            <li className="insight-list__item">
              <p className="insight-list__title">Checkout conversion recovered</p>
              <p className="insight-list__text">Mobile conversion is up 1.2 pts after the v2.1 fix.</p>
            </li>
            <li className="insight-list__item">
              <p className="insight-list__title">Thursday peak traffic</p>
              <p className="insight-list__text">Newsletter sends correlate with a 44% session lift.</p>
            </li>
            <li className="insight-list__item">
              <p className="insight-list__title">Referral quality improving</p>
              <p className="insight-list__text">Referral bounce rate dropped 6 pts week over week.</p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
