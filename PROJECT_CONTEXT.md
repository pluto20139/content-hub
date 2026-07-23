# PROJECT_CONTEXT.md

> 本文档是多平台内容中枢（Content Hub）的项目上下文文件，供 AI 和开发者快速理解项目技术约束与规范。
> 最后更新：2026-07-23 (V2.0 版本)

---

## 1. 技术栈

### 1.1 总览

| 层级 | 技术 | 版本 / 备注 |
|---|---|---|
| **前端框架** | React | 19.2.6，配置管理端 + 用户端 H5 两个独立 SPA |
| **构建工具** | Vite | 8.0.16，快速 HMR，生产构建优化 |
| **类型系统** | TypeScript | ~6.0.3（Monorepo 内 `tsc -b` 增量构建，严格类型检查） |
| **样式方案** | Tailwind CSS | 3.4.x，iOS 毛玻璃 (Glassmorphic) 风格，Pill 控件，高对比度 |
| **运行时** | Node.js | >= 20.0.0（Cron 脚本运行环境） |
| **包管理** | pnpm | 11.8.0 + workspace，Monorepo 依赖管理 |
| **后端 BaaS** | Supabase Cloud | PostgreSQL + PostgREST + Edge Functions + Supabase Auth |
| **数据库** | PostgreSQL 15（Supabase 托管） | 支持 RLS 多租户隔离、pg_cron、Supabase Vault |
| **Edge Functions** | Deno + TypeScript | 6 个函数（parse-url / bilibili-auth / article-fetcher / youtube-proxy / image-proxy / retry-summary） |
| **定时任务** | 腾讯云 pm2 + node-cron | 6 个平台适配器（B站/YouTube/知乎/抖音/小红书/X推特），每 30 分钟触发 |
| **AI 摘要** | Dify Workflow | DIFY_API_URL + DIFY_API_KEY 配置，支持全 content_type 摘要 |
| **知乎/X中转** | RSSHub（Docker 自部署） | `docker-compose.yml` 在服务器上跑，抓取知乎与 X (Twitter) RSS |
| **前端托管** | 腾讯云 Nginx | 绑定 `mpchub.top` (H5) 和 `admin.mpchub.top` (Admin) 域名，监听 80/443 端口，HTTPS 强制重定向 |

### 1.2 关键依赖

| 依赖 | 用途 | 持有方 |
|---|---|---|
| `@content-hub/shared` | 前后端共享类型、URL 解析器与常量 | workspace package |
| `@supabase/supabase-js` | Supabase REST / Auth 客户端 | apps/h5 + apps/admin + scripts/cron |
| `qrcode` | B站扫码登录二维码生成 | apps/admin |
| `node-cron` | Cron 调度 | scripts/cron |
| `undici` | HTTP 客户端（适配器） | scripts/cron |
| `@supabase/supabase-js` (Deno) | Edge Function 内 | supabase/functions |

### 1.3 环境变量清单

| 变量名 | 存储位置 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 腾讯云服务器环境变量 / Supabase Edge | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 腾讯云服务器环境变量 / Supabase Edge | 前端公开使用，受 RLS 租户隔离保护 |
| `SUPABASE_SERVICE_ROLE_KEY` | 腾讯云服务器环境变量 | 绕过 RLS，仅 Cron / Edge Function 使用 |
| `VITE_SUPABASE_URL` | Vite 编译期注入（前端） | 前端请求 Supabase 的 URL |
| `VITE_SUPABASE_ANON_KEY` | Vite 编译期注入（前端） | 前端 ANON_KEY |
| `YOUTUBE_API_KEY` | 腾讯云环境变量 + Supabase Secrets | YouTube Data API v3（双配置） |
| `BILIBILI_COOKIE` | `platform_configs` 表 + Supabase Vault 加密 | B站 Cookie |
| `RSSHUB_URL` | 腾讯云服务器环境变量 | RSSHub 实例地址（支持知乎与 X 抓取） |
| `ZHIHU_COOKIES` | `.env` / `docker-compose.yml` | RSSHub 抓知乎用（Docker 注入） |
| `DIFY_API_URL` | 腾讯云环境变量 + Supabase Secrets | Dify API endpoint |
| `DIFY_API_KEY` | 腾讯云环境变量 + Supabase Secrets | Dify API key |

---

## 2. 目录规范

### 2.1 Monorepo 结构

```
多平台中枢/
├── apps/                           # 前端应用
│   ├── admin/                      # 配置管理端 (React SPA, 部署在 admin.mpchub.top)
│   │   ├── src/
│   │   │   ├── components/         # 通用组件 (AuthGuard)
│   │   │   ├── pages/              # 页面 (Login - 免邮箱验证登录/注册, MonitorList - iOS毛玻璃管理端)
│   │   │   ├── lib/                # 工具 (supabase client, JWT 自刷新)
│   │   │   ├── App.tsx             # hash 路由（#/login / 默认 MonitorList）
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── h5/                         # 用户端 H5 (React SPA, 部署在 mpchub.top)
│       ├── src/
│       │   ├── components/         # ContentCard / SkeletonCard / FallbackModal
│       │   │                       # HideButton / UnhideButton / H5Auth (多租户 H5 登录页)
│       │   ├── pages/              # Feed（按 6 平台 Tabs + 已隐藏 Tab，含 user_id 筛选）
│       │   ├── lib/                # supabase / cache（SWR 租户隔离缓存）/ hidden-storage
│       │   ├── constants/          # tabs.ts（平台 Tabs 配置，含 X 平台）
│       │   ├── App.tsx             # ?u=userId 提取与未授权访问拦截
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── packages/
│   └── shared/                     # 前后端共享代码（Single Source of Truth）
│       ├── src/
│       │   ├── constants/          # platforms.ts（6 平台定义，含 X）/ deep-link.ts
│       │   ├── utils/              # environment.ts / time.ts / x-parser.ts (X/Twitter URL 解析)
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/                       # Supabase 项目配置
│   ├── functions/                  # Edge Functions (Deno, 6 个)
│   │   ├── _shared/                # 共享代码（cors.ts）
│   │   ├── parse-url/              # URL 解析 + 平台识别（含 X 平台及 original_url 返回）
│   │   ├── bilibili-auth/          # B站扫码登录 (带 JWT user_id 租户绑定)
│   │   ├── article-fetcher/        # 知乎文章正文抓取
│   │   ├── youtube-proxy/          # YouTube Data API 代理
│   │   ├── image-proxy/            # 图片代理（防盗链）
│   │   └── retry-summary/          # AI 摘要重试入口
│   ├── migrations/                 # SQL 迁移脚本（18 个）
│   │   ├── 001_monitors.sql ... 017_add_summary_fields.sql
│   │   └── 018_v2_0_multi_tenant.sql (V2.0 多租户数据库隔离迁移)
│   ├── seed.sql
│   └── config.toml
│
├── scripts/
│   └── cron/                       # pm2 Cron 守护进程与定时脚本
│       ├── src/
│       │   ├── adapters/           # 平台适配器（6 个）
│       │   │   ├── bilibili.ts / youtube.ts / zhihu.ts
│       │   │   ├── douyin.ts / xiaohongshu.ts / x.ts (X/Twitter RSSHub 适配器)
│       │   │   └── types.ts
│       │   ├── lib/                # supabase / cleaner / upsert(content-writer 多租户写)
│       │   │                       # alert / lock / dify / monitors-query
│       │   ├── index.ts            # 抓取主入口
│       │   ├── scheduler.ts        # node-cron 调度入口（被 pm2 启动）
│       │   └── scratch/            # 调试脚本
│       ├── package.json
│       └── tsconfig.json
│
├── scratch/                        # 动态门禁与自动化验证测试脚本
│   ├── test-dynamic-gate.ts        # 2.0 动态自动化断言门禁脚本
│   └── ...
├── docker-compose.yml              # 服务器自部署 RSSHub + Redis
├── ecosystem.config.cjs            # pm2 进程配置
├── PROJECT_CONTEXT.md              # 本文件
└── 腾讯云部署执行计划.md
```

### 2.2 核心标识与命名规范

| 类型 | 规范 | 示例 / 说明 |
|---|---|---|
| 显式 ID 变量命名 | 实体前缀 + ID | 在代码与日志中一律使用 `contentId` / `monitorId` / `userId`，严禁直接使用模糊的 `id` |
| 控制台日志打印 | 明确标注实体类型 | 正确示例：`[X] Processing Post (Content ID: 15)`，拒绝 `Processing 15` |
| DB 字段与表 | 蛇形（snake_case） | `monitors`, `contents`, `user_id`, `native_id`, `original_url` |
| TypeScript 类型/接口 | 帕斯卡（PascalCase） | `Monitor`, `Content`, `RawContent`, `Platform` |
| React 组件 | 帕斯卡（PascalCase） | `ContentCard`, `MonitorList`, `H5Auth` |
| SQL 迁移文件 | 数字前缀 + 蛇形 | `018_v2_0_multi_tenant.sql` |

---

## 3. 架构约束与数据流

### 3.1 架构拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                  腾讯云 Nginx (HTTPS 80/443)                  │
│  ├── https://admin.mpchub.top (Admin 配置管理端 SPA)         │
│  └── https://mpchub.top       (H5 移动端用户 Feed SPA)        │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (anon key, RLS 租户隔离 auth.uid() = user_id)
                       │ Supabase Edge Function (parse-url / bilibili-auth / image-proxy 等)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Supabase Cloud                              │
│  ├── PostgreSQL (monitors / contents / platform_configs /     │
│  │               cron_locks / short_link_cache)              │
│  ├── PostgREST (自动 REST API, 带有 auth.uid() 隔离)         │
│  ├── Edge Functions (Deno, 6 个)                              │
│  └── Supabase Auth (多租户账号鉴权，支持免邮件验证注册)         │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase REST API (service_role key)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            腾讯云服务器 (pm2 + node-cron 守护进程)            │
│  ├── Node.js 抓取脚本 (6 平台适配器: B站/YT/知乎/抖音/小红书/X) │
│  ├── Dify AI 摘要生成 (全类型内容异步处理)                     │
│  └── 写入 Supabase (多租户 UPSERT + user_id 关联)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│           RSSHub (Docker 自部署, docker-compose)              │
│  暴露 API Key 鉴权 → 抓取知乎 / X (Twitter) / 抖音 / 小红书      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 关键架构约束

1. **AC1: 强数据隔离**：所有 `monitors`、`contents`、`platform_configs` 数据记录均绑定 `user_id`。Supabase RLS 确保登录用户只能读写自身数据，H5 页面通过 `?u=userId` 参数隔离查询。
2. **AC2: 免邮箱验证极简 Auth 流程**：用户注册输入邮箱及两次密码，前端校验无误后调用 `signUp()`，后台自动完成注册并直接授权登录，无缝跳转。
3. **AC3: 平台适配器多租户感知**：Cron 调度引擎使用 `SUPABASE_SERVICE_ROLE_KEY` 轮询所有租户的激活监控（`monitors`），抓取内容入库时显式携带 `monitor.user_id`。
4. **AC4: PostgREST UPSERT 复合唯一约束**：`contents` 表的唯一约束升级为 `UNIQUE (user_id, platform, native_id)`，`monitors` 表升级为 `UNIQUE (user_id, platform, native_id)`，防止跨租户去重冲突。
5. **AC5: 6 平台原生支持**：原生支持 B站、YouTube、知乎、抖音、小红书及 **X (推特)** 抓取与 DeepLink 联动（`x.com/{handle}/status/{native_id}`）。
6. **AC6: 接口契约完整性**：Edge Function（如 `parse-url`）返回数据必须满足 `ParseSuccess` 契约，包含 `original_url` 字段，绝不传递 `undefined` / `null` 触碰数据库 `NOT NULL` 约束。

### 3.3 平台抓取路线决策与 Dify 智能体分工机制

为了兼顾抓取稳定性、反爬应对成本与 AI 智能化处理，系统在底层采用了**三层分流链路架构**（Direct API 直连、RSSHub 代理转换、Dify 智能体语义理解）：

```text
                               ┌──────────────────────────────────────────────┐
                               │       Cron 抓取调度引擎 (scripts/cron)         │
                               └──────┬──────────────┬──────────────┬─────────┘
                                      │              │              │
             ┌────────────────────────┘              │              └────────────────────────┐
             ▼                                       ▼                                       ▼
┌───────────────────────────┐          ┌───────────────────────────┐          ┌───────────────────────────┐
│ 1. 官方 / 公开 API 直连   │          │ 2. RSSHub 中转与代理池    │          │ 3. Dify AI 智能体 (Workflow)│
│ (B站 WBI API / YouTube)   │          │ (知乎 / X推特/ 抖音/ 小红书)│          │ (LLM 语义抽取 & 摘要生成)  │
└────────────┬──────────────┘          └─────────────┬─────────────┘          └─────────────┬─────────────┘
             │                                       │                                       │
             └───────────────────┬───────────────────┘                                       │
                                 ▼                                                           │
             ┌──────────────────────────────────────────────┐                                │
             │   数据清洗标准化 & 写入 Supabase (PostgreSQL)  │                                │
             │  (标记 summary_status = 'pending' 触发 AI)   ├────────────────────────────────┘
             └──────────────────────────────────────────────┘
```

#### 💡 1. 为什么各平台采用不同的抓取技术路线？

| 平台 | 抓取技术路线 | 选用理由 / 机制说明 |
|---|---|---|
| **B站 (bilibili)** | **公开 Web WBI API 直连** | B站提供了结构极其规范且高清的公开 API (`x/space/wbi/arc/search`)，结合 `SESSDATA` Cookie 和本地 WBI 动态加密签名算法即可直连抓取，无需经过任何中间代理。 |
| **YouTube** | **官方 Data API v3 直连** | Google 官方提供了标准 RESTful API (`playlistItems.list`)，传入频道 ID 即可精准获取该频道上传的所有视频，自带官方 SLA 保障与免费 API 额度。 |
| **知乎 (Zhihu)** | **RSSHub 中转 + Cookie** | 知乎网页端与 App 端加入了极严苛的前端 JS 渲染反爬（如 `__zse_ck` 动态签名和 `JOID` 校验），直连极易封禁 IP。RSSHub 维护了稳定的 Cookies 保持与 Feed 解析逻辑，避免抓取引擎遭受反爬。 |
| **X / 推特 (X.com)** | **RSSHub 中转 + Auth Token** | X.com 官方在改版后彻底关闭了匿名 API 访问，并对 Web 端的 GraphQL 接口实施严格的 Guest Token 及 TLS 指纹防护。自部署 RSSHub 通过挂载 `TWITTER_AUTH_TOKEN` Cookie 模拟真实浏览器，抓取推文并转换为标准的 XML 订阅源。 |
| **抖音 (Douyin)** | **RSSHub 中转 + 动态代理池** | 抖音网页端使用带时间戳密文的 X-Bogus 签名和长短链跳转，自部署 RSSHub 配合代理池 (`DOUYIN_PROXY_LIST`) 解决短链解析与防封锁。 |
| **小红书 (Xiaohongshu)** | **RSSHub 中转 + 网页 Cookie** | 小红书设置了较高浓度的网页风控参数 (`a1`, `webId`, `websectiga`)，通过 RSSHub 维护网页 Cookie 与个人主页 HTML 结构解析。 |

#### 🤖 2. Dify 智能体 (Dify Workflow) 的定位与分工区别

- **抓取引擎 (Cron Adapter / RSSHub)** 的职责是 **“拿原始数据”**：从各平台拉取原生的视频标题、推文文字、封面图、发布时间并写入数据库。**它负责数据采集，不进行复杂的 LLM 大模型推理**。
- **Dify 智能体 (Dify Workflow)** 的职责是 **“语义理解与内容二次加工”**：
  - 当抓取引擎完成数据入库后，如果内容需要生成 AI 摘要（如 B站视频、YouTube 视频字幕、知乎长文正文），系统会将 `summary_status` 设为 `pending`；
  - 后台异步触发 Dify 智能体，Dify 智能体调用大语言模型（LLM）进行长文清洗、提炼核心要点、生成结构化摘要，并将结果会写回 `contents.summary` 字段。
- **总结**：**RSSHub 是“网络爬虫/数据采集器”，Dify 智能体是“AI 脑力分析师”**。二者在链路中分工明确，前者解决数据拿到的问题，后者解决数据智能化理解的问题。

---

## 4. 核心业务模块与权限体系

### 4.1 模块全景

- **M1: 监控目标管理 (Admin SPA)**：包含博主主页解析、显示名称修改、开关状态切换及二次确认删除。
- **M2: 多租户账号体系 (Supabase Auth)**：支持登录/注册切换，集成 H5 专属链接生成（`https://mpchub.top/?u=userId`）。
- **M3: 6 平台抓取适配层 (Cron Engine)**：
  - `BilibiliAdapter`：WBI 算法 + SESSDATA Cookie 鉴权。
  - `YoutubeAdapter`：YouTube Data API v3 官方接口。
  - `ZhihuAdapter`：RSSHub `/zhihu/people/activities` 与 `/zhihu/column` 接口。
  - `DouyinAdapter` / `XiaohongshuAdapter`：RSSHub 抓取适配。
  - `XAdapter`：RSSHub `/twitter/user/:handle` 接口，自动清洗 XML 实体 (`&amp;`, `&lt;`, `&gt;`) 并提取 `post` 内容与配图。
- **M4: H5 移动端 Feed 流 (H5 SPA)**：具备 iOS 毛玻璃顶栏、SWR 缓存、多租户 Auth 登录拦截以及已隐藏控制。
- **M5: UI/UX 设计系统**：管理端与 H5 均采用 Apple iOS `#F2F2F7` 统一风格，集成分段 Pill 控件与微交互体验。

### 4.2 权限与 RLS 体系

| 角色 | 鉴权凭证 | RLS 策略表现 | 适用范围 |
|---|---|---|---|
| **authenticated** | Supabase Auth JWT (`auth.uid()`) | `auth.uid() = user_id` | Admin SPA 管理员读写自身监控与配置 |
| **anon** | Supabase Anon Key | `is_display = true AND user_id = query_user_id` | H5 SPA 匿名访客按 `?u=...` 浏览公开内容 |
| **service_role** | Supabase Service Role Key | 绕过 RLS 约束 (`USING (true)`) | 腾讯云 Cron 脚本抓取与 Edge Functions 内部 |

---

## 5. 接口规范

### 5.1 PostgREST 多租户写入规范

Cron 写入器 (`content-writer.ts`) 执行内容去重合并（UPSERT）：

```http
POST /rest/v1/contents?columns=user_id,platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id
Prefer: resolution=merge-duplicates
Authorization: Bearer <SERVICE_ROLE_KEY>
```

> **注意**：`?columns=` 必须显式列出包含 `user_id` 在内的所有写入列，匹配 `UNIQUE (user_id, platform, native_id)` 索引。

### 5.2 Edge Functions 契约

`parse-url` 接口规范：
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

---

## 6. 部署信息 (腾讯云)

- **公网 IP**：`124.222.54.39`
- **Nginx 域名配置**：
  - H5 移动端：`https://mpchub.top` (目录 `/opt/content-hub/apps/h5/dist`)
  - Admin 管理端：`https://admin.mpchub.top` (目录 `/opt/content-hub/apps/admin/dist`)
- **PM2 守护服务**：`content-hub-cron` (运行 `/opt/content-hub/scripts/cron/dist/scheduler.js`)

---

## 7. 踩坑记录与坑点预警 (Pitfalls & Lessons Learned)

针对开发、测试及部署过程中遇到的踩坑经验，归纳如下防错预警：

### 🚨 坑点 1：PostgREST UPSERT 唯一索引与列名严格匹配
- **现象**：PostgREST 报无法定位冲突约束错误 `on conflict do update command cannot affect row a second time` 或选择失效。
- **原因**：PostgREST 执行 `resolution=merge-duplicates` 时，URL 中 `?columns=` 参数指定的列必须与 PostgreSQL 中的 `UNIQUE` 索引定义**100% 严格一致**。
- **避坑指南**：数据库字段名为 `native_id`，切勿错写为 `native_content_id`。V2.0 引入多租户后，唯一约束已升级为 `UNIQUE (user_id, platform, native_id)`，`content-writer.ts` 必须显式在 `?columns=` 中传入 `user_id`。

### 🚨 坑点 2：Regex 跨行匹配字符集误写 (`[\s+S]` vs `[\s\S]`)
- **现象**：XML / HTML 抓取解析器在遇到多行 `<item>` 节点时无法捕获任何数据。
- **原因**：在正则表达式中试图匹配包含换行符在内的任意字符时，习惯写 `[\s\S]*?`。如果手滑误写成 `[\s+S]*?`，`+` 将被当成字符集内部的字面量 `+`，导致换行符截断匹配。
- **避坑指南**：匹配跨行文本一律使用 `[\s\S]*?`。每次新增适配器（如 `x.ts`），必须通过 TypeScript 自动化测试脚本 (`scratch/test-dynamic-gate.ts`) 跑一遍真正的 XML 样例断言。

### 🚨 坑点 3：`CREATE OR REPLACE VIEW` 改变列结构导致数据库 Migration 失败
- **现象**：在应用 SQL 迁移时报错 `ERROR: cannot change name of view column "platform" to "user_id" (SQLSTATE 42P16)`。
- **原因**：PostgreSQL 的 `CREATE OR REPLACE VIEW` 命令不支持改变现有视图的列顺序或新增/重命名现有列。
- **避坑指南**：在修改已有视图（如 `platform_configs_admin`）的 SQL 迁移脚本中，必须先执行 `DROP VIEW IF EXISTS platform_configs_admin CASCADE;`，然后再执行 `CREATE OR REPLACE VIEW`。

### 🚨 坑点 4：Edge Function 接口返回字段遗漏引发 DB `NOT NULL` 约束错误
- **现象**：前端在添加新平台博主时，管理端提示 `null value in column "original_url" of relation "monitors" violates not-null constraint`。
- **原因**：后端 `parse-url` 云函数为新增平台（如 X/Twitter）构建返回值时，漏写了 `original_url` 字段，导致前端提交插入时 `original_url` 变为 `undefined`（Postgres 解析为 `NULL`）。
- **避坑指南**：Edge Function 的 `ParseSuccess` 接口必须在 TypeScript 中进行严格强类型约束，所有分支 100% 显式返回 `original_url`。

### 🚨 坑点 5：React 19 / ESLint 中 `useEffect` 内部同步 `setState` 触发级联渲染
- **现象**：运行 ESLint 静态检测时提示 `Avoid calling setState() directly within an effect (react-hooks/set-state-in-effect)`。
- **原因**：在 `useEffect` 回调函数体第一行同步调用 `setState` 会触发重复级联渲染 (Cascading Renders)。
- **避坑指南**：页面初始化数据读取应在 `useEffect` 内部封装 `async function loadData()` 异步包裹，或者将 URL 参数提取放在 `useState(() => getInitialState())` 初始化回调函数中。

---
