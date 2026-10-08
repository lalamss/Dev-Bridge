import type { ProjectStatus } from "../data/mock";

const classByStatus: Record<ProjectStatus, string> = {
  "On track": "badge badge--ok",
  "At risk": "badge badge--warn",
  Delayed: "badge badge--bad",
  Completed: "badge badge--done",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={classByStatus[status]}>{status}</span>;
}
