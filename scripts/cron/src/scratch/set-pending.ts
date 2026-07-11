import { supabase } from "../lib/supabase.js";
import { processVideoSummaries } from "../lib/dify.js";

async function main() {
  console.log("Fetching the latest video from the database...");
  const { data: videos, error } = await supabase
    .from("contents")
    .select("id,title,platform,summary_status")
    .eq("content_type", "video")
    .order("published_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Failed to fetch latest video:", error.message);
    process.exit(1);
  }

  if (!videos || videos.length === 0) {
    console.log("No videos found in the database.");
    process.exit(0);
  }

  const latestVideo = videos[0];
  console.log(`Found latest video: [ID: ${latestVideo.id}] "${latestVideo.title}" (${latestVideo.platform})`);
  console.log(`Current status: ${latestVideo.summary_status}`);

  console.log("Updating summary_status to 'pending'...");
  const { error: updateError } = await supabase
    .from("contents")
    .update({ summary_status: "pending" })
    .eq("id", latestVideo.id);

  if (updateError) {
    console.error("Failed to update video status:", updateError.message);
    process.exit(1);
  }

  console.log("Successfully set status to 'pending'!");
  console.log("Invoking Dify summarization function now...");
  await processVideoSummaries();
  console.log("Execution finished.");
}

main().catch(console.error);
