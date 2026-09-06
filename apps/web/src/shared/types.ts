export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Collection {
  id: string;
  name: string;
  kind: "dates" | "movies" | "custom";
  emoji: string;
  colorKey: "red" | "blue" | "purple" | "charcoal";
  targetPerPerson: number;
  autoSelect: boolean;
  scheduleWeekday: number;
  scheduleTime: string;
  scheduleTimezone: string;
  notifyEnabled: boolean;
  notifyWeekday: number | null;
  notifyTime: string | null;
  notifyTimezone: string | null;
  cycleIndex: number;
  cycleStartDate: string | null;
  availableCount: number;
  totalCount: number;
}

export interface Entry {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  location: string | null;
  cost: "free" | "$" | "$$" | "$$$" | null;
  prep: string | null;
  status: "available" | "selected" | "completed";
  contributorId: string;
  contributorName: string;
  contributorAvatar: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseYear: number | null;
}

export interface Progress {
  target: number;
  contributors: Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    added: number;
    target: number;
  }>;
}

export interface ResultView {
  weeklyResultId: string;
  revision: number;
  title: string;
  description: string | null;
  emoji: string | null;
  location: string | null;
  contributor: string;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId: string | null;
  entryId: string | null;
  reason: string;
}

export interface CurrentState {
  collectionId: string;
  weekIndex: number;
  cycleIndex: number;
  periodStart: string;
  hasResult: boolean;
  completed: boolean;
  availableCount: number;
  revision: number;
  result: ResultView | null;
  action: "spin" | "reveal";
}

export interface HistoryItem {
  periodId: string;
  cycleIndex: number;
  weekIndex: number;
  periodStart: string;
  completed: boolean;
  completedAt: string | null;
  current: { title: string; emoji: string | null; contributor: string; posterPath: string | null };
  rerolls: number;
  revisions: Array<{
    revisionNumber: number;
    title: string;
    emoji: string | null;
    contributor: string;
    reason: string;
    source: string;
    createdAt: string;
  }>;
}

export interface MovieResult {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
}

export interface MovieGenre {
  id: number;
  name: string;
}

export interface PlaceCategory {
  key: string;
  label: string;
}

export interface PlaceResult {
  name: string;
  category: string;
  address: string | null;
  lat: number;
  lon: number;
  mapUrl: string;
}

export interface WhatsAppStatus {
  enabled: boolean;
  status: "disconnected" | "qr" | "connecting" | "connected";
  phone: string | null;
  qr: string | null;
  deliveryMode: "group" | "individuals";
  groupId: string | null;
  recipients: string[];
  /** Activation breakdown — reminders are gated until `activated` is true. */
  hasPhone: boolean;
  linked: boolean;
  hasEmail: boolean;
  activated: boolean;
  note: string;
}
