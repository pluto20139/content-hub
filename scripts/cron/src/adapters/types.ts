export type Platform = "bilibili" | "youtube" | "zhihu";
export type MonitorStatus = "normal" | "cookie_expired" | "rate_limited";
export type ContentType = "video" | "article" | "question" | "answer" | "post";

export interface Monitor {
  id: number;
  platform: Platform;
  native_id: string;
  display_name: string;
  name_auto: boolean;
  original_url: string;
  is_active: boolean;
  last_sync_at: string | null;
  last_content_at: string;
  fail_count: number;
  status: MonitorStatus;
  created_at: string;
}

export interface RawContent {
  platform: Platform;
  native_id: string;
  content_type: ContentType;
  title: string;
  cover_url: string | null;
  original_url: string;
  published_at: string;
}

export interface CronResult {
  totalMonitors: number;
  successCount: number;
  failCount: number;
  newContentCount: number;
  duration: number;
}

export interface PlatformResult {
  skipped: boolean;
  reason?: string;
  monitors: Monitor[];
  results: Array<{ monitor: Monitor; contents: RawContent[]; error?: string }>;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  fetchLatest(monitor: Monitor): Promise<RawContent[]>;
  fetchDisplayName(monitor: Monitor): Promise<string | null>;
  fetchAll(monitors: Monitor[]): Promise<PlatformResult>;
}

export interface ContentWriter {
  upsert(content: RawContent, monitorId: number): Promise<boolean>;
  updateMonitorStatus(
    monitorId: number,
    updates: { status: MonitorStatus; failCount: number; lastSync: boolean; newContent: boolean },
  ): Promise<void>;
  updateDisplayName(monitorId: number, displayName: string): Promise<void>;
}
