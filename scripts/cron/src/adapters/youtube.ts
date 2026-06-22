import type { PlatformAdapter, Monitor, RawContent, PlatformResult } from "./types";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export class YoutubeAdapter implements PlatformAdapter {
  readonly platform = "youtube" as const;

  private get apiKey(): string {
    return process.env.YOUTUBE_API_KEY ?? "";
  }

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    if (!this.apiKey) throw new Error("YouTube API Key 未配置");

    // Step 1: Get uploads playlist ID
    const channelRes = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(monitor.native_id)}&key=${this.apiKey}`,
    );

    if (!channelRes.ok) {
      const body = await channelRes.json();
      const isQuotaExceeded =
        channelRes.status === 403 &&
        body.error?.errors?.some((e: any) => e.reason === "quotaExceeded");
      if (isQuotaExceeded) {
        const err = new Error("YouTube API 配额已用尽");
        (err as any).isPlatformLevel = true;
        throw err;
      }
      throw new Error(`YouTube channels API error: ${channelRes.status}`);
    }

    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error("Failed to get uploads playlist ID");

    // Step 2: Get latest videos from uploads playlist
    const playlistRes = await fetch(
      `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=6&key=${this.apiKey}`,
    );

    if (!playlistRes.ok) throw new Error(`YouTube playlistItems API error: ${playlistRes.status}`);

    const playlistData = await playlistRes.json();
    return (playlistData.items ?? []).map((item: any) => {
      const snippet = item.snippet ?? {};
      const videoId = snippet.resourceId?.videoId ?? "";
      return {
        platform: "youtube" as const,
        native_id: videoId,
        content_type: "video" as const,
        title: snippet.title ?? "",
        cover_url: (snippet.thumbnails?.maxres?.url ?? snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? "")
          .replace(/^http:/, "https:") || null,
        original_url: `https://www.youtube.com/watch?v=${videoId}`,
        published_at: snippet.publishedAt ?? new Date().toISOString(),
      };
    });
  }

  async fetchDisplayName(monitor: Monitor): Promise<string | null> {
    try {
      const res = await fetch(
        `${YOUTUBE_API_BASE}/channels?part=snippet&id=${encodeURIComponent(monitor.native_id)}&key=${this.apiKey}`,
      );
      const data = await res.json();
      return data.items?.[0]?.snippet?.title ?? null;
    } catch {
      return null;
    }
  }

  async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
    if (monitors.length === 0) return { skipped: false, monitors: [], results: [] };

    try {
      await this.fetchLatest(monitors[0]);
    } catch (err: any) {
      if (err.isPlatformLevel) {
        return { skipped: true, reason: "YouTube API 配额已用尽，跳过整组", monitors, results: [] };
      }
    }

    const results: PlatformResult["results"] = [];
    for (const monitor of monitors) {
      try {
        const contents = await this.fetchLatest(monitor);
        results.push({ monitor, contents });
      } catch (err: any) {
        results.push({ monitor, contents: [], error: err.message });
      }
    }

    return { skipped: false, monitors, results };
  }
}
