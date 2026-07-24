import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkData() {
  console.log("=== 正在检查数据库 monitors 和 contents 表状态 ===");

  // 1. 查询所有 auth.users 账号
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  console.log("\n[1] 系统注册账号列表:");
  (authUsers?.users || []).forEach(u => console.log(`  - User ID: ${u.id} | Email: ${u.email}`));

  // 2. 查询所有 monitors 记录
  const { data: monitors } = await supabase.from("monitors").select("*");
  console.log(`\n[2] monitors 表中的全部博主 (共 ${monitors?.length ?? 0} 个):`);
  (monitors || []).forEach(m => {
    console.log(`  - Monitor ID: ${m.id} | User ID: ${m.user_id} | Platform: ${m.platform} | NativeID: ${m.native_id} | Name: ${m.display_name} | Active: ${m.is_active} | FailCount: ${m.fail_count} | Status: ${m.status}`);
  });

  // 3. 查询 contents 表中的全部内容
  const { data: contents } = await supabase.from("contents").select("id, user_id, platform, native_id, title, published_at, created_at").order("created_at", { ascending: false }).limit(20);
  console.log(`\n[3] contents 表最新的推文/文章/视频 (共 ${contents?.length ?? 0} 条):`);
  (contents || []).forEach(c => {
    console.log(`  - Content ID: ${c.id} | User ID: ${c.user_id} | Platform: ${c.platform} | NativeID: ${c.native_id} | Title: ${c.title?.slice(0, 40)}...`);
  });
}

checkData();
