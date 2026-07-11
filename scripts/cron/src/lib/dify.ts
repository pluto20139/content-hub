import { supabase } from "./supabase.js";
import { loadBilibiliCookie } from "./content-writer.js";

const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_API_KEY = process.env.DIFY_API_KEY;

/**
 * Helper to fetch Bilibili video description and subtitles.
 * Strict 5 seconds timeout.
 */
async function fetchBilibiliContent(bvid: string, cookie: string | null): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (cookie) {
      headers["Cookie"] = cookie;
    }

    // Step 1: get cid, desc, dynamic
    const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers,
      signal: controller.signal,
    });
    if (!viewRes.ok) throw new Error(`View API returned status ${viewRes.status}`);
    const viewJson: any = await viewRes.json();
    if (viewJson.code !== 0 || !viewJson.data) {
      throw new Error(`View API returned error code ${viewJson.code}: ${viewJson.message}`);
    }

    const cid = viewJson.data.cid;
    const desc = viewJson.data.desc || "";
    const dynamic = viewJson.data.dynamic || "";
    let content = `简介: ${desc}\n动态: ${dynamic}`.trim();

    if (!cid) return content;

    // Step 2: get subtitle list using player/v2
    const playerRes = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, {
      headers,
      signal: controller.signal,
    });
    if (!playerRes.ok) throw new Error(`Player API returned status ${playerRes.status}`);
    const playerJson: any = await playerRes.json();
    if (playerJson.code !== 0 || !playerJson.data) {
      throw new Error(`Player API returned error code ${playerJson.code}: ${playerJson.message}`);
    }

    const subtitles = playerJson.data.subtitle?.subtitles;
    if (Array.isArray(subtitles) && subtitles.length > 0) {
      // Prioritize zh-CN, then zh-Hans, zh-HK, zh-TW, ai-zh, or fall back to the first
      const sub =
        subtitles.find(
          (s: any) =>
            s.lan === "zh-CN" ||
            s.lan === "zh-Hans" ||
            s.lan?.startsWith("zh") ||
            s.lan?.includes("zh") ||
            s.lan?.includes("ai-zh")
        ) || subtitles[0];

      if (sub && sub.subtitle_url) {
        let subtitleUrl = sub.subtitle_url;
        if (subtitleUrl.startsWith("//")) {
          subtitleUrl = "https:" + subtitleUrl;
        }

        // Step 3: fetch subtitle JSON
        const subRes = await fetch(subtitleUrl, { signal: controller.signal });
        if (subRes.ok) {
          const subData: any = await subRes.json();
          if (subData && Array.isArray(subData.body)) {
            const transcript = subData.body.map((item: any) => item.content || "").join(" ");
            if (transcript.trim()) {
              content += `\n字幕录音文本:\n${transcript}`;
            }
          }
        }
      }
    }

    return content;
  } catch (err: any) {
    console.warn(`[DIFY] Failed to fetch Bilibili content for ${bvid}:`, err.message);
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper to fetch YouTube video description and tags.
 * Strict 5 seconds timeout.
 */
async function fetchYoutubeContent(videoId: string): Promise<string> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[DIFY] YOUTUBE_API_KEY is not configured, skipping YouTube content fetching");
    return "";
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `${process.env.SUPABASE_URL}/functions/v1/youtube-proxy/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${apiKey}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`YouTube API returned status ${res.status}`);
    const json: any = await res.json();
    const item = json.items?.[0];
    if (!item) return "";

    const desc = item.snippet?.description || "";
    const tags = Array.isArray(item.snippet?.tags) ? item.snippet.tags.join(", ") : "";
    return `Description:\n${desc}\nTags: ${tags}`.trim();
  } catch (err: any) {
    console.warn(`[DIFY] Failed to fetch YouTube content for ${videoId}:`, err.message);
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Scan database for videos with summary_status = 'pending' and invoke Dify Workflow API to summarize them.
 * Limits execution to 5 videos per run to prevent timeout issues.
 */
export async function processVideoSummaries(): Promise<void> {
  if (!DIFY_API_KEY) {
    console.warn("[DIFY] DIFY_API_KEY is not configured, skipping video summarization");
    return;
  }

  console.log("[DIFY] Scanning for pending video summaries...");

  // 1. Fetch pending video contents
  const { data: videos, error } = await supabase
    .from("contents")
    .select("id,platform,title,original_url,content_type,native_id")
    .eq("content_type", "video")
    .eq("summary_status", "pending")
    .order("published_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[DIFY] Failed to fetch pending videos:", error.message);
    return;
  }

  if (!videos || videos.length === 0) {
    console.log("[DIFY] No pending videos found.");
    return;
  }

  console.log(`[DIFY] Found ${videos.length} videos to summarize.`);

  // Load B站 cookie once to reuse for the B站 video fetches in this run
  const bilibiliCookie = await loadBilibiliCookie().catch((err) => {
    console.warn("[DIFY] Failed to load B站 cookie for summaries:", err.message);
    return null;
  });

  for (const video of videos) {
    console.log(`[DIFY] Processing video (Content ID: ${video.id}): ${video.title} (${video.platform})`);

    // 2. Optimistically update summary_status to 'processing' to avoid concurrency conflicts
    const { error: updateError } = await supabase
      .from("contents")
      .update({ summary_status: "processing" })
      .eq("id", video.id);

    if (updateError) {
      console.error(`[DIFY] Failed to mark video (Content ID: ${video.id}) as processing:`, updateError.message);
      continue;
    }

    try {
      // Step 2.1: Scrape detailed content depending on the platform
      let contentText = "";
      if (video.platform === "bilibili") {
        contentText = await fetchBilibiliContent(video.native_id, bilibiliCookie);
      } else if (video.platform === "youtube") {
        contentText = await fetchYoutubeContent(video.native_id);
      }

      // Truncate if content is too long (limit to 20,000 characters to conserve prompt tokens)
      if (contentText.length > 20000) {
        contentText = contentText.slice(0, 20000) + "... (内容过长已截断)";
      }

      const difyStartTime = Date.now();

      // 3. Make POST request to Dify Workflows API
      const response = await fetch(`${DIFY_API_URL}/workflows/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DIFY_API_KEY}`,
        },
        body: JSON.stringify({
          inputs: {
            url: video.original_url,
            title: video.title,
            platform: video.platform,
            content_type: video.content_type,
            content_text: contentText,
          },
          response_mode: "blocking",
          user: "content-hub-cron",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
      }

      const resData: any = await response.json();
      const durationMs = Date.now() - difyStartTime;

      // 4. Extract summary text from response outputs (flexible matching)
      const outputs = resData.data?.outputs || {};
      const summaryText =
        outputs.summary ||
        outputs.result ||
        outputs.text ||
        outputs.output ||
        Object.values(outputs)[0];

      if (!summaryText || typeof summaryText !== "string") {
        throw new Error(`Invalid outputs structure in Dify response: ${JSON.stringify(outputs)}`);
      }

      // 5. Clean summary text by stripping out <think>...</think> tags if present
      const cleanedSummary = summaryText.replace(/<think>[\s\S]*?<\/think>/, "").trim();

      const { error: successError } = await supabase
        .from("contents")
        .update({
          summary: cleanedSummary,
          summary_status: "success",
          summary_at: new Date().toISOString(),
          summary_duration_ms: durationMs,
        })
        .eq("id", video.id);

      if (successError) {
        throw new Error(`DB write failed: ${successError.message}`);
      }

      console.log(`[DIFY] Video (Content ID: ${video.id}) successfully summarized. (Duration: ${durationMs}ms)`);
    } catch (err: any) {
      console.error(`[DIFY] Video (Content ID: ${video.id}) summarization failed:`, err.message);

      // Revert status to failed so that it can be retried later
      const { error: revertError } = await supabase
        .from("contents")
        .update({ summary_status: "failed" })
        .eq("id", video.id);
      if (revertError) {
        console.error(`[DIFY] Failed to revert video (Content ID: ${video.id}) status to failed:`, revertError.message);
      }
    }
  }
}
