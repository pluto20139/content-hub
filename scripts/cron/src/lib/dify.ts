import { supabase } from "./supabase.js";

const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_API_KEY = process.env.DIFY_API_KEY;

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
    .select("id,platform,title,original_url,content_type")
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
          },
          response_mode: "blocking",
          user: "content-hub-cron",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
      }

      const resData: any = await response.json();

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

      // 5. Clean summary text by stripping out <think>...</think> tags if present (from DeepSeek/reasoning models)
      const cleanedSummary = summaryText.replace(/<think>[\s\S]*?<\/think>/, "").trim();

      const { error: successError } = await supabase
        .from("contents")
        .update({
          summary: cleanedSummary,
          summary_status: "success",
        })
        .eq("id", video.id);

      if (successError) {
        throw new Error(`DB write failed: ${successError.message}`);
      }

      console.log(`[DIFY] Video (Content ID: ${video.id}) successfully summarized.`);
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
