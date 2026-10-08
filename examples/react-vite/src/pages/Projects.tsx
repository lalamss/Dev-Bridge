import { useMemo, useState } from "react";
import { projects, type ProjectStatus } from "../data/mock";
import { ProjectTable } from "../components/ProjectTable";

type Filter = "All" | ProjectStatus;

const filters: Filter[] = ["All", "On track", "At risk", "Delayed", "Completed"];

export function Projects() {
  const [filter, setFilter] = useState<Filter>("All");

  const visible = useMemo(
    () => (filter === "All" ? projects : projects.filter((p) => p.status === filter)),
    [filter],
  );

  return (
    <div className="page">
      <section aria-labelledby="projects-page-heading" className="page-head">
        <div>
          <h1 id="projects-page-heading" className="page-title">
            Projects
          </h1>
          <p className="page-sub">
            {visible.length} of {projects.length} projects · filtered by {filter}
          </p>
        </div>
        <button type="button" className="primary-button">
          New project
        </button>
      </section>

      <div className="filter-row" role="group" aria-label="Filter projects by status">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? "chip chip--active" : "chip"}
            aria-pressed={f === filter}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <ProjectTable projects={visible} headingId="projects-page-table-heading" />
    </div>
  );
}
