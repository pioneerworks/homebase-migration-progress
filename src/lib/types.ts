export type Source = "linear" | "fallback";
export type PageStatus = "done" | "active" | "backlog" | "canceled";

export interface ProjectConfig {
  id: string;
  key: string;
  name: string;
  shortName: string;
  url: string;
}

export interface PageRecord {
  path: string;
  title: string;
  ticket: string;
  ticketUrl: string;
  liveUrl: string;
  pillar: string;
  pillarName: string;
  status: PageStatus;
  stateName: string;
  updatedAt: string;
  completedAt: string | null;
  labels: string[];
}

export interface PillarProgress {
  id: string;
  name: string;
  shortName: string;
  url: string;
  done: number;
  active: number;
  backlog: number;
  canceled: number;
  total: number;
}

export interface TrackedIssue {
  id: string;
  title: string;
  status: string;
  summary: string;
  url: string;
  updatedAt: string;
  labels: string[];
}

export interface StatusCounts {
  total: number;
  done: number;
  active: number;
  backlog: number;
  canceled: number;
}

export interface BlogMigration {
  estimatedPosts: number | null;
  status: PageStatus;
  stateName: string;
  primaryIssue: TrackedIssue | null;
  openFollowUps: TrackedIssue[];
}

export interface Snapshot {
  generatedAt: string;
  source: Source;
  warning?: string;
  overall: StatusCounts & {
    completion: number;
    recentlyCompleted: number;
  };
  pillars: PillarProgress[];
  pages: PageRecord[];
  recentActivity: PageRecord[];
  blogMigration: BlogMigration;
  decisions: {
    projectUrl: string;
    counts: StatusCounts;
    recent: TrackedIssue[];
    questions: TrackedIssue[];
  };
}
