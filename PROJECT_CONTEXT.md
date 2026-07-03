# PROJECT_CONTEXT.md

> 本文档是多平台内容中枢（Content Hub）的项目上下文文件，供 AI 和开发者快速理解项目技术约束与规范。
> 最后更新：2026-06-21

---

## 1. 技术栈

### 1.1 总览

| 层级 | 技术 | 说明 |
|---|---|---|
| **前端框架** | React 18 + TypeScript | 配置管理端 + 用户端 H5 两个独立 SPA |
| **构建工具** | Vite 5 | 快速 HMR，生产构建优化 |
| **样式方案** | Tailwind CSS 3 | 原子化 CSS，移动端优先 |
| **后端服务** | Supabase Cloud | PostgreSQL + PostgREST + Edge Functions |
| **数据库** | PostgreSQL 15（Supabase 托管） | 支持 RLS、pg_cron、Supabase Vault |
| **Edge Functions** | Deno + TypeScript | 轻量级 serverless 函数 |
| **定时任务** | 腾讯云 pm2 | pm2 守护进程，使用 node-cron 每 30 分钟触发抓取脚本 |
| **知乎中转** | RSSHub（Railway/Fly.io 部署） | Docker 容器，API Key 鉴权 |
| **包管理** | pnpm + workspace | Monorepo 依赖管理 |
| **前端托管** | 腾讯云 nginx | 静态 SPA 部署 |

### 1.2 关键依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| `@supabase/supabase-js` | 前端与 Supabase 交互 | 同时用于前端 SPA 和 Cron 脚本 |
| `@supabase/supabase` (Deno) | Edge Functions 内使用 | Deno 模块导入 |
| `youtubei.js` 或 googleapis | YouTube Data API v3 | Cron 脚本内调用 |
| RSSHub `[Phase 2]` | 知乎内容中转 | MVP 不使用。知乎延后至 Phase 2，届时评估是否用 RSSHub 或直连 API（详见 Taskplan.md 附录 A） |

### 1.3 环境变量清单

| 变量名 | 存储位置 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 腾讯云服务器环境变量 / Supabase Edge | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 腾讯云服务器环境变量 / Supabase Edge | 前端公开使用，受 RLS 保护 |
| `SUPABASE_SERVICE_ROLE_KEY` | 腾讯云服务器环境变量 | 绕过 RLS，仅 Cron 使用 |
| `VITE_SUPABASE_URL` | Vite 编译期注入（本位） | Nginx/静态托管前端请求 Supabase 的 URL |
| `VITE_SUPABASE_ANON_KEY` | Vite 编译期注入（本位） | Nginx/静态托管前端请求 Supabase 的 ANON_KEY |
| `YOUTUBE_API_KEY` | 腾讯云服务器环境变量 + Supabase Secrets | YouTube Data API v3 密钥（双配置，SPEC 5.3 规则 5） |
| `BILIBILI_COOKIE` | `platform_configs` 表 + Supabase Vault 加密 | B站 Cookie，扫码登录后存入数据库（非环境变量） |
| `RSSHUB_URL` `[Phase 2]` | 腾讯云服务器环境变量（Phase 2 启用时配置） | RSSHub 实例地址。MVP 不使用 |
| `RSSHUB_API_KEY` `[Phase 2]` | 腾讯云服务器环境变量（Phase 2 启用时配置） | RSSHub 访问鉴权密钥。MVP 不使用 |
| `WECOM_WEBHOOK_URL` | 腾讯云服务器环境变量（可选） | 企业微信告警 Webhook |

---

## 2. 目录规范

### 2.1 Monorepo 结构

采用 pnpm workspace 管理的 Monorepo 结构。基于 Supabase 官方推荐的 Edge Functions 组织方式（fat functions + `_shared` 目录）和前端社区主流的 apps/packages 分层模式。

```
多平台中枢/
├── apps/                           # 前端应用
│   ├── admin/                      # 配置管理端 (React SPA)
│   │   ├── src/
│   │   │   ├── components/         # 通用组件
│   │   │   ├── pages/              # 页面组件
│   │   │   ├── hooks/              # 自定义 Hooks
│   │   │   ├── lib/                # 工具函数 (supabase client 等)
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── h5/                         # 用户端 H5 (React SPA)
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── packages/
│   └── shared/                     # 前后端共享代码
│       ├── src/
│       │   ├── types/              # TypeScript 类型定义
│       │   │   ├── monitor.ts      # Monitor 类型
│       │   │   ├── content.ts      # Content 类型
│       │   │   └── platform.ts     # 平台枚举与常量
│       │   └── constants/          # 共享常量
│       │       ├── platforms.ts    # 平台标识、配色、名称
│       │       └── deep-link.ts    # Deep Link Schema 模板
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/                       # Supabase 项目配置
│   ├── functions/                  # Edge Functions (Deno)
│   │   ├── _shared/                # 共享代码（下划线前缀，不部署）
│   │   │   ├── supabaseAdmin.ts    # Service Role client
│   │   │   ├── supabaseClient.ts   # Anon client
│   │   │   └── cors.ts             # CORS headers
│   │   ├── parse-url/              # URL 解析 + 平台识别
│   │   │   └── index.ts
│   │   └── bilibili-auth/          # B站扫码登录
│   │       └── index.ts
│   ├── migrations/                 # SQL 迁移脚本（数字前缀连续编号）
│   │   ├── 001_monitors.sql
│   │   ├── 002_contents.sql
│   │   ├── 003_platform_configs.sql
│   │   ├── 004_cron_locks.sql
│   │   ├── ...
│   │   └── 008_pg_cron_soft_delete.sql
│   ├── seed.sql                    # 种子数据
│   └── config.toml                 # Supabase 项目配置
│
├── scripts/
│   └── cron/                       # pm2 Cron 守护进程与定时脚本
│       ├── src/
│       │   ├── adapters/           # 平台适配器
│       │   │   ├── bilibili.ts     # B站适配器
│       │   │   ├── youtube.ts      # YouTube 适配器
│       │   │   ├── zhihu.ts        # 知乎适配器（调 RSSHub）
│       │   │   └── types.ts        # 适配器接口定义
│       │   ├── lib/                # 工具函数
│       │   │   ├── supabase.ts     # Supabase client (Service Role)
│       │   │   ├── cleaner.ts      # 数据清洗标准化
│       │   │   ├── upsert.ts       # UPSERT 去重逻辑
│       │   │   └── alert.ts        # 告警通知
│       │   └── index.ts            # 主入口
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                           # 项目文档
├── .env.example                    # 环境变量示例
├── .gitignore
├── package.json                    # 根 package.json (workspace 配置)
├── pnpm-workspace.yaml             # pnpm workspace 配置
└── PROJECT_CONTEXT.md              # 本文件
```

### 2.2 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| **Edge Function** | 连字符（kebab-case），URL 友好 | `parse-url`、`bilibili-auth` |
| **数据库表/字段** | 蛇形（snake_case） | `monitors`、`is_active`、`last_sync_at` |
| **TypeScript 文件** | 连字符（kebab-case） | `deep-link.ts`、`platform-configs.ts` |
| **TypeScript 类型/接口** | 帕斯卡（PascalCase） | `Monitor`、`ContentCard` |
| **React 组件** | 帕斯卡（PascalCase） | `MonitorList`、`ContentCard` |
| **React 组件文件** | 帕斯卡（PascalCase） | `MonitorList.tsx`、`ContentCard.tsx` |
| **常量** | 全大写蛇形（UPPER_SNAKE） | `PLATFORM_COLORS`、`MAX_CONTENT_AGE_DAYS` |
| **CSS 类名** | Tailwind 原子类优先 | `className="flex items-center gap-2"` |
| **SQL 迁移文件** | 数字前缀 + 蛇形 | `001_monitors.sql`、`003_platform_configs.sql` |
| **环境变量** | 全大写蛇形 | `SUPABASE_URL`、`YOUTUBE_API_KEY` |

### 2.3 共享类型同步策略

`packages/shared` 是前后端类型的唯一数据源（Single Source of Truth）：

- 前端（`apps/admin`、`apps/h5`）通过 workspace 依赖引用 `@content-hub/shared`
- Cron 脚本（`scripts/cron`）通过 workspace 依赖引用 `@content-hub/shared`
- Edge Functions（Deno 环境）无法引用 npm 包，手动保持类型同步，在 `_shared/types.ts` 中维护副本并标注 `// SYNC: packages/shared/src/types/`

---

## 3. 架构约束

### 3.1 服务职责划分

```
┌─────────────────────────────────────────────────────────────┐
│                  腾讯云 nginx (静态托管)                      │
│  ├── apps/admin (配置管理端 SPA)                             │
│  └── apps/h5   (用户端 H5 SPA)                               │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (anon key, RLS 保护)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Supabase Cloud                              │
│  ├── PostgreSQL (monitors / contents / platform_configs)     │
│  ├── PostgREST (自动 REST API)                               │
│  ├── Edge Functions (Deno)                                   │
│  │   ├── parse-url    → URL 解析 + 平台识别                   │
│  │   └── bilibili-auth → B站扫码登录                         │
│  ├── pg_cron (每日软删除任务)                                 │
│  └── cron_locks 表 (Cron 行级互斥锁)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (service_role key)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            腾讯云服务器 (pm2 + node-cron 守护进程)            │
│  ├── Node.js 抓取脚本                                         │
│  │   ├── B站适配器 → B站空间 API (带 Cookie)                  │
│  │   ├── YouTube 适配器 → YouTube Data API v3                │
│  │   └── 知乎适配器 → RSSHub (API Key 鉴权)                   │
│  └── 写入 Supabase (UPSERT + 状态回写)                       │
└─────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│           RSSHub (Railway / Fly.io PaaS)                      │
│  Docker 部署，公网可访问，API Key 鉴权                        │
│  → 抓取知乎博主主页/专栏最新内容                               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心架构约束

| # | 约束 | 理由 |
|---|---|---|
| AC1 | **前端不直接调用任何第三方平台 API** | B站/YouTube/知乎的 API 调用全部在 pm2 Cron 守护进程内完成，前端只与 Supabase 交互 |
| AC2 | **Cron 脚本不直接操作数据库连接** | 通过 Supabase REST API（Service Role Key）写入数据，不直连 PostgreSQL |
| AC3 | **Edge Functions 仅用于轻量逻辑** | URL 解析、B站扫码登录等。数据密集型操作用 PostgREST 或 Database Functions |
| AC4 | **Service Role Key 永不暴露到前端** | 仅存储在腾讯云环境变量中，供 Cron 脚本和 Edge Functions 使用 |
| AC5 | **RSSHub 必须启用 API Key 鉴权** | RSSHub 暴露在公网，通过 `ACCESS_CONTROL` 配置项限制访问 |
| AC6 | **Cron 互斥锁基于 cron_locks 表行级锁** | 不使用 pg_advisory_lock（REST API 每次请求是独立会话），改用数据库表行 + PATCH 原子操作实现互斥 |
| AC7 | **所有数据库表必须启用 RLS** | 即使是内部表，也通过 RLS 策略显式控制访问权限 |
| AC8 | **Cron 脚本按平台串行、平台间可并行** | 同平台请求间隔 ≥ 1.5 秒（防反爬），不同平台无此限制 |
| AC9 | **敏感信息（Cookie、API Key）加密存储** | B站 Cookie 存入 `platform_configs` 表，使用 Supabase Vault 加密 |
| AC10 | **前端 SPA 不做服务端渲染** | 纯客户端渲染，SEO 不是需求，腾讯云 nginx 静态托管即可 |

### 3.3 数据流约束

```
写入流（Cron 抓取）：
  腾讯云 pm2 → 第三方 API → 清洗标准化 → Supabase REST API (UPSERT) → PostgreSQL

读取流（H5 浏览）：
  H5 SPA → Supabase REST API (SELECT is_display=true) → PostgreSQL

配置流（管理端）：
  Admin SPA → Edge Function (parse-url) → Supabase REST API → PostgreSQL
  Admin SPA → Edge Function (bilibili-auth) → B站 API → Supabase (存 Cookie)

清理流（软删除）：
  pg_cron → SQL UPDATE (is_display=false WHERE created_at < 30天)
```

---

## 4. 核心业务模块

### 4.1 模块全景

```
Content Hub
├── 【配置管理端】
│   ├── M1: 监控目标管理 (CRUD)
│   ├── M2: URL 解析与平台识别 (Edge Function)
│   ├── M3: B站扫码授权 (Edge Function + B站 API)
│   ├── M4: 监控状态面板 (只读展示)
│   └── M5: 昵称管理 (同步获取 + 行内编辑)
│
├── 【后端自动化引擎】
│   ├── M6: Cron 调度 (pm2 + node-cron)
│   ├── M7: 平台适配器层
│   │   ├── B站适配器 (Cookie + 空间 API)
│   │   ├── YouTube 适配器 (Data API v3)
│   │   └── 知乎适配器 (RSSHub 中转)
│   ├── M8: 数据清洗标准化
│   ├── M9: UPSERT 去重 (ON CONFLICT)
│   ├── M10: 软删除生命周期 (pg_cron)
│   └── M11: 告警通知 (企业微信 Webhook)
│
└── 【用户端 H5】
    ├── M12: 聚合信息流 (分页 + 筛选)
    ├── M13: Deep Link 跳转 (B站 + YouTube)
    └── M14: 兜底弹窗 (跳转失败时)
```

### 4.2 模块职责详述

#### M1: 监控目标管理

- **职责**：monitors 表的 CRUD 操作
- **实现**：Admin SPA 直接调用 Supabase REST API
- **关键逻辑**：添加时调用 `parse-url` Edge Function 解析平台与标识

#### M2: URL 解析与平台识别

- **职责**：根据 URL 特征识别平台，提取核心标识
- **实现**：Edge Function `parse-url`（Deno）
- **输入**：`{ url: string }`
- **输出**：`{ platform: string, native_id: string, display_name?: string }`
- **平台识别规则**：
  - 含 `bilibili.com` → B站，正则提取 `mid`
  - 含 `youtube.com` → YouTube，提取 `@handle` 并调 `channels.list?forHandle=` 转 `channelId`
  - 含 `zhihu.com` → 知乎，正则提取 `people_id` 或 `column_id`

#### M3: B站扫码授权

- **职责**：生成二维码 → 轮询扫码状态 → 捕获 Cookie → 加密存储
- **实现**：Edge Function `bilibili-auth`（Deno）
- **接口**：
  - `POST /bilibili-auth` body `{ action: "qrcode" }` → 返回二维码图片 URL + `qrcode_key`
  - `POST /bilibili-auth` body `{ action: "poll", qrcode_key: string }` → 返回扫码状态 + Cookie（成功时）
- **存储**：Cookie 加密存入 `platform_configs` 表

#### M7: 平台适配器层

- **职责**：各平台内容抓取的抽象层
- **实现**：`scripts/cron/src/adapters/` 下的 TypeScript 模块
- **统一接口**：
  ```typescript
  interface PlatformAdapter {
    fetchLatest(monitor: Monitor): Promise<RawContent[]>
  }
  ```
- **各适配器差异**：
  | 适配器 | 数据源 | 鉴权 | 限速 |
  |---|---|---|---|
  | B站 | 空间 API `x/space/wbi/arc/search` | Cookie (SESSDATA) | 同平台 ≥1.5s |
  | YouTube | `playlistItems.list` (uploads playlist) | API Key | 无需额外限速 |
  | 知乎 | RSSHub HTTP 接口 | API Key | 同平台 ≥1.5s |

#### M9: UPSERT 去重

- **职责**：基于 `(platform, native_id)` 唯一索引的去重写入
- **实现**：Supabase REST API `upsert` 操作（PostgreSQL `ON CONFLICT`）
- **SQL 语义**：
  ```sql
  INSERT INTO contents (platform, native_id, ...)
  VALUES (...)
  ON CONFLICT (platform, native_id)
  DO UPDATE SET
    title = EXCLUDED.title,
    cover_url = EXCLUDED.cover_url,
    original_url = EXCLUDED.original_url
  WHERE contents.is_display = true;
  -- 软删除记录(is_display=false)不会被更新，防止旧数据复活
  ```

#### M13: Deep Link 跳转

- **职责**：根据 `(platform, content_type)` 选择 Schema 唤醒原生 App
- **MVP 支持范围**：
  | 平台 | content_type | Deep Link Schema | 网页兜底 |
  |---|---|---|---|
  | B站 | video | `bilibili://video/{native_id}` | `original_url` |
  | B站 | article | `bilibili://article/{native_id}` | `original_url` |
  | YouTube | video | `youtube://watch?v={native_id}` | `original_url` |
  | 知乎 | * | **不支持 Deep Link** | 直接 `original_url` |
- **跳转流程**：静默复制 → Deep Link 唤醒 → 2 秒超时检测 → 兜底弹窗

---

## 5. 权限体系

### 5.1 角色模型

本项目是个人/小团队工具，采用**极简双角色模型**：

| 角色 | 身份 | 访问方式 | 权限范围 |
|---|---|---|---|
| **管理员** | Supabase Auth 认证用户（邮箱+密码） | Admin SPA（登录后） | monitors / contents / platform_configs 全部读写 |
| **访客** | 匿名用户（anon） | H5 SPA（无需登录） | contents 表只读（仅 `is_display = true` 的记录） |

### 5.2 RLS 策略

所有表必须启用 Row Level Security。

#### monitors 表

```sql
-- 管理员：全部读写
CREATE POLICY "monitors_admin_all" ON monitors
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 访客：不可见
-- （不创建 anon 策略，默认拒绝）
```

#### contents 表

```sql
-- 管理员：全部读写
CREATE POLICY "contents_admin_all" ON contents
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 访客：只能读取 is_display = true 的记录
CREATE POLICY "contents_anon_read" ON contents
  FOR SELECT TO anon
  USING (is_display = true);
```

#### platform_configs 表（存 B站 Cookie 等敏感信息）

```sql
-- 管理员：全部读写
CREATE POLICY "platform_configs_admin_all" ON platform_configs
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 访客：不可见
-- （不创建 anon 策略，默认拒绝）
```

### 5.3 密钥层级

| 密钥 | 持有者 | RLS 行为 | 用途 |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | 前端 SPA（公开） | 受 RLS 策略约束 | 前端读写数据 |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Secrets + Edge Functions | **绕过 RLS** | Cron 脚本写入数据、Edge Function 内部操作 |
| Supabase Auth Token | 管理员浏览器 session | 认证为 `authenticated` 角色 | Admin SPA 操作 |

### 5.4 安全红线

1. **`SUPABASE_SERVICE_ROLE_KEY` 永不出现在前端代码中**
2. **前端 SPA 只使用 `SUPABASE_ANON_KEY`**
3. **B站 Cookie / YouTube API Key 等敏感信息不硬编码，通过环境变量或 Supabase Vault 管理**
4. **RSSHub 必须配置 API Key 鉴权，裸奔部署是安全红线**
5. **Admin SPA 登录页面应有限流保护**（Supabase Auth 自带基础限流）

---

## 6. 接口规范

### 6.1 接口分类

| 接口类型 | 协议 | 调用方 | 说明 |
|---|---|---|---|
| **Supabase REST API** | HTTPS RESTful | 前端 SPA / Cron 脚本 | PostgREST 自动生成，标准 RESTful |
| **Edge Functions** | HTTPS POST | 前端 SPA | Deno 函数，JSON 请求/响应 |
| **平台 API** | HTTPS | Cron 脚本 | B站 / YouTube / RSSHub，各平台自有规范 |
| **pm2 (node-cron)** | 守护进程调度 | pm2 守护进程 | 定时触发 Cron 脚本 |

### 6.2 Supabase REST API 规范

PostgREST 自动生成 REST API，遵循以下约定：

#### 路径规则

```
GET    /rest/v1/monitors?select=*&is_active=eq.true     → 查询监控列表
POST   /rest/v1/monitors                                 → 新增监控
PATCH  /rest/v1/monitors?id=eq.42                        → 更新单条
DELETE /rest/v1/monitors?id=eq.42                        → 删除单条

GET    /rest/v1/contents?select=*&is_display=eq.true&order=published_at.desc&limit=20&offset=0
                                                          → H5 分页查询信息流
```

#### 请求头

```
apikey: {SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_ROLE_KEY}
Authorization: Bearer {token}
Content-Type: application/json
Prefer: return=representation        # 创建/更新时返回完整对象
Prefer: resolution=merge-duplicates  # UPSERT 模式
```

#### 响应格式

```json
// 成功 (200/201)
{
  "data": [{ ... }],
  "status": 200
}

// 失败
{
  "code": "PGRST116",
  "message": "JSON object requested, multiple (or no) rows returned",
  "details": "...",
  "hint": "..."
}
```

### 6.3 Edge Function 接口规范

所有 Edge Function 遵循统一的请求/响应格式。

#### 通用请求格式

```json
POST /functions/v1/{function-name}
Content-Type: application/json
Authorization: Bearer {anon_key或auth_token}

{
  "action": "string",
  ...action-specific fields
}
```

#### 通用响应格式

```json
// 成功
{
  "success": true,
  "data": { ... }
}

// 失败
{
  "success": false,
  "error": {
    "code": "PARSE_FAILED",
    "message": "无法识别该平台"
  }
}
```

#### parse-url 接口

```
POST /functions/v1/parse-url

请求:
{ "url": "https://space.bilibili.com/12345" }

成功响应:
{
  "success": true,
  "data": {
    "platform": "bilibili",
    "native_id": "12345",
    "display_name": "B站_12345"
  }
}

失败响应:
{
  "success": false,
  "error": {
    "code": "UNKNOWN_PLATFORM",
    "message": "无法识别该平台"
  }
}
```

#### bilibili-auth 接口

```
POST /functions/v1/bilibili-auth

# 获取二维码
请求: { "action": "qrcode" }
响应: {
  "success": true,
  "data": {
    "qr_url": "https://...",
    "qrcode_key": "xxx"
  }
}

# 轮询扫码状态
请求: { "action": "poll", "qrcode_key": "xxx" }
响应（等待中）: {
  "success": true,
  "data": { "status": "waiting" }
}
响应（成功）: {
  "success": true,
  "data": { "status": "success" }
}
响应（过期）: {
  "success": true,
  "data": { "status": "expired" }
}
```

### 6.4 Cron 脚本内部接口（平台适配器）

适配器层统一接口，不对外暴露，仅在 Cron 脚本内部调用：

```typescript
// scripts/cron/src/adapters/types.ts

/** 原始内容（适配器返回） */
interface RawContent {
  native_id: string;
  content_type: 'video' | 'article' | 'question' | 'answer' | 'post';
  title: string;
  cover_url: string;
  original_url: string;
  published_at: string; // ISO 8601 UTC
}

/** 平台适配器接口 */
interface PlatformAdapter {
  /** 平台标识 */
  readonly platform: 'bilibili' | 'youtube' | 'zhihu';

  /** 获取博主最新内容 */
  fetchLatest(monitor: Monitor): Promise<RawContent[]>;

  /** 获取博主昵称（添加时同步调用） */
  fetchDisplayName(monitor: Monitor): Promise<string | null>;
}
```

### 6.5 错误码规范

Edge Function 统一错误码：

| 错误码 | HTTP 状态 | 含义 |
|---|---|---|
| `UNKNOWN_PLATFORM` | 400 | 无法识别 URL 对应的平台 |
| `INVALID_URL` | 400 | URL 格式不合法 |
| `DUPLICATE_MONITOR` | 409 | 该博主已添加 |
| `BILIBILI_QRCODE_EXPIRED` | 400 | B站二维码已过期 |
| `BILIBILI_COOKIE_INVALID` | 401 | B站 Cookie 已失效 |
| `YOUTUBE_API_ERROR` | 502 | YouTube API 调用失败 |
| `RSSHUB_ERROR` | 502 | RSSHub 接口调用失败 |
| `INTERNAL_ERROR` | 500 | 未预期的内部错误 |



---

## 附录：行业最佳实践参考

本文件中采用的架构决策基于以下行业最佳实践：

1. **Supabase Edge Functions 组织方式**：采用官方推荐的 "fat functions" 模式（少而大的函数），共享代码放 `_shared` 目录（下划线前缀不部署），函数名使用连字符（URL 友好）。
2. **Supabase RLS 安全模式**：所有暴露表必须启用 RLS，`service_role` 密钥绕过 RLS 仅用于服务端，前端只使用 `anon_key`。
3. **Monorepo 共享类型**：前后端共享类型放在 `packages/shared`，作为 Single Source of Truth，避免类型定义分散。
4. **环境变量管理**：敏感信息（API Key、Service Role Key）存储在腾讯云环境变量中，不硬编码到代码或配置文件中。
5. **PostgreSQL UPSERT 模式**：使用 `ON CONFLICT ... DO UPDATE WHERE` 实现防复活保护，软删除记录不被意外重置。
6. **cron_locks 行级互斥**：使用数据库表行 + PATCH 原子操作（而非 pg_advisory_lock），因为 Supabase REST API 每次请求是独立会话，跨会话锁失效。
