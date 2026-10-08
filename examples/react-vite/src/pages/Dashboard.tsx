import { activities, projects, stats } from "../data/mock";
import { StatCard } from "../components/StatCard";
import { ActivityPanel } from "../components/ActivityPanel";
import { ProjectTable } from "../components/ProjectTable";

export function Dashboard() {
  return (
    <div className="page">
      <section className="welcome" aria-labelledby="dashboard-heading">
        <div>
          <h1 id="dashboard-heading" className="page-title">
            Good morning, Ava
          </h1>
          <p className="page-sub">Here is what is happening across your workspace today.</p>
        </div>
        <div className="welcome__actions">
          <button type="button" className="secondary-button">
            Download report
          </button>
          <button type="button" className="primary-button">
            New project
          </button>
        </div>
      </section>

      <section className="stats-grid" aria-label="Key metrics">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </section>

      <div className="two-col">
        <ActivityPanel activities={activities} />
        <section className="panel" aria-labelledby="priorities-heading">
          <div className="panel__header">
            <h2 id="priorities-heading" className="panel__title">
              Today&apos;s priorities
            </h2>
          </div>
          <ul className="checklist">
            <li className="checklist__item">
              <input type="checkbox" id="task-1" className="checklist__box" defaultChecked />
              <label htmlFor="task-1" className="checklist__label">
                Approve mobile app release notes
              </label>
            </li>
            <li className="checklist__item">
              <input type="checkbox" id="task-2" className="checklist__box" />
              <label htmlFor="task-2" className="checklist__label">
                Review API migration rollback plan
              </label>
            </li>
            <li className="checklist__item">
              <input type="checkbox" id="task-3" className="checklist__box" />
              <label htmlFor="task-3" className="checklist__label">
                Share Q3 report with leadership
              </label>
            </li>
          </ul>
        </section>
      </div>

      <ProjectTable projects={projects.slice(0, 6)} />
    </div>
  );
}
