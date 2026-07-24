# PROJECT_CONTEXT.md

> 本文档是多平台内容中枢（Content Hub）的长期性项目上下文与技术架构规范文件，供开发者与 AI Agent 快速掌握项目最新现状、设计约束与最佳实践。
> 最后更新：2026-07-24 (V2.1 版本)

---

## 1. 技术栈

### 1.1 总览

| 层级 | 技术 | 版本 / 备注 |
|---|---|---|
| **前端框架** | React | 19.2.6，配置管理端 (Admin) + 用户端 H5 两个独立 SPA |
| **构建工具** | Vite | 8.0.16，快速 HMR，生产构建优化 |
| **类型系统** | TypeScript | ~6.0.3（Monorepo 内 `@content-hub/shared` 共享类型定义，严格类型检查） |
| **样式方案** | Tailwind CSS | 3.4.x，iOS 毛玻璃 (Glassmorphic) 风格，Pill 控件，高对比度 |
| **运行时** | Node.js | >= 20.0.0（Cron 守护进程运行环境） |
| **包管理** | pnpm | 11.8.0 + workspace，Monorepo 依赖与子包管理 |
| **后端 BaaS** | Supabase Cloud | PostgreSQL + PostgREST + Edge Functions + Supabase Auth |
| **数据库** | PostgreSQL 15（Supabase 托管） | 支持 RLS 多租户隔离、pg_cron、Supabase Vault 秘钥存储 |
| **Edge Functions** | Deno + TypeScript | 7 个云函数（`parse-url` / `bilibili-auth` / `article-fetcher` / `youtube-proxy` / `image-proxy` / `retry-summary` / `x-fetcher`） |
| **定时任务** | 腾讯云 pm2 + node-cron | 6 个平台适配器（B站/YouTube/知乎/抖音/小红书/X推特），每 30 分钟触发，集成分布式代理池与超时控制 |
| **AI 摘要** | Dify Workflow API | 异步调用 Dify Workflow 生成 AI 总结，具备并发控制、失败重试与前端 `retry-summary` 补救 |
| **知乎/X/代理** | RSSHub (Docker 自部署) + DatabaseProxyPool | 服务器自部署 RSSHub 抓取知乎与 X (Twitter) RSS，配合代理池实现网络抗封锁 |
| **前端托管** | 腾讯云 Nginx | 绑定 `mpchub.top` (H5) 和 `admin.mpchub.top` (Admin) 域名，监听 80/443 端口，HTTPS 强制重定向 |

### 1.2 关键依赖

| 依赖 | 用途 | 持有方 |
|---|---|---|
| `@content-hub/shared` | 前后端共享类型 (Monitor/Content/Platform)、URL 解析器、DeepLink 及常量 | workspace package (`packages/shared`) |
| `@supabase/supabase-js` | Supabase REST API & Auth 客户端 | `apps/h5` + `apps/admin` + `scripts/cron` |
| `qrcode` | B站扫码登录二维码生成 | `apps/admin` |
| `node-cron` | 定时调度引擎 | `scripts/cron` |
| `undici` | 高性能 HTTP 客户端 (适配器抓取) | `scripts/cron` |
| `@supabase/supabase-js` (Deno) | Edge Function 云端数据库与服务调用 | `supabase/functions` |

### 1.3 环境变量清单

| 变量名 | 存储位置 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 腾讯云服务器环境变量 / Supabase Edge | Supabase 项目后端 Endpoint |
| `SUPABASE_ANON_KEY` | 腾讯云服务器环境变量 / Supabase Edge | 前端公开密钥，受 RLS 租户隔离控制 |
| `SUPABASE_SERVICE_ROLE_KEY` | 腾讯云服务器环境变量 | 越过 RLS 提权密钥，仅限 Cron 脚本与 Edge Functions 使用 |
| `VITE_SUPABASE_URL` | Vite 编译期注入（前端） | 前端连接 Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Vite 编译期注入（前端） | 前端 ANON KEY |
| `YOUTUBE_API_KEY` | 腾讯云环境变量 + Supabase Secrets | YouTube Data API v3 秘钥 |
| `BILIBILI_COOKIE` | `platform_configs` 表 / Supabase Vault | B站博主抓取 Cookie |
| `RSSHUB_URL` | 腾讯云服务器环境变量 | 自部署 RSSHub 实例地址 |
| `TWITTER_AUTH_TOKEN` | `docker-compose.yml` / 环境变量 | RSSHub 抓取 X (Twitter) 用的身份 Token |
| `ZHIHU_COOKIES` | `.env` / `docker-compose.yml` | RSSHub 抓取知乎用的 Cookie 注入 |
| `DIFY_API_URL` | 腾讯云环境变量 + Supabase Secrets | Dify Workflow API 运行地址 |
| `DIFY_API_KEY` | 腾讯云环境变量 + Supabase Secrets | Dify Workflow API 鉴权 App Key |

---

## 2. 目录规范

### 2.1 Monorepo 目录结构

```
多平台中枢/
├── apps/                           # 前端应用 SPA
│   ├── admin/                      # 配置管理端 (React SPA, 部署在 admin.mpchub.top)
│   │   ├── src/
│   │   │   ├── components/         # AuthGuard, MonitorCard, AddMonitorModal
│   │   │   ├── pages/              # Login, MonitorList (iOS 毛玻璃管理界面)
│   │   │   ├── lib/                # supabase 客户端, Auth 工具
│   │   │   ├── App.tsx             # 路由分发与登录态拦截
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── h5/                         # 用户端 H5 Feed 流 (React SPA, 部署在 mpchub.top)
│       ├── src/
│       │   ├── components/         # ContentCard (支持 AI 摘要展开/重试), SkeletonCard, FallbackModal, H5Auth
│       │   ├── pages/              # Feed (按 6 平台 Tabs + 已隐藏 Tab 筛选，支持 ?u= 租户隔离)
│       │   ├── lib/                # supabase, hidden-storage, cache
│       │   ├── constants/          # tabs.ts (平台 Tabs 配置)
│       │   ├── App.tsx             # 提取 ?u=userId 参数与无缝授权
│       │   └── main.tsx
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   └── shared/                     # 前后端共享代码库 (Single Source of Truth)
│       ├── src/
│       │   ├── constants/          # platforms.ts (6 平台定义: bilibili/youtube/zhihu/douyin/xiaohongshu/x), deep-link.ts
│       │   ├── utils/              # environment.ts, time.ts, x-parser.ts, zhihu-parser.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/                       # Supabase 数据库与云函数配置
│   ├── functions/                  # Edge Functions (Deno 运行时, 7 个函数)
│   │   ├── _shared/                # 共享中间件 (cors.ts 等)
│   │   ├── parse-url/              # 博主 URL 解析与识别 (100% 返回 original_url)
│   │   ├── bilibili-auth/          # B站扫码登录凭证与多租户绑定
│   │   ├── article-fetcher/        # 知乎文章正文抽取器
│   │   ├── youtube-proxy/          # YouTube Data API 代理
│   │   ├── image-proxy/            # 图片防盗链中转代理
│   │   ├── retry-summary/          # 前端触发 AI 摘要重新拉起入口
│   │   └── x-fetcher/              # 云端 X/Twitter 推文拉取与 Token 中转
│   ├── migrations/                 # PostgreSQL 数据库 Migration 脚本 (含 V2.0 多租户及 V1.2 summary 字段扩展)
│   └── config.toml
│
├── scripts/
│   └── cron/                       # pm2 定时抓取引擎守护进程
│       ├── src/
│       │   ├── adapters/           # 6 平台适配器 (bilibili.ts / youtube.ts / zhihu.ts / douyin.ts / xiaohongshu.ts / x.ts)
│       │   ├── lib/                # supabase, content-writer (多租户 UPSERT), dify (AI 总结队列), lock, proxy-pool
│       │   ├── index.ts            # 单次抓取主流程
│       │   └── scheduler.ts        # node-cron 守护线程 (被 pm2 托管)
│       └── package.json
│
├── docker-compose.yml              # 腾讯云 RSSHub + Redis 自部署配置
├── ecosystem.config.cjs            # pm2 进程配置文件
├── PROJECT_CONTEXT.md              # 项目长期性上下文文档（本文档）
└── AGENTS.md / .agents/AGENTS.md   # AI Agent 行为与命名约束规则
```

### 2.2 命名与控制台日志约束（强制执行）

根据 `.agents/AGENTS.md` 的规范，为避免各种数据库 ID 混淆，代码与日志必须遵循：

| 场景 | 强约束规范 | 正确示例 | 错误反例 |
|---|---|---|---|
| **TS 代码 / 变量** | 必须带显式实体后缀 | `contentId`, `monitorId`, `userId` | `id` (除单行 Callback 内) |
| **数据库字段** | 蛇形命名 `snake_case` | `user_id`, `monitor_id`, `native_id`, `original_url` | `userId`, `monitorId` |
| **控制台日志输出** | 必须明确前缀标注实体类型 | `[DIFY] Processing Video (Content ID: 15)` | `Processing video 15` |
| | | `[CRON] Syncing Monitor (Monitor ID: 3)` | `Syncing Monitor 3` |
| **TypeScript 类型** | 帕斯卡命名 `PascalCase` | `Monitor`, `Content`, `RawContent`, `Platform` | `monitor`, `content` |

---

## 3. 架构约束与数据流

### 3.1 架构拓扑图

```text
┌─────────────────────────────────────────────────────────────┐
│                  腾讯云 Nginx (HTTPS 80/443)                  │
│  ├── https://admin.mpchub.top (Admin 配置管理端 SPA)         │
│  └── https://mpchub.top       (H5 移动端 Feed 流 SPA)         │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (anon key, RLS 隔离: auth.uid() = user_id 或 ?u=userId)
                       │ Supabase Edge Functions (parse-url / image-proxy / retry-summary / x-fetcher)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Supabase Cloud (PostgreSQL 15)            │
│  ├── 数据表: monitors, contents, platform_configs, cron_locks │
│  ├── PostgREST 自动 REST API + Supabase Auth 账号鉴权        │
│  └── Edge Functions (Deno 运行时 7 个云函数)                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (service_role key 提权)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            腾讯云服务器 (pm2 + node-cron 守护进程)            │
│  ├── 定时抓取引擎 (6 平台适配器: B站/YT/知乎/抖音/小红书/X推特)   │
│  ├── Dify AI 摘要并发处理池 (Blocking 模式 + 自动重试)       │
│  └── 写入 Supabase (多租户 UPSERT, 显式匹配复合唯一约束)       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP 抓取请求 (带 Auth Token / Cookie / 代理池)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│           RSSHub (Docker 自部署, docker-compose)              │
│  提供知乎 / X推特 / 抖音 / 小红书 的标准 RSS Feed 转换        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 关键架构约束

1. **AC1: 强数据多租户隔离**：所有核心数据表 (`monitors`, `contents`, `platform_configs`) 均绑定 `user_id`。Supabase RLS 策略保证登录用户只能读写其自身数据；用户端 H5 页面支持通过 `?u=userId` 参数隔离展示对应用户的关注内容，并兼容遗留 `user_id IS NULL` 的公共历史数据展示。
2. **AC2: 免邮箱验证极简 Auth 流程**：注册时无需等待验证邮件，前端提交注册后自动授权登录并无缝跳转。
3. **AC3: 抓取引擎多租户感知**：Cron 守护进程使用 `SUPABASE_SERVICE_ROLE_KEY` 轮询所有租户的激活监控项（`monitors`），抓取内容入库时显式关联对应的 `monitor.user_id`。
4. **AC4: PostgREST UPSERT 复合唯一索引匹配**：`contents` 表唯一索引为 `UNIQUE (user_id, platform, native_id)`，`monitors` 表唯一索引为 `UNIQUE (user_id, platform, native_id)`。Cron 写入脚本在 PostgREST 请求 URL 中必须通过 `?columns=` 显式列出包含 `user_id` 在内的所有字段，防止跨租户去重失效。
5. **AC5: 6 平台原生支持与云端/本地双重抓取**：支持 B站、YouTube、知乎、抖音、小红书以及 X (推特)。X 平台支持自部署 RSSHub、云端 `x-fetcher` 云函数及多 Endpoint 自动 Fallback 机制。
6. **AC6: 接口契约绝对非空保护**：Edge Function（如 `parse-url`）返回的数据必须严格遵循 `ParseSuccess` 契约，保证 `original_url` 绝对非空，切勿传递 `undefined` 或 `null` 避免触碰数据库 `NOT NULL` 约束。
7. **AC7: Dify AI 摘要异步分流与前端补救**：抓取到的内容默认标记 `summary_status = 'pending'`；后置触发 Dify Workflow API 异步生成 AI 总结。如遇失败，除后端 1 次自动重试外，H5 前端提供卡片一键触发 `retry-summary` Edge Function 手动补救机制。
8. **AC8: 稳健网络与超时防御**：抓取适配器（如 `XAdapter`）必须配置 `DatabaseProxyPool` 代理池与严格的 15s/30s `AbortController` 请求超时限制，严禁因个别平台网络挂死阻塞整个 pm2 轮询主进程。

### 3.3 抓取路线与 Dify AI 智能体分工机制

系统在底层采用了**数据采集**与**语义理解**剥离的分层架构：

```text
               ┌──────────────────────────────────────────────┐
               │       Cron 抓取调度引擎 (scripts/cron)         │
               └──────┬──────────────┬──────────────┬─────────┘
                      │              │              │
     ┌────────────────┘              │              └────────────────┐
     ▼                               ▼                               ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│ 1. 官方 / 公开 API 直连   │  │ 2. RSSHub / x-fetcher 代理│  │ 3. Dify AI 智能体 (Workflow)│
│ (B站 WBI API / YouTube)   │  │ (知乎/ X推特/ 抖音/ 小红书) │  │ (LLM 语义提取与摘要生成)  │
└────────────┬──────────────┘  └─────────────┬─────────────┘  └─────────────┬─────────────┘
             │                               │                              │
             └───────────────────┬───────────┘                              │
                                 ▼                                          │
             ┌──────────────────────────────────────────────┐               │
             │   数据标准化清洗 & 写入 Supabase PostgreSQL   │               │
             │  (标记 summary_status = 'pending' 触发 AI)   ├───────────────┘
             └──────────────────────────────────────────────┘
```

#### 1. 各平台抓取技术路线选型说明

| 平台 | 抓取技术路线 | 选型理由与机制说明 |
|---|---|---|
| **B站 (bilibili)** | **公开 Web WBI API 直连** | B站提供了结构规范的公开 Web API (`x/space/wbi/arc/search`)，结合 `SESSDATA` Cookie 与本地 WBI 动态加密签名算法直连，无中转开销。 |
| **YouTube** | **官方 Data API v3 直连** | 调用 Google 官方 RESTful API (`playlistItems.list`)，传入频道 ID 精准获取最新视频，具备官方 SLA 保障与免费额度。 |
| **知乎 (Zhihu)** | **RSSHub 中转 + Cookie** | 知乎网页端与 App 具有极严苛的 JS 反爬与签名校验 (`__zse_ck`, `JOID`)。通过自部署 RSSHub 维护 Cookie 与 Feed 解析，规避 IP 封禁。 |
| **X / 推特 (X.com)** | **RSSHub / x-fetcher 云函数双中转** | X.com 实施了严格的 Guest Token 及 Auth 防护。支持自部署 RSSHub 挂载 `TWITTER_AUTH_TOKEN` 与 Supabase `x-fetcher` 云端云函数拉取推文，配置多 Endpoint 自动切换。 |
| **抖音 (Douyin)** | **RSSHub 中转 + 动态代理池** | 抖音网页端使用带时间戳密文的 X-Bogus 签名。通过 RSSHub 结合分布式代理池解决长短链跳转与防封锁。 |
| **小红书 (Xiaohongshu)**| **RSSHub 中转 + 网页 Cookie** | 小红书具备较强的网页风控参数 (`a1`, `webId`)，通过 RSSHub 维护 Cookie 并解析个人主页 HTML。 |

#### 2. RSSHub 与 Dify AI 智能体分工定位

- **抓取引擎 (Cron Adapter / RSSHub)** 的职责是 **“获取原始数据”**：负责从各平台拉取标题、推文正文、封面图、发布时间并写入 Supabase。它只专注数据采集，不做复杂大模型推理。
- **Dify AI 智能体 (Dify Workflow)** 的职责是 **“语义理解与内容提炼”**：
  - 数据入库后，如果需要生成 AI 总结，系统将 `summary_status` 置为 `pending`；
  - 异步队列调用 Dify Workflow API，Dify 调用大语言模型 (LLM) 对文本/字幕/正文进行清洗与要点提炼，并将结果更新回 `contents.summary` 字段。
- **总结**：**RSSHub 是“数据采集器”，Dify 智能体是“AI 脑力分析师”**，二者各司其职。

---

## 4. 核心业务模块与权限体系

### 4.1 业务模块全景

- **M1: 监控目标管理 (Admin SPA)**：包含博主主页 URL 解析、自定义显示名称、启用/停用开关切换及二次确认删除。
- **M2: 多租户账号与免验证鉴权 (Supabase Auth)**：支持登录/注册切换，集成 H5 专属链接生成（`https://mpchub.top/?u=userId`）。
- **M3: 6 平台抓取适配与调度层 (Cron Engine)**：
  - `BilibiliAdapter`：WBI 算法加签 + Cookie 鉴权。
  - `YoutubeAdapter`：YouTube Data API v3。
  - `ZhihuAdapter`：RSSHub 知乎用户活动与专栏接口。
  - `DouyinAdapter` / `XiaohongshuAdapter`：RSSHub 抓取适配。
  - `XAdapter`：RSSHub 推特 Feed 抓取，配合 `x-fetcher` 云函数中转，清洗 XML 实体 (`&amp;`, `&lt;`, `&gt;`) 并提取多图与推文。
- **M4: Dify AI 摘要生成与重试模块**：
  - 后台 Cron 并发池 (Concurrency ≤ 5) 异步请求 Dify Workflow API；
  - 超时/失败自动重试机制；
  - 前端 `retry-summary` Edge Function 实现用户一键手动重新生成。
- **M5: H5 移动端 Feed 流与 AI 总结卡片 (H5 SPA)**：
  - 具备 iOS 毛玻璃顶栏、SWR 数据缓存与无缝授权登录；
  - 卡片集成 AI 摘要折叠/展开、骨架屏加载状态、重试交互；
  - 支持快捷跳转原生 App / Web 及链接复制；
  - 具备已隐藏内容列表的管理与恢复功能。
- **M6: 统一 UI/UX 设计系统**：管理端与 H5 均采用 Apple iOS `#F2F2F7` 背景与毛玻璃视觉风格，搭配分段 Pill 控件与微交互体验。

### 4.2 权限与 RLS 策略体系

| 角色 | 鉴权凭证 | RLS 策略表现 | 适用范围 |
|---|---|---|---|
| **authenticated** | Supabase Auth JWT (`auth.uid()`) | `auth.uid() = user_id` | Admin SPA 管理员读写自身监控项与配置 |
| **anon** | Supabase Anon Key | `is_display = true AND (user_id = query_user_id OR user_id IS NULL)` | H5 SPA 访客根据 `?u=...` 参数浏览对应用户的公开 Feed 内容 |
| **service_role** | Supabase Service Role Key | 绕过 RLS 限制 (`USING (true)`) | 腾讯云服务器 Cron 抓取脚本与 Supabase Edge Functions 内部提权操作 |

---

## 5. 接口规范

### 5.1 PostgREST 多租户 UPSERT 规范

Cron 写入器 (`content-writer.ts`) 执行内容去重合并写入：

```http
POST /rest/v1/contents?columns=user_id,platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id
Prefer: resolution=merge-duplicates
Authorization: Bearer <SERVICE_ROLE_KEY>
```

> **注意**：`?columns=` 参数必须显式包含 `user_id` 在内的所有写入列，以此完全匹配 PostgreSQL 中的 `UNIQUE (user_id, platform, native_id)` 索引。

### 5.2 Edge Functions 契约

#### 1. `parse-url` (博主链接解析)
```json
// POST /functions/v1/parse-url
// Request:
{ "url": "https://x.com/elonmusk" }

// Response (Success):
{
  "success": true,
  "data": {
    "platform": "x",
    "native_id": "elonmusk",
    "display_name": "@elonmusk",
    "original_url": "https://x.com/elonmusk"
  }
}
```

#### 2. `retry-summary` (手动重试 AI 摘要)
```json
// POST /functions/v1/retry-summary
// Request:
{ "content_id": 123 }

// Response (Success):
{
  "success": true,
  "data": {
    "content_id": 123,
    "previous_status": "failed"
  }
}
```

#### 3. `x-fetcher` (云端推文中转拉取)
```json
// POST /functions/v1/x-fetcher
// Request:
{ "handle": "elonmusk", "limit": 10 }

// Response (Success):
{
  "success": true,
  "data": [
    {
      "id": "1815000000000000000",
      "text": "Hello Twitter world",
      "created_at": "2026-07-24T08:00:00Z",
      "images": ["https://pbs.twimg.com/media/xxx.jpg"]
    }
  ]
}
```

---

## 6. 部署与服务器运维信息 (腾讯云)

### 6.1 SSH 连接凭证与服务器环境

| 属性 | 配置值 | 说明 |
|---|---|---|
| **主机 IP / Host** | `124.222.54.39` | 腾讯云广州/上海区 Linux 生产服务器公网 IP |
| **SSH 登录用户名** | `root` | 最高管理员权限账号 |
| **SSH 端口** | `22` | 标准 SSH 服务端口 |
| **认证方式** | 密钥 / 密码 | `ssh root@124.222.54.39` (配合私钥 `ssh -i <私钥路径> root@124.222.54.39`) |
| **服务器操作系统** | Ubuntu / TencentOS Server | 运行 Linux x86_64 架构 |

#### 🔑 SSH 密钥查找与获取路径

1. **本地开发机默认密钥路径 (Mac / Linux)**：
   - **私钥文件**：`~/.ssh/id_rsa` 或 `~/.ssh/id_ed25519`
   - **公钥文件**：`~/.ssh/id_rsa.pub` 或 `~/.ssh/id_ed25519.pub`
   - **SSH 配置文件**：`~/.ssh/config`
2. **腾讯云控制台密钥获取路径**：
   - **控制台入口**：[腾讯云控制台 -> 云服务器 CVM -> 密钥对 (Key Pairs)](https://console.cloud.tencent.com/cvm/sshkey)；
   - **下载与绑定**：如果在腾讯云控制台上创建或绑定过密钥对，公钥会自动写入服务器的 `/root/.ssh/authorized_keys`，创建时下载的 `.pem` 私钥文件（例如 `tencent_key.pem`）保存在您下载此秘钥时的本地电脑目录中；
   - **连接命令**：`ssh -i /path/to/your_key.pem root@124.222.54.39`。

### 6.2 服务器项目目录与存储布局

| 目录/文件路径 | 用途描述 |
|---|---|
| `/opt/content-hub` | **服务器项目根目录**（Git 仓库映射路径，执行 `git pull` 主入口） |
| `/opt/content-hub/.env.production` | **生产环境变量配置文件**（包含 `SUPABASE_SERVICE_ROLE_KEY`、`TWITTER_AUTH_TOKEN` 等隐私秘钥） |
| `/opt/content-hub/apps/h5/dist` | **H5 移动端 SPA 部署目录**（Nginx 静态根目录，域名 `mpchub.top`） |
| `/opt/content-hub/apps/admin/dist` | **Admin 管理端 SPA 部署目录**（Nginx 静态根目录，域名 `admin.mpchub.top`） |
| `/opt/content-hub/scripts/cron` | **定时抓取引擎服务目录**（运行 `node` / `pm2` 调度） |

### 6.3 服务托管与容器架构 (PM2 + Docker Compose + Nginx)

1. **PM2 进程守护 (Node.js 定时引擎)**：
   - **进程名称**：`content-hub-cron`
   - **运行文件**：`/opt/content-hub/scripts/cron/dist/index.js`（或 `scheduler.js`）
   - **作用**：每 30 分钟轮询抓取 6 平台最新动态并异步请求 Dify AI 总结卡片。
2. **Docker Compose 容器化服务 (RSSHub + Redis)**：
   - **配置文件**：`/opt/content-hub/docker-compose.yml`
   - **包含服务**：`rsshub` (自部署 RSS 抓取服务，监听 1200 端口) + `redis` (缓存服务)
   - **作用**：提供知乎、X (Twitter)、抖音、小红书的 Feed XML 抓取中转。
3. **Nginx Web 反向代理与静态托管**：
   - **监听端口**：`80` (HTTP，自动重定向至 443) 和 `443` (HTTPS，配置 SSL 证书)
   - **域名解析**：
     - `https://mpchub.top` -> 指向 `/opt/content-hub/apps/h5/dist`
     - `https://admin.mpchub.top` -> 指向 `/opt/content-hub/apps/admin/dist`

### 6.4 常用部署与运维命令速查

```bash
# 1. 部署/更新 Cron 抓取引擎 (Git 拉取 -> 编译 -> 重启 PM2)
ssh root@124.222.54.39 "cd /opt/content-hub && git pull origin main && pnpm --filter @content-hub/cron build && pm2 restart content-hub-cron"

# 2. 本地构建并上传 H5 SPA 前端产物
pnpm --filter h5 build && scp -r apps/h5/dist/* root@124.222.54.39:/opt/content-hub/apps/h5/dist/

# 3. 本地构建并上传 Admin SPA 管理端产物
pnpm --filter admin build && scp -r apps/admin/dist/* root@124.222.54.39:/opt/content-hub/apps/admin/dist/

# 4. 查看 PM2 定时任务运行日志与状态
ssh root@124.222.54.39 "pm2 logs content-hub-cron --lines 100"
ssh root@124.222.54.39 "pm2 status"

# 5. 重启 RSSHub 容器 (更新环境变量后)
ssh root@124.222.54.39 "cd /opt/content-hub && docker compose --env-file .env.production up -d --force-recreate rsshub"
```

---

## 7. 踩坑记录与防错预警 (Pitfalls & Lessons Learned)

结合开发、调试与部署过程中的实战总结，总结出以下 8 项核心避坑指南：

### 🚨 坑点 1：PostgREST UPSERT 唯一索引与 `?columns=` 必须 100% 严格匹配
- **现象**：PostgREST 报错 `on conflict do update command cannot affect row a second time` 或选择忽略更新。
- **原因**：PostgREST 在处理 `resolution=merge-duplicates` 时，URL 中 `?columns=` 列名必须与数据库 `UNIQUE` 索引定义的字段**完全一致**。
- **避坑指南**：数据库字段为 `native_id`，切勿错写为 `native_content_id`；多租户引入后唯一索引升级为 `UNIQUE (user_id, platform, native_id)`，`content-writer.ts` 必须在 `?columns=` 中显式传入 `user_id`。

### 🚨 坑点 2：Regex 跨行匹配字符集误写 (`[\s+S]` vs `[\s\S]`)
- **现象**：XML / HTML 解析器在遇到多行 `<item>` 节点时无法捕获任何文本。
- **原因**：正则匹配跨行字符应使用 `[\s\S]*?`，如果手滑误写成 `[\s+S]*?`，`+` 被当做字面量 `+`，导致遇到换行符截断匹配。
- **避坑指南**：匹配跨行文本一律使用 `[\s\S]*?`，编写完新平台适配器后，必须运行 `scratch/test-dynamic-gate.ts` 进行真实 XML 样例断言测试。

### 🚨 坑点 3：`CREATE OR REPLACE VIEW` 改变列结构引发 Migration 失败
- **现象**：执行 SQL Migration 时报错 `ERROR: cannot change name of view column "platform" to "user_id" (SQLSTATE 42P16)`。
- **原因**：PostgreSQL 的 `CREATE OR REPLACE VIEW` 不支持改变现有视图的列顺序或增删重命名现有列。
- **避坑指南**：在更新视图（如 `platform_configs_admin`）的 SQL 迁移脚本中，必须先执行 `DROP VIEW IF EXISTS platform_configs_admin CASCADE;`，再执行 `CREATE OR REPLACE VIEW`。

### 🚨 坑点 4：Edge Function 响应遗漏 `original_url` 触发 DB `NOT NULL` 约束
- **现象**：前端添加新博主时提示 `null value in column "original_url" of relation "monitors" violates not-null constraint`。
- **原因**：云函数 `parse-url` 在构建新增平台返回值时遗漏了 `original_url` 字段，导致前端提交插入时变为 `undefined`（Postgres 解析为 `NULL`）。
- **避坑指南**：Edge Function 返回数据必须在 TS 中使用 `ParseSuccess` 强制契约校验，所有分支 100% 显式返回 `original_url`。

### 🚨 坑点 5：React 19 / ESLint 中 `useEffect` 内部同步 `setState` 触发级联渲染
- **现象**：运行静态检测或控制台提示 `Avoid calling setState() directly within an effect (react-hooks/set-state-in-effect)`。
- **原因**：在 `useEffect` 回调函数体第一行同步调用 `setState` 会触发重复级联渲染 (Cascading Renders)。
- **避坑指南**：页面初始化数据读取应在 `useEffect` 内部封装 `async function loadData()` 异步包裹，或者将 URL 参数提取放在 `useState(() => getInitialState())` 初始化回调函数中。

### 🚨 坑点 6：Cron 抓取无超时控制导致 HTTP 请求挂死整个 pm2 轮询线程
- **现象**：定时抓取任务卡死，后续轮询不再触发，进程处于僵死状态。
- **原因**：部分外部节点（如推特或 RSSHub 代理）网络超时未返回，无 Timeout 控制导致 HTTP 请求一直 await。
- **避坑指南**：所有平台 Adapter 外部请求必须传入 `AbortController` 信号，并设置 15s 至 30s 严格超时判定；配合 `DatabaseProxyPool` 代理池，在超时后自动切换节点。

### 🚨 坑点 7：数据库 ID 混淆与日志模糊导致排查效率低下
- **现象**：排查日志时无法分清打印的是 `contents.id` 还是 `monitors.id`，或者定位错对应的租户数据。
- **原因**：代码中使用泛化的 `id` 变量名，控制台打印如 `Processing 15` 无法辩识实体。
- **避坑指南**：严格遵守 `.agents/AGENTS.md` 规范！TS 变量显式声明 `contentId` / `monitorId` / `userId`；日志打印统一携带前缀实体标注，如 `[X] Processing Post (Content ID: 15)`。

### 🚨 坑点 8：H5 兼容 Legacy `user_id IS NULL` 数据漏读问题
- **现象**：系统升级多租户后，老用户在 H5 访问 Feed 时发现历史公共数据全空。
- **原因**：查询语句只写了 `.eq('user_id', targetUserId)`，漏掉了历史上未关联租户的 `user_id IS NULL` 旧数据。
- **避坑指南**：H5 Feed 查询逻辑使用 `or(user_id.eq.${targetUserId},user_id.is.null)` 进行多租户 + 历史遗留数据的兼容组合查询。
