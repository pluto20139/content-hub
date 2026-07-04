# V1.1 代码 Review 报告（执行后）

> 审查范围：V1.1 迭代全部新增/修改代码  
> 对照依据：`SPEC.md`、`PRD_V1.1.md`、`V1.1_TASK_PLAN.md`  
> 审查维度：PRD 业务符合性、字段遗漏、状态遗漏、权限遗漏、异常场景遗漏、对已有功能的影响  
> 审查时间：2026-07-04

---

## 1. 核心结论

V1.1 核心链路（5 平台添加、抓取、隐藏、Deep Link、封面防盗链）已基本跑通，但存在 **4 个 P0 级问题** 必须在上线前修复，以及若干 P1/P2 级风险。最危险的是：

1. **生产环境会写入 Mock 数据** — 抖音/小红书/知乎适配器在 `RSSHUB_URL` 未配置时返回 Mock 数据，违反 PRD。
2. **知乎 `native_id` 前缀污染 contents 表和 Deep Link** — 导致知乎 Deep Link 无法正确唤醒，且 `contents` 唯一索引语义混乱。
3. **知乎专栏 URL 误识别单篇文章为专栏** — `zhuanlan.zhihu.com/p/xxx` 会被当成专栏 monitor。
4. **新平台适配器未做同平台限速** — 知乎/抖音/小红书 `fetchAll` 没有 `withPlatformThrottle`，可能触发反爬。

---

## 2. P0 级问题（必须修复）

### 2.1 生产环境会写入 Mock 数据

| 项目 | 内容 |
|---|---|
| **问题** | 当 `RSSHUB_URL` 环境变量为空时，抖音/小红书/知乎适配器直接返回 Mock 数据，而不是平台级短路或失败。 |
| **风险等级** | **P0** |
| **影响** | 违反 PRD_V1.1 第 4 节"生产环境不允许 Mock 数据"的硬约束；若部署时漏配 RSSHub，数据库会写入假内容，污染真实信息流。 |
| **代码位置** | `scripts/cron/src/adapters/douyin.ts:21-43`、 `scripts/cron/src/adapters/xiaohongshu.ts:15-37`、 `scripts/cron/src/adapters/zhihu.ts:14-37` |
| **修改建议** | 删除 `if (!this.rsshubUrl)` 的 Mock 分支，改为抛出 `PlatformLevelError`（isPlatformLevel=true），让 Cron 走平台级短路，不写入任何数据。本地开发如需 Mock，应通过独立的 `NODE_ENV=development && USE_MOCK=true` 开关控制，且不能写入生产库。 |
| **是否影响已有功能** | 否，但会改变新平台在 RSSHub 未配置时的行为。 |

### 2.2 知乎 `native_id` 前缀污染 contents 与 Deep Link

| 项目 | 内容 |
|---|---|
| **问题** | `parse-url` 返回的知乎 `native_id` 带 `people:` / `column:` 前缀；`ZhihuAdapter` 给 `contents.native_id` 又加了 `article:` / `answer:` / `question:` / `pin:` 前缀。 |
| **风险等级** | **P0** |
| **影响** | 1. `contents` 表 `(platform, native_id)` 唯一索引里混进前缀字符串，违反 SPEC 中"native_id 是平台内内容唯一 ID"的定义。<br>2. Deep Link 生成时直接拼接前缀 ID，例如 `zhihu://answers/answer:123`、`zhihu://articles/article:456`，知乎 App 无法识别。<br>3. 删除 monitor 后重新添加，旧内容的 `monitor_id` 为 NULL，知乎 post 的 Deep Link 需要 `monitor_native_id`，代码里已经做了 fallback，但 content native_id 前缀仍会导致其他 schema 错误。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:217-229`、`scripts/cron/src/adapters/zhihu.ts:74-132`、`packages/shared/src/constants/deep-link.ts:14-17` |
| **修改建议** | 1. `parse-url` 返回的知乎 `native_id` 不带前缀，但 `native_type` 字段区分 people/column。<br>2. `monitors.native_id` 存纯 ID（如 `abc123`），`monitors.native_type` 区分类型。<br>3. `contents.native_id` 存纯内容 ID（如 `123456`），不要加 `article:` 等前缀；内容类型由 `content_type` 字段区分。<br>4. Deep Link 里的 `{native_id}` 替换为纯 ID。 |
| **是否影响已有功能** | 影响知乎 Deep Link 唤醒，若已上线需清空/修复已写入的知乎 contents。 |

### 2.3 知乎专栏 URL 误识别单篇文章

| 项目 | 内容 |
|---|---|
| **问题** | `parse-url` 中 `ZHIHU_COLUMN_RE = /zhuanlan\.zhihu\.com\/([^/?#]+)/` 会匹配 `zhuanlan.zhihu.com/p/123` 并把单篇文章当专栏。 |
| **风险等级** | **P0** |
| **影响** | 用户粘贴知乎单篇文章链接时，系统会错误添加为专栏 monitor，后续抓取必然失败或抓到错误内容。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:205-230` |
| **修改建议** | 修改正则：`ZHIHU_COLUMN_RE` 只匹配 `zhuanlan.zhihu.com/[:column_id]` 且排除 `/p/` 路径；或把 `zhuanlan.zhihu.com/p/` 明确返回 `UNKNOWN_PLATFORM` 错误。 |
| **是否影响已有功能** | 否，新平台解析功能。 |

### 2.4 新平台适配器未做同平台限速

| 项目 | 内容 |
|---|---|
| **问题** | 知乎/抖音/小红书 `fetchAll` 没有调用 `withPlatformThrottle`，同平台内多个 monitor 连续请求没有 1.5s 间隔。 |
| **风险等级** | **P0** |
| **影响** | 同一平台多个 monitor 会在短时间内密集请求 RSSHub/目标站点，极易触发反爬或 IP 封禁。 |
| **代码位置** | `scripts/cron/src/adapters/zhihu.ts:157-209`、`scripts/cron/src/adapters/douyin.ts:213-269`、`scripts/cron/src/adapters/xiaohongshu.ts:168-221` |
| **修改建议** | 在 `fetchAll` 的循环中，每个 monitor 调用前 `await withPlatformThrottle(this.platform, async () => { ... })`。可参考 `BilibiliAdapter.fetchAll:188-197`。 |
| **是否影响已有功能** | 否，但会显著降低新平台被封概率。 |

---

## 3. P1 级问题（强烈建议修复）

### 3.1 抖音代理设置对 Node.js fetch 无效

| 项目 | 内容 |
|---|---|
| **问题** | `DouyinAdapter` 通过设置 `process.env.HTTP_PROXY = selectedProxy` 来使用代理，但 Node.js 20 内置的 `fetch`（undici）默认不读取 `HTTP_PROXY` 环境变量。 |
| **风险等级** | **P1** |
| **影响** | 即使配置了代理，抖音请求仍可能走本地网络，代理失效，增加被封风险。 |
| **代码位置** | `scripts/cron/src/adapters/douyin.ts:55-79`、`scripts/cron/src/adapters/douyin.ts:126-192` |
| **修改建议** | 使用支持代理的 HTTP 客户端（如 `undici` 的 `ProxyAgent`、`https-proxy-agent`、`node-fetch` + agent）显式传入代理。 |
| **是否影响已有功能** | 影响抖音抓取稳定性。 |

### 3.2 小红书/知乎未使用代理池

| 项目 | 内容 |
|---|---|
| **问题** | `XiaohongshuAdapter` 和 `ZhihuAdapter` 没有接入 `ProxyPool`，完全依赖单 IP 直连。 |
| **风险等级** | **P1** |
| **影响** | 小红书反爬严格，没有代理池极易被封；知乎虽然风控较松，但多 monitor 时仍可能触发限流。 |
| **代码位置** | `scripts/cron/src/adapters/xiaohongshu.ts`、`scripts/cron/src/adapters/zhihu.ts` |
| **修改建议** | 为小红书/知乎适配器也创建 `DatabaseProxyPool`，在 `fetchLatest` 和 `fetchDisplayName` 中使用代理。知乎可配置为可选（默认空代理池），小红书建议强制使用。 |
| **是否影响已有功能** | 影响新平台稳定性。 |

### 3.3 小红书未读取 Cookie 配置

| 项目 | 内容 |
|---|---|
| **问题** | `spike/v1_1_rsshub_routes.md` 明确小红书 RSSHub 需要 `XIAOHONGSHU_COOKIE`，但 `XiaohongshuAdapter` 没有从 `platform_configs` 读取 cookie 并注入请求。 |
| **风险等级** | **P1** |
| **影响** | 自托管 RSSHub 抓取小红书时频繁返回 403，无法稳定获取内容。 |
| **代码位置** | `scripts/cron/src/adapters/xiaohongshu.ts` |
| **修改建议** | 在 `fetchLatest` 中读取 `platform_configs` 的 `xiaohongshu:cookie`，请求 RSSHub 时作为环境变量或请求头注入；或按 RSSHub 文档配置全局 `XIAOHONGSHU_COOKIE`。 |
| **是否影响已有功能** | 影响小红书抓取。 |

### 3.4 Deep Link 知乎 schema 与 PRD 不一致

| 项目 | 内容 |
|---|---|
| **问题** | `deep-link.ts` 中知乎 question schema 为 `zhihu://questions/{native_id}`（复数），PRD 为 `zhihu://question/{native_id}`（单数）；知乎 post schema 为 `zhihu://people/{monitor_native_id}/pin/{native_id}`（单数），PRD 为 `/pins/`（复数）。 |
| **风险等级** | **P1** |
| **影响** | 知乎 App 可能无法识别这些 Deep Link，导致跳转失败。 |
| **代码位置** | `packages/shared/src/constants/deep-link.ts:14-17` |
| **修改建议** | 按 PRD 修正为 `zhihu://question/{native_id}` 和 `zhihu://people/{monitor_native_id}/pins/{native_id}`。 |
| **是否影响已有功能** | 影响知乎 Deep Link 唤醒。 |

### 3.5 `contents_anon_read` 策略被放宽到所有内容

| 项目 | 内容 |
|---|---|
| **问题** | `013_v1_1_allow_anon_read_hidden.sql` 将 anon 的 `contents` SELECT 策略从 `USING (is_display = true)` 改为 `USING (true)`，匿名用户可以查看所有隐藏/软删除内容。 |
| **风险等级** | **P1** |
| **影响** | 违反 1.0 SPEC 权限矩阵中"anon 只能读取 is_display=true 的记录"；虽然 PRD 2.4 要求"已隐藏" Tab 可见，但这意味着所有 30 天软删除内容也对匿名用户可见。 |
| **代码位置** | `supabase/migrations/013_v1_1_allow_anon_read_hidden.sql` |
| **修改建议** | 方案 A：保持 `USING (true)` 但 H5 只查询 `is_display=false` 作为已隐藏 Tab，并在 PRD/SPEC 中明确更新权限矩阵。<br>方案 B：使用两个策略：`contents_anon_read` 保持 `is_display=true`，新增 `contents_anon_read_hidden` 策略允许 anon 读取 `is_display=false`，并只在 H5 已隐藏 Tab 查询中使用。 |
| **是否影响已有功能** | 改变匿名用户可见内容范围。 |

### 3.6 `image-proxy` 存在 SSRF 风险

| 项目 | 内容 |
|---|---|
| **问题** | `image-proxy` 接受任意 `url` 参数并代理请求，没有域名白名单或格式校验。 |
| **风险等级** | **P1** |
| **影响** | 攻击者可能利用该端点访问内网服务或发起恶意请求。 |
| **代码位置** | `supabase/functions/image-proxy/index.ts` |
| **修改建议** | 增加白名单校验：只允许 http(s) 协议，且域名属于封面图常见 CDN（如 bilibili.com、youtube.com、zhihu.com、xiaohongshu.com、douyin.com 等），或限制 `Content-Type` 必须以 `image/` 开头。 |
| **是否影响已有功能** | 不影响，但增加安全层。 |

### 3.7 知乎 adapter 使用 `Math.random()` 作为 fallback ID

| 项目 | 内容 |
|---|---|
| **问题** | `ZhihuAdapter` 中 column 文章无法提取 ID 时，使用 `Math.random()` 生成 native_id。 |
| **风险等级** | **P1** |
| **影响** | 每次抓取都会生成新的随机 ID，导致同一篇文章重复插入，污染数据库。 |
| **代码位置** | `scripts/cron/src/adapters/zhihu.ts:80` |
| **修改建议** | 改为使用 `item.id` 或 `item.url` 的 hash 作为 fallback，确保同一内容 ID 稳定。 |
| **是否影响已有功能** | 影响知乎内容去重。 |

### 3.8 小红书/抖音 `fetchDisplayName` 未使用代理

| 项目 | 内容 |
|---|---|
| **问题** | 小红书/抖音的 `fetchDisplayName` 直接 `fetch` 目标 URL，没有使用代理池。 |
| **风险等级** | **P1** |
| **影响** | 在反爬环境下，昵称刷新请求可能失败，导致 `name_auto=true` 的昵称更新失效。 |
| **代码位置** | `scripts/cron/src/adapters/xiaohongshu.ts:138-166`、`scripts/cron/src/adapters/douyin.ts:199-211` |
| **修改建议** | 复用代理池和移动 UA，对 `fetchDisplayName` 也做代理轮换。 |
| **是否影响已有功能** | 影响昵称自动刷新。 |

---

## 4. P2 级问题（建议优化）

### 4.1 文档仍提到 Mock 数据降级

| 项目 | 内容 |
|---|---|
| **问题** | `PROJECT_CONTEXT.md` 第 32 行提到"支持代理池与 Mock 数据降级"；`spike/v1_1_rsshub_routes.md` 第 47 行提到"无配置本地开发环境自动降级为 Mock 数据"。 |
| **风险等级** | **P2** |
| **影响** | 文档与 PRD 冲突，可能导致开发/部署误解。 |
| **修改建议** | 删除文档中关于 Mock 数据降级的描述，明确"生产环境不允许 Mock 数据"。 |

### 4.2 抖音图集 content_type 未明确处理

| 项目 | 内容 |
|---|---|
| **问题** | 代码中抖音图集统一映射为 `video`，虽然已按决策执行，但代码注释和 PRD 没有明确说明这一点。 |
| **风险等级** | **P2** |
| **影响** | 后续维护者可能困惑。 |
| **修改建议** | 在代码和 PRD 中明确注释：抖音图集统一按 `video` 处理，Deep Link 唤醒失败时 fallback 到 `original_url`。 |

### 4.3 `short_link_cache` 缺少显式 RLS policy

| 项目 | 内容 |
|---|---|
| **问题** | 迁移文件只启用 RLS 但没有创建 policy。 |
| **风险等级** | **P2** |
| **影响** | 默认只有表所有者能访问，service_role 可绕过；虽然当前安全，但缺少显式声明。 |
| **代码位置** | `supabase/migrations/012_v1_1_platforms_and_native_type.sql:46-54` |
| **修改建议** | 添加显式 policy：`CREATE POLICY short_link_cache_service_only ON short_link_cache FOR ALL TO service_role USING (true) WITH CHECK (true);`。 |

### 4.4 新平台状态未在 Admin 展示

| 项目 | 内容 |
|---|---|
| **问题** | 抖音/小红书/知乎的 `platform_status` 仅在数据库中维护，Admin 没有展示平台级暂停状态。 |
| **风险等级** | **P2** |
| **影响** | 管理员不知道平台因风控暂停。 |
| **修改建议** | 在 Admin 监控列表顶部或平台筛选旁增加平台状态提示（如"抖音因风控暂停至 xx:xx"）。 |

### 4.5 `ZhiHuAdapter` 的 `published_at` 使用 RSSHub 原始字段

| 项目 | 内容 |
|---|---|
| **问题** | 代码使用 `item.date_published`，但 RSSHub 某些路由可能用 `published` 或 `date_modified`。 |
| **风险等级** | **P2** |
| **影响** | 时间解析失败时会 fallback 到 `new Date().toISOString()`，导致时间排序错误。 |
| **修改建议** | 按 RSSHub JSON Feed 标准，优先 `date_published`，其次 `date_modified`，最后 `published`。 |

### 4.6 知乎 `column` 路由调研结论与代码不一致

| 项目 | 内容 |
|---|---|
| **问题** | 调研报告说专栏路由是 `/zhihu/zhuanlan/:id`，PRD 和 task plan 也写 `/zhihu/column/:id`，代码使用 `/zhihu/zhuanlan/${cleanId}`。 |
| **风险等级** | **P2** |
| **影响** | 命名不一致，后续维护可能困惑。 |
| **修改建议** | 统一文档和代码中的路由名称。 |

---

## 5. 状态/字段/权限遗漏检查

### 5.1 字段遗漏

| 字段 | 状态 | 说明 |
|---|---|---|
| `monitors.native_type` | ✅ 已添加 | 数据库约束、Admin 保存、parse-url 返回均正确。 |
| `contents.is_display` | ✅ 已复用 | 按产品决策复用，未新增独立字段。 |
| `platform_configs.platform_status` | ✅ 已添加 | 用于新平台反爬暂停状态。 |
| `short_link_cache` 表 | ✅ 已添加 | 缓存短链解析结果。 |
| 知乎 content native_id 前缀 | ❌ 污染 | 见 P0-2。 |

### 5.2 状态遗漏

| 状态 | 状态 |
|---|---|
| 新平台 `normal → cookie_expired → rate_limited` | ✅ 已按 1.0 SPEC 状态机实现（`computeStatus` 在 `scripts/cron/src/index.ts:64-89`）。 |
| 平台级短路暂停状态 | ✅ 已实现（`isPlatformPaused` + adapter 写入 `platform_status`）。 |
| 隐藏失败回滚 | ✅ 已实现（`Feed.tsx:137-172`）。 |
| 隐藏与 30 天软删除交互 | ✅ 已验证，UPSERT 不传 `is_display`/`created_at`，不会复活。 |
| 删除 monitor 后隐藏内容归属 | ✅ 已测试，`monitor_id` 为 NULL 时 Deep Link fallback 到 `original_url`。 |

### 5.3 权限遗漏

| 权限 | 状态 |
|---|---|
| anon 隐藏 `is_display` 改 false | ✅ 已加 `contents_anon_hide` 策略。 |
| anon 改回 `is_display=true` | ✅ `USING (is_display=true)` 阻止。 |
| anon 读取所有 contents（含 hidden） | ⚠️ 已放宽，见 P1-5。 |
| `platform_configs_admin` 视图脱敏 | ✅ 已对 `cookie`/`proxy_list` 返回 NULL。 |
| `short_link_cache` RLS | ⚠️ 已启用 RLS 但缺少显式 policy，见 P2-3。 |
| `image-proxy` SSRF | ⚠️ 缺少白名单，见 P1-6。 |

### 5.4 异常场景遗漏

| 场景 | 状态 |
|---|---|
| H5 隐藏 PATCH 失败 | ✅ 已回滚并 Toast。 |
| 连续点击隐藏 | ✅ `isHiding` 禁用状态。 |
| 短链解析超时 | ✅ 10s timeout。 |
| RSSHub 空列表 | ✅ 视为成功，不增加 fail_count。 |
| 封面 403 | ✅ `image-proxy` 兜底。 |
| 代理池全部失效 | ✅ 平台级短路。 |
| 知乎 monitor 缺少 native_type | ✅ DB CHECK + Admin 校验阻止。 |
| 知乎 post Deep Link fallback | ✅ `getDeepLink` 在 `monitorNativeId` 缺失时返回 `original_url`。 |

---

## 6. 对已有功能的影响

| 功能 | 影响 | 说明 |
|---|---|---|
| B站 抓取 | 无影响 | 代码未改动核心逻辑。 |
| YouTube 抓取 | 无影响 | 未改动。 |
| Admin 监控列表 | 轻微影响 | 新增平台筛选、native_type 展示，B站 cookie 状态查询仍通过 `cookie_meta`。 |
| H5 信息流 | 正面影响 | 新增 5 平台 Tab、隐藏功能、已隐藏 Tab。 |
| 权限模型 | 显著影响 | anon 可读取所有 contents，包括隐藏内容，改变了 1.0 SPEC 的权限边界。 |
| 数据库结构 | 扩展影响 | 新增 `native_type`、扩展 platform 枚举、新增 `short_link_cache`、新增 `platform_status`。 |

---

## 7. 修复优先级建议

### 立即修复（P0）
1. 删除抖音/小红书/知乎适配器中的 Mock 数据分支。
2. 清理知乎 `native_id` 前缀污染：parse-url 返回纯 ID，contents 表存纯 ID，Deep Link 用纯 ID。
3. 修复知乎专栏 URL 正则，避免误识别单篇文章。
4. 为新平台适配器添加 `withPlatformThrottle` 限速。

### 上线前修复（P1）
5. 抖音代理使用显式 `ProxyAgent`，而不是 `process.env.HTTP_PROXY`。
6. 小红书/知乎接入代理池（小红书必须，知乎可选）。
7. 小红书读取 `platform_configs` 的 cookie 并注入 RSSHub 请求。
8. 修正知乎 Deep Link schema（question 单数、post 复数）。
9. 明确 `contents_anon_read` 策略放宽是产品决策，并在 SPEC 中更新权限矩阵。
10. 为 `image-proxy` 增加 URL 白名单/域名限制。
11. 移除 `ZhihuAdapter` 中的 `Math.random()` fallback。

### 可后续优化（P2）
12. 删除文档中关于 Mock 数据降级的描述。
13. 为 `short_link_cache` 添加显式 RLS policy。
14. 在 Admin 展示新平台暂停状态。
15. 统一知乎专栏路由名称（zhuanlan vs column）。

---

## 8. 总结

V1.1 在功能上已接近可交付状态，但 **P0 级问题不能带上线**。最关键的是：

- **Mock 数据会污染生产库**（P0-1）。
- **知乎 native_id 前缀导致 Deep Link 失效和数据去重问题**（P0-2）。
- **知乎专栏 URL 误识别**（P0-3）。
- **新平台缺少限速**（P0-4）。

建议先按"立即修复"清单处理 P0，再按 P1 清单处理，最后再做一轮集成测试（尤其验证知乎 Deep Link、抖音代理、小红书 Cookie、5 平台限速）。
