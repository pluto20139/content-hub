import { run } from "../index.js";
import { releaseLock } from "../lib/lock.js";

async function main() {
  console.log("Forcing lock release...");
  await releaseLock();
  console.log("Lock released! Starting cron sync run...");
  const result = await run();
  console.log("Cron run finished. Result:", JSON.stringify(result));
}

main().catch(console.error);
