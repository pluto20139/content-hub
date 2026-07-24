import { XAdapter } from "../adapters/x.js";

async function testXFetch() {
  console.log("=== 测试 XAdapter 实际抓取 elonmusk ===");
  const adapter = new XAdapter();

  const mockMonitor: any = {
    id: 22,
    user_id: "b13860c0-415c-4a28-9a1a-1f6fee2855d2",
    platform: "x",
    native_id: "elonmusk",
    display_name: "@elonmusk",
    original_url: "https://x.com/elonmusk",
    is_active: true,
    last_sync_at: null,
    last_content_at: "2026-07-20T00:00:00Z",
    fail_count: 0,
    status: "normal",
    created_at: new Date().toISOString(),
  };

  try {
    const rawContents = await adapter.fetchLatest(mockMonitor);
    console.log(`\n抓取到 ${rawContents.length} 条推文:`);
    rawContents.slice(0, 5).forEach((item, i) => {
      console.log(`  [${i + 1}] Title: ${item.title?.slice(0, 50)} | NativeID: ${item.native_id} | URL: ${item.original_url}`);
    });
  } catch (err: any) {
    console.error("XAdapter fetch failed:", err.message);
  }
}

testXFetch();
