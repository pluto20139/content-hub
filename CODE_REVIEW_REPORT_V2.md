# 多平台内容中枢 — 二次 Code Review 报告

> 评审范围：用户修复后的 diff（`git diff` 与新增文件）
> 依据文档：PRD v1.4、SPEC v1.6、Taskplan.md、腾讯云部署执行计划
> 部署约束：服务部署在腾讯云服务器，数据库保留 Supabase Cloud
> 评审日期：2026-07-03

---

## 1. 执行摘要

本次 re-review 共验证 **12 个 P0/P1/P2 问题** 的修复状态，结论如下：

- **已关闭**：8 个（含 3 个 P0、3 个 P1、1 个 P2、1 个文档/配置项）
- **部分修复**：2 个（P0-3 权限脱敏、P1-3 Admin session 刷新）
- **仍未修复**：7 个（1 个 P1、6 个 P2/P3）
- **新增发现**：3 个（P2 级 2 个、P3 级 1 个）

**整体判断**：P0 级安全与业务阻塞问题已基本解决，核心链路可以跑通；但 P1-8、P2-1、P2-2、P2-5 仍对稳定性与运维体验有实质影响，建议在上线前继续修复。Admin session 刷新实现存在逻辑缺陷，需要二次调整。

---

## 2. 风险等级定义

| 等级 | 定义 |
|---|---|
| **P0 — 阻塞** | 导致系统无法运行、构建/部署失败、敏感信息泄露、数据丢失或严重业务错误。 |
| **P1 — 高** | 导致功能异常、告警误报、权限失控、业务目的不达或运维困难。 |
| **P2 — 中** | 与 SPEC/PRD 不一致、边界场景处理缺失、体验缺陷，但不阻塞核心流程。 |
| **P3 — 低** | 代码债务、文档不同步、可优化项。 |

---

## 3. 已关闭问题清单

| 原编号 | 问题 | 验证结果 | 关键改动 |
|---|---|---|---|
| **P0-1** | `supabase/config.toml` 硬编码 YouTube API Key | 已关闭 | `YOUTUBE_API_KEY = "env(YOUTUBE_API_KEY)"`，RSSHUB 相关也改为 `env()` |
| **P0-2** | B 站 Cookie 缺失未走平台级短路 | 已关闭 | `bilibili.ts:76-80` 抛出的错误附加 `isPlatformLevel=true`；`fetchAll` probe 逻辑正确识别并整组跳过 |
| **P0-4** | H5 占位图 data URI 未编码 `#` | 已关闭 | `ContentCard.tsx:21-22` 使用 `encodeURIComponent(svg)` 生成 data URI |
| **P1-1** | `last_content_at` 语义偏差 | 已关闭 | `index.ts:126` 改为 `lastContentAt: inserted > 0 ? new Date().toISOString() : undefined` |
| **P1-2** | Admin“异常”筛选包含 `cookie_expired` | 已关闭 | `MonitorList.tsx:24` 改为 `rate_limited`，过滤逻辑同步简化 |
| **P1-5** | parse-url `/c/` 自定义 URL 解析错误 | 已关闭 | `parse-url/index.ts:125-127` 明确返回不支持 `/c/`，避免错误调用 `forUsername` |
| **P1-6** | parse-url `forHandle` 缺少 `@` 前缀 | 已关闭 | `parse-url/index.ts:100` 改为 `forHandle=@${value}` |
| **P1-7** | bilibili-auth 未处理扫码状态码 86090 | 已关闭 | `bilibili-auth/index.ts:108` 将 86090 纳入 `waiting` 状态 |
| **P2-6** | bilibili-auth `postgrestUpsert` 死代码 | 已关闭 | 该函数现用于写入 `cookie_status` 与 `cookie_meta`，不再是死代码 |

**修复质量评价**：上述改动位置准确、逻辑清晰，P0-2 的 probe 模式还能同时覆盖 Cookie 失效场景，设计合理。

---

## 4. 部分修复问题

### P0-3. `platform_configs` 对管理员的权限脱敏仅过滤 `cookie` 行 ⚠️ 降为 P1

- **位置**：`supabase/migrations/007_rls.sql:27`、`apps/admin/src/pages/MonitorList.tsx:81-92`
- **当前实现**：
  ```sql
  CREATE POLICY platform_configs_admin_read ON platform_configs
    FOR SELECT TO authenticated
    USING (config_key != 'cookie');
  ```
  将 `cookie` 密文行过滤掉，但管理员仍可读取 `cookie_status`、`cookie_meta` 的 `config_value`。
- **问题**：SPEC 4.1 原文要求 *“platform_configs 的 SELECT 对管理员脱敏（不返回 config_value 原文，只返回 config_key 和 updated_at）”*。当前实现过滤了真正敏感行，但 `config_value` 列本身仍对管理员开放。
- **风险**：当前 `cookie_status`/`cookie_meta` 的值不敏感，实际风险可控；但若未来新增敏感配置项（如 API Secret、Refresh Token）存入 `platform_configs`，容易复犯。
- **修改建议**：
  1. 创建视图 `platform_configs_admin` 仅暴露 `(platform, config_key, updated_at)`；
  2. Admin 端改为读取该视图，不再读取 `config_value`；
  3. `cookie_status` 这种非敏感状态可单独建表或走独立字段暴露。

**风险等级调整**：从 P0 下调为 **P1**（当前无实际敏感信息泄露，但架构不符合 SPEC）。

### P1-3. Admin session 自动刷新实现有缺陷 ⚠️ 仍为 P1

- **位置**：`apps/admin/src/lib/supabase.ts:10-28`
- **当前实现**：在 `global.fetch` 拦截器里检测 401，调用 `supabase.auth.refreshSession()`，失败则跳转登录页。
- **问题**：
  1. **没有重试原请求**：401 响应仍然返回给调用方，用户会先收到一次失败，体验未根本改善；
  2. **refreshSession 自身可能再次进入拦截器**：`supabase.auth.refreshSession()` 内部会请求 `/auth/v1/token`，虽然代码排除了 `/auth/v1/`，但 Supabase 刷新 token 的 URL 可能匹配 `/auth/v1/` 子路径，需确认不会死循环；
  3. **竞态条件**：并发 401 会触发多次 `refreshSession()`。
- **修改建议**：
  1. 优先依赖 Supabase JS 自带的 `autoRefreshToken: true`（默认已启用），移除自定义拦截器，或仅用于兜底；
  2. 如需自定义拦截器，应在刷新成功后**重试原始请求**并返回新响应；
  3. 使用单例 Promise 避免并发刷新。

---

## 5. 仍未修复问题

### P1-4. B 站专栏接口未加 WBI 签名（仍为 P1）

- **位置**：`scripts/cron/src/adapters/bilibili.ts:118-119`
- **状态**：未修复，仍直接请求 `x/space/article/list?mid=...&pn=1&ps=6`。
- **风险**：B 站空间类接口逐步接入 WBI，未来可能 403；代码 catch 后仅返回视频，内容丢失静默。
- **修改建议**：复用 `getMixinKey` / `wbiSign` 对专栏接口签名，或先用真实请求验证当前是否强制 WBI。

### P1-8. Admin 加载 monitor 列表失败无提示（仍为 P1）

- **位置**：`apps/admin/src/pages/MonitorList.tsx:68-76`
- **状态**：未修复，`fetchMonitors` 仍只解构 `{ data }`，未处理 `error`。
- **风险**：Supabase 查询失败时 `setLoading(false)` 可能不执行，页面卡住；管理员无法感知网络/RLS/服务异常。
- **修改建议**：
  ```typescript
  const { data, error } = await supabase.from("monitors").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("Failed to fetch monitors:", error.message);
    setError("加载监控列表失败，请刷新重试");
    setLoading(false);
    return;
  }
  setMonitors((data ?? []) as Monitor[]);
  setLoading(false);
  ```

### P2-1. `processPlatformGroup` 对 B 站结果重复限速（仍为 P2）

- **位置**：`scripts/cron/src/index.ts:94-95`
- **状态**：未修复，外层仍包裹 `withPlatformThrottle(adapter.platform, ...)`。
- **风险**：B 站 Adapter 内部 `fetchAll` 每条 monitor 已做 1500ms 限速；外层再限速会让整组额外增加约 `(N-1)*1500ms`。
- **修改建议**：移除 `processPlatformGroup` 内层 `withPlatformThrottle`，将限速职责完全下放到 Adapter。

### P2-2. `computeStatus` 在 `normal` 状态下存在异常边界（仍为 P2）

- **位置**：`scripts/cron/src/index.ts:42-44`
- **状态**：未修复。
- **风险**：如果管理员手动把 monitor 重置为 `normal` 但未清零 `fail_count`，且 `fail_count >= 2`，下一次失败会进入 `cookie_expired` 而非 `rate_limited`，可能导致应告警的 monitor 未触发告警。
- **修改建议**：
  ```typescript
  if (currentStatus === "normal") {
    return failCount >= 3 ? { status: "rate_limited", failCount } : { status: "cookie_expired", failCount };
  }
  ```

### P2-3. Admin 删除 monitor 仍使用行内确认按钮（仍为 P2）

- **位置**：`apps/admin/src/pages/MonitorList.tsx:466-488`
- **状态**：未修复。
- **风险**：UI 与 Taskplan 10.8 自测标准不一致，误触风险略高。
- **修改建议**：改为 Modal 弹窗确认。

### P2-4. Admin 活跃度提示缺少 `⚪` 前缀（仍为 P2）

- **位置**：`apps/admin/src/pages/MonitorList.tsx:50`
- **状态**：未修复。
- **修改建议**：`return { text: `⚪ 该博主已超过 ${days} 天未更新${red ? "，建议关闭监控或移除" : ""}`, red };`

### P2-5. `BilibiliAdapter.fetchDisplayName` 未携带 Cookie（仍为 P2）

- **位置**：`scripts/cron/src/adapters/bilibili.ts:143-151`
- **状态**：未修复，仍裸调 `x/space/acc/info`。
- **风险**：B 站风控较严时可能 403，昵称自动刷新成功率下降。
- **修改建议**：复用 `loadCookie()` 携带 Cookie。

### P2-7. H5 无限滚动未处理加载失败重试（仍为 P2）

- **位置**：`apps/h5/src/pages/Feed.tsx:44-47`
- **状态**：未修复，出错仅 `console.error`。
- **修改建议**：增加 `error` 状态与“加载失败，点击重试”按钮。

---

## 6. 新增发现的问题

### NEW-1. `apps/admin/src/lib/supabase.ts` 的 401 拦截器没有重试原请求（P1）

- **位置**：`apps/admin/src/lib/supabase.ts:16-26`
- **问题描述**：检测到 401 时刷新 token 后直接返回原 401 响应，调用方会收到失败；refreshSession 自身的请求可能再次进入拦截器。
- **风险等级**：P1
- **修改建议**：见 4.2 P1-3 的修改建议。

### NEW-2. `.env.example` 注释与部署架构不同步（P3）

- **位置**：`.env.example:7`
- **问题描述**：注释仍写 *“GitHub Secrets + Supabase Secrets 双配置”*，与当前腾讯云部署不符；同时未列出前端需要的 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。
- **风险等级**：P3
- **修改建议**：
  ```
  # YouTube
  YOUTUBE_API_KEY=           # Cron 脚本使用：配置在腾讯云服务器 .env.production
                             # parse-url Edge Function 使用：配置在 Supabase Dashboard → Edge Functions Secrets
  ```
  并补充前端变量说明。

### NEW-3. `RUN_ID` 仍保留 `GITHUB_RUN_ID` fallback（P3）

- **位置**：`scripts/cron/src/index.ts:18`
- **问题描述**：`const RUN_ID = \`run-${process.env.GITHUB_RUN_ID ?? Date.now()}\`;` 中 `GITHUB_RUN_ID` 残留无意义。
- **风险等级**：P3
- **修改建议**：简化为 `const RUN_ID = \`run-${Date.now()}\`;`。

---

## 7. 符合性结论

| 维度 | 结论 | 说明 |
|---|---|---|
| **P0 阻塞问题** | 基本解决 | 硬编码密钥、平台级短路、H5 占位图均已修复。 |
| **权限脱敏** | 部分解决 | `cookie` 行已过滤，但 `platform_configs` 的 `config_value` 列仍对管理员开放，与 SPEC 4.1 字面要求不符。 |
| **业务语义** | 已解决 | `last_content_at`、`异常` 筛选、`/c/` 与 `/@handle` 解析均正确。 |
| **异常场景** | 部分解决 | B 站 Cookie 缺失/失效已整组跳过；Admin 加载失败、H5 加载失败仍未向用户反馈。 |
| **状态机** | 未解决 | `computeStatus` normal 状态边界仍可能产生误判。 |
| **运维体验** | 部分解决 | pm2 + node-cron 架构已落地；Admin session 刷新实现有缺陷。 |
| **是否影响已有功能** | 否 | 本次修复未引入破坏性变更。 |
| **腾讯云部署适配** | 已适配 | `ecosystem.config.cjs`、`scheduler.ts`、`.env.production`、文档更新均已完成。 |

---

## 8. 修复优先级建议

### 上线前必须完成

1. **P1-3 / NEW-1**：修正 Admin session 刷新逻辑（建议直接依赖 Supabase 自动刷新，或实现重试原请求）。
2. **P1-8**：为 `fetchMonitors` 添加错误处理与加载失败提示。
3. **P2-2**：修正 `computeStatus` normal 状态边界，避免漏告警。
4. **P2-1**：移除 `processPlatformGroup` 外层重复限速。

### 上线后 1-2 周内完成

- P1-4：B 站专栏接口 WBI 签名。
- P0-3（调整后的 P1）：按 SPEC 4.1 彻底脱敏 `platform_configs`，Admin 改读视图。
- P2-5：`fetchDisplayName` 携带 Cookie。
- P2-3 / P2-4 / P2-7：删除弹窗、活跃度前缀、H5 错误重试。

### 可排期

- NEW-2 / NEW-3：`.env.example` 注释、`RUN_ID` 清理。
- P3 级：react-router-dom 移除、YouTube 代理预留、注册关闭检查项、PostgreSQL 版本文档同步。

---

## 9. 总体评价

本次修复集中解决了上次 review 中最危险的 P0 问题，核心抓取链路（添加 → 解析 → 抓取 → 写回 → 展示）已具备上线条件。剩余问题多为体验、边界和架构一致性，按上述优先级分批处理即可。建议优先修正 **Admin session 刷新** 与 **Admin 列表加载错误处理**，这两项直接影响管理员日常使用体验。
