import { supabase } from "../lib/supabase.js";
import { processSummaries } from "../lib/dify.js";

const isAllMode = process.argv.includes("--all");

async function runTestSummaries() {
  console.log("Fetching 3 existing videos from database to re-summarize (test mode)...");

  const { data: bVideos, error: bErr } = await supabase
    .from("contents")
    .select("id,title,platform,native_id")
    .eq("platform", "bilibili")
    .eq("content_type", "video")
    .limit(2);

  const { data: yVideos, error: yErr } = await supabase
    .from("contents")
    .select("id,title,platform,native_id")
    .eq("platform", "youtube")
    .eq("content_type", "video")
    .limit(1);

  if (bErr || yErr) {
    console.error("Failed to query videos:", bErr?.message || yErr?.message);
    return;
  }

  const targetVideos = [...(bVideos || []), ...(yVideos || [])];
  if (targetVideos.length === 0) {
    console.log("No videos found in the database to process.");
    return;
  }

  const targetIds = targetVideos.map(v => v.id);
  console.log(`Selected target videos (IDs: ${targetIds.join(", ")}):`);
  targetVideos.forEach(v => console.log(`- [${v.platform.toUpperCase()}] ID ${v.id}: ${v.title} (${v.native_id})`));

  console.log("\nResetting summary_status to 'pending' for these videos...");
  const { error: updateErr } = await supabase
    .from("contents")
    .update({
      summary_status: "pending",
      summary: null,
      summary_at: null,
      summary_duration_ms: null,
    })
    .in("id", targetIds);

  if (updateErr) {
    console.error("Failed to update status to pending:", updateErr.message);
    return;
  }

  console.log("Running processSummaries('all')...");
  await processSummaries("all");

  console.log("\nQuerying results...");
  const { data: results, error: resErr } = await supabase
    .from("contents")
    .select("id,platform,title,summary_status,summary,summary_at,summary_duration_ms")
    .in("id", targetIds);

  if (resErr || !results) {
    console.error("Failed to fetch results:", resErr?.message);
    return;
  }

  console.log("\n=== SUMMARY GENERATION RESULTS ===");
  results.forEach(r => {
    console.log(`\nID ${r.id} [${r.platform.toUpperCase()}]: ${r.title}`);
    console.log(`Status: ${r.summary_status}`);
    console.log(`Duration: ${r.summary_duration_ms}ms`);
    console.log(`Summary: ${r.summary}`);
  });
}

async function runAllSummaries() {
  const MAX_BATCHES = 100; // safety: 100 batches × 5 = 500 contents max
  const startTime = Date.now();

  console.log("=== ALL MODE: Regenerate summaries for all contents ===");

  // 1. Count total contents
  const { count: total, error: cntErr } = await supabase
    .from("contents")
    .select("id", { count: "exact", head: true })
    .in("content_type", ["video", "article", "question", "answer", "post"]);

  if (cntErr) {
    console.error("Failed to count contents:", cntErr.message);
    return;
  }
  console.log(`Total contents in DB: ${total}`);

  // 2. Reset all success/failed contents to pending
  console.log("Resetting all (success|failed) contents to pending...");
  const { error: resetErr, count: resetCount } = await supabase
    .from("contents")
    .update({
      summary_status: "pending",
      summary: null,
      summary_at: null,
      summary_duration_ms: null,
    }, { count: "exact" })
    .in("content_type", ["video", "article", "question", "answer", "post"])
    .in("summary_status", ["success", "failed"]);

  if (resetErr) {
    console.error("Failed to reset:", resetErr.message);
    return;
  }
  console.log(`Reset ${resetCount ?? "?"} contents to pending.`);

  // 3. Loop processSummaries('all') until no more pending
  let batchNum = 0;
  while (true) {
    const { count: pending, error: pendErr } = await supabase
      .from("contents")
      .select("id", { count: "exact", head: true })
      .in("content_type", ["video", "article", "question", "answer", "post"])
      .eq("summary_status", "pending");

    if (pendErr) {
      console.error("Failed to check pending:", pendErr.message);
      return;
    }
    if (!pending || pending === 0) {
      console.log("No more pending contents. Done.");
      break;
    }

    batchNum++;
    console.log(`\n--- Batch ${batchNum}: ${pending} pending ---`);
    try {
      await processSummaries("all");
    } catch (err: any) {
      console.error(`Batch ${batchNum} threw error:`, err.message);
      // continue to next batch
    }

    if (batchNum >= MAX_BATCHES) {
      console.warn(`Hit MAX_BATCHES=${MAX_BATCHES}, stopping loop (safety).`);
      break;
    }
  }

  // 4. Final report
  const { data: results, error: resErr } = await supabase
    .from("contents")
    .select("id,platform,title,summary_status,summary_at,summary_duration_ms")
    .in("content_type", ["video", "article", "question", "answer", "post"])
    .order("published_at", { ascending: false });

  if (resErr) {
    console.error("Failed to fetch final results:", resErr.message);
    return;
  }

  const byStatus: Record<string, number> = {};
  for (const r of results || []) {
    byStatus[r.summary_status || "(null)"] = (byStatus[r.summary_status || "(null)"] || 0) + 1;
  }

  console.log("\n=== FINAL REPORT ===");
  console.log(`Total elapsed: ${Date.now() - startTime}ms`);
  console.log(`Batches run: ${batchNum}`);
  console.log(`By status:`, byStatus);
  console.log(`\nPer-content results:`);
  for (const r of results || []) {
    console.log(`- [${r.platform.toUpperCase()}] ID ${r.id}: ${r.summary_status} (${r.summary_duration_ms ?? "-"}ms) | ${r.title}`);
  }
}

if (isAllMode) {
  runAllSummaries().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  runTestSummaries().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
