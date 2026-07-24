import { supabase } from "../lib/supabase.js";

async function checkData() {
  console.log("=== 正在检查数据库 monitors 和 contents 表状态 ===");

  const { data: monitors, error: mErr } = await supabase.from("monitors").select("*");
  if (mErr) console.error("Monitors query error:", mErr);
  console.log(`\n[1] monitors 表中的全部博主 (共 ${monitors?.length ?? 0} 个):`);
  (monitors || []).forEach(m => {
    console.log(`  - Monitor ID: ${m.id} | User ID: ${m.user_id} | Platform: ${m.platform} | NativeID: ${m.native_id} | Name: ${m.display_name} | Active: ${m.is_active} | FailCount: ${m.fail_count} | Status: ${m.status}`);
  });

  const { data: contents, error: cErr } = await supabase.from("contents").select("id, user_id, platform, native_id, title, published_at, created_at").order("created_at", { ascending: false }).limit(20);
  if (cErr) console.error("Contents query error:", cErr);
  console.log(`\n[2] contents 表最新的抓取内容 (共 ${contents?.length ?? 0} 条):`);
  (contents || []).forEach(c => {
    console.log(`  - Content ID: ${c.id} | User ID: ${c.user_id} | Platform: ${c.platform} | NativeID: ${c.native_id} | Title: ${c.title?.slice(0, 40)}...`);
  });
}

checkData();
