import type { Project } from "../data/mock";
import { ProjectRow } from "./ProjectRow";

export function ProjectTable({ projects, headingId = "projects-heading" }: { projects: Project[]; headingId?: string }) {
  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__header">
        <h2 id={headingId} className="panel__title">
          Projects
        </h2>
        <button type="button" className="secondary-button">
          New project
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="table__head">
                Project name
              </th>
              <th scope="col" className="table__head">
                Owner
              </th>
              <th scope="col" className="table__head">
                Status
              </th>
              <th scope="col" className="table__head">
                Progress
              </th>
              <th scope="col" className="table__head">
                Updated
              </th>
              <th scope="col" className="table__head table__head--right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
