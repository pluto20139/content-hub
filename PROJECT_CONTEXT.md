# PROJECT_CONTEXT.md

> 本文档是多平台内容中枢（Content Hub）的项目上下文文件，供 AI 和开发者快速理解项目技术约束与规范。
> 最后更新：2026-07-18

---

## 1. 技术栈

### 1.1 总览

| 层级 | 技术 | 版本 / 备注 |
|---|---|---|
| **前端框架** | React | 19.2.6，配置管理端 + 用户端 H5 两个独立 SPA |
| **构建工具** | Vite | 8.0.16，快速 HMR，生产构建优化 |
| **类型系统** | TypeScript | ~6.0.2（Monorepo 内 `tsc -b` 增量构建） |
| **样式方案** | Tailwind CSS | 3.4.x，原子化 CSS，移动端优先 |
| **运行时** | Node.js | >= 20.0.0（Cron 脚本运行环境） |
| **包管理** | pnpm | 11.8.0 + workspace，Monorepo 依赖管理 |
| **后端 BaaS** | Supabase Cloud | PostgreSQL + PostgREST + Edge Functions |
| **数据库** | PostgreSQL 15（Supabase 托管） | 支持 RLS、pg_cron、Supabase Vault |
| **Edge Functions** | Deno + TypeScript | 6 个函数（详见 §6.3） |
| **定时任务** | 腾讯云 pm2 + node-cron | 6 个平台适配器，每 30 分钟触发 |
| **AI 摘要** | Dify | DIFY_API_URL + DIFY_API_KEY 配置 |
| **知乎中转** | RSSHub（Docker 自部署） | `docker-compose.yml` 在服务器上跑 |
| **前端托管** | 腾讯云 nginx | 绑定 `mpchub.top` (H5) 和 `admin.mpchub.top` (Admin) 域名，监听 80/443 端口，通过 Let's Encrypt 自动配置 HTTPS |

### 1.2 关键依赖

| 依赖 | 用途 | 持有方 |
|---|---|---|
| `@content-hub/shared` | 前后端共享类型与常量 | workspace package |
| `@supabase/supabase-js` | Supabase REST 客户端 | apps/h5 + apps/admin + scripts/cron |
| `qrcode` | B站扫码登录二维码生成 | apps/admin |
| `node-cron` | Cron 调度 | scripts/cron |
| `undici` | HTTP 客户端（适配器） | scripts/cron |
| `@supabase/supabase-js` (Deno) | Edge Function 内 | supabase/functions |

### 1.3 环境变量清单

| 变量名 | 存储位置 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 腾讯云服务器环境变量 / Supabase Edge | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 腾讯云服务器环境变量 / Supabase Edge | 前端公开使用，受 RLS 保护 |
| `SUPABASE_SERVICE_ROLE_KEY` | 腾讯云服务器环境变量 | 绕过 RLS，仅 Cron / Edge Function 使用 |
| `VITE_SUPABASE_URL` | Vite 编译期注入（前端） | 前端请求 Supabase 的 URL |
| `VITE_SUPABASE_ANON_KEY` | Vite 编译期注入（前端） | 前端 ANON_KEY |
| `YOUTUBE_API_KEY` | 腾讯云环境变量 + Supabase Secrets | YouTube Data API v3（双配置） |
| `BILIBILI_COOKIE` | `platform_configs` 表 + Supabase Vault 加密 | B站 Cookie |
| `RSSHUB_URL` | 腾讯云服务器环境变量 | RSSHub 实例地址（V1.1+） |
| `ZHIHU_COOKIES` | `.env` / `docker-compose.yml` | RSSHub 抓知乎用（Docker 注入） |
| `XIAOHONGSHU_COOKIE` | `.env` / `docker-compose.yml` | RSSHub 抓小红书用 |
| `DIFY_API_URL` | 腾讯云环境变量 + Supabase Secrets | Dify API endpoint |
| `DIFY_API_KEY` | 腾讯云环境变量 + Supabase Secrets | Dify API key |
| `DOUYIN_PROXY_LIST` | 数据库/环境配置 | 抖音抓取代理列表 |
| `XIAOHONGSHU_PROXY_LIST` | 数据库/环境配置 | 小红书抓取代理列表 |
| `ZHIHU_PROXY_LIST` | 数据库/环境配置 | 知乎抓取代理列表 |
| `WECOM_WEBHOOK_URL` | 腾讯云环境变量（可选） | 企业微信告警 Webhook |

---

## 2. 目录规范

### 2.1 Monorepo 结构

pnpm workspace 管理的 Monorepo，基于 Supabase 推荐的 Edge Functions 组织方式和 apps/packages 分层模式。

```
多平台中枢/
├── apps/                           # 前端应用
│   ├── admin/                      # 配置管理端 (React SPA)
│   │   ├── src/
│   │   │   ├── components/         # 通用组件 (AuthGuard)
│   │   │   ├── pages/              # 页面 (Login, MonitorList)
│   │   │   ├── lib/                # 工具 (supabase client)
│   │   │   ├── App.tsx             # hash 路由（#/login / 默认 MonitorList）
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── h5/                         # 用户端 H5 (React SPA)
│       ├── src/
│       │   ├── components/         # ContentCard / SkeletonCard / FallbackModal
│       │   │                       # HideButton / UnhideButton / ErrorBoundary
│       │   ├── pages/              # Feed（按平台 Tabs + 已隐藏 Tab）
│       │   ├── lib/                # supabase / cache（SWR）/ hidden-storage
│       │   ├── constants/          # tabs.ts（平台 Tabs 配置）
│       │   ├── assets/             # 静态资源
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── packages/
│   └── shared/                     # 前后端共享代码（Single Source of Truth）
│       ├── src/
│       │   ├── constants/          # platforms.ts / deep-link.ts
│       │   ├── utils/              # environment.ts / time.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/                       # Supabase 项目配置
│   ├── functions/                  # Edge Functions (Deno, 6 个)
│   │   ├── _shared/                # 共享代码（cors.ts）
│   │   ├── parse-url/              # URL 解析 + 平台识别
│   │   ├── bilibili-auth/          # B站扫码登录
│   │   ├── article-fetcher/        # 知乎文章正文抓取（V1.2）
│   │   ├── youtube-proxy/          # YouTube Data API 代理
│   │   ├── image-proxy/            # 图片代理（防盗链）
│   │   └── retry-summary/          # AI 摘要重试入口
│   ├── migrations/                 # SQL 迁移脚本（017 个）
│   │   ├── 001_monitors.sql
│   │   ├── ...
│   │   ├── 015_anon_read_tighten.sql
│   │   ├── 016_add_video_summary.sql
│   │   └── 017_add_summary_fields.sql
│   ├── seed.sql
│   └── config.toml
│
├── scripts/
│   └── cron/                       # pm2 Cron 守护进程与定时脚本
│       ├── src/
│       │   ├── adapters/           # 平台适配器（6 个）
│       │   │   ├── bilibili.ts / youtube.ts / zhihu.ts
│       │   │   ├── douyin.ts / xiaohongshu.ts
│       │   │   └── types.ts
│       │   ├── lib/                # supabase / cleaner / upsert(content-writer)
│       │   │                       # alert / lock / dify / monitors-query
│       │   │                       # proxy / throttle
│       │   ├── index.ts            # 抓取主入口
│       │   ├── scheduler.ts        # node-cron 调度入口（被 pm2 启动）
│       │   └── scratch/            # 临时调试脚本（不部署）
│       ├── package.json
│       └── tsconfig.json
│
├── docker-compose.yml              # 服务器自部署 RSSHub + Redis
├── ecosystem.config.cjs            # pm2 进程配置
├── docs/                           # 项目文档
├── .env.example
├── package.json                    # 根 package.json (workspace)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── PROJECT_CONTEXT.md              # 本文件
```

### 2.2 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| Edge Function | 连字符（kebab-case） | `parse-url`, `bilibili-auth` |
| 数据库表/字段 | 蛇形（snake_case） | `monitors`, `is_active`, `summary_status` |
| TypeScript 文件 | 连字符（kebab-case） | `deep-link.ts`, `hidden-storage.ts` |
| TypeScript 类型/接口 | 帕斯卡（PascalCase） | `Monitor`, `Content`, `TabConfig` |
| React 组件 | 帕斯卡（PascalCase） | `ContentCard`, `MonitorList` |
| React 组件文件 | 帕斯卡（PascalCase） | `ContentCard.tsx`, `MonitorList.tsx` |
| 常量 | 全大写蛇形（UPPER_SNAKE） | `PLATFORM_COLORS`, `TABS`, `MOBILE_UA_PATTERNS` |
| CSS 类名 | Tailwind 原子类优先 | `className="flex items-center gap-2"` |
| SQL 迁移文件 | 数字前缀 + 蛇形 | `001_monitors.sql`, `016_add_video_summary.sql` |
| 环境变量 | 全大写蛇形 | `SUPABASE_URL`, `DIFY_API_KEY` |

### 2.3 共享类型同步策略

`packages/shared` 是前后端类型的唯一数据源：

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
                       │ Supabase Edge Function (image-proxy / youtube-proxy /
                       │   parse-url / bilibili-auth / article-fetcher / retry-summary)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Supabase Cloud                              │
│  ├── PostgreSQL (monitors / contents / platform_configs /     │
│  │               cron_locks / cron_soft_delete_logs /         │
│  │               short_link_cache)                            │
│  ├── PostgREST (自动 REST API)                               │
│  ├── Edge Functions (Deno, 6 个)                              │
│  ├── pg_cron (每日软删除任务)                                 │
│  └── cron_locks 表 (Cron 行级互斥锁)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (service_role key)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            腾讯云服务器 (pm2 + node-cron 守护进程)            │
│  ├── Node.js 抓取脚本（6 平台适配器）                           │
│  ├── Dify AI 摘要生成                                          │
│  └── 写入 Supabase (UPSERT + 状态回写)                       │
└─────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│           RSSHub (Docker 自部署, docker-compose)              │
│  暴露 API Key 鉴权 → 抓取知乎/抖音/小红书                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心架构约束

| # | 约束 | 理由 |
|---|---|---|
| AC1 | **前端不直接调用任何第三方平台 API** | 平台 API 全部在 pm2 Cron 守护进程内完成，前端只与 Supabase / Edge Function 交互 |
| AC2 | **Cron 脚本不直接操作数据库连接** | 通过 Supabase REST API（Service Role Key）写入数据，不直连 PostgreSQL |
| AC3 | **Edge Functions 仅用于轻量逻辑** | URL 解析、扫码登录、图片代理、YouTube 代理、知乎文章抓取、AI 重试入口 |
| AC4 | **Service Role Key 永不暴露到前端** | 仅存储在腾讯云环境变量中，供 Cron 和 Edge Function 使用 |
| AC5 | **RSSHub 必须启用 API Key 鉴权** | RSSHub 暴露在公网，通过 `ACCESS_CONTROL` 配置项限制访问 |
| AC6 | **Cron 互斥锁基于 cron_locks 表行级锁** | 不使用 pg_advisory_lock（REST API 每次请求是独立会话），改用数据库表行 + PATCH 原子操作 |
| AC7 | **所有数据库表必须启用 RLS** | 即使是内部表，也通过 RLS 策略显式控制访问权限 |
| AC8 | **Cron 脚本按平台串行、平台间可并行** | 同平台请求间隔 ≥ 1.5 秒（防反爬），不同平台无此限制 |
| AC9 | **敏感信息（Cookie、API Key）加密存储** | B站 Cookie 存入 `platform_configs` 表，使用 Supabase Vault 加密 |
| AC10 | **前端 SPA 不做服务端渲染** | 纯客户端渲染，腾讯云 nginx 静态托管 |
| AC11 | **H5 用户隐藏状态存于 localStorage** | 个人工具，无需多端同步，避免污染 contents 表和 RLS |
| AC12 | **第三方图片必须经 image-proxy 中转** | 解决 CDN 防盗链；image-proxy 通过白名单（5 平台 + CDN 域名）限制来源 |
| AC13 | **YouTube API 由 youtube-proxy 转发** | 解决浏览器端 CORS；proxy 过滤掉 Supabase 注入的 auth 头 |
| AC14 | **AI 摘要由 Dify 生成** | 视频 content_type 入库时 summary_status='pending'，Cron 异步调用 Dify 回写 summary |
| AC15 | **5 平台支持** | bilibili（user/people/column 主页） / youtube / zhihu（people/column） / douyin / xiaohongshu |
| AC16 | **知乎 feed 路由由 monitor type 决定** | V1.2 修复：根据 monitor.native_type（people/column）选择 RSSHub 路由，不再依赖 content.content_type |

### 3.3 数据流约束

```
写入流（Cron 抓取）：
  腾讯云 pm2 → 第三方 API / RSSHub → 清洗标准化 → Supabase REST API (UPSERT) → PostgreSQL

AI 摘要流（Cron 异步）：
  视频入库 (summary_status='pending')
    → Cron 触发 Dify Workflow
    → 解析响应回写 contents.summary / summary_status='success' / summary_at / summary_duration_ms

读取流（H5 浏览）：
  H5 SPA → Supabase REST API (SELECT is_display=true) → PostgreSQL
  H5 SPA → image-proxy Edge Function → 第三方 CDN（防盗链）
  H5 SPA → youtube-proxy Edge Function → YouTube Data API
  H5 SPA → article-fetcher Edge Function → 知乎文章正文（V1.2 摘要）
  H5 SPA → retry-summary Edge Function → 触发摘要重试（failed → pending）

配置流（管理端）：
  Admin SPA → Edge Function (parse-url) → Supabase REST API → PostgreSQL
  Admin SPA → Edge Function (bilibili-auth) → B站 API → Supabase (存 Cookie)
```

---

## 4. 核心业务模块

### 4.1 模块全景

```
Content Hub
├── 【配置管理端】
│   ├── M1: 监控目标管理 (CRUD)
│   ├── M2: URL 解析与平台识别 (Edge Function: parse-url)
│   ├── M3: B站扫码授权 (Edge Function: bilibili-auth)
│   ├── M4: 监控状态面板 (只读展示)
│   └── M5: 昵称管理 (同步获取 + 行内编辑)
│
├── 【后端自动化引擎】
│   ├── M6: Cron 调度 (pm2 + node-cron, 30 分钟)
│   ├── M7: 平台适配器层（6 个）
│   │   ├── B站适配器 (Cookie + 空间 API)
│   │   ├── YouTube 适配器 (Data API v3)
│   │   ├── 知乎适配器 (RSSHub 中转, people/column)
│   │   ├── 抖音适配器 (RSSHub 中转)
│   │   └── 小红书适配器 (RSSHub 中转)
│   ├── M8: 数据清洗标准化
│   ├── M9: UPSERT 去重 (ON CONFLICT, ?columns= 防复活)
│   ├── M10: 软删除生命周期 (pg_cron)
│   ├── M11: 告警通知 (企业微信 Webhook)
│   └── M15: AI 摘要 (Dify Workflow 异步生成)
│
├── 【用户端 H5】
│   ├── M12: 聚合信息流 (分页 + 按平台 Tabs 切换 + 已隐藏 Tab)
│   ├── M13: Deep Link 跳转（5 平台 + PC 桌面浏览器分支）
│   ├── M14: 兜底弹窗 (跳转失败时)
│   ├── M16: 隐藏/取消隐藏 (localStorage, 客户端状态)
│   └── M18: 知乎文章正文抓取 (article-fetcher, 摘要阅读)
│
└── 【通用基础设施 Edge Functions】
    ├── M17: 图片代理 (image-proxy, CDN 防盗链)
    └── M19: YouTube API 代理 (youtube-proxy, CORS 中转)
```

### 4.2 模块职责详述

#### M1: 监控目标管理

- **职责**：`monitors` 表的 CRUD 操作
- **实现**：Admin SPA 直接调用 Supabase REST API
- **关键逻辑**：添加时调用 `parse-url` Edge Function 解析平台与标识

#### M2: URL 解析与平台识别

- **职责**：根据 URL 特征识别平台，提取核心标识
- **实现**：Edge Function `parse-url`（Deno）
- **平台识别规则**：
  - `bilibili.com/space.bilibili.com` → B站，正则提取 `mid`（user 主页）
  - `bilibili.com/read.cv` → B站专栏（预留）
  - `youtube.com/@handle` → YouTube，提取 handle 并调 `channels.list?forHandle=` 转 `channelId`
  - `zhihu.com/people/xxx` → 知乎 people，`zhihu.com/column/xxx` → 知乎 column
  - `douyin.com/user/xxx` → 抖音（V1.1+）
  - `xiaohongshu.com/user/profile/xxx` → 小红书（V1.1+）

#### M3: B站扫码授权

- **职责**：生成二维码 → 轮询扫码状态 → 捕获 Cookie → 加密存储
- **实现**：Edge Function `bilibili-auth`（Deno）+ Admin SPA 内 `qrcode` 库展示
- **存储**：Cookie 加密存入 `platform_configs` 表

#### M6: Cron 调度

- **实现**：`scripts/cron/src/scheduler.ts` 启动 node-cron，调度规则 `*/30 * * * *`（每 30 分钟）
- **启动方式**：pm2 以 `node dist/scheduler.js` 启动，注入 `--env-file=/opt/content-hub/.env.production`
- **首次行为**：启动时立即执行一次 `run()`

#### M7: 平台适配器层

- **统一接口**：
  ```typescript
  interface PlatformAdapter {
    platform: 'bilibili' | 'youtube' | 'zhihu' | 'douyin' | 'xiaohongshu';
    fetchLatest(monitor: Monitor): Promise<RawContent[]>;
    fetchDisplayName(monitor: Monitor): Promise<string | null>;
  }
  ```
- **各适配器数据源**：

| 适配器 | 数据源 | 鉴权 | 限速 |
|---|---|---|---|
| bilibili | 空间 API `x/space/wbi/arc/search` | Cookie (SESSDATA) | 同平台 ≥1.5s |
| youtube | `playlistItems.list` (uploads playlist) | API Key | 无需 |
| zhihu | RSSHub HTTP 接口 | API Key | 同平台 ≥1.5s |
| douyin | RSSHub HTTP 接口 | API Key | 同平台 ≥1.5s |
| xiaohongshu | RSSHub HTTP 接口 | API Key | 同平台 ≥1.5s |

#### M9: UPSERT 去重

- **实现**：`scripts/cron/src/lib/content-writer.ts`
- **关键设计**：用 `?columns=` URL 参数限制 UPSERT 字段，避免触碰 `is_display` 等敏感列，防止软删除记录被复活
- **冲突键**：`(platform, native_id)` 唯一索引

#### M12: 聚合信息流

- **入口**：`apps/h5/src/pages/Feed.tsx`
- **Tabs**（`apps/h5/src/constants/tabs.ts`）：全部 / bilibili / youtube / zhihu / douyin / xiaohongshu / 已隐藏
- **缓存**：`lib/cache.ts` 实现 SWR 模式（stale-while-revalidate），Tab 切换瞬时显示
- **加载状态**：`SkeletonCard` 骨架屏
- **错误兜底**：`ErrorBoundary`

#### M13: Deep Link 跳转

- **入口**：`apps/h5/src/components/ContentCard.tsx` `handleClick`
- **分支**：
  1. 微信 / 支付宝 → 立即复制 + 弹 fallback
  2. **桌面浏览器**（新增，V1.2.x）→ `window.open(originalUrl, "_blank")`，跳过 Deep Link
  3. 系统浏览器（手机）→ Deep Link + 2.5s 兜底
- **PC 识别**：`@content-hub/shared` 的 `isDesktopBrowser(ua)`，UA 不含 `Mobile/Android/iPhone/iPad/iPod` 且非微信/支付宝

#### M14: 兜底弹窗

- **组件**：`FallbackModal`
- **触发**：移动端 2.5s 内 Deep Link 未唤起成功（visibilitychange/pagehide/blur 都不触发）

#### M15: AI 摘要（Dify）

- **触发**：视频入库时 `summary_status='pending'`
- **执行**：`scripts/cron/src/lib/dify.ts` 调 Dify Workflow API
- **超时**：5 秒硬超时（`AbortController`）
- **回写字段**：`summary` / `summary_status`（success/failed）/ `summary_at` / `summary_duration_ms`
- **重试入口**：`retry-summary` Edge Function，允许 anon 将 `failed` 状态 PATCH 为 `pending`，由下次 Cron 重跑
- **V1.2.1 扩展**：所有 content_type 都支持摘要（不再仅限 video）

#### M16: 隐藏/取消隐藏

- **存储**：`apps/h5/src/lib/hidden-storage.ts`（`localStorage`）
- **键**：`content-hub:hidden-ids`，JSON 数组
- **同步**：`addHiddenId` / `removeHiddenId` / `getHiddenIds` / `asSupabaseIdList`
- **查询**：在 Feed 页面通过 `NOT IN` 过滤 + 单独的"已隐藏" Tab 反向查询

#### M17: 图片代理

- **入口**：`/functions/v1/image-proxy?url=<encoded>`
- **白名单**：5 平台主域 + CDN 域名（hdslb/ytimg/zhimg/xhscdn/douyincdn/pstatp/amemv）
- **用途**：解决 CDN 防盗链导致 `<img>` 直接加载失败的问题

#### M19: YouTube API 代理

- **入口**：`/functions/v1/youtube-proxy/<path>?<query>`
- **实现**：转发到 `https://www.googleapis.com/youtube/v3/<path>`，过滤掉 Supabase 注入的 `host/authorization/apikey` 头
- **用途**：解决浏览器端直连 YouTube API 的 CORS 限制

---

## 5. 权限体系

### 5.1 角色模型

极简双角色模型：

| 角色 | 身份 | 访问方式 | 权限范围 |
|---|---|---|---|
| **管理员** | Supabase Auth 认证用户（邮箱+密码） | Admin SPA（登录后） | monitors / contents / platform_configs 全部读写 |
| **访客** | 匿名用户（anon） | H5 SPA（无需登录） | contents 表只读（仅 `is_display = true` 的记录） |

### 5.2 RLS 策略（当前生效版）

经过 013→015 迭代后，当前策略如下：

#### monitors 表

```sql
-- 管理员：全部读写
CREATE POLICY monitors_admin_all ON monitors
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 访客：不可见
```

#### contents 表

```sql
-- 管理员：全部读写
CREATE POLICY contents_admin_all ON contents
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 访客：仅读取 is_display = true 的记录
CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (is_display = true);

-- 访客：可重置 AI 摘要状态（failed → pending，仅限这两列）
CREATE POLICY contents_anon_retry_summary ON contents
  FOR UPDATE TO anon
  USING (summary_status = 'failed')
  WITH CHECK (summary_status = 'pending');

-- GRANT: 访客可显式 UPDATE 这两列
GRANT UPDATE (is_display, summary_status) ON public.contents TO anon;
```

#### platform_configs 表

```sql
-- 管理员：全部读写
-- 访客：不可见
```

#### short_link_cache 表（migration 013 显式锁定）

```sql
-- 仅 service_role 可读写（防止匿名访问短链缓存）
CREATE POLICY short_link_cache_service_only ON short_link_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

### 5.3 密钥层级

| 密钥 | 持有者 | RLS 行为 | 用途 |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | 前端 SPA（公开） | 受 RLS 策略约束 | 前端读写数据 |
| `SUPABASE_SERVICE_ROLE_KEY` | 腾讯云环境变量 + Edge Function | 绕过 RLS | Cron 写入、Edge Function 内部操作 |
| Supabase Auth Token | 管理员浏览器 session | 认证为 `authenticated` 角色 | Admin SPA 操作 |
| `DIFY_API_KEY` | 腾讯云环境变量 + Supabase Secrets | 不涉及 RLS | AI 摘要生成 |

### 5.4 安全红线

1. `SUPABASE_SERVICE_ROLE_KEY` 永不出现在前端代码中
2. 前端 SPA 只使用 `SUPABASE_ANON_KEY`
3. 敏感信息（Cookie、API Key）不硬编码，通过环境变量或 Supabase Vault 管理
4. RSSHub 必须配置 API Key 鉴权
5. Admin SPA 登录页面应有限流保护（Supabase Auth 自带基础限流）
6. image-proxy 必须用域名白名单，禁止开放代理

---

## 6. 接口规范

### 6.1 接口分类

| 接口类型 | 协议 | 调用方 | 说明 |
|---|---|---|---|
| Supabase REST API | HTTPS RESTful | 前端 SPA / Cron | PostgREST 自动生成 |
| Edge Functions | HTTPS POST | 前端 SPA / Cron | Deno 函数，6 个 |
| 平台 API | HTTPS | Cron | B站 / YouTube / RSSHub |
| node-cron | 守护进程调度 | pm2 | 每 30 分钟触发抓取 |
| Dify API | HTTPS | Cron | AI 摘要生成 |

### 6.2 Supabase REST API 规范

PostgREST 自动生成 REST API：

#### 常用路径

```
GET    /rest/v1/monitors?select=*&is_active=eq.true
POST   /rest/v1/monitors
PATCH  /rest/v1/monitors?id=eq.42
DELETE /rest/v1/monitors?id=eq.42

GET    /rest/v1/contents?select=*&is_display=eq.true&order=published_at.desc&limit=20&offset=0
PATCH  /rest/v1/contents?id=eq.42         -- anon 限定 (is_display, summary_status) 两列
```

#### Cron 写入路径（V1.2 内容写入器）

```
POST   /rest/v1/contents?columns=platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id
Prefer: resolution=merge-duplicates
Authorization: Bearer <SERVICE_ROLE_KEY>
```

> `?columns=` 限制 UPSERT 字段，避免触碰 `is_display` / `summary_status` 等敏感列。

### 6.3 Edge Function 接口规范

#### 当前 6 个 Edge Function

| Function | 用途 | 触发方 |
|---|---|---|
| `parse-url` | URL 解析 + 平台识别 | Admin SPA 添加监控时 |
| `bilibili-auth` | B站扫码登录 | Admin SPA M3 |
| `article-fetcher` | 知乎文章正文抓取（V1.2 摘要阅读） | H5 SPA |
| `youtube-proxy` | YouTube Data API 代理 | Admin SPA / 内部 |
| `image-proxy` | 图片代理（防盗链） | H5 SPA `<img>` 标签 |
| `retry-summary` | AI 摘要重试（failed → pending） | H5 SPA 重新总结按钮 |

#### 通用请求 / 响应格式

```json
// 请求
POST /functions/v1/<function-name>
Content-Type: application/json
Authorization: Bearer <anon_key 或 auth_token 或 service_role>

{
  "action": "string",
  ...action-specific fields
}

// 成功响应
{ "success": true, "data": { ... } }

// 失败响应
{ "success": false, "error": { "code": "...", "message": "..." } }
```

#### 关键端点详解

**parse-url**：
```
请求:  { "url": "https://space.bilibili.com/12345" }
响应:  { "success": true, "data": { "platform": "bilibili", "native_id": "12345", "display_name": "..." } }
```

**bilibili-auth**：
```
请求:  { "action": "qrcode" }
响应:  { "success": true, "data": { "qr_url": "...", "qrcode_key": "..." } }

请求:  { "action": "poll", "qrcode_key": "..." }
响应:  { "success": true, "data": { "status": "waiting" | "success" | "expired" } }
```

**article-fetcher**（V1.2）：
```
请求:  { "url": "https://zhuanlan.zhihu.com/p/12345" }
响应:  { "success": true, "data": { "text": "...正文（HTML 转纯文本）..." } }
```

**retry-summary**：
```
请求:  { "content_id": 42 }
响应:  { "success": true, "data": { "content_id": 42, "previous_status": "failed" } }
```

**image-proxy**：
```
请求:  GET /functions/v1/image-proxy?url=https%3A%2F%2Fi0.hdslb.com%2F...
响应:  image binary（白名单域名通过，否则 403）
```

**youtube-proxy**：
```
请求:  GET /functions/v1/youtube-proxy/channels?part=snippet&forHandle=...
转发到: https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=...
```

### 6.4 Cron 适配器内部接口

```typescript
// scripts/cron/src/adapters/types.ts

interface RawContent {
  native_id: string;
  content_type: 'video' | 'article' | 'question' | 'answer' | 'post';
  title: string;
  cover_url: string;
  original_url: string;
  published_at: string; // ISO 8601 UTC
}

interface PlatformAdapter {
  readonly platform: 'bilibili' | 'youtube' | 'zhihu' | 'douyin' | 'xiaohongshu';
  fetchLatest(monitor: Monitor): Promise<RawContent[]>;
  fetchDisplayName(monitor: Monitor): Promise<string | null>;
}
```

### 6.5 错误码规范

Edge Function 统一错误码：

| 错误码 | HTTP 状态 | 含义 |
|---|---|---|
| `UNKNOWN_PLATFORM` | 400 | 无法识别 URL 对应的平台 |
| `INVALID_URL` | 400 | URL 格式不合法 |
| `INVALID_JSON` | 400 | 请求体非合法 JSON |
| `INVALID_ID` | 400 | ID 参数不合法 |
| `METHOD_NOT_ALLOWED` | 405 | 必须用 POST |
| `DUPLICATE_MONITOR` | 409 | 该博主已添加 |
| `BILIBILI_QRCODE_EXPIRED` | 400 | B站二维码已过期 |
| `BILIBILI_COOKIE_INVALID` | 401 | B站 Cookie 已失效 |
| `YOUTUBE_API_ERROR` | 502 | YouTube API 调用失败 |
| `RSSHUB_ERROR` | 502 | RSSHub 接口调用失败 |
| `INTERNAL_ERROR` | 500 | 未预期的内部错误 |

---

## 附录 A：腾讯云服务器部署信息

> 供 AI 助手在任何会话中读取。

### 服务器连接

| 项目 | 值 |
|---|---|
| 公网 IP | `124.222.54.39` |
| 登录用户 | `root` |
| 认证方式 | SSH 密钥免密登录（Mac 本地私钥：`~/.ssh/id_rsa`） |

### 部署路径与域名

| 服务 | 路径 / 域名 | 访问地址 | 备注 |
|---|---|---|---|
| 项目根目录 | `/opt/content-hub/` | - | - |
| H5 前端静态文件 | `/opt/content-hub/apps/h5/dist` | `https://mpchub.top` / `https://www.mpchub.top` | 监听 80(自动跳转)/443 端口 |
| Admin 后台静态文件 | `/opt/content-hub/apps/admin/dist` | `https://admin.mpchub.top` | 监听 80(自动跳转)/443 端口 |
| Cron 调度脚本 | `/opt/content-hub/scripts/cron/dist/scheduler.js` | - | - |
| pm2 配置文件 | `/opt/content-hub/ecosystem.config.cjs` | - | - |
| 生产环境变量 | `/opt/content-hub/.env.production` | - | - |
| RSSHub + Redis | `/opt/content-hub/`（docker-compose） | - | 本地 12006 端口 |

### 常用部署命令

```bash
# 1. 本地构建 H5（Mac 上执行）
pnpm --filter h5 build

# 2. 上传 H5 静态文件到服务器
scp -r apps/h5/dist/* root@124.222.54.39:/opt/content-hub/apps/h5/dist/

# 2a. 清理服务器上残留的旧 hash 文件（每次部署可顺手执行）
ssh root@124.222.54.39 "cd /opt/content-hub/apps/h5/dist/assets && ls -1 index-*.{js,css} | grep -vE 'index-(CURRENT_JS_HASH|CURRENT_CSS_HASH)\.(js|css)' | xargs -r rm"

# 3. 更新服务器 Cron 脚本
ssh root@124.222.54.39 "cd /opt/content-hub && git pull && pnpm --filter @content-hub/cron build && pm2 restart content-hub-cron"

# 4. 查看 Cron 日志
ssh root@124.222.54.39 "pm2 logs content-hub-cron --lines 50"

# 5. 查看 RSSHub 日志
ssh root@124.222.54.39 "cd /opt/content-hub && docker compose logs rsshub --tail 50"
```

### Admin 部署（与 H5 类似）

```bash
pnpm --filter admin build
scp -r apps/admin/dist/* root@124.222.54.39:/opt/content-hub/apps/admin/dist/
```

## 附录 B：版本演进

| 版本 | 主要变化 |
|---|---|
| V1.0 | 单一 B站监控 + H5 静态展示 |
| V1.1 | 多平台同步（bilibili / youtube / zhihu / douyin / xiaohongshu），RSSHub 中转，docker-compose 自部署 |
| V1.2 | H5 体验优化（Apple 极简风格 / 骨架屏 / 错误边界 / SWR 缓存 / Tabs 切换）+ AI 摘要（Dify 集成）+ 隐藏功能（localStorage）+ 知乎文章正文抓取 + 5 个新 Edge Function（article-fetcher / youtube-proxy / image-proxy / retry-summary / Dify 写入链路）|
| V1.2.1 | AI 摘要从仅 video 扩展到全部 content_type |
| V1.2.x | PC 桌面浏览器分支（isDesktopBrowser），避免在桌面走 2.5s 兜底弹窗 |
| V1.3.0 | 腾讯云正式域名 `mpchub.top` 备案通过，Nginx 迁移至 80/443 端口，基于 Certbot 部署免费 Let's Encrypt SSL 证书，全站升级强制 HTTPS 访问 |
