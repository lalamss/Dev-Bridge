import type { Stat } from "../data/mock";

export function StatCard({ stat }: { stat: Stat }) {
  const trendClass = stat.changeDirection === "up" ? "trend trend--up" : "trend trend--down";
  const arrow = stat.changeDirection === "up" ? "▲" : "▼";

  return (
    <article className="stat-card">
      <h3 className="stat-card__title">{stat.label}</h3>
      <p className="stat-card__value">{stat.value}</p>
      <p className="stat-card__meta">
        <span className={trendClass}>
          <span aria-hidden="true">{arrow}</span> {stat.change}
        </span>
        <span className="stat-card__hint">{stat.hint}</span>
      </p>
    </article>
  );
}
