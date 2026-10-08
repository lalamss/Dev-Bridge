import type { Project } from "../data/mock";
import { StatusBadge } from "./StatusBadge";
import { ProgressBar } from "./ProgressBar";

export function ProjectRow({ project }: { project: Project }) {
  return (
    <tr className="table__row">
      <td className="table__cell">
        <p className="project-name">{project.name}</p>
        <p className="project-desc">{project.description}</p>
      </td>
      <td className="table__cell">
        <span className="owner">
          <span className="avatar avatar--sm" aria-hidden="true">
            {project.ownerInitials}
          </span>
          {project.owner}
        </span>
      </td>
      <td className="table__cell">
        <StatusBadge status={project.status} />
      </td>
      <td className="table__cell">
        <ProgressBar value={project.progress} label={`${project.name} progress`} />
      </td>
      <td className="table__cell table__cell--muted">{project.updated}</td>
      <td className="table__cell table__cell--right">
        <button type="button" className="icon-button" aria-label={`Open ${project.name}`}>
          ↗
        </button>
        <button type="button" className="icon-button" aria-label={`More actions for ${project.name}`}>
          ⋯
        </button>
      </td>
    </tr>
  );
}
