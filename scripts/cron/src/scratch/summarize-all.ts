import { supabase } from "../lib/supabase.js";

const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_API_KEY = process.env.DIFY_API_KEY;

async function main() {
  if (!DIFY_API_KEY) {
    console.error("DIFY_API_KEY is not configured.");
    process.exit(1);
  }

  console.log("Fetching all content cards that are not yet summarized successfully...");
  const { data: items, error } = await supabase
    .from("contents")
    .select("id,platform,title,original_url,content_type,summary_status")
    .not("summary_status", "eq", "success")
    .order("published_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch contents:", error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log("No unsummarized content found in the database.");
    process.exit(0);
  }

  console.log(`Found ${items.length} unsummarized items. Starting batch processing...`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`[${i + 1}/${items.length}] Processing item ${item.id}: "${item.title}" (${item.content_type})`);

    // Update status to processing
    await supabase
      .from("contents")
      .update({ summary_status: "processing" })
      .eq("id", item.id);

    try {
      const response = await fetch(`${DIFY_API_URL}/workflows/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DIFY_API_KEY}`,
        },
        body: JSON.stringify({
          inputs: {
            url: item.original_url,
            title: item.title,
            platform: item.platform,
            content_type: item.content_type,
          },
          response_mode: "blocking",
          user: "content-hub-batch-runner",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
      }

      const resData: any = await response.json();
      const outputs = resData.data?.outputs || {};
      const summaryText =
        outputs.summary ||
        outputs.result ||
        outputs.text ||
        outputs.output ||
        Object.values(outputs)[0];

      if (!summaryText || typeof summaryText !== "string") {
        throw new Error("Invalid output structure");
      }

      const cleanedSummary = summaryText.replace(/<think>[\s\S]*?<\/think>/, "").trim();

      const { error: saveError } = await supabase
        .from("contents")
        .update({
          summary: cleanedSummary,
          summary_status: "success",
        })
        .eq("id", item.id);

      if (saveError) throw saveError;
      console.log(`Successfully summarized item ${item.id}`);

    } catch (err: any) {
      console.error(`Failed to summarize item ${item.id}:`, err.message);
      await supabase
        .from("contents")
        .update({ summary_status: "failed" })
        .eq("id", item.id);
    }

    // Add a 1.5s delay between requests to be gentle on Dify/APIs
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log("All items processed successfully!");
}

main().catch(console.error);
