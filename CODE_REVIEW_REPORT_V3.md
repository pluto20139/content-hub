# 多平台内容中枢 — 第三次 Code Review 报告

> 评审范围：用户第二轮修复后的 diff（含 `apps/admin/*`、`apps/h5/*`、`scripts/cron/*`、`supabase/migrations/007_rls.sql`、`.env.example` 等）
> 依据文档：PRD v1.4、SPEC v1.6、Taskplan.md、腾讯云部署执行计划
> 部署约束：服务部署在腾讯云服务器，数据库保留 Supabase Cloud
> 评审日期：2026-07-03

---

## 1. 执行摘要

本次 re-review 验证 **第二轮修复** 的落地情况，结论如下：

- **P0 级问题**：全部关闭（3/3）。
- **P1 级问题**：全部关闭（8/8），包括 Admin session 刷新缺陷、Admin 列表加载错误、B 站专栏 WBI 签名。
- **P2 级问题**：全部关闭（7/7），包括重复限速、computeStatus 边界、删除弹窗、活跃度前缀、fetchDisplayName Cookie、H5 错误重试、postgrestUpsert 死代码。
- **剩余未修复**：2 个 P3 级文档/代码整洁项（`RUN_ID` 残留 GitHub 引用、`.env.example` 与 `PROJECT_CONTEXT.md` 部署注释未同步）。
- **新增发现**：1 个 P2 级语义偏差（Cron 平台级短路时会更新 `cookie_meta`，可能让 Admin 的"Cookie 更新时间"变成短路时间而非扫码时间）。

**整体判断**：核心功能链路（添加 → 解析 → 抓取 → 写回 → 展示）已完整且符合 SPEC/PRD 要求，权限脱敏也达到安全上线标准。剩余问题均为文档债或低风险语义项，可按"上线前顺手修"处理。

---

## 2. 风险等级定义

| 等级 | 定义 |
|---|---|
| **P0 — 阻塞** | 导致系统无法运行、构建/部署失败、敏感信息泄露、数据丢失或严重业务错误。 |
| **P1 — 高** | 导致功能异常、告警误报、权限失控、业务目的不达或运维困难。 |
| **P2 — 中** | 与 SPEC/PRD 不一致、边界场景处理缺失、体验缺陷，但不阻塞核心流程。 |
| **P3 — 低** | 代码债务、文档不同步、可优化项。 |

---

## 3. 修复状态验证

### 3.1 第二轮修复已确认关闭的问题

| 原编号 | 问题 | 验证结果 | 关键改动 |
|---|---|---|---|
| **P0-3** | `platform_configs` 对管理员脱敏不完全 | **已关闭** | `007_rls.sql` 新增 `platform_configs_admin` 视图，`cookie` 行 `config_value` 返回 NULL；物理表 SELECT 策略改为 `USING (false)`；Admin 改查视图 |
| **P1-3** | Admin session 刷新未重试原请求 | **已关闭** | `apps/admin/src/lib/supabase.ts` 实现 `getSessionOrRefresh` 单例 + 刷新成功后 `fetch` 重试原请求 |
| **P1-4** | B 站专栏接口未加 WBI 签名 | **已关闭** | `scripts/cron/src/adapters/bilibili.ts:115-121` 对 `x/space/article/list` 同样生成 `wts`/`w_rid` 参数 |
| **P1-8** | Admin 加载 monitor 列表失败无提示 | **已关闭** | `apps/admin/src/pages/MonitorList.tsx:67-85` 解构 `error`，设置 `error` 状态并显示重试按钮 |
| **P2-1** | `processPlatformGroup` 重复限速 | **已关闭** | `scripts/cron/src/index.ts:94-175` 移除外层 `withPlatformThrottle`，仅保留 Adapter 内部限速 |
| **P2-2** | `computeStatus` normal 状态边界 | **已关闭** | `scripts/cron/src/index.ts:42-43` normal 失败后直接按 `failCount >= 3` 判断 `rate_limited` 或 `cookie_expired` |
| **P2-3** | Admin 删除无二次确认弹窗 | **已关闭** | `apps/admin/src/pages/MonitorList.tsx:512-543` 新增 Modal 弹窗 |
| **P2-4** | 活跃度提示缺少 `⚪` 前缀 | **已关闭** | `apps/admin/src/pages/MonitorList.tsx:50` 已加 `⚪` 前缀 |
| **P2-5** | `fetchDisplayName` 未携带 Cookie | **已关闭** | `scripts/cron/src/adapters/bilibili.ts:150-157` 调用 `loadCookie` 并加入请求头 |
| **P2-7** | H5 无限滚动加载失败无重试 | **已关闭** | `apps/h5/src/pages/Feed.tsx` 新增 `error` 状态，支持空状态/列表尾部重试 |

### 3.2 上一轮已关闭的问题（保持关闭）

| 原编号 | 问题 | 状态 |
|---|---|---|
| **P0-1** | `supabase/config.toml` 硬编码 API Key | 关闭 |
| **P0-2** | B 站 Cookie 缺失未触发平台级短路 | 关闭 |
| **P0-4** | H5 占位图 data URI 未编码 | 关闭 |
| **P1-1** | `last_content_at` 语义偏差 | 关闭 |
| **P1-2** | Admin"异常"筛选包含 `cookie_expired` | 关闭 |
| **P1-5** | parse-url `/c/` 自定义 URL 解析错误 | 关闭 |
| **P1-6** | parse-url `forHandle` 缺少 `@` 前缀 | 关闭 |
| **P1-7** | bilibili-auth 未处理 86090 中间状态 | 关闭 |
| **P2-6** | bilibili-auth `postgrestUpsert` 死代码 | 关闭（已用于写入 `cookie_status`/`cookie_meta`） |

---

## 4. 新增发现的问题

### NEW-1. Cron 平台级短路时更新 `cookie_meta` 导致语义偏差（P2）

- **位置**：`scripts/cron/src/index.ts:71-90`
- **当前实现**：B 站平台级短路时，会执行 `upsert({ config_key: 'cookie_meta', config_value: nowIso })`。
- **问题**：`cookie_meta` 在 `bilibili-auth` 扫码成功时被写入，用于 Admin 展示"Cookie 最后更新时间"。短路时更新该字段，会让 Admin 看到的"更新时间"变成"最近一次失败时间"，而不是"最近一次扫码成功时间"。
- **风险**：管理员可能误判 Cookie 刚刚更新过，延误重新扫码。
- **修改建议**：平台级短路时只更新 `cookie_status='expired'`，不更新 `cookie_meta`。或者新增独立字段（如 `cookie_checked_at`）记录状态检查时间，避免混淆。

```typescript
// 建议：短路时只更新 cookie_status
await supabase.from("platform_configs").upsert(
  { platform: "bilibili", config_key: "cookie_status", config_value: "expired", updated_at: nowIso },
  { onConflict: "platform,config_key" },
);
// 删除 cookie_meta 的短路更新
```

---

## 5. 仍未修复的问题

### P3-1. `RUN_ID` 仍保留 `GITHUB_RUN_ID` 引用（P3）

- **位置**：`scripts/cron/src/index.ts:18`
- **当前实现**：`const RUN_ID = \`run-${process.env.GITHUB_RUN_ID ?? Date.now()}\`;`
- **风险**：腾讯云 pm2 部署下 `GITHUB_RUN_ID` 永远为 undefined，虽然不影响运行，但残留无意义环境依赖。
- **修改建议**：`const RUN_ID = \`run-${Date.now()}\`;`

### P3-2. `.env.example` 注释仍写 GitHub Secrets（P3）

- **位置**：`.env.example:7`
- **当前实现**：`YOUTUBE_API_KEY= # YouTube Data API v3 密钥（GitHub Secrets + Supabase Secrets 双配置）`
- **风险**：与当前腾讯云部署架构不一致，新部署者可能误解。
- **修改建议**：改为"腾讯云环境变量 + Supabase Edge Function 环境变量双配置"，并补充 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 说明。

### P3-3. `PROJECT_CONTEXT.md` 环境变量表格仍写 GitHub Secrets（P3）

- **位置**：`PROJECT_CONTEXT.md:1.3 环境变量清单`
- **当前实现**：`SUPABASE_SERVICE_ROLE_KEY` 写"GitHub Secrets 仅"，`YOUTUBE_API_KEY` 写"GitHub Secrets + Supabase Secrets"，`WECOM_WEBHOOK_URL` 写"GitHub Secrets"。
- **风险**：与腾讯云部署架构脱节。
- **修改建议**：统一改为"腾讯云服务器环境变量（.env.production）"或"Supabase Edge Function Secrets"。

---

## 6. 符合性结论

| 维度 | 结论 | 说明 |
|---|---|---|
| **P0 阻塞问题** | 全部解决 | 敏感信息、平台级短路、H5 占位图、权限脱敏均修复。 |
| **P1 高风险问题** | 全部解决 | Admin session、列表错误、B 站专栏 WBI、parse-url 等均已修复。 |
| **P2 中风险问题** | 全部解决 | 状态机边界、限速、删除弹窗、H5 错误重试等均已修复。 |
| **业务语义准确性** | 基本满足 | `last_content_at`、`last_sync_at`、状态流转均符合 SPEC。仅 `cookie_meta` 短路更新存在轻微语义偏差。 |
| **权限控制** | 满足 | 通过 `platform_configs_admin` 视图实现管理员脱敏，物理表拒绝 authenticated 读取。 |
| **异常场景覆盖** | 满足 | Cookie 失效、API 配额、列表加载失败、H5 加载失败均覆盖。 |
| **腾讯云部署适配** | 满足 | pm2 + node-cron、环境变量、删除 GitHub Actions 均完成。 |
| **文档同步** | 部分不足 | `.env.example` 和 `PROJECT_CONTEXT.md` 仍有 GitHub 时代注释残留。 |
| **是否影响已有功能** | 否 | 修复未引入破坏性变更。 |

---

## 7. 建议的上线前清单

### 必须完成（无）

所有 P0/P1/P2 问题均已关闭，核心链路无阻塞。

### 强烈建议完成

1. **NEW-1（P2）**：平台级短路时不再更新 `cookie_meta`，或拆分字段语义。

### 可顺手修复

2. **P3-1**：清理 `RUN_ID` 中的 `GITHUB_RUN_ID`。
3. **P3-2**：更新 `.env.example` 注释，补充前端 `VITE_` 变量说明。
4. **P3-3**：更新 `PROJECT_CONTEXT.md` 环境变量表格为腾讯云部署描述。

---

## 8. 总体评价

经过三轮修复，代码库已从上次的"P0 基本解决、P1 部分存在缺陷"进步到**全部 P0/P1/P2 关闭**的状态。核心功能符合 SPEC/PRD，权限模型安全，腾讯云部署架构清晰。剩余问题均为低风险文档/代码整洁项，不会阻塞上线。

建议按"上线前顺手修"处理 NEW-1 和 P3 文档债，然后进入集成测试阶段。
