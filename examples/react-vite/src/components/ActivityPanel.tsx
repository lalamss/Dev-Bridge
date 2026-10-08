import type { Activity } from "../data/mock";
import { ActivityItem } from "./ActivityItem";

export function ActivityPanel({ activities }: { activities: Activity[] }) {
  return (
    <section className="panel" aria-labelledby="recent-activity-heading">
      <div className="panel__header">
        <h2 id="recent-activity-heading" className="panel__title">
          Recent activity
        </h2>
        <button type="button" className="link-button">
          View all
        </button>
      </div>
      <ul className="activity-list">
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </ul>
    </section>
  );
}
