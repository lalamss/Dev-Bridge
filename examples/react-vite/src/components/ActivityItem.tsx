import type { Activity } from "../data/mock";

export function ActivityItem({ activity }: { activity: Activity }) {
  return (
    <li className="activity-item">
      <span className="avatar" aria-hidden="true">
        {activity.initials}
      </span>
      <div className="activity-item__body">
        <p className="activity-item__text">
          <strong>{activity.actor}</strong> {activity.action} <strong>{activity.target}</strong>
        </p>
        <p className="activity-item__time">{activity.time}</p>
      </div>
    </li>
  );
}
