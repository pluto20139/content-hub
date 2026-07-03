# 多平台内容中枢 — Code Review 报告

> 评审范围：apps / packages / scripts / supabase 全代码库
> 依据文档：PRD v1.4、SPEC v1.6、Taskplan.md、腾讯云部署执行计划
> 部署约束：服务部署在腾讯云服务器，数据库保留 Supabase Cloud
> 评审日期：2026-07-03

---

## 1. 执行摘要

本次 Review 共识别出 **4 个 P0 级问题**、**8 个 P1 级问题**、**7 个 P2 级问题** 及若干 P3 建议。主要风险集中在：

1. **安全红线**：`supabase/config.toml` 硬编码 YouTube API Key，`platform_configs` 表未对管理员脱敏。
2. **B 站 Cookie 缺失未走平台级短路**：会导致所有 B 站 monitor 逐条失败并触发误告警。
3. **业务语义偏差**：`last_content_at` 使用最新内容 `published_at` 而非 `now()`，状态筛选“异常”包含 `cookie_expired` 与 SPEC 不符。
4. **前端缺陷**：H5 占位图 SVG data URI 未编码 `#` 号，部分浏览器会解析失败。
5. **可维护性**：多处实现与 SPEC/PRD 字面描述存在偏差，文档与代码未同步。

整体架构已按腾讯云部署计划完成迁移（pm2 + node-cron、删除 bilibili-fetch、删除 GitHub Actions），核心链路（添加 → 抓取 → 展示 → 跳转）已打通，但上述问题需在上线前修复。

---

## 2. 风险等级定义

| 等级 | 定义 |
|---|---|
| **P0 — 阻塞** | 导致系统无法运行、构建/部署失败、敏感信息泄露、数据丢失或严重业务错误。必须修复。 |
| **P1 — 高** | 导致功能异常、告警误报、权限失控、业务目的不达或运维困难。强烈建议修复。 |
| **P2 — 中** | 与 SPEC/PRD 不一致、边界场景处理缺失、体验缺陷，但不阻塞核心流程。建议修复。 |
| **P3 — 低** | 代码债务、文档不同步、可优化项。可排期处理。 |

---

## 3. P0 级问题（必须修复）

### P0-1. `supabase/config.toml` 硬编码 YouTube API Key

- **位置**：`supabase/config.toml:386`
- **问题描述**：
  ```toml
  [edge_runtime.secrets]
  YOUTUBE_API_KEY = "AIzaSyCWPDOYQQzwwrL6a6a_j1BkS_wDt0xM1nU"
  ```
  API Key 以明文硬编码提交到仓库，违反 PROJECT_CONTEXT.md 安全红线第 3 条（敏感信息不硬编码）。该文件会进入 git history，即使后续删除也无法从 history 中抹除。
- **影响**：YouTube API Key 泄露，可能被他人盗用配额。
- **修改建议**：
  1. 立即轮换该 API Key。
  2. 将 `config.toml` 中改为环境变量引用：
     ```toml
     YOUTUBE_API_KEY = "env(YOUTUBE_API_KEY)"
     ```
  3. 检查 git history，必要时执行 `git filter-repo` 或 `git filter-branch` 清除敏感信息。
  4. 同时删除 `RSSHUB_URL` / `RSSHUB_API_KEY` 的硬编码（当前为空或示例值，但 Phase 2 启用时容易复犯）。

### P0-2. B 站 Cookie 缺失时未触发平台级短路，导致批量误告警

- **位置**：`scripts/cron/src/adapters/bilibili.ts:75-77`
- **问题描述**：
  ```typescript
  const cookie = await this.loadCookie();
  if (!cookie) throw new Error("B站 Cookie 未配置");
  ```
  当 Vault 中无 Cookie 或 RPC 调用失败时，`fetchLatest` 抛出普通错误，未标记 `isPlatformLevel`。`fetchAll` 会逐条处理所有 B 站 monitor，每条都失败，每条 `fail_count` 递增，最终全部进入 `rate_limited` 并触发企业微信告警。
- **影响**：Cookie 未配置/失效时，管理员会收到 N 条重复告警；与 SPEC 5.6 “B 站 Cookie 失效 → 平台级短路，整组跳过，fail_count 不变” 严重不符。
- **修改建议**：
  ```typescript
  if (!cookie) {
    const err = new Error("B站 Cookie 未配置");
    (err as any).isPlatformLevel = true;
    throw err;
  }
  ```
  同时建议在 `run()` 中加载 Cookie 失败时提前记录日志，但让适配器自行判定平台级短路。

### P0-3. `platform_configs` 表对管理员未脱敏，可读取敏感配置原文

- **位置**：`supabase/migrations/007_rls.sql:22-29`、`apps/admin/src/pages/MonitorList.tsx:79-93`
- **问题描述**：
  - 007_rls.sql 中 `platform_configs_admin_read` 策略：
    ```sql
    CREATE POLICY platform_configs_admin_read ON platform_configs
      FOR SELECT TO authenticated USING (true);
    ```
    允许 `authenticated` 角色读取 `platform_configs` 全部字段（包括 `config_value`）。
  - SPEC 4.1 明确规定：*“platform_configs 的 SELECT 对管理员脱敏（不返回 config_value 原文，只返回 config_key 和 updated_at）”*。
  - Admin 代码当前读取 `config_value` 显示 `cookie_status`，若未来 `cookie` 行也落入 platform_configs，会导致 Cookie 泄露。
- **影响**：违反最小权限原则，存在敏感信息泄露风险。
- **修改建议**：
  1. 修改 RLS 策略，仅允许读取 `config_key` 和 `updated_at`：
     ```sql
     CREATE POLICY platform_configs_admin_read ON platform_configs
       FOR SELECT TO authenticated
       USING (true)
       WITH CHECK (false);  -- SELECT 策略不需要 WITH CHECK
     ```
     更稳妥的做法是创建一个视图 `platform_configs_public` 仅暴露 `config_key`/`updated_at`，并只授予该视图 SELECT 权限。
  2. Admin 端改为不读取 `config_value`，仅读取 `updated_at`。`cookie_status` 可通过独立的非敏感字段或 Vault 之外的状态表暴露。
  3. 当前 `cookie_status`/`cookie_meta` 本身不是敏感信息，可保留在 platform_configs，但需确保 `cookie` 密文行不会被 Admin 读到。

### P0-4. H5 占位图 data URI 未编码 `#`，部分浏览器解析失败

- **位置**：`apps/h5/src/components/ContentCard.tsx:14-20`
- **问题描述**：
  ```typescript
  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" ... fill="${colors[platform] ?? "#999"}">...`;
  ```
  `colors` 值为 `#FB7299`、`#FF0000` 等，data URI 中 `#` 会被解析为 fragment，导致 SVG 属性截断，占位图显示异常或空白。
- **影响**：封面图加载失败时，H5 卡片可能显示空白/损坏图，影响核心浏览体验。
- **修改建议**：
  ```typescript
  const encodedColor = encodeURIComponent(colors[platform] ?? "#999");
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ... fill="${colors[platform] ?? "#999"}">...</svg>`)}`;
  ```
  或改用 Base64 编码 data URI：
  ```typescript
  const svg = `<svg ...>...</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
  ```

---

## 4. P1 级问题（强烈建议修复）

### P1-1. `last_content_at` 语义与 SPEC/PRD 不符

- **位置**：`scripts/cron/src/index.ts:119-131`
- **问题描述**：代码在新内容入库时，将 `last_content_at` 更新为最新内容的 `published_at`：
  ```typescript
  const newestTime = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  await updateMonitorStatus(monitor.id, {
    ...,
    lastContentAt: newestTime ? new Date(newestTime).toISOString() : undefined,
  });
  ```
  但 SPEC 5.1 规则 2 和 PRD B.2 Step 6 明确规定：*“有新增内容 → 额外更新 last_content_at = now()”*。`last_content_at` 的语义是“系统最后一次获得新内容的时间”，用于判断博主活跃度，而不是“内容本身的发布时间”。
- **影响**：如果抓取到一篇发布时间较早但新发现的内容，`last_content_at` 会回退，导致 Admin 活跃度提示天数计算错误。
- **修改建议**：
  ```typescript
  await updateMonitorStatus(monitor.id, {
    status,
    failCount,
    lastSync: true,
    newContent: inserted > 0,
    lastContentAt: inserted > 0 ? new Date().toISOString() : undefined,
  });
  ```
  同时修正 `updateMonitorStatus` 的语义，使其仅依赖 `newContent` 标志。

### P1-2. Admin 状态筛选“异常”包含 `cookie_expired`，与 SPEC 不符

- **位置**：`apps/admin/src/pages/MonitorList.tsx:21-26`
- **问题描述**：
  ```typescript
  const STATUS_FILTERS = [
    { key: "all", label: "全部" },
    { key: "normal", label: "正常" },
    { key: "cookie_expired+rate_limited", label: "异常" },
    { key: "inactive", label: "已关闭" },
  ];
  ```
  SPEC 9.6 自测标准明确：*“选‘异常’ → 只显示 `status=rate_limited` 的 monitor”*。PRD 中“🟡 Cookie 过期”是独立的关注状态，不应与“🔴 接口受限”混为一谈。
- **影响**：管理员无法单独筛选出已触发告警的 monitor，状态面板与 SPEC 不一致。
- **修改建议**：将“异常”改为仅 `rate_limited`，或拆分为两个筛选项：`cookie_expired`、`rate_limited`。

### P1-3. Admin 未实现 Session 过期自动刷新

- **位置**：`apps/admin/src/components/AuthGuard.tsx`、`apps/admin/src/lib/supabase.ts`
- **问题描述**：SPEC 9.4 要求：*“session 过期时自动使用 refresh_token 刷新；刷新失败 → 跳转登录页”*。当前 `AuthGuard` 仅检查 session 是否存在，没有监听 401、没有主动刷新、没有处理 access_token 过期后的请求重试。
- **影响**：管理员登录 1 小时后（默认 JWT expiry）操作可能失败或被重定向，体验差；长时间操作可能丢失数据。
- **修改建议**：
  1. 使用 Supabase JS 客户端的自动 token 刷新（默认已启用），但需确保 `supabase.auth.onAuthStateChange` 能正确传播新 session。
  2. 封装一个带自动 refresh 的 API 请求层，遇到 401 时调用 `supabase.auth.refreshSession()`，失败则跳转 `/login`。
  3. 将 access_token 保存在内存，refresh_token 保存在 httpOnly cookie（当前 Supabase Auth 已自动处理）。

### P1-4. B 站 `x/space/article/list` 专栏接口未加 WBI 签名，存在失效风险

- **位置**：`scripts/cron/src/adapters/bilibili.ts:114`
- **问题描述**：专栏接口直接调用 `x/space/article/list?mid=...&pn=1&ps=6`，未使用 WBI 签名。B 站空间类接口已逐步接入 WBI，未来该接口可能 403。
- **影响**：MVP 初期可能可用，但一旦 B 站收紧接口，专栏内容抓取会静默失败（代码 catch 后仅返回视频）。
- **修改建议**：将专栏请求也接入 WBI 签名，与视频接口共用 `getMixinKey`/`wbiSign`；或先通过实际抓包确认该接口当前是否强制校验 WBI。

### P1-5. `parse-url` 对 YouTube `/c/` 自定义 URL 使用 `forUsername`，解析逻辑错误

- **位置**：`supabase/functions/parse-url/index.ts:72-74`、`99-103`
- **问题描述**：
  - `/c/` 是 YouTube 自定义频道 URL（custom URL），YouTube Data API 没有 `forUsername` 参数对应 `/c/`。`forUsername` 对应的是早期 YouTube 用户名系统（`youtube.com/user/xxx`）。
  - 代码对 `/c/SomeName` 调用 `channels.list?forUsername=SomeName`，大概率无法解析到正确频道。
- **影响**：粘贴 YouTube `/c/` 链接时，可能返回“Channel not found”或错误 channelId。
- **修改建议**：
  - 方案 A：对 `/c/` 使用 YouTube 搜索 API（`search.list?q=@SomeName&type=channel`）或 `forHandle=@SomeName`（如果自定义 URL 与 handle 一致）。
  - 方案 B：在 parse-url 中明确只支持 `/@handle` 和 `/channel/UC...`，对 `/c/` 返回更清晰的错误提示。

### P1-6. `parse-url` 对 YouTube `/@handle` 使用 `forHandle` 时缺少 `@` 前缀

- **位置**：`supabase/functions/parse-url/index.ts:100`
- **问题描述**：代码提取 handle 时不包含 `@`，然后调用 `forHandle=${value}`。根据 YouTube Data API 文档，`forHandle` 参数通常需要包含 `@` 符号（例如 `forHandle=@mkbhd`）。
- **影响**：解析 YouTube handle 链接时可能返回空结果。
- **修改建议**：调用 API 时拼接 `@`：
  ```typescript
  json = await youtubeApi(`channels?part=snippet&forHandle=@${value}`);
  ```
  并在本地用真实 handle 测试验证。

### P1-7. `bilibili-auth` 未处理扫码状态码 86090，可能误判为过期

- **位置**：`supabase/functions/bilibili-auth/index.ts:104-115`
- **问题描述**：B 站扫码登录接口常见状态码包括：
  - `86038` 二维码已过期
  - `86039` 未扫码
  - `86101` 已扫码未确认
  - `0` 成功
  - 部分场景下还可能返回 `86090`（已确认/等待跳转）等中间状态。
  代码对未识别的 code 统一返回 `BILIBILI_QRCODE_EXPIRED`，如果 86090 是中间状态，会被误判为过期。
- **影响**：用户扫码后可能看到“二维码已过期”，体验受损。
- **修改建议**：
  1. 查阅 B 站 passport 接口文档或实际抓包，列出所有中间状态码。
  2. 将中间状态码统一映射为 `waiting`；仅 `86038` 映射为 `expired`；非明确状态码返回 `INTERNAL_ERROR` 而不是 `BILIBILI_QRCODE_EXPIRED`。

### P1-8. Admin 缺少平台级/服务端错误提示，加载失败时界面卡死

- **位置**：`apps/admin/src/pages/MonitorList.tsx:68-76`
- **问题描述**：`fetchMonitors` 只处理 `{ data }`，未处理 `error`。如果 Supabase 查询失败（网络问题、RLS 拒绝、服务不可用），`setLoading(false)` 永远不会被调用，页面一直显示“加载中...”。
- **影响**：运维或网络异常时管理员无法感知问题，界面无响应。
- **修改建议**：
  ```typescript
  const { data, error } = await supabase.from("monitors").select("*")...;
  if (error) {
    console.error("Failed to fetch monitors:", error.message);
    setError("加载监控列表失败，请刷新重试");
    setLoading(false);
    return;
  }
  ```
  同样需为 `fetchCookieInfo` 添加错误处理。

---

## 5. P2 级问题（建议修复）

### P2-1. `processPlatformGroup` 中对 B 站结果重复限速

- **位置**：`scripts/cron/src/index.ts:94-164`
- **问题描述**：`BilibiliAdapter.fetchAll` 内部已经对每条 monitor 调用 `withPlatformThrottle("bilibili", ...)`；而 `processPlatformGroup` 遍历 `result.results` 时再次 `await withPlatformThrottle(adapter.platform, ...)`。
- **影响**：不会导致错误，但会让 B 站组执行时间额外增加 (N-1)*1500ms 左右，降低 Cron 效率。
- **修改建议**：移除 `processPlatformGroup` 内层的 `withPlatformThrottle`，将限速职责完全交给 Adapter 层。

### P2-2. `computeStatus` 在 `normal` 状态下存在异常边界

- **位置**：`scripts/cron/src/index.ts:31-56`
- **问题描述**：
  ```typescript
  if (currentStatus === "normal") {
    return { status: "cookie_expired", failCount };
  }
  ```
  如果管理员手动把 monitor 状态重置为 `normal` 但没有把 `fail_count` 清零，且 `fail_count` 已经为 2，则下一次失败会返回 `cookie_expired` + `failCount=3`，而不是 `rate_limited`。虽然 Admin 重置按钮会同时清零 `fail_count`，但手动 PATCH 或通过 SQL 修复时可能出现。
- **影响**：状态机边界异常，可能导致应告警的 monitor 未触发告警。
- **修改建议**：在 `normal` 状态失败时，如果 `failCount >= 3` 直接流转为 `rate_limited`；或确保从 `rate_limited` 重置时必须同时清零 `fail_count`。

### P2-3. Admin 删除 monitor 使用行内确认按钮，未按 SPEC 实现二次确认弹窗

- **位置**：`apps/admin/src/pages/MonitorList.tsx:468-491`
- **问题描述**：Taskplan 10.8 自测标准要求*“点击删除 → 弹出确认弹窗”*，当前实现是行内的“确认 / 取消”按钮。
- **影响**：功能等价，但 UI 与 SPEC 不一致，误触风险略高。
- **修改建议**：改为 Modal 弹窗确认，文案参考 SPEC 附录 A.3。

### P2-4. Admin 活跃度提示缺少 `⚪` 前缀

- **位置**：`apps/admin/src/pages/MonitorList.tsx:45-51`
- **问题描述**：`freshnessWarning` 返回的文本为 `"该博主已超过 N 天未更新..."`，缺少 SPEC 9.5 / PRD F4 要求的 `"⚪ "` 前缀。
- **影响**：视觉样式与产品文档不一致。
- **修改建议**：
  ```typescript
  return { text: `⚪ 该博主已超过 ${days} 天未更新${red ? "，建议关闭监控或移除" : ""}`, red };
  ```

### P2-5. `BilibiliAdapter.fetchDisplayName` 未携带 Cookie，风控下可能失败

- **位置**：`scripts/cron/src/adapters/bilibili.ts:139-147`
- **问题描述**：`x/space/acc/info` 接口在 B 站风控较严时可能需要 Cookie。`fetchDisplayName` 直接裸调，失败时返回 null，不影响主流程，但 `name_auto=true` 的昵称刷新效果差。
- **影响**：昵称自动刷新成功率降低。
- **修改建议**：在 `fetchDisplayName` 中复用 `loadCookie()` 携带 Cookie 请求。

### P2-6. `bilibili-auth` 中 `postgrestUpsert` 为死代码

- **位置**：`supabase/functions/bilibili-auth/index.ts:26-45`
- **问题描述**：函数已定义但从未被调用，Cookie 写入完全走 Vault RPC。
- **影响**：无功能影响，但增加维护成本，与 SPEC 2.4 “Cookie 已由 Edge Function 内部写入 platform_configs 表” 的描述产生歧义。
- **修改建议**：删除死代码，并在 SPEC/PROJECT_CONTEXT.md 中明确 Cookie 存储在 Vault，状态行存在 `platform_configs`。

### P2-7. H5 无限滚动未处理加载失败重试

- **位置**：`apps/h5/src/pages/Feed.tsx:28-60`
- **问题描述**：`fetchPage` 出错时仅在 console 打印，没有向用户展示错误，也没有重试机制。
- **影响**：网络抖动时用户看到空白或无法加载更多，没有反馈。
- **修改建议**：增加 `error` 状态，出错时显示“加载失败，点击重试”按钮。

---

## 6. P3 级建议（可排期优化）

### P3-1. 前端安装但未使用 `react-router-dom`

- **位置**：`apps/h5/package.json`、`apps/admin/package.json`
- **问题描述**：两个 SPA 都依赖 `react-router-dom`，但实际使用 hash 路由 + `window.location.hash` 自行管理。
- **建议**：要么移除依赖并使用原生 hash 路由，要么统一迁移到 `react-router-dom` 以获得更完善的路由、鉴权守卫和导航能力。

### P3-2. `.env.example` 变量名与前端 `VITE_` 前缀未对齐

- **位置**：`.env.example`
- **问题描述**：`.env.example` 列出 `SUPABASE_URL` / `SUPABASE_ANON_KEY`，但 Vite 项目需要 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。
- **建议**：在 `.env.example` 中补充前端变量名说明，或明确区分 Cron/Edge/Frontend 所需变量。

### P3-3. `config.toml` 中 `enable_signup = true`

- **位置**：`supabase/config.toml:176`、`auth.email.enable_signup = true`
- **问题描述**：SPEC 9.4 明确 MVP 阶段不需要注册功能，仅手动创建用户。本地配置允许注册，不影响生产 Supabase Cloud，但容易在部署时忘记关闭。
- **建议**：在部署文档中增加检查项：Supabase Dashboard → Auth → 禁用注册（Disable new users）。

### P3-4. `supabase/config.toml` 中 `major_version = 17` 与文档 PostgreSQL 15 不一致

- **位置**：`supabase/config.toml:42`
- **问题描述**：PROJECT_CONTEXT.md 写 PostgreSQL 15，但本地 config.toml 配置 major_version = 17。
- **建议**：更新文档，确认生产 Supabase 项目实际 PostgreSQL 版本，保持本地与云端一致。

### P3-5. `MonitorList` 平台筛选为客户端过滤，数据量大时性能差

- **位置**：`apps/admin/src/pages/MonitorList.tsx:100-108`
- **问题描述**：所有 monitor 一次性加载后在前端过滤。当前个人/小团队场景数据量小，没有问题。
- **建议**：未来数据量增长后，将平台筛选改为 Supabase query 条件。

### P3-6. Cron `RUN_ID` 仍保留 `GITHUB_RUN_ID` fallback

- **位置**：`scripts/cron/src/index.ts:18`
- **问题描述**：`const RUN_ID = \`run-${process.env.GITHUB_RUN_ID ?? Date.now()}\`;` 已兼容腾讯云部署，但 `GITHUB_RUN_ID` 残留无意义。
- **建议**：简化为 `const RUN_ID = \`run-${Date.now()}\`;`，减少歧义。

### P3-7. 腾讯云部署计划中 YouTube API 国内访问风险未在代码中预留降级

- **位置**：`scripts/cron/src/adapters/youtube.ts`
- **问题描述**：腾讯云国内服务器访问 `www.googleapis.com` 可能不稳定（部署计划已识别为最大风险），但代码中没有代理 fallback 或开关。
- **建议**：在 `.env.production` 中预留可选的 `YOUTUBE_PROXY_URL`，在 `YoutubeAdapter` 中支持通过代理请求 YouTube API，便于 Batch 2 实测后快速切换。

---

## 7. 符合性结论

| 维度 | 结论 | 说明 |
|---|---|---|
| **是否符合 Spec** | 部分符合 | 核心数据模型、API 契约、Cron 流程基本符合，但存在 P0/P1 级安全、状态机、业务语义偏差。 |
| **是否满足 PRD 业务目的** | 基本满足 | “配置 → 抓取 → 展示 → 跳转”主链路已打通，MVP 仅 B 站 + YouTube 的决策已落实。 |
| **字段遗漏** | 无严重遗漏 | 数据库字段与 SPEC 一致，但 `last_content_at` 语义实现偏差。 |
| **状态遗漏** | 有 | Monitor 三种状态存在，但 `normal` 状态边界、状态筛选“异常”语义需修正。 |
| **权限遗漏** | 有 | `platform_configs` 未对管理员脱敏，存在敏感信息泄露风险。 |
| **异常场景遗漏** | 有 | B 站 Cookie 缺失未走平台级短路；Admin 加载失败无提示；session 过期无刷新。 |
| **是否影响已有功能** | 是 | P0-2 会导致 Cookie 缺失时批量误告警；P0-4 会导致 H5 占位图显示异常。 |
| **腾讯云部署适配** | 已适配 | pm2 + node-cron、删除 GitHub Actions、删除 bilibili-fetch、B 站直连均已完成。 |

---

## 8. 修复优先级建议

**上线前必须完成（P0 + 关键 P1）**：
1. P0-1 删除 config.toml 硬编码 API Key 并轮换 Key
2. P0-2 B 站 Cookie 缺失走平台级短路
3. P0-3 platform_configs 对管理员脱敏
4. P0-4 H5 占位图 data URI 编码
5. P1-1 `last_content_at` 更新为 `now()`
6. P1-2 Admin“异常”筛选仅显示 `rate_limited`
7. P1-3 Admin session 自动刷新
8. P1-6 / P1-7 parse-url YouTube 解析逻辑修正

**上线后 1-2 周内完成（其余 P1 + P2）**：
- P1-4 B 站专栏接口 WBI 签名
- P1-5 YouTube `forHandle` @ 前缀
- P1-8 Admin 错误提示
- P2 级重复限速、状态机边界、弹窗、提示文本等

**可排期（P3）**：
- 移除未使用的 react-router-dom、.env.example 对齐、注册关闭检查项、YouTube 代理预留等。
