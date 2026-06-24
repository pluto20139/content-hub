# Taskplan.md — 多平台内容中枢实现计划

> 基于 SPEC v1.5 拆解，每个 Step 为最小可验证单元。
> 技术栈：pnpm Monorepo / React 18 + Vite 5 + Tailwind CSS / Supabase (PostgreSQL + PostgREST + Edge Functions) / GitHub Actions / Node.js 20

> **MVP 平台范围**：B站 + YouTube 两平台。知乎因 RSSHub 公共实例失效 + API 直连需 IP 风控验证，延后至 Phase 2（见附录 A：知乎延后决策记录）。
> 标注为 `[Phase 2]` 的 Step 不在 MVP 实施范围，仅作为后续迭代参考保留。

---

## Phase 0：项目脚手架

### Step 0.1 — 初始化 pnpm Monorepo

**动作**：在项目根目录执行 `pnpm init`，创建 `pnpm-workspace.yaml`，声明四个工作区：
```
apps/h5
apps/admin
packages/shared
scripts/cron
```
创建根目录 `.nvmrc`（锁定 Node 20）、`.gitignore`、`tsconfig.base.json`。

**自测标准**：
- [ ] `pnpm ls -r` 输出四个 workspace
- [ ] 根 `tsconfig.base.json` 可被子包 `extends`

### Step 0.2 — 初始化 packages/shared

**动作**：创建 `packages/shared/package.json`（name: `@content-hub/shared`），设置 `main`/`types` 指向 `dist/`，安装 TypeScript 并创建 `tsconfig.json`（extends 根配置）。

**自测标准**：
- [ ] `pnpm --filter @content-hub/shared build` 编译通过（暂无源码，输出空目录即可）

### Step 0.3 — 初始化 apps/h5

**动作**：使用 `pnpm create vite apps/h5 --template react-ts` 初始化，安装 Tailwind CSS v3 并配置 `tailwind.config.js`（content 包含 `packages/shared/src/**`）。设置 `vite.config.ts` 的 resolve alias 指向 `@content-hub/shared`。

**自测标准**：
- [ ] `pnpm --filter h5 dev` 启动成功，浏览器显示 Vite 默认页
- [ ] `index.css` 中 `@tailwind base;` 生效（检查 body 样式被 Tailwind reset）

### Step 0.4 — 初始化 apps/admin

**动作**：同 Step 0.3，使用 Vite + React + TS + Tailwind 初始化 Admin SPA。

**自测标准**：
- [ ] `pnpm --filter admin dev` 启动成功
- [ ] 两个 app 可同时在不同端口运行

### Step 0.5 — 初始化 scripts/cron

**动作**：创建 `scripts/cron/package.json`（name: `@content-hub/cron`，type: `module`），安装 TypeScript、`@supabase/supabase-js`，创建 `tsconfig.json`。入口文件 `src/index.ts`。

**自测标准**：
- [ ] `pnpm --filter @content-hub/cron exec tsc --noEmit` 类型检查通过

### Step 0.6 — 初始化 Supabase 本地开发环境

**动作**：安装 Supabase CLI，执行 `supabase init` 创建 `supabase/` 目录。创建 `supabase/migrations/` 目录用于存放迁移文件。

**自测标准**：
- [ ] `supabase start` 启动成功（本地 Postgres + PostgREST + Studio）
- [ ] `supabase status` 输出 REST API URL 和 anon key

### Step 0.7 — Supabase Edge Functions 开发环境（Deno）

**动作**：安装 Deno 运行时（`brew install deno` 或官方脚本）。创建 `supabase/functions/deno.json`，配置 imports 映射（`@supabase/functions-js` 等）。Edge Functions 运行在 Deno 上而非 Node.js，代码需使用 Deno 风格的 import。

**自测标准**：
- [ ] `deno --version` 输出版本号
- [ ] `supabase/functions/deno.json` 存在且包含 imports 配置
- [ ] 创建 `supabase/functions/_shared/cors.ts` 导出 CORS headers 工具（后续 Edge Functions 复用）
- [ ] `supabase functions serve` 可启动本地 Edge Functions 开发服务器

### Step 0.8 — 环境变量模板 .env.example

**动作**：在项目根目录创建 `.env.example`，列出所有环境变量及说明，作为环境配置的单一来源。各子包（apps/h5、apps/admin、scripts/cron）按需创建各自的 `.env.local`（已被 .gitignore 忽略）。

```bash
# Supabase
SUPABASE_URL=              # Supabase 项目 URL
SUPABASE_ANON_KEY=         # 匿名密钥（H5/Admin 前端使用）
SUPABASE_SERVICE_ROLE_KEY= # 服务角色密钥（Cron 脚本使用，切勿泄露）

# YouTube
YOUTUBE_API_KEY=           # YouTube Data API v3 密钥（GitHub Secrets + Supabase Secrets 双配置）

# 告警
WECOM_WEBHOOK_URL=         # 企业微信 Webhook URL（可选，未配置则仅记录日志）

# 以下变量 MVP 不使用，Phase 2 启用知乎适配器时配置
# RSSHUB_URL=                # RSSHub 实例地址（Phase 2）
# RSSHUB_API_KEY=            # RSSHub 鉴权密钥（Phase 2）
```

**自测标准**：
- [ ] `.env.example` 包含以上全部变量及说明
- [ ] `.gitignore` 中包含 `.env.local` 和 `.env`
- [ ] 各子包的 `.env.local` 可从 `.env.example` 复制并填写

---

## Phase 1：数据库 Schema

### Step 1.1 — monitors 表迁移

**动作**：创建 `supabase/migrations/001_monitors.sql`，内容严格照搬 SPEC 1.2（含 CHECK 约束、UNIQUE 约束、所有 COMMENT）。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] Supabase Studio → Table Editor 可看到 `monitors` 表
- [ ] 手动 INSERT 一条 `platform='bilibili'` 记录成功
- [ ] 手动 INSERT `platform='douyin'` 被 CHECK 约束拒绝
- [ ] 手动 INSERT 重复 `(platform, native_id)` 被 UNIQUE 约束返回 23505

### Step 1.2 — contents 表迁移

**动作**：创建 `supabase/migrations/002_contents.sql`，含外键 `ON DELETE SET NULL`、UNIQUE 约束、CHECK 约束。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] INSERT contents 引用不存在的 monitor_id → 外键约束拒绝
- [ ] INSERT contents 引用存在的 monitor_id → 成功
- [ ] DELETE 对应 monitor → contents 的 monitor_id 变为 NULL，记录保留

### Step 1.3 — platform_configs 表迁移

**动作**：创建 `supabase/migrations/003_platform_configs.sql`，含 UNIQUE(platform, config_key)。启用 Supabase Vault 扩展（`CREATE EXTENSION IF NOT EXISTS supabase_vault;`）用于 `config_value` 加密存储。同时预置以下状态行：
- `platform='bilibili', config_key='cookie_status'`，`config_value='valid'`（初始值）

该行用于 Cron 平台级短路状态的持久化：Cron 短路时 PATCH 为 `expired`，Cron 成功时 PATCH 为 `valid`。Admin SPA 查询该行判断 Cookie 状态（因 GitHub Actions 日志 Web 应用无法访问）。

> **Vault 使用方式**：写入时通过 `vault.create_secret(config_value)` 加密，读取时通过 `vault.decrypted_secrets` 视图解密。Edge Function（Deno）中通过 PostgREST RPC 调用 `vault.create_secret()`，通过查询 `vault.decrypted_secrets` 视图获取明文。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] INSERT `platform='bilibili', config_key='cookie'` 成功
- [ ] 重复 INSERT 同一 (platform, config_key) 被拒绝
- [ ] 预置行 `cookie_status='valid'` 存在
- [ ] PATCH `cookie_status` 为 `expired` 成功，Admin SPA 可查询到该状态

### Step 1.4 — cron_locks 表迁移

**动作**：创建 `supabase/migrations/004_cron_locks.sql`，含表定义 + 初始化单行 `INSERT INTO cron_locks (id, locked_at, locked_by) VALUES (1, NULL, NULL)`。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] `SELECT * FROM cron_locks` 返回 1 行，`locked_at IS NULL`
- [ ] 执行加锁 SQL 后 `locked_at` 不为 NULL
- [ ] 再次执行加锁 SQL（locked_at 非 NULL 且未超 15 分钟）→ affected_rows = 0

### Step 1.5 — cron_soft_delete_logs 表迁移

**动作**：创建 `supabase/migrations/005_cron_soft_delete_logs.sql`。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] INSERT 一条日志记录成功

### Step 1.6 — 索引迁移

**动作**：创建 `supabase/migrations/006_indexes.sql`，照搬 SPEC 1.5 全部 7 个索引（3 个 monitors + 4 个 contents）。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] `\di` 可看到 `idx_monitors_is_active` 等所有索引

### Step 1.7 — RLS 策略迁移

**动作**：创建 `supabase/migrations/007_rls.sql`，照搬 SPEC 4.2 全部 RLS 策略 SQL（5 张表的 ENABLE RLS + 各 POLICY）。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] 使用 anon key 查询 contents → 只返回 `is_display=true` 的记录
- [ ] 使用 anon key 查询 monitors → 返回 200 且数据为空数组（RLS 无 anon 策略，默认拒绝但返回空）
- [ ] 使用 authenticated token 查询 monitors → 返回全部记录
- [ ] 使用 service_role key 查询 cron_locks → 成功
- [ ] 使用 authenticated token 查询 cron_locks → 返回空（无权限）

### Step 1.8 — pg_cron 软删除任务

**动作**：创建 `supabase/migrations/008_pg_cron_soft_delete.sql`，含 pg_cron 扩展启用 + 软删除任务调度（带日志写入 cron_soft_delete_logs）。

**自测标准**：
- [ ] `supabase db reset` 执行成功
- [ ] `SELECT * FROM cron.job` 可看到 `soft-delete-30d` 任务
- [ ] 手动 INSERT 一条 `created_at = now() - 31 days` 的 contents 记录
- [ ] 直接执行软删除 SQL 块后该记录 `is_display = false`（手动触发方式：复制迁移中的 UPDATE 语句执行）
- [ ] `cron_soft_delete_logs` 新增一条 `affected_rows >= 1` 的日志

---

## Phase 2：packages/shared 共享包

### Step 2.1 — 平台常量定义

**动作**：创建 `packages/shared/src/constants/platforms.ts`，定义平台枚举、中文名、品牌色（SPEC 9.1）。

**自测标准**：
- [ ] `PLATFORMS` 对象包含 bilibili/zhihu/youtube 三个条目
- [ ] 每个条目的 `brandColor` 分别为 `#FB7299`/`#0066FF`/`#FF0000`
- [ ] TypeScript 编译通过

### Step 2.2 — Deep Link 常量定义

**动作**：创建 `packages/shared/src/constants/deep-link.ts`，定义 `DEEP_LINK_SCHEMAS` 映射表（SPEC 5.7）。

**自测标准**：
- [ ] `getDeepLink('bilibili', 'video', 'BV123')` 返回 `bilibili://video/BV123`
- [ ] `getDeepLink('zhihu', 'article', '123')` 返回 `null`（知乎无 Deep Link）
- [ ] TypeScript 编译通过

### Step 2.3 — 相对时间格式化工具函数

**动作**：创建 `packages/shared/src/utils/time.ts`，实现 `formatRelativeTime(date: Date): string`（SPEC 9.2）。

**自测标准**：
- [ ] 输入 30 秒前 → 返回 `"刚刚"`
- [ ] 输入 5 分钟前 → 返回 `"5分钟前"`
- [ ] 输入 3 小时前 → 返回 `"3小时前"`
- [ ] 输入 15 天前 → 返回 `"15天前"`
- [ ] 输入 60 天前 → 返回 `"2026-04-23"`（绝对日期，基准日 2026-06-22）
- [ ] 单元测试全部通过

### Step 2.4 — 活跃度天数计算函数

**动作**：在 `time.ts` 中追加 `getDaysSinceActivity(date: Date): number`（SPEC 9.5）。

**自测标准**：
- [ ] 输入 45 天前 → 返回 `45`
- [ ] 输入今天 → 返回 `0`

### Step 2.5 — EnvironmentDetector

**动作**：创建 `packages/shared/src/utils/environment.ts`，实现 `detectEnvironment(ua: string): 'wechat' | 'alipay' | 'browser'`（SPEC 5.7.1）。

**自测标准**：
- [ ] 输入含 `MicroMessenger` 的 UA → 返回 `'wechat'`
- [ ] 输入含 `AlipayClient` 的 UA → 返回 `'alipay'`
- [ ] 输入普通 Chrome UA → 返回 `'browser'`
- [ ] 单元测试全部通过

### Step 2.6 — 导出入口

**动作**：创建 `packages/shared/src/index.ts`，统一 re-export 所有常量和工具函数。配置 `package.json` 的 `exports` 字段。

**自测标准**：
- [ ] `pnpm --filter @content-hub/shared build` 编译通过
- [ ] `apps/h5` 中 `import { PLATFORMS } from '@content-hub/shared'` 可正确解析

---

## Phase 3：Edge Function — parse-url

### Step 3.1 — Edge Function 骨架

**动作**：创建 `supabase/functions/parse-url/index.ts`，实现 HTTP POST 请求解析（接收 `{ url }`，返回 `{ success, data }` 或 `{ success: false, error }`）。配置 CORS headers。

**自测标准**：
- [ ] `supabase functions serve` 启动成功
- [ ] `curl -X POST http://localhost:54321/functions/v1/parse-url -d '{"url":"https://example.com"}'` 返回 `UNKNOWN_PLATFORM` 错误

### Step 3.2 — B站 URL 识别

**动作**：实现 B站 URL 匹配逻辑：正则提取 `space.bilibili.com/(\d+)` 中的 mid，调用 `x/space/acc/info` API 获取昵称，失败时降级为 `B站_{mid前8位}`。

**自测标准**：
- [ ] POST `{"url":"https://space.bilibili.com/12345"}` → 返回 `{ platform: "bilibili", native_id: "12345", display_name: "..." }`
- [ ] 昵称 API 超时/失败时 → display_name = `"B站_12345678"`

### Step 3.3 — YouTube URL 识别（3 种格式）

**动作**：实现 YouTube 三种 URL 格式识别（SPEC 2.3）：
1. `youtube.com/@handle` → `channels.list?forHandle=`
2. `youtube.com/channel/UCxxxx` → 直接提取 channelId
3. `youtube.com/c/customname` → `channels.list?forUsername=`

**自测标准**：
- [ ] POST `{"url":"https://www.youtube.com/@mkbhd"}` → 返回 channelId
- [ ] POST `{"url":"https://www.youtube.com/channel/UCBcRF18a7Qf58cCRy5xuWwQ"}` → native_id = `UCBcRF18a7Qf58cCRy5xuWwQ`
- [ ] POST `{"url":"https://www.youtube.com/c/SomeName"}` → 返回 channelId
- [ ] 昵称获取失败 → display_name = `"YouTube_{channelId前8位}"`

### Step 3.4 — 知乎 URL 识别 `[Phase 2]`

> **延后原因**：知乎适配器整体延后（见附录 A）。MVP 阶段 parse-url 只识别 B站 + YouTube，知乎 URL 返回 `UNKNOWN_PLATFORM` 即可。

**动作**：实现知乎 URL 匹配（`/people/xxx` 或 `/column/xxx`），调用 RSSHub 接口获取昵称。

**自测标准**：
- [ ] POST `{"url":"https://www.zhihu.com/people/excited-vczh"}` → `{ platform: "zhihu", native_id: "excited-vczh" }`
- [ ] POST `{"url":"https://www.zhihu.com/column/c_1256734926581866496"}` → `{ platform: "zhihu", native_id: "c_1256734926581866496" }`

### Step 3.5 — 知乎文章链接拒绝 + 未知 URL 处理 `[Phase 2]`

> **MVP 调整**：MVP 阶段知乎 URL 直接归入"未知 URL"分支返回 `UNKNOWN_PLATFORM`。知乎文章链接特殊提示文案延后至 Phase 2。

**动作**：添加 `zhuanlan.zhihu.com/p/` 的特殊处理（返回 `UNKNOWN_PLATFORM` + 特定提示文案），以及其他 URL 的兜底错误。

**自测标准**：
- [ ] POST `{"url":"https://zhuanlan.zhihu.com/p/123456"}` → 错误信息含"请粘贴博主主页链接，而非文章链接"
- [ ] POST `{"url":"https://google.com"}` → 返回 `UNKNOWN_PLATFORM`
- [ ] POST `{"url":"not-a-url"}` → 返回 `INVALID_URL`

### Step 3.6 — 错误码规范对齐

**动作**：确保 parse-url Edge Function 的所有错误响应严格遵循 SPEC 2.6 错误码表中 parse-url 涉及的 5 个码（`UNKNOWN_PLATFORM`/`INVALID_URL`/`YOUTUBE_API_ERROR`/`RSSHUB_ERROR`/`INTERNAL_ERROR`）。

**自测标准**：
- [ ] 每种错误码的 HTTP status code 与 SPEC 一致
- [ ] 错误响应格式统一为 `{ success: false, error: { code, message } }`

---

## Phase 4：Edge Function — bilibili-auth

### Step 4.1 — 获取二维码接口

**动作**：创建 `supabase/functions/bilibili-auth/index.ts`，实现 `action: "qrcode"` 分支。调用 B站二维码 API，返回 `{ qr_url, qrcode_key }`。

**自测标准**：
- [ ] POST `{"action":"qrcode"}` → 返回 200 + `qr_url` 和 `qrcode_key`
- [ ] `qr_url` 为有效 URL（`https://passport.bilibili.com/...`）

### Step 4.2 — 轮询扫码状态接口

**动作**：实现 `action: "poll"` 分支，调用 B站轮询 API，返回 `waiting`/`success`/`expired` 三种状态。

**自测标准**：
- [ ] 未扫码时 → 返回 `{ status: "waiting" }`
- [ ] 二维码过期后 → 返回 `{ status: "expired" }`

### Step 4.3 — 扫码成功后写入 Cookie

**动作**：扫码成功时，将 Cookie JSON 写入 `platform_configs` 表（`platform=bilibili, config_key=cookie`），使用 UPSERT。config_value 需通过 Supabase Vault 加密存储（SPEC 1.4/5.3），读取时解密。

**自测标准**：
- [ ] 扫码成功后 `SELECT config_value, updated_at FROM platform_configs WHERE platform='bilibili' AND config_key='cookie'` 返回非空
- [ ] `updated_at` 为当前时间
- [ ] config_value 为加密存储（非明文），读取时通过 Vault 解密还原

### Step 4.4 — Cookie 写入失败处理

**动作**：wrap 数据库写入操作，捕获异常并返回 `INTERNAL_ERROR` + "登录成功但 Cookie 保存失败"提示（SPEC 2.4）。

**自测标准**：
- [ ] 模拟数据库写入失败 → 返回 `{ success: false, error: { code: "INTERNAL_ERROR", message: "登录成功但 Cookie 保存失败，请重试" } }`

---

## Phase 5：Cron 脚本 — 基础设施

### Step 5.1 — Supabase 客户端初始化

**动作**：创建 `scripts/cron/src/lib/supabase.ts`，使用 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 创建 service_role 客户端。

**自测标准**：
- [ ] `createClient()` 不抛异常
- [ ] 缺少环境变量时抛出明确错误

### Step 5.2 — 行级锁获取与释放

**动作**：创建 `scripts/cron/src/lib/lock.ts`，实现 `acquireLock(runId)` 和 `releaseLock()`（SPEC 3.3 REST API 调用方式，原子 PATCH + or 过滤器）。URL 中的冒号编码为 `%3A`。

**自测标准**：
- [ ] `acquireLock("test-run-1")` → 返回 true，`cron_locks` 表 `locked_by = "test-run-1"`
- [ ] 锁已持有时再次 `acquireLock("test-run-2")` → 返回 false
- [ ] `releaseLock()` → `locked_at` 恢复为 NULL
- [ ] 锁超时（`locked_at` > 15 分钟前）→ `acquireLock` 可成功获取

### Step 5.3 — 锁释放放入 finally 块

**动作**：确保锁释放在 `try/finally` 块中执行，释放失败时记录错误日志但不影响退出码（SPEC 5.8 Step 6）。

**自测标准**：
- [ ] 即使中间步骤抛出异常，`releaseLock()` 仍被调用
- [ ] `releaseLock()` 失败时进程仍正常退出（exit code 0）

### Step 5.4 — 查询 monitors + YouTube 4 小时降频

**动作**：创建 `scripts/cron/src/lib/monitors-query.ts`，实现 Step 2 + Step 2.5：查询 `is_active=true` 的 monitors，YouTube 组按 `last_sync_at` 降频过滤（SPEC 5.8 具体 REST API 查询语句）。

> **MVP 范围**：仅 B站 + YouTube。知乎组查询延后至 Phase 2。

**自测标准**：
- [ ] B站 monitor 全部返回（不受降频限制）
- [ ] YouTube monitor 中 `last_sync_at` 为 2 小时前的被过滤
- [ ] YouTube monitor 中 `last_sync_at` 为 null 或 5 小时前的保留
- [ ] `is_active=false` 的 monitor 不在结果中

### Step 5.5 — 同平台限速 sleep 工具

**动作**：创建 `scripts/cron/src/lib/throttle.ts`，实现 `sleep(ms: number): Promise<void>` 和 `withPlatformThrottle(platform: string, fn: () => Promise<T>): Promise<T>` 封装。B站同平台请求间强制 sleep ≥ 1500ms（SPEC 要求），YouTube 无此限制。

> **MVP 范围**：仅 B站需要限速。知乎组限速延后至 Phase 2（知乎适配器启用时复用同一工具）。

**自测标准**：
- [ ] `sleep(1500)` 等待约 1500ms 后 resolve
- [ ] 连续调用 `withPlatformThrottle('bilibili', fn)` 两次，间隔 ≥ 1500ms
- [ ] 连续调用 `withPlatformThrottle('youtube', fn)` 两次，无强制等待
- [ ] 单元测试验证时间间隔

---

## Phase 6：Cron 脚本 — 平台适配器

### Step 6.1 — PlatformAdapter 接口定义

**动作**：创建 `scripts/cron/src/adapters/types.ts`，定义 `PlatformAdapter` 接口 + `Monitor`/`RawContent`/`CronResult`/`ContentWriter`/`MonitorStatus` 等类型（SPEC 2.5 + 5.5 + 5.6）。

> **`fetchAll` 方法归属说明**：`fetchAll`（平台级短路探测）不是 `PlatformAdapter` 接口方法，而是各适配器独立实现的内部方法。CronRunner 在 Step 7.7 中按平台分组后，调用适配器的 `fetchAll` 而非逐个调用 `fetchLatest`。接口只约束 `fetchLatest` 和 `fetchDisplayName` 两个标准方法。

**自测标准**：
- [ ] TypeScript 编译通过
- [ ] 接口包含 `platform`/`fetchLatest`/`fetchDisplayName` 成员
- [ ] `CronResult` 类型包含 `totalMonitors`/`successCount`/`failCount`/`newContentCount`/`duration` 字段
- [ ] `ContentWriter` 接口包含 `upsert`/`updateMonitorStatus`/`updateDisplayName` 方法（`updateDisplayName` 用于 name_auto=true 时刷新昵称，SPEC 5.1 规则 7）
- [ ] `PlatformResult` 类型包含 `skipped`/`reason`/`monitors`/`results` 字段（`fetchAll` 返回值类型）

### Step 6.2 — BilibiliAdapter — fetchLatest

**动作**：创建 `scripts/cron/src/adapters/bilibili.ts`，实现 `fetchLatest`：
1. 调用 `x/space/wbi/arc/search` 获取最新视频列表（前 6 条），含 WBI 签名逻辑（SPEC 5.6）
2. 调用 B站专栏 API `x/space/article/list?mid={mid}&pn=1&ps=6` 获取最新专栏文章（content_type = article，SPEC 6.3），合并后取前 6 条

> **注意**：B站专栏 API 端点需在开发时验证可用性，如端点变更需调研替代接口。

**自测标准**：
- [ ] 对真实 B站 mid 调用 `fetchLatest` → 返回 ≤ 6 条 RawContent
- [ ] 每条 RawContent 的 `title`/`cover_url`/`original_url`/`published_at`/`native_id` 非空
- [ ] `cover_url` 为 HTTPS 协议
- [ ] `published_at` 为 ISO 8601 UTC 格式
- [ ] WBI 签名参数 `w_rid` 正确生成
- [ ] 视频类内容 `content_type = "video"`，专栏类内容 `content_type = "article"`

### Step 6.3 — BilibiliAdapter — WBI 签名缓存

**动作**：实现 `mixin_key` 缓存逻辑（有效期约 24 小时），失效时重新获取。

**自测标准**：
- [ ] 首次调用获取 `mixin_key`，后续调用使用缓存
- [ ] 缓存过期后自动重新获取

### Step 6.4 — BilibiliAdapter — fetchDisplayName

**动作**：实现 `fetchDisplayName`：调用 `x/space/acc/info` 获取博主昵称。

**自测标准**：
- [ ] 对真实 mid 调用 → 返回非空字符串
- [ ] API 失败时 → 返回 `null`

### Step 6.5 — BilibiliAdapter — 平台级短路

**动作**：实现 `fetchAll` 方法（SPEC 5.6 平台级短路机制）。先 probe 第一条，若 HTTP 401/403 → 返回 `{ skipped: true }`，跳过整组。

**自测标准**：
- [ ] Cookie 有效 → 正常返回所有 monitor 的结果
- [ ] Cookie 失效（401/403）→ 返回 `{ skipped: true, reason: "..." }`，不调用后续 monitor
- [ ] 第一条非平台级故障（如单条视频被删）→ 正常逐个处理

### Step 6.6 — YoutubeAdapter — fetchLatest

**动作**：创建 `scripts/cron/src/adapters/youtube.ts`，实现 `fetchLatest`：先获取 uploads playlist ID（`channels.list?part=contentDetails`），再调 `playlistItems.list` 获取最新视频（前 6 条）。

**自测标准**：
- [ ] 对真实 YouTube channelId 调用 → 返回 ≤ 6 条 RawContent
- [ ] uploads playlist ID 获取成功
- [ ] 每条 RawContent 的 `native_id` 为 videoId
- [ ] `original_url` 格式为 `https://www.youtube.com/watch?v={videoId}`

### Step 6.7 — YoutubeAdapter — fetchDisplayName

**动作**：实现 `fetchDisplayName`：调用 `channels.list?id={channelId}` 取 `snippet.title`。

**自测标准**：
- [ ] 对真实 channelId → 返回非空字符串
- [ ] channelId 无效 → 返回 `null`

### Step 6.8 — YoutubeAdapter — 平台级短路

**动作**：实现平台级短路：HTTP 403 + reason = `quotaExceeded` → 跳过整组。

**自测标准**：
- [ ] API Key 配额耗尽 → 返回 `{ skipped: true }`
- [ ] 其他 403 错误（如非 quota 原因）→ 不触发短路，逐个处理

### Step 6.9 — ZhihuAdapter — fetchLatest `[Phase 2]`

> **延后原因**：RSSHub 公共实例全线不可用，自建 RSSHub 在本地 Docker + 真实 Cookie 测试中仍 503（RSSHub 签名逻辑与知乎现行反爬不匹配）。直连知乎 API v4 在本机验证可行，但 GitHub Actions 海外 IP 是否被风控未验证。Phase 2 需先决策架构（本地脚本 / 国内云服务器 / GH Actions 直连），再实施。

**动作**：创建 `scripts/cron/src/adapters/zhihu.ts`，实现 `fetchLatest`：调用 RSSHub HTTP 接口获取知乎用户/专栏最新文章（前 6 条）。

RSSHub API 路径格式：
- 知乎用户：`GET {RSSHUB_URL}/zhihu/people/{people_id}/articles`（需携带 `RSSHUB_API_KEY` 鉴权 header）
- 知乎专栏：`GET {RSSHUB_URL}/zhihu/column/{column_id}`

> **注意**：RSSHub 路径格式需在开发时参考 [RSSHub 文档](https://docs.rsshub.app/) 确认，版本升级可能变更。

**自测标准**：
- [ ] 对真实知乎 people_id 调用 → 返回 ≤ 6 条 RawContent
- [ ] `content_type` 正确映射（article/answer/question/post，SPEC 6.3）
- [ ] `published_at` 从 RFC 2822 格式正确转换为 ISO 8601

### Step 6.10 — ZhihuAdapter — 平台级短路 `[Phase 2]`

**动作**：实现平台级短路：RSSHub 实例不可达（ECONNREFUSED/5xx）→ 跳过整组。

**自测标准**：
- [ ] RSSHub 宕机 → 返回 `{ skipped: true }`
- [ ] 单条内容 404 → 不触发短路，逐个处理

---

## Phase 7：Cron 脚本 — 编排与写入

### Step 7.1 — 数据清洗管道

**动作**：创建 `scripts/cron/src/lib/cleaner.ts`，实现 SPEC 6.1 全部清洗规则：title 去 HTML 标签 + trim + 截断 300 字符、cover_url 转 HTTPS、published_at 转 ISO 8601、native_id trim。单条记录大小上限 3 KB。

**自测标准**：
- [ ] title `"<b>标题</b>  "` → `"标题"`
- [ ] title 超过 300 字符 → 截断至 300
- [ ] cover_url `"http://example.com/img.jpg"` → `"https://example.com/img.jpg"`
- [ ] cover_url 无效 → `null`
- [ ] bilibili 时间戳 `1718928000` → `"2024-06-21T00:00:00.000Z"`
- [ ] 单条 > 3KB → 拦截并记录警告

### Step 7.2 — UPSERT 内容写入（含防复活 + 置顶内容过滤）

**动作**：创建 `scripts/cron/src/lib/content-writer.ts`，实现 UPSERT：POST `/rest/v1/contents` + `resolution=merge-duplicates` + `columns` 参数限制可更新字段（SPEC 2.2.2）。不传 `is_display` 和 `created_at`。

UPSERT 之前先执行**置顶内容过滤**：遍历 RawContent 数组，`published_at` 早于 monitor 的 `last_content_at` 的条目视为旧内容（置顶），从数组中移除不入库。

**自测标准**：
- [ ] `published_at` 早于 monitor 的 `last_content_at` → 该条不入库（穿透置顶内容逻辑，SPEC 5.6）
- [ ] 新内容 → INSERT 成功，`is_display = true`（数据库默认值）
- [ ] 已存在且 `is_display = true` → UPDATE title/cover_url，`is_display` 不变
- [ ] 已存在且 `is_display = false` → UPDATE title/cover_url，`is_display` 保持 false（不复活）
- [ ] `columns` 参数正确传递

### Step 7.3 — 写回前校验

**动作**：在 UPSERT 之前执行 monitor 存在性校验（SPEC 3.4）：查询 `monitors?id=eq.{id}&select=id,is_active`。

**自测标准**：
- [ ] monitor 存在且 `is_active=true` → 继续 UPSERT
- [ ] monitor 已删除 → 跳过 UPSERT，丢弃结果
- [ ] monitor `is_active=false` → 跳过 UPSERT，丢弃结果

### Step 7.4 — Monitor 状态写回

**动作**：实现 `updateMonitorStatus`：抓取成功时更新 `status/fail_count/last_sync_at`，有新内容时额外更新 `last_content_at`。`name_auto=true` 时调用 `fetchDisplayName` 刷新 `display_name`（SPEC 5.1 规则 7）。

**自测标准**：
- [ ] 抓取成功 → `fail_count = 0, status = normal, last_sync_at = now()`
- [ ] 抓取成功 + 有新内容 → 额外更新 `last_content_at`
- [ ] 抓取失败 → `fail_count +1`，`status` 按状态机规则流转
- [ ] `name_auto=true` 且 `fetchDisplayName` 返回新昵称 → `display_name` 更新，`name_auto` 保持 true
- [ ] `name_auto=false` → 不调用 `fetchDisplayName`

### Step 7.5 — 状态流转逻辑

**动作**：实现状态机（SPEC 3.1 状态流转规则表）：
- normal + 失败 → cookie_expired, fail_count+1
- cookie_expired + 成功 → normal, fail_count=0
- cookie_expired + 失败(fail_count=3) → rate_limited + 告警
- rate_limited + 成功 → normal, fail_count=0
- rate_limited + 失败 → rate_limited, fail_count+1 + 再次告警

**自测标准**：
- [ ] 每种状态转换路径对应正确的 `status` 和 `fail_count` 值
- [ ] 单元测试覆盖全部 7 行流转规则

### Step 7.6 — 告警推送

**动作**：创建 `scripts/cron/src/lib/alert.ts`，实现告警消息模板（SPEC 7.2）和企业微信 Webhook 推送（SPEC 7.3）。`fail_count >= 3` 时触发，无静默期。平台级短路不告警。

**自测标准**：
- [ ] `fail_count = 3` → 发送告警
- [ ] `fail_count = 4`（rate_limited 再次失败）→ 再次发送告警
- [ ] 平台级短路 → 不发送告警
- [ ] 未配置 `WECOM_WEBHOOK_URL` → 仅记录日志，不抛异常
- [ ] 告警消息格式与 SPEC 7.2 模板一致

### Step 7.7 — CronRunner 主编排器

**动作**：创建 `scripts/cron/src/index.ts`，实现 `CronRunner.run()` 完整流程（SPEC 5.8）：获取锁 → 查询 monitors → YouTube 降频 → 按 platform 分组 → 对每组调用 `adapter.fetchAll(monitors)`（非逐个 `fetchLatest`），`fetchAll` 内部先 probe 第一条检测平台级故障 → Promise.allSettled 并行执行 → 汇总 CronResult → 释放锁（finally）。

> **MVP 范围**：仅 B站 + YouTube 两个平台组。知乎组延后至 Phase 2。

> **平台级短路状态持久化**：当某平台组 `fetchAll` 返回 `{ skipped: true }` 时，CronRunner 需 PATCH `platform_configs` 表：
> - B站短路 → `config_key='cookie_status'` 更新为 `'expired'`
> - 任意平台成功完成（非短路）→ 对应 `cookie_status` 更新为 `'valid'`
>
> Admin SPA 通过查询该行判断 Cookie 状态（SPEC 2.2.3 第 4 条）。
>
> **注意**：`cookie_status` 持久化仅对 B站有意义（用户可扫码刷新），YouTube 短路时不持久化状态，仅在 Cron 日志中记录"平台级故障，跳过整组"。

**自测标准**：
- [ ] 完整流程执行成功，CronResult 各字段正确
- [ ] 两个平台组并行执行（时间 ≈ max(B站时间, YouTube时间)）
- [ ] 某平台组失败不影响其他平台组（Promise.allSettled）
- [ ] 平台级短路时该组所有 monitor 的 fail_count 不变
- [ ] B站短路 → `platform_configs` 中 `cookie_status` 更新为 `expired`
- [ ] B站成功 → `cookie_status` 更新为 `valid`
- [ ] 同平台内部串行，间隔 ≥ 1.5 秒

### Step 7.8 — CronRunner 错误隔离验证

**动作**：确保三级错误隔离（SPEC 5.8 错误隔离规则表）：monitor 级 try-catch、平台组级隔离、全局级退出。

**自测标准**：
- [ ] 单条 monitor 抓取异常 → catch 捕获，记录日志，继续下一条
- [ ] 某平台适配器初始化失败 → 其他平台正常执行
- [ ] 数据库连接失败 → 整个 Cron 退出（非零 exit code）
- [ ] UPSERT 外键约束失败（极端竞态）→ catch 捕获，继续下一条

---

## Phase 8：GitHub Actions 工作流

### Step 8.1 — Cron 工作流配置

**动作**：创建 `.github/workflows/cron-fetch.yml`，配置每 30 分钟触发（SPEC 配置），执行 `scripts/cron` 中的脚本。配置所需 Secrets（SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、YOUTUBE_API_KEY、WECOM_WEBHOOK_URL）。

> **MVP 范围**：不配置 `RSSHUB_URL`/`RSSHUB_API_KEY`（知乎延后，Phase 2 启用时再加）。

> **YouTube API Key 双配置**（SPEC 5.3 规则 5）：`YOUTUBE_API_KEY` 需同时配置在两处：
> 1. **GitHub Actions Secrets**：Cron 脚本 YoutubeAdapter 使用
> 2. **Supabase Edge Function 环境变量**：`parse-url` 函数解析 YouTube URL 时使用（`channels.list?forHandle=`）
>
> 通过 `supabase secrets set YOUTUBE_API_KEY=xxx` 配置 Edge Function 环境变量。

**自测标准**：
- [ ] workflow 文件语法正确（`actionlint` 检查通过）
- [ ] `on.schedule` 为 `*/30 * * * *`
- [ ] 所有必要 Secrets 在 workflow 中被引用（SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、YOUTUBE_API_KEY、WECOM_WEBHOOK_URL）
- [ ] `pnpm --filter @content-hub/cron start` 命令在 workflow 中执行
- [ ] `parse-url` Edge Function 可读取 `YOUTUBE_API_KEY` 环境变量（`supabase secrets list` 可见）

### Step 8.2 — 工作流日志与退出码

**动作**：确保 CronRunner 的 CronResult 输出到 GitHub Actions 日志（包括 totalMonitors/successCount/failCount/newContentCount/duration）。

**自测标准**：
- [ ] GitHub Actions 日志可看到各字段
- [ ] 平台级短路时在日志中记录"平台级故障，跳过 {platform} 组"
- [ ] 正常完成时 exit code = 0

---

## Phase 9：H5 SPA

### Step 9.0 — H5 路由 + Supabase 客户端初始化

**动作**：
1. 安装 `react-router-dom`，配置路由：`/` → Feed 信息流页面
2. 创建 `apps/h5/src/lib/supabase.ts`，使用 `SUPABASE_URL` + `SUPABASE_ANON_KEY` 初始化 Supabase 客户端（anon 角色，用于查询 contents）

**自测标准**：
- [ ] `pnpm --filter h5 dev` 启动后访问 `/` 显示 Feed 页面
- [ ] Supabase 客户端创建成功，`createClient()` 不抛异常
- [ ] `.env.local` 中 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 可正确读取

### Step 9.1 — 信息流页面骨架

**动作**：创建 `apps/h5/src/pages/Feed.tsx`，实现分页查询（SPEC 2.2.2 H5 分页查询 API）。初始显示空状态"暂无内容，请先在管理端添加博主"。

**自测标准**：
- [ ] 无数据时显示空状态提示
- [ ] API 返回数据时渲染内容列表
- [ ] 分页请求正确（limit=20, offset 递增）
- [ ] 滚动到底部 → 自动请求下一页并追加到列表尾部（无限滚动）
- [ ] 返回空数组 → 显示"没有更多内容了"，停止加载

### Step 9.2 — 平台筛选 Tab

**动作**：实现顶部平台筛选 Tab（SPEC 9.3）：全部 / B站 / YouTube。Tab 配置定义在 `apps/h5/src/constants/tabs.ts`。

> **MVP 范围**：仅含 B站 + YouTube。知乎 Tab 延后至 Phase 2（见附录 A）。

**自测标准**：
- [ ] 点击"B站" Tab → 列表只显示 B站内容
- [ ] 点击"全部" Tab → 显示所有平台内容
- [ ] Tab 切换时 URL query 参数正确更新

### Step 9.3 — 内容卡片组件

**动作**：创建 `apps/h5/src/components/ContentCard.tsx`，展示：封面图（onerror → 平台默认占位图）、平台 Tag（品牌色，SPEC 9.1）、标题、相对时间（SPEC 9.2）。

**自测标准**：
- [ ] 封面图加载失败 → 显示对应平台占位图
- [ ] B站卡片 Tag 颜色为 `#FB7299`
- [ ] 发布时间 5 分钟前 → 显示"5分钟前"
- [ ] 发布时间 60 天前 → 显示绝对日期

### Step 9.4 — Deep Link 跳转

**动作**：实现卡片点击跳转逻辑（SPEC 5.7）：EnvironmentDetector 检测 → 静默复制 original_url → Deep Link 唤醒 → 2 秒超时检测 → 兜底弹窗。

**自测标准**：
- [ ] B站视频卡片点击 → 尝试唤醒 `bilibili://video/{native_id}`
- [ ] 知乎卡片点击 → 直接打开 `original_url`
- [ ] Deep Link 唤醒失败（2 秒无 `visibilitychange`）→ 弹兜底弹窗
- [ ] 兜底弹窗含"链接已自动复制，打开 App 即可直接看"文案 + [网页打开] + [关闭] 按钮

### Step 9.5 — 微信/支付宝环境兜底

**动作**：在 Deep Link 跳转前执行 EnvironmentDetector（SPEC 5.7.1）。微信/支付宝环境直接弹兜底弹窗，跳过 Deep Link。

**自测标准**：
- [ ] 微信 UA 下点击 → 直接弹兜底弹窗（不尝试唤醒 App）
- [ ] 兜底弹窗含"当前环境不支持直接打开 App"提示 + 一键复制按钮

---

## Phase 10：Admin SPA

### Step 10.0 — Admin 路由 + 鉴权守卫 + Supabase 客户端初始化

**动作**：
1. 安装 `react-router-dom`，配置路由：`/login` → Login 页面，`/monitors` → MonitorList 页面
2. 创建鉴权守卫组件 `<AuthGuard>`：未登录时自动重定向到 `/login`
3. 创建 `apps/admin/src/lib/supabase.ts`，使用 `SUPABASE_URL` + `SUPABASE_ANON_KEY` 初始化 Supabase 客户端（含 Auth 模块）

**自测标准**：
- [ ] 未登录访问 `/monitors` → 自动跳转 `/login`
- [ ] 登录后访问 `/monitors` → 正常显示列表页
- [ ] Supabase Auth 客户端 `signInWithPassword` 可调用
- [ ] `.env.local` 中环境变量可正确读取

### Step 10.1 — 登录页面

**动作**：创建 `apps/admin/src/pages/Login.tsx`，实现邮箱 + 密码登录（SPEC 9.4）。调用 Supabase Auth `signInWithPassword`。access_token 存内存，refresh_token 存 secure cookie。

**自测标准**：
- [ ] 正确凭据 → 登录成功，跳转监控列表页
- [ ] 错误凭据 → 显示错误提示
- [ ] session 过期 → 自动刷新；刷新失败 → 跳转登录页

### Step 10.2 — API 请求拦截器

**动作**：创建 HTTP 请求封装，所有 REST API 请求自动携带 `Authorization: Bearer {access_token}` 和 `apikey: {anon_key}`。

**自测标准**：
- [ ] 登录后发出的请求 Header 包含正确的 Bearer token
- [ ] 401 响应 → 尝试 refresh；refresh 失败 → 跳转登录

### Step 10.3 — 监控列表页

**动作**：创建 `apps/admin/src/pages/MonitorList.tsx`，展示所有 monitor 列表。每行展示：平台 Tag、昵称、运行状态（🟢🟡🔴，SPEC 9.7）、最后同步时间（SPEC 9.8）、活跃度提示（SPEC 9.5）、开关。

**自测标准**：
- [ ] `status=normal` → 显示 🟢
- [ ] `status=cookie_expired` → 显示 🟡
- [ ] `status=rate_limited` → 显示 🔴
- [ ] `last_sync_at` 非空 → 显示 `2026-06-20 14:00` 格式
- [ ] `last_sync_at` 为 null → 显示"从未同步"
- [ ] `last_content_at` 距今 45 天 → 显示"⚪ 该博主已超过 45 天未更新"（灰色）
- [ ] `last_content_at` 距今 95 天 → 显示"⚪ 该博主已超过 95 天未更新，建议关闭监控或移除"（红色，SPEC 9.5，文案升级对应 PRD F4）
- [ ] `last_content_at` 为 NULL → 不显示任何停更提示（防御性兜底，PRD F4）

### Step 10.4 — 状态筛选下拉

**动作**：实现列表顶部状态筛选下拉（SPEC 9.6）：全部 / 正常 / 异常 / 已关闭。

**自测标准**：
- [ ] 选"异常" → 只显示 `status=rate_limited` 的 monitor
- [ ] 选"已关闭" → 只显示 `is_active=false` 的 monitor
- [ ] 筛选 + 平台组合筛选正确

### Step 10.5 — 新增博主（URL 粘贴）

**动作**：实现添加博主流程：用户粘贴 URL → 调用 parse-url Edge Function → 成功后 POST monitors。处理 409 重复添加（SPEC 2.2.1 去重机制）。

**自测标准**：
- [ ] 粘贴有效 B站 URL → 自动填充平台/ID/昵称，POST 成功
- [ ] 重复添加 → 前端显示"该博主已添加"（拦截 PostgREST 409）
- [ ] 粘贴无效 URL → Toast 提示"无法识别该平台"

### Step 10.6 — 博主开关与手动重置

**动作**：实现 monitor 开关（PATCH `is_active`）和手动重置按钮（PATCH `status=normal, fail_count=0`）。

**自测标准**：
- [ ] 关闭开关 → `is_active=false`，列表状态更新
- [ ] 重新开启 → `is_active=true`
- [ ] 点击"重置"按钮 → `status=normal, fail_count=0`

### Step 10.7 — 昵称行内编辑

**动作**：实现昵称行内编辑：点击昵称 → 变为输入框 → 编辑 → 回车保存（PATCH `display_name` + `name_auto=false`，SPEC 2.2.1）。

**自测标准**：
- [ ] 编辑昵称并保存 → `display_name` 更新，`name_auto=false`
- [ ] 后续 Cron 不会覆盖手动编辑的昵称

### Step 10.8 — 删除监控（二次确认）

**动作**：实现删除按钮 + 二次确认弹窗，确认后 DELETE monitor。

**自测标准**：
- [ ] 点击删除 → 弹出确认弹窗
- [ ] 确认 → 调用 DELETE API，列表移除该条目
- [ ] 取消 → 关闭弹窗，不删除

### Step 10.9 — B站 Cookie 管理

**动作**：实现 Cookie 状态展示 + 扫码更新流程。展示规则（SPEC 2.2.3）：
1. 展示 Cookie 最后更新时间（查询 `platform_configs` 的 `cookie` 行 `updated_at`）
2. 距今 > 25 天 → 黄色预警
3. 查询 `platform_configs` 的 `cookie_status` 行，若值为 `expired` → 红色警告"Cookie 已失效，请重新扫码"

**自测标准**：
- [ ] Cookie 10 天前更新 → 正常显示
- [ ] Cookie 26 天前更新 → 显示黄色"Cookie 即将过期"
- [ ] `cookie_status = 'expired'` → 显示红色警告
- [ ] `cookie_status = 'valid'` → 不显示红色警告

### Step 10.10 — B站扫码登录 UI

**动作**：实现扫码登录完整 UI：获取二维码 → 展示 → 轮询（每 2 秒）→ 成功/过期处理。轮询上限 90 次（SPEC 2.4.2）。

**自测标准**：
- [ ] 展示二维码图片
- [ ] 扫码后 UI 更新为"登录成功"
- [ ] 二维码过期（180 秒）→ 提示"二维码已过期，请重新获取"
- [ ] 轮询达到 90 次自动停止

---

## Phase 11：集成测试与验收

### Step 11.1 — 端到端流程：添加博主 → Cron 抓取 → H5 展示

**动作**：手动走通完整流程：Admin 添加 B站博主 → 等待 Cron 执行 → H5 查看信息流。

**自测标准**：
- [ ] Admin SPA 添加 B站博主成功
- [ ] Cron 执行后 contents 表出现新记录
- [ ] H5 信息流展示该内容卡片
- [ ] 卡片点击 → Deep Link 或兜底弹窗正常

### Step 11.2 — 端到端流程：两平台覆盖

**动作**：分别添加 B站/YouTube 博主各一个，验证 Cron 两个适配器均能正常抓取。

> **MVP 范围**：B站 + YouTube。知乎延后至 Phase 2。

**自测标准**：
- [ ] B站 monitor 抓取成功
- [ ] YouTube monitor 抓取成功
- [ ] H5 信息流展示两个平台的内容

### Step 11.3 — 异常场景验证

**动作**：验证核心异常场景：
- Cookie 失效 → 平台级短路
- YouTube 配额耗尽 → 平台级短路
- monitor 删除 → 写回前校验跳过
- UPSERT 软删除记录 → 不复活
- 锁冲突 → 跳过本轮
- 粘贴已注销博主 URL → parse-url 返回错误（PRD B.6）
- 封面图 URL 失效 → H5 显示占位图（PRD B.6）

**自测标准**：
- [ ] B站 Cookie 失效 → 所有 B站 monitor fail_count 不变，日志记录"平台级短路"
- [ ] 删除 monitor 后 Cron 执行 → 无外键约束错误
- [ ] 已软删除的内容 UPSERT 后 `is_display` 仍为 false
- [ ] 并发两个 Cron 实例 → 第二个跳过本轮
- [ ] 粘贴已注销/无效博主 URL → 前端 Toast "该主页不存在或已失效"或对应错误码
- [ ] H5 封面图 404 → 显示对应平台默认占位图

### Step 11.4 — 30 天软删除验证

**动作**：手动执行软删除 SQL 块，验证超过 30 天的内容被软删除。

**自测标准**：
- [ ] `created_at` > 30 天的内容 → `is_display = false`
- [ ] `created_at` < 30 天的内容 → `is_display` 不变
- [ ] `cron_soft_delete_logs` 有对应日志

### Step 11.5 — Admin SPA 全功能验证

**动作**：逐项验证 Admin SPA 所有功能：添加/删除/开关/重置/编辑昵称/Cookie 管理/状态筛选/活跃度提示。

**自测标准**：
- [ ] 所有 Step 10.x 的自测标准在集成环境中全部通过
- [ ] 运行状态 🟢🟡🔴 正确显示
- [ ] 最后同步时间格式正确
- [ ] 活跃度提示显示动态天数

---

## 依赖关系总览

```
Phase 0 (脚手架)
  ├── Phase 1 (数据库 Schema)
  │     ├── Phase 2 (packages/shared)
  │     │     └── Phase 9 (H5 SPA) — 依赖 Step 9.0 路由+客户端 → Step 9.1~9.5
  │     │     └── Phase 10 (Admin SPA) — 依赖 Step 10.0 路由+鉴权 → Step 10.1~10.10
  │     ├── Phase 3 (parse-url EF) — 依赖 Step 0.7 Deno 环境
  │     │     └── Phase 10 Step 10.5 (Admin 添加博主)
  │     ├── Phase 4 (bilibili-auth EF) — 依赖 Step 0.7 Deno 环境
  │     │     └── Phase 10 Step 10.9~10.10 (Cookie 管理)
  │     └── Phase 5 (Cron 基础设施，含 Step 5.5 限速工具)
  │           └── Phase 6 (适配器)
  │                 └── Phase 7 (编排写入)
  │                       └── Phase 8 (GitHub Actions)
  │                             └── Phase 11 (集成测试)
  └── Step 0.7 (Deno Edge Functions 环境) → Phase 3 + Phase 4
```

**可并行开发的组**：
- Phase 2 + Phase 3 + Phase 4 可并行（均只依赖 Phase 1 + Step 0.7）
- Phase 9 + Phase 10 可并行（均只依赖 Phase 2）
- Phase 6 的两个适配器（B站/YouTube）可并行（知乎适配器延后至 Phase 2）

---

## 附录 A：知乎延后决策记录

### A.1 决策

MVP 阶段（Phase 0-11）不含知乎平台，仅支持 B站 + YouTube。知乎适配器相关 Step（6.9-6.10）及 H5 知乎 Tab 标注为 `[Phase 2]`，保留文档作为后续迭代参考。

### A.2 决策依据（spike 验证结果）

#### A.2.1 方案 B（ZhihuAdapter 直连知乎 API v4）spike 结论

**测试环境**：本地 Docker + 真实知乎账号 Cookie（`d_c0` + `z_c0`）

**测试结果**：
- ✅ 知乎公共路由 `zhihu/daily` → RSSHub 200（RSSHub 本身正常）
- ❌ 知乎用户路由 `zhihu/people/{id}/answers|posts|activities` → RSSHub 503（即便带 Cookie）
- ✅ 直连知乎 API v4 `api/v4/members/{id}/articles` + Cookie → **200，返回完整文章数据**
- ✅ RawContent 字段映射齐全（`id`/`title`/`url`/`image_url`/`created`）

**关键发现**：
1. RSSHub 签名逻辑（`x-zse-93`/`x-zse-96`）与知乎现行反爬不匹配，RSSHub 路由整体失效
2. 知乎 API v4 + Cookie 直连可用（在本机住宅 IP 上验证）
3. GitHub Actions 的 Azure 海外 IP 是否被知乎风控**未验证**——这是方案 B 的核心风险

#### A.2.2 方案 A（自建 RSSHub + 国内云）评估

- ❌ Railway 模板已下架（官方 URL 404，2026-06-22 确认）
- ⚠️ Sealos 部署需付费（~120 元/月）
- ⚠️ 本地 Docker 跑 RSSHub 即便带 Cookie 仍 503，RSSHub 知乎路由本身有 bug
- ✅ 国内云服务器自建 RSSHub 理论可行，但 RSSHub 知乎路由失效问题依然存在

#### A.2.3 方案 C-2a（本地脚本直连 API）评估

- ✅ 本机 IP 已验证可用
- ❌ 架构改动大（+5.5 Step：CLI 入口 + token 安全存储 + RLS 策略）
- ❌ 用户需常开本地机器，失去"全自动"优势
- 适合作为 Phase 2 的备选方案

### A.3 Phase 2 实施前的决策点

Phase 2 启动知乎适配器时，需先完成以下决策：

1. **架构选型**：
   - 选项 A：ZhihuAdapter 直连 API + GitHub Actions（需先验证 GH Actions IP 是否被风控）
   - 选项 B：ZhihuAdapter 直连 API + 国内云服务器（腾讯云轻量 ~50 元/月）
   - 选项 C：ZhihuAdapter 直连 API + 本地脚本（C-2a 方案，+5.5 Step）
2. **Cookie 获取机制**：
   - MVP 方案：管理员手动从浏览器导出 Cookie 贴入 Admin SPA
   - Phase 3 方案：实现知乎扫码登录（`zhihu-auth` Edge Function，知乎无公开扫码 API，技术风险高）
3. **Cookie 续期**：知乎 `z_c0` 有效期约 1 年，期间无需续期；`d_c0` 长期有效

### A.4 文档同步状态

知乎延后决策已同步至：
- ✅ Taskplan.md（本文件，Step 0.8、3.4-3.5、6.9-6.10、9.2、11.2、依赖关系总览）
- ✅ SPEC.md（开头 MVP 声明、5.6 适配器表、5.8 流程图、9.3 H5 Tab）
- ⏳ PRD.md（已同步：开头 MVP 声明，正文 F10.5、A.3 D2 保留知乎 Tab 属预期——PRD 保留完整产品愿景）
- ✅ PROJECT_CONTEXT.md（1.2 RSSHub 依赖标 `[Phase 2]`、1.3 `RSSHUB_*` 环境变量标 `[Phase 2]`）
