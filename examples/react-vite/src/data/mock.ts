export type NavKey = "dashboard" | "projects" | "analytics" | "settings";

export interface Stat {
  id: string;
  label: string;
  value: string;
  change: string;
  changeDirection: "up" | "down";
  hint: string;
}

export interface Activity {
  id: string;
  actor: string;
  initials: string;
  action: string;
  target: string;
  time: string;
}

export type ProjectStatus = "On track" | "At risk" | "Delayed" | "Completed";

export interface Project {
  id: string;
  name: string;
  description: string;
  owner: string;
  ownerInitials: string;
  status: ProjectStatus;
  progress: number;
  updated: string;
}

export const stats: Stat[] = [
  {
    id: "revenue",
    label: "Revenue",
    value: "$128,430",
    change: "+12.5%",
    changeDirection: "up",
    hint: "vs last month",
  },
  {
    id: "active-users",
    label: "Active users",
    value: "24,892",
    change: "+8.2%",
    changeDirection: "up",
    hint: "vs last month",
  },
  {
    id: "orders",
    label: "Orders",
    value: "3,417",
    change: "-2.4%",
    changeDirection: "down",
    hint: "vs last month",
  },
  {
    id: "conversion",
    label: "Conversion rate",
    value: "4.8%",
    change: "+0.6 pts",
    changeDirection: "up",
    hint: "vs last month",
  },
];

export const activities: Activity[] = [
  {
    id: "act-1",
    actor: "Maya Chen",
    initials: "MC",
    action: "merged a pull request in",
    target: "Website redesign",
    time: "12 min ago",
  },
  {
    id: "act-2",
    actor: "Tomas Rivera",
    initials: "TR",
    action: "commented on",
    target: "Mobile app v2",
    time: "48 min ago",
  },
  {
    id: "act-3",
    actor: "Priya Nair",
    initials: "PN",
    action: "moved 4 tasks to Done in",
    target: "API gateway migration",
    time: "2 hrs ago",
  },
  {
    id: "act-4",
    actor: "Jonas Weber",
    initials: "JW",
    action: "published a report in",
    target: "Q3 growth analytics",
    time: "5 hrs ago",
  },
  {
    id: "act-5",
    actor: "Sofia Almeida",
    initials: "SA",
    action: "invited 3 teammates to",
    target: "Customer portal",
    time: "Yesterday",
  },
];

export const projects: Project[] = [
  {
    id: "prj-1",
    name: "Website redesign",
    description: "Marketing site overhaul",
    owner: "Maya Chen",
    ownerInitials: "MC",
    status: "On track",
    progress: 82,
    updated: "Oct 7, 2026",
  },
  {
    id: "prj-2",
    name: "Mobile app v2",
    description: "iOS & Android release",
    owner: "Tomas Rivera",
    ownerInitials: "TR",
    status: "At risk",
    progress: 47,
    updated: "Oct 6, 2026",
  },
  {
    id: "prj-3",
    name: "API gateway migration",
    description: "Edge routing cutover",
    owner: "Priya Nair",
    ownerInitials: "PN",
    status: "On track",
    progress: 64,
    updated: "Oct 5, 2026",
  },
  {
    id: "prj-4",
    name: "Customer portal",
    description: "Self-serve billing",
    owner: "Sofia Almeida",
    ownerInitials: "SA",
    status: "Delayed",
    progress: 28,
    updated: "Oct 3, 2026",
  },
  {
    id: "prj-5",
    name: "Q3 growth analytics",
    description: "Funnel & retention",
    owner: "Jonas Weber",
    ownerInitials: "JW",
    status: "Completed",
    progress: 100,
    updated: "Sep 29, 2026",
  },
  {
    id: "prj-6",
    name: "Design system v3",
    description: "Tokens & components",
    owner: "Maya Chen",
    ownerInitials: "MC",
    status: "On track",
    progress: 71,
    updated: "Sep 27, 2026",
  },
  {
    id: "prj-7",
    name: "Notification service",
    description: "Email & push pipeline",
    owner: "Priya Nair",
    ownerInitials: "PN",
    status: "At risk",
    progress: 39,
    updated: "Sep 24, 2026",
  },
];
