import { parseXUrl, getDeepLink, PLATFORMS } from "../packages/shared/dist/index.js";
import { XAdapter } from "../scripts/cron/dist/adapters/x.js";

console.log("=== 正在启动 2.0 动态门禁验收测试 ===");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

// 1. 测试 X (Twitter) URL 解析逻辑
console.log("\n[模块 1] X (Twitter) URL / Handle 解析关卡:");

const res1 = parseXUrl("https://x.com/elonmusk");
assert(res1 && res1.handle === "elonmusk", "解析标准 X 主页链接 (https://x.com/elonmusk)");

const res2 = parseXUrl("https://twitter.com/OpenAI?s=20");
assert(res2 && res2.handle === "OpenAI", "解析 Twitter 带 Query 链接 (https://twitter.com/OpenAI?s=20)");

const res3 = parseXUrl("https://mobile.x.com/satyanadella");
assert(res3 && res3.handle === "satyanadella", "解析移动端域名链接 (https://mobile.x.com/satyanadella)");

const res4 = parseXUrl("@sama");
assert(res4 && res4.handle === "sama", "解析 @handle 账号 (@sama)");

const res5 = parseXUrl("https://x.com/home");
assert(res5 === null, "拦截系统保留字 URL (https://x.com/home)");

// 2. 测试 DeepLink 及 平台表达配置
console.log("\n[模块 2] DeepLink 与 平台UI参数关卡:");

assert(PLATFORMS.x && PLATFORMS.x.name === "X (推特)" && PLATFORMS.x.brandColor === "#0F1419", "X 平台 UI 配置存在且颜色正确");

const deepLink = getDeepLink("x", "post", "18123456789", { monitorNativeId: "elonmusk" });
assert(deepLink === "https://x.com/elonmusk/status/18123456789", "X 平台 DeepLink 生成准确");

// 3. 测试 XAdapter 动态 RSS 解析与 XML 反转义
console.log("\n[模块 3] XAdapter 动态 XML 清洗与数据转换关卡:");

const adapter = new XAdapter();
const testXml = `
<rss version="2.0">
  <channel>
    <title>Elon Musk / X</title>
    <item>
      <title><![CDATA[Starship launch &amp; test flight &lt;Success&gt;]]></title>
      <link>https://x.com/elonmusk/status/9876543210</link>
      <pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Photo update</p><img src="https://pbs.twimg.com/media/test.jpg"/>]]></description>
    </item>
  </channel>
</rss>
`;

const items = adapter["parseRssFeed"](testXml, "elonmusk");
assert(items.length === 1, "成功从 RSS XML 提取 1 条推文");
assert(items[0].title === "Starship launch & test flight <Success>", "XML 实体反转义(&amp;, &lt;, &gt;)正确执行");
assert(items[0].native_id === "9876543210", "正确提取 Native Content ID (9876543210)");
assert(items[0].cover_url === "https://pbs.twimg.com/media/test.jpg", "正确提取媒体配图 Cover URL");
assert(items[0].platform === "x", "正确指定平台标识为 'x'");

console.log(`\n=== 动态门禁测试完成 | 通过: ${passed} | 失败: ${failed} ===`);
if (failed > 0) {
  process.exit(1);
}
