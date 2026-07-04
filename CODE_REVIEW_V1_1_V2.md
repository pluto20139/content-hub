# V1.1 代码 Review 报告（修复后二次审查）

> 审查范围：V1.1 迭代全部新增/修改代码（基于用户声称已修复后的版本）  
> 对照依据：`SPEC.md`、`PRD_V1.1.md`、`V1.1_TASK_PLAN.md`  
> 审查维度：PRD 业务符合性、字段遗漏、状态遗漏、权限遗漏、异常场景遗漏、对已有功能的影响  
> 审查时间：2026-07-04

---

## 1. 核心结论

**所有上一次 Review 的 P0 问题均已修复**，代码在关键路径（5 平台添加、抓取、隐藏、Deep Link、封面防盗链）上基本闭环。本次审查**未发现新的 P0 级问题**，但存在 **3 个 P1 级问题** 导致代码未 100% 满足 PRD 字面要求，以及若干 P2 级优化项。

**最需关注的三点**：
1. 知乎 `article`/`answer` Deep Link schema 与 PRD 不一致（`articles`/`answers` vs `zhuanlan`/`answer`）。
2. YouTube `/c/` 自定义链接 PRD 声明支持，但代码仍返回错误。
3. B站/YouTube 的 `native_type` 与 PRD 不一致（PRD 要求 B站 `user`、YouTube 空，代码返回 `people`）。

---

## 2. 上一轮 P0/P1 问题修复验证

| 编号 | 问题 | 修复状态 | 验证位置 |
|---|---|---|---|
| P0-1 | 生产环境写入 Mock 数据 | ✅ 已修复 | 抖音/小红书/知乎适配器均改为 `process.env.NODE_ENV !== 'production' && process.env.USE_MOCK === 'true'` 才返回 Mock，否则抛 `isPlatformLevel` 错误 |
| P0-2 | 知乎 `native_id` 前缀污染 | ✅ 已修复 | `parse-url` 返回纯 ID；`zhihu.ts` 内容 `native_id` 不再加 `article:`/`answer:` 等前缀；`getDeepLink` 已清理 `people:` 前缀 |
| P0-3 | 知乎专栏 URL 误识别单篇文章 | ✅ 已修复 | `ZHIHU_COLUMN_RE` 使用负向前瞻排除 `p/`，且主 handler 明确拦截 `zhuanlan.zhihu.com/p/` |
| P0-4 | 新平台适配器未做同平台限速 | ✅ 已修复 | 知乎/抖音/小红书 `fetchAll` 均使用 `withPlatformThrottle` |
| P1-1 | 抖音代理设置无效 | ✅ 已修复 | `DouyinAdapter` 使用 `undici` 的 `ProxyAgent` 显式传入代理 |
| P1-2 | 小红书/知乎未使用代理池 | ✅ 已修复 | 两适配器均接入 `DatabaseProxyPool` |
| P1-3 | 小红书未读取 Cookie | ✅ 已修复 | `XiaohongshuAdapter.loadXiaohongshuCookie()` 从 `platform_configs` 读取并注入请求 |
| P1-4 | 知乎 Deep Link question/post 复数问题 | 部分修复 | `question` 已改为单数，`post` 已改为 `pins`，但 `article`/`answer` 仍与 PRD 不一致 |
| P1-6 | `image-proxy` SSRF 风险 | ✅ 已修复 | 已增加域名白名单和 `image/` 内容类型校验 |
| P1-7 | 知乎 `Math.random()` fallback | ✅ 已修复 | 改为 `sha256(rawId).slice(0,16)` 稳定 ID |
| P1-8 | 小红书/抖音 `fetchDisplayName` 未使用代理 | ✅ 已修复 | 均使用代理池 |
| P2-3 | `short_link_cache` 缺少显式 RLS policy | ✅ 已修复 | `013` 迁移已添加 `short_link_cache_service_only` policy |

---

## 3. P1 级问题（必须修复以 100% 满足 PRD）

### 3.1 知乎 `article` / `answer` Deep Link schema 与 PRD 不一致

| 项目 | 内容 |
|---|---|
| **问题** | PRD 2.5 规定：`article` → `zhihu://zhuanlan/{native_id}`，`answer` → `zhihu://answer/{native_id}`（单数）。代码中：`article` → `zhihu://articles/{native_id}`，`answer` → `zhihu://answers/{native_id}`（复数）。 |
| **风险等级** | **P1** |
| **影响** | 知乎 App 可能无法识别这两个 schema，导致文章和回答无法唤起，统一 fallback 到 `original_url`，影响核心体验。 |
| **代码位置** | `packages/shared/src/constants/deep-link.ts:14-15` |
| **修改建议** | 将 `zhihu://articles/{native_id}` 改为 `zhihu://zhuanlan/{native_id}`；将 `zhihu://answers/{native_id}` 改为 `zhihu://answer/{native_id}`。 |
| **是否影响已有功能** | 否，仅影响知乎 Deep Link 唤起。 |

### 3.2 YouTube `/c/` 自定义链接仍未支持

| 项目 | 内容 |
|---|---|
| **问题** | PRD 2.1 明确列出 YouTube 支持 `/c/xxx` 链接。但 `parse-url` 对 `/c/` 仍然返回 `INVALID_URL` 错误。 |
| **风险等级** | **P1** |
| **影响** | 用户粘贴 YouTube `/c/` 链接时无法添加监控，违反 PRD 平台支持范围。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:184-185` |
| **修改建议** | 参照 `/c/` 链接获取其频道 ID 或 handle 映射，或至少通过 handle 兜底解析。YouTube Data API 对 `/c/` 没有直接接口，可先 HEAD 请求获取 `rel="canonical"` 或 redirect 到 `/@handle` 再解析。 |
| **是否影响已有功能** | 否，属于新增平台解析能力。 |

### 3.3 B站 / YouTube `native_type` 与 PRD 不一致

| 项目 | 内容 |
|---|---|
| **问题** | PRD 2.1 与 3.1 规定：`native_type` 仅用于知乎，B站应为 `user`，YouTube 为空。代码中 B站返回 `people`，YouTube 也返回 `people`。 |
| **风险等级** | **P1**（PRD 字面符合性问题） |
| **影响** | 当前 Admin 只针对 `platform === 'zhihu'` 展示 `native_type`，所以功能不受影响；但数据库中写入的值与 PRD 不一致，后续若基于 `native_type` 做平台判断会出错。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:125`（B站）、`index.ts:195`（YouTube） |
| **修改建议** | B站返回 `native_type: "user"`；YouTube 返回 `native_type: null`（或不返回该字段）。 |
| **是否影响已有功能** | 低，但需同步检查数据库 CHECK 约束是否允许 `user`（当前约束为 `native_type IS NULL OR native_type IN ('people', 'column')`，若 B站改 `user` 需扩展约束）。 |

---

## 4. P2 级问题（建议修复）

### 4.1 `contents_anon_read` 放宽后 30 天软删除内容对匿名用户可见

| 项目 | 内容 |
|---|---|
| **问题** | `013` 迁移将 anon SELECT 策略改为 `USING (true)`，所有 `is_display=false` 的内容都对匿名用户可读，包括 30 天软删除内容。 |
| **风险等级** | **P2**（产品决策已知） |
| **影响** | 这是按用户决策复用 `is_display` 的直接后果，PRD 2.4 已明确说明。但从 1.0 SPEC 权限边界看，anon 原本只能读 `is_display=true`。需要确认是否接受：任何访客都能浏览全部历史软删除内容。 |
| **代码位置** | `supabase/migrations/013_v1_1_allow_anon_read_hidden.sql:5-7` |
| **修改建议** | 若接受该设计，在 SPEC 权限矩阵中同步更新并注明；若不接受，需新增独立隐藏字段（但用户已否决）。 |
| **是否影响已有功能** | 改变匿名用户可见范围。 |

### 4.2 H5 占位图未使用新平台品牌色

| 项目 | 内容 |
|---|---|
| **问题** | `ContentCard.getPlaceholderCover` 只定义了 bilibili/youtube 的占位色，知乎/抖音/小红书 fallback 到 `#999` 灰色。 |
| **风险等级** | **P2** |
| **影响** | 新平台封面加载失败时，卡片呈现灰色占位图，与品牌识别不一致，降低体验。 |
| **代码位置** | `apps/h5/src/components/ContentCard.tsx:16-25` |
| **修改建议** | 直接使用 `PLATFORMS[platform].brandColor`（已定义知乎 `#0066FF`、抖音 `#000000`、小红书 `#FF2442`），移除硬编码的 `colors` 映射。 |
| **是否影响已有功能** | 否。 |

### 4.3 `scripts/cron/src/lib/short-link.ts` 为死代码

| 项目 | 内容 |
|---|---|
| **问题** | 该模块导出了 `resolveAndCacheShortLink`，但没有任何 Cron 代码引用它；短链解析和缓存逻辑已在 `parse-url` Edge Function 中实现。 |
| **风险等级** | **P2** |
| **影响** | 代码冗余，维护时可能混淆；两端缓存逻辑若未来不同步会导致数据不一致。 |
| **代码位置** | `scripts/cron/src/lib/short-link.ts` |
| **修改建议** | 删除 `scripts/cron/src/lib/short-link.ts`，或在 Cron 中复用该模块替代 Edge Function 内嵌逻辑。推荐删除，因为短链解析属于添加监控时的单次操作，放在 Edge Function 更合适。 |
| **是否影响已有功能** | 否。 |

### 4.4 知乎专栏 RSSHub 路由名与 PRD 不一致

| 项目 | 内容 |
|---|---|
| **问题** | PRD 4.1 及 V1.1 任务计划使用路由 `/zhihu/column/:id`，代码中使用 `/zhihu/zhuanlan/${cleanId}`。 |
| **风险等级** | **P2** |
| **影响** | 命名不一致，后续维护可能困惑；若 RSSHub 实际路由为 `zhuanlan` 则功能正确，但文档需同步。 |
| **代码位置** | `scripts/cron/src/adapters/zhihu.ts:54-56`、`scripts/cron/src/adapters/zhihu.ts:168-170` |
| **修改建议** | 统一文档和代码：要么 PRD 改为 `/zhihu/zhuanlan/:id`，要么代码改为 `/zhihu/column/:id`（需确认 RSSHub 实际可用路由）。 |
| **是否影响已有功能** | 否，若当前路由可用则功能正常。 |

### 4.5 知乎 / 小红书 RSSHub 请求缺少超时控制

| 项目 | 内容 |
|---|---|
| **问题** | 抖音移动端兜底已使用 `AbortController` 10s 超时，但知乎、小红书、抖音 RSSHub 主路径均没有超时控制。 |
| **风险等级** | **P2** |
| **影响** | 若 RSSHub 服务无响应，Cron 单次请求会长时间挂起，可能阻塞整个平台组执行。 |
| **代码位置** | `scripts/cron/src/adapters/zhihu.ts:67`、`scripts/cron/src/adapters/xiaohongshu.ts:80`、`scripts/cron/src/adapters/douyin.ts:62` |
| **修改建议** | 统一为 RSSHub 请求添加 `AbortController` + 10s 超时。 |
| **是否影响已有功能** | 否，提升稳定性。 |

### 4.6 Admin 未展示新平台暂停状态

| 项目 | 内容 |
|---|---|
| **问题** | 抖音/小红书/知乎的风控暂停状态（`platform_status`）仅写入数据库，Admin 页面没有展示。 |
| **风险等级** | **P2** |
| **影响** | 管理员无法直观知道某平台因反爬被暂停，可能误以为是配置问题。 |
| **代码位置** | `apps/admin/src/pages/MonitorList.tsx` |
| **修改建议** | 在平台筛选栏或 B站 Cookie 状态栏旁边，增加新平台状态展示（如"抖音因风控暂停至 xx:xx"）。 |
| **是否影响已有功能** | 否。 |

### 4.7 `supabase/config.toml` 缺少未使用但声明的 Secrets

| 项目 | 内容 |
|---|---|
| **问题** | `parse-url` 读取了 `EDGE_PROXY_LIST`，但 `[edge_runtime.secrets]` 未配置该变量；`parse-url` 中该变量也未实际使用。 |
| **风险等级** | **P2** |
| **影响** | 存在 dead env 引用，未来若启用 Edge Function 代理会失效。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:30`、`supabase/config.toml:385-389` |
| **修改建议** | 方案 A：在 `config.toml` 的 `[edge_runtime.secrets]` 中补充 `EDGE_PROXY_LIST = "env(EDGE_PROXY_LIST)"` 并实际接入短链解析；方案 B：删除 `parse-url` 中未使用的 `EDGE_PROXY_LIST` 读取。 |
| **是否影响已有功能** | 否。 |

---

## 5. 字段 / 状态 / 权限遗漏检查

### 5.1 字段遗漏

| 字段 | 状态 | 说明 |
|---|---|---|
| `monitors.native_type` | ✅ 已添加 | 数据库约束、Admin 保存、parse-url 返回均正确。 |
| `contents.is_display` | ✅ 复用 | 按产品决策复用。 |
| `platform_configs.platform_status` | ✅ 已添加 | 新平台反爬暂停状态已实现。 |
| `short_link_cache` 表 | ✅ 已添加 | 缓存短链解析结果。 |
| 知乎 `content native_id` | ✅ 无前缀 | 纯 ID 存储，符合 SPEC。 |

### 5.2 状态遗漏

| 状态 | 状态 |
|---|---|
| 新平台 `normal → cookie_expired → rate_limited` | ✅ 已按 1.0 SPEC 状态机实现。 |
| 平台级短路暂停状态 | ✅ 已实现（`isPlatformPaused` + adapter 写入 `platform_status`）。 |
| 隐藏失败回滚 | ✅ 已实现（`Feed.tsx:137-172`）。 |
| 隐藏与 30 天软删除交互 | ✅ 按产品决策共用 `is_display=false`。 |
| 删除 monitor 后隐藏内容归属 | ✅ `monitor_id` 为 NULL 时 Deep Link fallback 到 `original_url`。 |
| 防复活机制 | ✅ `upsertContent` 不更新 `is_display` 列。 |

### 5.3 权限遗漏

| 权限 | 状态 |
|---|---|
| anon 隐藏 `is_display` 改 false | ✅ `contents_anon_hide` 策略限制 `USING (is_display=true)` + `WITH CHECK (is_display=false)`。 |
| anon 改回 `is_display=true` | ✅ 策略阻止。 |
| anon 读取 30 天软删除内容 | ⚠️ 按产品决策允许，但需 SPEC 同步说明。 |
| `platform_configs_admin` 视图脱敏 | ✅ 已对 `cookie`/`proxy_list` 返回 NULL。 |
| `short_link_cache` RLS | ✅ 已添加 service_role only policy。 |
| `image-proxy` SSRF | ✅ 已加域名白名单。 |

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
| RSSHub 请求超时 | ❌ 知乎/小红书/抖音主路径未加超时。 |

---

## 6. 对已有功能的影响

| 功能 | 影响 | 说明 |
|---|---|---|
| B站 抓取 | 无影响 | 核心逻辑未改动。 |
| YouTube 抓取 | 无影响 | 未改动。 |
| Admin 监控列表 | 轻微影响 | 新增平台筛选、native_type 展示；新平台暂停状态未展示。 |
| H5 信息流 | 正面影响 | 新增 5 平台 Tab、隐藏功能、已隐藏 Tab、封面代理。 |
| 权限模型 | 显著影响 | anon 可读取所有 `is_display=false` 内容，包括 30 天软删除内容，改变了 1.0 SPEC 权限边界。 |
| 数据库结构 | 扩展影响 | 新增 `native_type`、扩展 platform 枚举、新增 `short_link_cache`、新增 `platform_status`。 |

---

## 7. 修复优先级建议

### 立即修复（P1）
1. 修正知乎 Deep Link schema：`article` → `zhihu://zhuanlan/{native_id}`，`answer` → `zhihu://answer/{native_id}`。
2. 支持 YouTube `/c/` 自定义链接，或更新 PRD 明确不支持（当前代码与 PRD 冲突）。
3. 修正 B站/YouTube `native_type`：B站 `user`、YouTube `null`；若 B站改 `user` 需同步扩展数据库 CHECK 约束。

### 上线前修复（P2）
4. 在 SPEC 中明确说明 `contents_anon_read` 放宽至 `USING (true)` 的权限边界（接受 30 天软删除内容对匿名可见）。
5. H5 占位图使用 `PLATFORMS[platform].brandColor`。
6. 删除死代码 `scripts/cron/src/lib/short-link.ts`。
7. 统一知乎专栏 RSSHub 路由名称（文档/代码一致）。
8. 为知乎/小红书/抖音 RSSHub 请求添加 10s 超时。
9. Admin 展示新平台暂停状态。
10. 清理 `parse-url` 中未使用的 `EDGE_PROXY_LIST` 引用，或在 `config.toml` 中补充配置。

### 可后续优化（P3）
11. 更新 `monitors-query.ts` 注释，说明 `others` 现在包含 bilibili/知乎/抖音/小红书。
12. H5 7 个 Tab 横向滚动已支持，可进一步优化为底部固定或下拉筛选以提升移动端体验。

---

## 8. 总结

V1.1 上一次 Review 的 P0 问题已全部关闭，核心链路和风险点（生产 Mock、native_id 前缀、知乎专栏正则、同平台限速）都已处理到位。当前版本主要剩余 **PRD 字面符合性问题**（知乎 Deep Link、YouTube `/c/`、B站/YouTube `native_type`），以及若干不影响核心流程的 P2 优化项。

建议按 P1 → P2 → P3 顺序处理，处理完 P1 后再做一轮端到端验证（尤其知乎文章/回答 Deep Link、YouTube `/c/` 添加、各平台占位图颜色）。整体已具备接近上线条件。