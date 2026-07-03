import cron from "node-cron";
import { run } from "./index.js";

const CRON_SCHEDULE = "*/30 * * * *"; // 每 30 分钟

async function main(): Promise<void> {
  console.log(`[SCHEDULER] Cron scheduled: ${CRON_SCHEDULE}`);

  // 启动时立即跑一次
  await run().catch((err) => console.error("[SCHEDULER] Initial run failed:", err));

  // 注册定时任务
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[SCHEDULER] Tick at ${new Date().toISOString()}`);
    try {
      await run();
    } catch (err) {
      console.error("[SCHEDULER] Run failed:", err);
    }
  });
}

main().catch((err) => {
  console.error("[SCHEDULER] Fatal:", err);
  process.exit(1);
});
