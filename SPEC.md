# SPEC.md — 多平台内容中枢技术规格

> 本文档是 Content Hub 的工程技术规格书，基于 PRD v1.4 和 PROJECT_CONTEXT.md 编写。
> 所有技术决策已锁定，本文档作为开发的唯一实现依据。
> 最后更新：2026-06-21（v1.6 Review Round 6 修订版）

---

## 1. 数据库表设计

### 1.1 ER 概览

```
┌──────────────┐       1:N       ┌──────────────────┐
│  monitors    │ ──────────────→ │    contents      │
│  (监控目标)   │   monitor_id    │   (内容卡片)      │
└──────┬───────┘  (ON DELETE     └──────────────────┘
       │           SET NULL)
       │ 1:N (逻辑关联，非物理外键)
       │
┌──────▼───────┐     ┌──────────────────┐     ┌─────────────────────────┐
│platform_configs│  │   cron_locks     │     │ cron_soft_delete_logs   │
│ (平台级配置)  │     │  (Cron 互斥锁)  │     │ (软删除任务执行日志)    │
└──────────────┘     └──────────────────┘     └─────────────────────────┘
```

### 1.2 monitors 表

```sql
CREATE TABLE monitors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        VARCHAR(20)  NOT NULL,
  native_id       VARCHAR(200) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  name_auto       BOOLEAN      NOT NULL DEFAULT true,
  original_url    VARCHAR(500) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  last_sync_at    TIMESTAMPTZ,
  last_content_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  fail_count      INTEGER      NOT NULL DEFAULT 0,
  status          VARCHAR(20)  NOT NULL DEFAULT 'normal',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT monitors_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT monitors_status_check
    CHECK (status IN ('normal', 'cookie_expired', 'rate_limited')),
  CONSTRAINT monitors_fail_count_check
    CHECK (fail_count >= 0),
  CONSTRAINT monitors_unique
    UNIQUE (platform, native_id)
);

COMMENT ON TABLE  monitors IS '监控目标表，记录需要追踪的博主';
COMMENT ON COLUMN monitors.platform     IS '平台标识：bilibili / youtube / zhihu';
COMMENT ON COLUMN monitors.native_id    IS '博主在平台内的唯一标识（B站 mid / YouTube channelId / 知乎 people_id 或 column_id）';
COMMENT ON COLUMN monitors.display_name IS '博主显示名称，添加时同步获取一次，管理员可手动编辑';
COMMENT ON COLUMN monitors.name_auto    IS '昵称是否为系统自动生成，true 时 Cron 会尝试刷新，管理员手动编辑后设为 false';
COMMENT ON COLUMN monitors.original_url IS '管理员原始粘贴的链接';
COMMENT ON COLUMN monitors.is_active    IS '是否开启监控，false 时 Cron 跳过';
COMMENT ON COLUMN monitors.last_sync_at IS '最后一次成功同步时间（API 请求成功，不代表有新内容）';
COMMENT ON COLUMN monitors.last_content_at IS '最后一次获得新内容的时间，初始值=创建时间';
COMMENT ON COLUMN monitors.fail_count   IS '连续失败次数，请求成功即归零';
COMMENT ON COLUMN monitors.status       IS '运行状态：normal / cookie_expired / rate_limited（注：cookie_expired 命名继承自 PRD，对 YouTube/知乎等非 Cookie 平台，语义为"抓取异常"）';
```

### 1.3 contents 表

```sql
CREATE TABLE contents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     VARCHAR(20)  NOT NULL,
  native_id    VARCHAR(200) NOT NULL,
  content_type VARCHAR(20)  NOT NULL,
  title        VARCHAR(300) NOT NULL,
  cover_url    VARCHAR(500),
  original_url VARCHAR(500) NOT NULL,
  published_at TIMESTAMPTZ  NOT NULL,
  monitor_id   BIGINT,
  is_display   BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT contents_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT contents_content_type_check
    CHECK (content_type IN ('video', 'article', 'question', 'answer', 'post')),
  CONSTRAINT contents_unique
    UNIQUE (platform, native_id),
  CONSTRAINT contents_monitor_fk
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE SET NULL
);

COMMENT ON TABLE  contents IS '内容卡片表，存储抓取到的博主最新内容';
COMMENT ON COLUMN contents.content_type IS '内容类型，用于 Deep Link Schema 选择';
COMMENT ON COLUMN contents.is_display   IS '是否在 H5 信息流展示，超 30 天自动软删除为 false';
COMMENT ON COLUMN contents.created_at   IS '入库时间，软删除基于此字段判断';
```

### 1.4 platform_configs 表

```sql
CREATE TABLE platform_configs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     VARCHAR(20) NOT NULL,
  config_key   VARCHAR(50) NOT NULL,
  config_value TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_configs_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT platform_configs_unique
    UNIQUE (platform, config_key)
);

COMMENT ON TABLE  platform_configs IS '平台级配置表，存储 B站 Cookie 等敏感信息';
COMMENT ON COLUMN platform_configs.config_key   IS '配置键名，如 cookie / api_key';
COMMENT ON COLUMN platform_configs.config_value IS '配置值，敏感信息需加密存储（Supabase Vault）';
```

**预置配置行**：

| platform | config_key | 说明 |
|---|---|---|
| `bilibili` | `cookie` | B站扫码登录后的 Cookie JSON（含 SESSDATA、bili_jct 等） |
| `bilibili` | `cookie_status` | B站 Cookie 平台级状态：`valid` / `expired`。Cron 平台级短路时 PATCH 为 `expired`，成功完成时 PATCH 为 `valid`。Admin SPA 查询该行判断是否展示红色警告 |

> Cookie 最后更新时间直接查询 `cookie` 行的 `updated_at` 字段，无需独立配置行。

### 1.5 索引设计

```sql
-- monitors 表索引
CREATE INDEX idx_monitors_is_active ON monitors (is_active);
CREATE INDEX idx_monitors_platform  ON monitors (platform);
CREATE INDEX idx_monitors_status    ON monitors (status);

-- contents 表索引
CREATE INDEX idx_contents_published_at ON contents (published_at DESC);
CREATE INDEX idx_contents_is_display   ON contents (is_display);
CREATE INDEX idx_contents_monitor_id   ON contents (monitor_id);
CREATE INDEX idx_contents_platform_display
  ON contents (platform, is_display, published_at DESC);
```

### 1.6 软删除定时任务（pg_cron）

> **调度隔离**：pg_cron 软删除任务（每日 3:00 UTC）与 GitHub Actions 抓取任务（每 30 分钟）独立运行，互不影响。pg_cron 在 Supabase 数据库内部执行，GitHub Actions 在外部运行。

```sql
-- 启用 pg_cron 扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每日凌晨 3:00 UTC 执行软删除
SELECT cron.schedule(
  'soft-delete-30d',
  '0 3 * * *',
  $$
    UPDATE contents
    SET is_display = false
    WHERE created_at < NOW() - INTERVAL '30 days'
      AND is_display = true;
  $$
);
```

**软删除日志记录**：

```sql
-- 软删除执行日志表
CREATE TABLE cron_soft_delete_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  affected_rows INTEGER NOT NULL,
  duration_ms  INTEGER
);

-- pg_cron 任务改为带日志记录的版本
SELECT cron.schedule(
  'soft-delete-30d',
  '0 3 * * *',
  $$
    DO $block$
    DECLARE
      v_count INTEGER;
      v_start TIMESTAMPTZ := clock_timestamp();
    BEGIN
      UPDATE contents
      SET is_display = false
      WHERE created_at < NOW() - INTERVAL '30 days'
        AND is_display = true;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      INSERT INTO cron_soft_delete_logs (affected_rows, duration_ms)
      VALUES (v_count, EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000);
    END $block$;
  $$
);
```

---

## 2. API 契约定义

### 2.1 API 全景

| API 分类 | 调用方 | 协议 | 说明 |
|---|---|---|---|
| Supabase REST API | Admin SPA / H5 SPA | HTTPS | PostgREST 自动生成，标准 CRUD |
| Edge Function: `parse-url` | Admin SPA | HTTPS POST | URL 解析 + 平台识别 |
| Edge Function: `bilibili-auth` | Admin SPA | HTTPS POST | B站扫码登录 |
| Cron 内部接口 | GitHub Actions 脚本内部 | TypeScript | 适配器接口，不对外暴露 |

### 2.2 Supabase REST API

#### 2.2.1 monitors 表操作

**查询监控列表**

```
GET /rest/v1/monitors?select=*&order=created_at.desc
Authorization: Bearer {auth_token}
apikey: {anon_key}
```

**按平台筛选**

```
GET /rest/v1/monitors?platform=eq.bilibili&select=*&order=created_at.desc
```

**新增监控**

> 去重机制：新增监控时直接 POST，若违反 `monitors_unique` 约束（同一博主重复添加），PostgREST 返回 409（错误码 23505）。Admin SPA 前端拦截此响应，映射为 `DUPLICATE_MONITOR` 提示用户"该博主已添加"。

```
POST /rest/v1/monitors
Content-Type: application/json
Prefer: return=representation

{
  "platform": "bilibili",
  "native_id": "12345",
  "display_name": "B站_12345",
  "original_url": "https://space.bilibili.com/12345",
  "is_active": true,
  "name_auto": true,
  "status": "normal",
  "fail_count": 0,
  "last_content_at": "2026-06-21T00:00:00Z"
}
```

**更新监控状态（开关 / 手动重置）**

```
PATCH /rest/v1/monitors?id=eq.42
Content-Type: application/json
Prefer: return=representation

{
  "is_active": false
}
```

**手动重置状态**

```
PATCH /rest/v1/monitors?id=eq.42
{
  "status": "normal",
  "fail_count": 0
}
```

**删除监控**

```
DELETE /rest/v1/monitors?id=eq.42
```

**编辑监控昵称**

```
PATCH /rest/v1/monitors?id=eq.42
Content-Type: application/json
Prefer: return=representation

{
  "display_name": "新昵称",
  "name_auto": false
}
```

#### 2.2.2 contents 表操作

**H5 信息流分页查询**

```
GET /rest/v1/contents?
  select=id,platform,native_id,content_type,title,cover_url,original_url,published_at&
  is_display=eq.true&
  order=published_at.desc&
  limit=20&offset=0
apikey: {anon_key}
```

**按平台筛选**

```
GET /rest/v1/contents?
  select=*&
  is_display=eq.true&
  platform=eq.bilibili&
  order=published_at.desc&
  limit=20&offset=0
```

**UPSERT 内容（Cron 脚本调用）**

```
POST /rest/v1/contents
Content-Type: application/json
Prefer: return=representation,resolution=merge-duplicates
apikey: {service_role_key}

{
  "platform": "bilibili",
  "native_id": "BV1xx411c7mD",
  "content_type": "video",
  "title": "视频标题",
  "cover_url": "https://...",
  "original_url": "https://...",
  "published_at": "2026-06-21T10:00:00Z",
  "monitor_id": 42
}
```

> UPSERT 通过 `resolution=merge-duplicates` + UNIQUE 约束实现。
>
> **防复活机制**：UPSERT 请求中**不传 `is_display` 和 `created_at` 字段**，并使用 PostgREST 的 `columns` 参数限制可更新字段：
>
> ```
> POST /rest/v1/contents?columns=platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id
> ```
>
> `columns` 参数确保 UPSERT 只更新指定的字段，`is_display` 和 `created_at` 不会被覆盖。
> 新增记录时 `is_display` 走数据库默认值 `true`，已软删除记录（`is_display=false`）不会被复活。

#### 2.2.3 platform_configs 表操作

**查询 B站 Cookie 状态**

```
GET /rest/v1/platform_configs?platform=eq.bilibili&select=config_key,updated_at
Authorization: Bearer {auth_token}
```

**更新 Cookie**

```
PATCH /rest/v1/platform_configs?platform=eq.bilibili&config_key=eq.cookie
Content-Type: application/json
Prefer: return=representation

{
  "config_value": "{\"SESSDATA\":\"xxx\",\"bili_jct\":\"xxx\"}",
  "updated_at": "2026-06-21T10:00:00Z"
}
```

**Admin SPA Cookie 状态展示规则**：

```
配置管理端展示规则：
  1. 查询 platform_configs WHERE platform=bilibili AND config_key=cookie，取 updated_at 字段
  2. 展示 Cookie 最后更新时间（updated_at）
  3. 若 updated_at 距今 > 25 天 → 展示黄色预警"Cookie 即将过期，建议重新扫码"
  4. 查询 platform_configs WHERE platform=bilibili AND config_key=cookie_status，
     若 config_value='expired' → 展示红色警告"Cookie 已失效，请重新扫码"
     （注：不依赖 monitor.status=cookie_expired 判断，因短路机制下 fail_count 不变、
      不会逐个 monitor 进入 cookie_expired 状态。Cron 平台级短路时 PATCH 为 expired，
      Cron 成功完成时 PATCH 为 valid）
```

### 2.3 Edge Function: parse-url

**端点**：`POST /functions/v1/parse-url`

**请求**：

```json
{
  "url": "https://space.bilibili.com/12345"
}
```

**成功响应（200）**：

```json
{
  "success": true,
  "data": {
    "platform": "bilibili",
    "native_id": "12345",
    "display_name": "老番茄"
  }
}
```

**失败响应**：

```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_PLATFORM",
    "message": "无法识别该平台"
  }
}
```

**平台识别规则**：

| URL 特征 | 平台 | 提取方式 | 昵称获取 |
|---|---|---|---|
| 含 `bilibili.com` | bilibili | 正则 `/space\.bilibili\.com\/(\d+)/` 提取 mid | 调用 `x/space/acc/info` API |
| 含 `youtube.com/@` | youtube | 提取 `@handle` → `channels.list?forHandle=` 转 channelId | 从 channels.list 响应中取 `snippet.title` |
| 含 `youtube.com/channel/UC` | youtube | 直接提取 channelId（无需 API 转换） | `channels.list?id={channelId}` 取 `snippet.title` |
| 含 `youtube.com/c/` | youtube | 提取自定义名 → `channels.list?forUsername=` 转 channelId | 从 channels.list 响应中取 `snippet.title` |
| 含 `zhihu.com` | zhihu | 正则 `/people\/([^/?]+)/` 或 `/column\/([^/?]+)/` | 调用 RSSHub 接口获取 |
| 含 `zhuanlan.zhihu.com/p/` | — | — | 返回 `UNKNOWN_PLATFORM`，提示"请粘贴博主主页链接，而非文章链接" |
| 均不匹配 | — | — | 返回 `UNKNOWN_PLATFORM` 错误 |

**昵称降级策略**：获取失败时 `display_name = "{平台中文名}_{native_id前8位}"`

### 2.4 Edge Function: bilibili-auth

**端点**：`POST /functions/v1/bilibili-auth`

#### 2.4.1 获取二维码

**请求**：

```json
{
  "action": "qrcode"
}
```

**响应（200）**：

```json
{
  "success": true,
  "data": {
    "qr_url": "https://passport.bilibili.com/x/passport-login/web/qrcode?url=...",
    "qrcode_key": "abc123def456"
  }
}
```

#### 2.4.2 轮询扫码状态

**请求**：

```json
{
  "action": "poll",
  "qrcode_key": "abc123def456"
}
```

**轮询配置**：
- 前端每 **2 秒**轮询一次
- B站二维码默认有效期 **180 秒**，过期后需重新获取（前端停止轮询，提示用户重新扫码）
- 最大轮询次数：90 次（180s / 2s），达到上限后自动停止并提示"二维码已过期"

**响应 — 等待中**：

```json
{
  "success": true,
  "data": {
    "status": "waiting"
  }
}
```

**响应 — 成功**：

```json
{
  "success": true,
  "data": {
    "status": "success"
  }
}
```

> Cookie 已由 Edge Function 内部写入 platform_configs 表（`cookie` 行的 `updated_at` 自动更新），前端只需刷新状态显示。

**Cookie 写入失败处理**：

若 Edge Function 内部写入 platform_configs 失败（数据库异常），Edge Function 返回：
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "登录成功但 Cookie 保存失败，请重试"
  }
}
```

**响应 — 过期**：

```json
{
  "success": true,
  "data": {
    "status": "expired"
  }
}
```

**响应 — 失败**：

```json
{
  "success": false,
  "error": {
    "code": "BILIBILI_QRCODE_EXPIRED",
    "message": "二维码已过期，请重新获取"
  }
}
```

### 2.5 Cron 脚本内部接口

#### 2.5.1 平台适配器接口

```typescript
interface PlatformAdapter {
  readonly platform: 'bilibili' | 'youtube' | 'zhihu';
  fetchLatest(monitor: Monitor): Promise<RawContent[]>;
  fetchDisplayName(monitor: Monitor): Promise<string | null>;
}
```

#### 2.5.2 Cron 主流程接口

```typescript
interface CronRunner {
  run(): Promise<CronResult>;
}

interface CronResult {
  totalMonitors: number;
  successCount: number;
  failCount: number;
  newContentCount: number;
  duration: number;
}
```

#### 2.5.3 数据写入接口

```typescript
interface ContentWriter {
  upsert(content: RawContent, monitorId: number): Promise<boolean>;
  updateMonitorStatus(monitorId: number, status: MonitorStatus): Promise<void>;
  updateDisplayName(monitorId: number, displayName: string): Promise<void>;  // name_auto=true 时刷新昵称
}
```

### 2.6 错误码规范

| 错误码 | HTTP | 场景 | 触发方 |
|---|---|---|---|
| `UNKNOWN_PLATFORM` | 400 | URL 无法识别平台 | parse-url |
| `INVALID_URL` | 400 | URL 格式不合法 | parse-url |
| `DUPLICATE_MONITOR` | 409 | 该博主已添加 | parse-url / Admin SPA |
| `BILIBILI_QRCODE_EXPIRED` | 400 | B站二维码过期 | bilibili-auth |
| `BILIBILI_COOKIE_INVALID` | 401 | B站 Cookie 失效 | bilibili-auth / Cron |
| `YOUTUBE_API_ERROR` | 502 | YouTube API 调用失败 | parse-url / Cron |
| `RSSHUB_ERROR` | 502 | RSSHub 接口调用失败 | parse-url / Cron |
| `INTERNAL_ERROR` | 500 | 未预期的内部错误 | 所有 Edge Functions |

---

## 3. 核心业务状态机

### 3.1 Monitor 状态机

```
                         抓取成功
                      ┌──────────────┐
                      │              ▼
                ┌─────┴──────┐  ┌─────────┐
  首次添加 ───→ │   normal    │  │  恢复    │
                │ fail_count=0│  │         │
                └─────┬──────┘  └────┬────┘
                      │              │
           失败 1~2 次 │       抓取成功
                      ▼              │
                ┌──────────────┐    │
                │cookie_expired│────┘
                │fail_count 1-2│
                └──────┬───────┘
                       │
              失败 ≥ 3 次│
                       ▼
                ┌──────────────┐
        ┌─────→ │ rate_limited  │──→ 触发告警通知
        │       │fail_count ≥ 3│
        │       └──────┬───────┘
        │              │
        │     管理员手动重置
        │     或 抓取成功
  再次失败 │              │
 (fail_count+1)          │
        │              ▼
        │       ┌──────────────┐
        └───────│   normal      │
                │ fail_count=0  │
                └───────────────┘
```

**状态流转规则**：

| 当前状态 | 触发事件 | 目标状态 | 副作用 |
|---|---|---|---|
| normal | 单次抓取失败 | cookie_expired | fail_count + 1 |
| cookie_expired | 抓取成功 | normal | fail_count 归零，更新 last_sync_at |
| cookie_expired | 再次失败（fail_count 达到 3） | rate_limited | 推送告警通知 |
| rate_limited | 抓取成功 | normal | fail_count 归零，更新 last_sync_at |
| rate_limited | 再次失败 | rate_limited | fail_count +1，再次推送告警（无静默期） |
| rate_limited | 管理员手动重置 | normal | fail_count 归零 |
| 任意状态 | 管理员关闭监控 | 不变 | is_active = false，Cron 跳过 |

**关键规则**：
- `fail_count` 在**请求成功时归零**，与是否有新内容无关
- `last_sync_at` 在**请求成功时更新**，无论是否有新内容
- `last_content_at` 仅在**有新内容 INSERT 时**更新
- 告警在 `fail_count ≥ 3` 时触发，无静默期（MVP 决策砍掉，PRD F9.3 告警静默期 24h 暂不实现）

### 3.2 Content 生命周期

```
  适配器抓取
      │
      ▼
  ┌─ UPSERT 判断（通过 columns 参数限制可更新字段）─┐
  │                                                  │
  │  POST /contents?columns=platform,native_id,      │
  │    content_type,title,cover_url,original_url,     │
  │    published_at,monitor_id                        │
  │  （不传 is_display / created_at）                 │
  │                                                  │
  │  ├── 不存在（新记录）                             │
  │  │   → INSERT, is_display = true（数据库默认值）  │
  │  │   → 更新 monitor.last_content_at              │
  │  │                                               │
  │  ├── 已存在且 is_display = true                  │
  │  │   → UPDATE title / cover_url /                │
  │  │          original_url（防死链）                │
  │  │   → is_display / created_at 不被覆盖          │
  │  │                                               │
  │  └── 已存在且 is_display = false                 │
  │      （软删除记录）                               │
  │      → UPDATE title / cover_url                  │
  │      → is_display 不被覆盖（防复活）             │
  │      → created_at 不被覆盖                       │
  │      → 不触发 last_content_at 更新               │
  └──────────────────────────────────────────────────┘
      │
      ▼
  ┌─ 30 天后 ───────────────────────────┐
  │  pg_cron 每日凌晨扫描                │
  │  WHERE created_at < NOW() - 30 days  │
  │    AND is_display = true             │
  │  → SET is_display = false            │
  │  → 写入 cron_soft_delete_logs        │
  └──────────────────────────────────────┘
```

### 3.3 Cron 互斥锁状态

> **注意**：不使用 `pg_advisory_lock`，因为 Supabase REST API 每次请求是独立会话，请求结束后锁自动释放，跨请求无法持有锁。改用基于数据库行的互斥机制。

```
  GitHub Actions 触发
      │
      ▼
  ┌─ 获取行级锁（cron_locks 表）───────────┐
  │                                         │
  │  UPDATE 返回 affected_rows = 1           │
  │  → 加锁成功，执行抓取流程               │
  │  → 完成后 UPDATE 释放锁                 │
  │                                         │
  │  UPDATE 返回 affected_rows = 0           │
  │  → 已被占用（上一轮仍在运行或崩溃未释放）│
  │  → 跳过本轮                             │
  │  → 记录日志"上一轮未完成，跳过"         │
  └─────────────────────────────────────────┘
```

**锁实现 — cron_locks 表**：

```sql
-- 新增 cron_locks 表（固定单行）
CREATE TABLE cron_locks (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  locked_at   TIMESTAMPTZ,
  locked_by   TEXT
);

-- 初始化单行
INSERT INTO cron_locks (id, locked_at, locked_by) VALUES (1, NULL, NULL);

-- 加锁（原子操作，通过 UPDATE 返回值判断）
-- affected_rows = 1 → 加锁成功；= 0 → 已被占用
UPDATE cron_locks
SET locked_at = now(), locked_by = $run_id
WHERE id = 1 AND (locked_at IS NULL OR locked_at < now() - INTERVAL '15 minutes');

-- 执行完毕后释放锁
UPDATE cron_locks SET locked_at = NULL, locked_by = NULL WHERE id = 1;
```

**15 分钟超时兜底**：即使脚本崩溃未释放锁，下一轮也能在 15 分钟后自动获取，避免死锁。

**管理员手动解锁**（极端场景）：若锁卡死且 15 分钟超时不够，管理员可通过 Supabase Dashboard 的 SQL Editor 手动执行 `UPDATE cron_locks SET locked_at = NULL, locked_by = NULL WHERE id = 1` 解锁。

**REST API 调用方式（原子加锁，避免 TOCTOU 竞争）**：

```
-- 原子加锁（单条 PATCH 带 or 过滤器，无先 GET 步骤）
PATCH /rest/v1/cron_locks?id=eq.1&or=(locked_at.is.null,locked_at.lt.2026-06-21T09:45:00Z)
Content-Type: application/json
Prefer: return=representation

{
  "locked_at": "2026-06-21T10:00:00Z",
  "locked_by": "run-{github_run_id}"
}

-- 响应数组非空 → 加锁成功
-- 响应数组为空 → 加锁失败（已被占用）
-- 注意：locked_at.lt 的值 = now() - 15 minutes（stale threshold）

-- 解锁
PATCH /rest/v1/cron_locks?id=eq.1
{ "locked_at": null, "locked_by": null }
```

> **URL 编码提示**：时间戳中的冒号 `:` 在 URL 中是保留字符。虽然 PostgREST 能正确解析原始冒号，但生产环境建议编码为 `%3A`（如 `2026-06-21T09%3A45%3A00Z`），或使用 PostgREST 客户端库自动处理。

### 3.4 写回前校验

> **时机**：在适配器抓取完成后、UPSERT contents 之前执行。避免 monitor 在抓取期间被删除导致 UPSERT 外键约束失败。

```
  抓取完成，准备 UPSERT 之前
      │
      ▼
  ┌─ 校验 monitor 是否仍存在且 is_active = true ─┐
  │                                                │
  │  存在且开启                                    │
  │  → 继续 UPSERT contents                       │
  │  → 写回 last_sync_at / fail_count / status    │
  │  → 有新内容则更新 last_content_at             │
  │                                                │
  │  已删除                                        │
  │  → 跳过 UPSERT 和写回，丢弃本轮结果          │
  │                                                │
  │  已关闭（is_active = false）                   │
  │  → 跳过 UPSERT 和写回，丢弃本轮结果          │
  └────────────────────────────────────────────────┘
```

---

## 4. 权限矩阵

### 4.1 角色-操作矩阵

| 表 | 操作 | 管理员 (authenticated) | 访客 (anon) | Cron (service_role) | Edge Function (service_role) |
|---|---|---|---|---|---|
| **monitors** | SELECT | ✅ | ❌ | ✅ | ✅ |
| | INSERT | ✅ | ❌ | ❌ | ❌ |
| | UPDATE | ✅ | ❌ | ✅（仅 status/fail_count/last_sync_at/last_content_at/display_name） | ❌ |
| | DELETE | ✅ | ❌ | ❌ | ❌ |
| **contents** | SELECT | ✅ | ✅（仅 is_display=true） | ✅ | ✅ |
| | INSERT | ✅ | ❌ | ✅ | ❌ |
| | UPDATE | ✅ | ❌ | ✅（UPSERT 触发） | ❌ |
| | DELETE | ❌ | ❌ | ❌ | ❌ |
| **platform_configs** | SELECT | ✅（脱敏） | ❌ | ✅ | ✅ |
| | INSERT | ❌ | ❌ | ❌ | ✅（bilibili-auth 写入 Cookie） |
| | UPDATE | ❌ | ❌ | ❌ | ✅（bilibili-auth 更新 Cookie） |
| | DELETE | ❌ | ❌ | ❌ | ❌ |
| **cron_locks** | SELECT | ❌ | ❌ | ✅ | ❌ |
| | UPDATE | ❌ | ❌ | ✅（加锁/解锁） | ❌ |
| **cron_soft_delete_logs** | SELECT | ✅（查看日志） | ❌ | ✅ | ❌ |
| | INSERT | ❌ | ❌ | ✅（pg_cron 写入） | ❌ |

**关键说明**：
- `service_role` 绕过所有 RLS 策略，直接操作数据
- `contents` 表永远不物理 DELETE，只通过 `is_display = false` 软删除
- `platform_configs` 的 SELECT 对管理员脱敏（不返回 config_value 原文，只返回 config_key 和 updated_at）
- monitors 的 INSERT 由 Admin SPA 直接调用 REST API（authenticated 角色）
- monitors 的 UPDATE 在 Cron 中只允许更新状态字段和 display_name（name_auto=true 时刷新昵称），通过应用层逻辑控制

### 4.2 RLS 策略 SQL

```sql
-- ========== monitors 表 ==========
ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY monitors_admin_all ON monitors
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
-- anon 角色：无策略，默认拒绝

-- ========== contents 表 ==========
ALTER TABLE contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY contents_admin_all ON contents
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (is_display = true);

-- ========== platform_configs 表 ==========
ALTER TABLE platform_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_configs_admin_read ON platform_configs
  FOR SELECT TO authenticated
  USING (true);
-- 管理员只能读取，不能直接修改（通过 Edge Function 间接写入）
-- anon 角色：无策略，默认拒绝

-- ========== cron_locks 表 ==========
ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY cron_locks_cron_only ON cron_locks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
-- 仅 Cron (service_role) 可操作，其他角色无权限

-- ========== cron_soft_delete_logs 表 ==========
ALTER TABLE cron_soft_delete_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY soft_delete_logs_admin_read ON cron_soft_delete_logs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY soft_delete_logs_cron_insert ON cron_soft_delete_logs
  FOR INSERT TO service_role
  WITH CHECK (true);
-- 管理员可查看日志，Cron 可写入日志
```

---

## 5. 业务对象定义

### 5.1 Monitor（监控目标）

| 属性 | 值 |
|---|---|
| **对象名称** | Monitor |
| **职责** | 表示一个被监控的博主，包含平台信息、运行状态和同步元数据 |
| **存储表** | monitors |

**字段定义**：

| 字段 | 类型 | 可空 | 默认值 | 业务规则 |
|---|---|---|---|---|
| id | number | 否 | 自增 | 主键 |
| platform | enum | 否 | — | bilibili / youtube / zhihu |
| native_id | string | 否 | — | 博主在平台内的唯一标识 |
| display_name | string | 否 | — | 添加时同步获取一次，管理员可编辑 |
| name_auto | boolean | 否 | true | true 时 Cron 尝试刷新昵称；管理员手动编辑后设为 false |
| original_url | string | 否 | — | 原始粘贴的链接 |
| is_active | boolean | 否 | true | false 时 Cron 跳过该博主 |
| last_sync_at | timestamp | 是 | null | 请求成功时更新，不代表有新内容 |
| last_content_at | timestamp | 否 | now() | 有新内容 INSERT 时更新 |
| fail_count | number | 否 | 0 | 请求成功归零，失败 +1 |
| status | enum | 否 | normal | normal / cookie_expired / rate_limited |
| created_at | timestamp | 否 | now() | 创建时间 |

**业务规则**：

1. `(platform, native_id)` 全局唯一，重复添加返回 409
2. 添加时 `last_content_at` 初始化为 `now()`，避免误触发停更提示。**语义说明**：初始值 = `now()` 意味着仅抓取添加后的新内容，不回溯历史。如果博主昨天发了视频、今天添加监控，昨天的视频不会出现
3. `fail_count` 达到 3 时自动流转为 `rate_limited` 并触发告警
4. 管理员手动重置：`status = normal, fail_count = 0`
5. 删除 monitor 时，关联 contents 的 `monitor_id` 置为 NULL（`ON DELETE SET NULL`），内容记录保留，仅失去关联。**重新添加说明**：删除后重新添加同一博主会生成新 monitor（新 id），旧 contents 的 monitor_id 已为 NULL，不会自动关联到新 monitor，这是预期行为
6. 添加时 `name_auto = true`；管理员编辑昵称时同步设置 `name_auto = false`
7. Cron 抓取时，若 `name_auto = true`，调用 `fetchDisplayName` 尝试刷新昵称；返回非 null 时更新 `display_name`，`name_auto` 保持 true；管理员手动修改后 `name_auto = false`，Cron 不再覆盖

### 5.2 Content（内容卡片）

| 属性 | 值 |
|---|---|
| **对象名称** | Content |
| **职责** | 表示一条被抓取到的博主内容，是 H5 信息流的最小展示单元 |
| **存储表** | contents |

**字段定义**：

| 字段 | 类型 | 可空 | 默认值 | 业务规则 |
|---|---|---|---|---|
| id | number | 否 | 自增 | 主键 |
| platform | enum | 否 | — | 与关联 monitor 的 platform 一致 |
| native_id | string | 否 | — | 内容在平台内的原生 ID |
| content_type | enum | 否 | — | video / article / question / answer / post |
| title | string | 否 | — | 清洗 HTML 标签后的纯文本标题 |
| cover_url | string | 是 | null | 封面图 URL，统一为 HTTPS 绝对路径 |
| original_url | string | 否 | — | 可直接访问的原文链接 |
| published_at | timestamp | 否 | — | 原始发布时间（UTC） |
| monitor_id | number | 是 | null | 外键关联 monitors.id，删除 monitor 后置为 NULL |
| is_display | boolean | 否 | true | 软删除标记 |
| created_at | timestamp | 否 | now() | 入库时间，软删除判断依据 |

**业务规则**：

1. `(platform, native_id)` 全局唯一，UPSERT 去重依据
2. `is_display = false` 的记录禁止重置为 true（防复活）
3. `created_at` 超过 30 天自动软删除（`is_display = false`）
4. 软删除记录仍可更新 title/cover_url/original_url（防死链和破损图片）
5. 永远不物理 DELETE，只软删除
6. 单条记录大小上限 3 KB（应用层拦截）

### 5.3 PlatformConfig（平台配置）

| 属性 | 值 |
|---|---|
| **对象名称** | PlatformConfig |
| **职责** | 存储平台级敏感配置（B站 Cookie 等），与具体 monitor 无关 |
| **存储表** | platform_configs |

**字段定义**：

| 字段 | 类型 | 可空 | 默认值 | 业务规则 |
|---|---|---|---|---|
| id | number | 否 | 自增 | 主键 |
| platform | enum | 否 | — | bilibili / youtube / zhihu |
| config_key | string | 否 | — | cookie / api_key 等 |
| config_value | string | 否 | — | 加密存储（Supabase Vault） |
| updated_at | timestamp | 否 | now() | 最后更新时间 |

**业务规则**：

1. `(platform, config_key)` 唯一
2. B站 Cookie 通过 Edge Function `bilibili-auth` 扫码登录后写入
3. Cron 脚本通过 service_role 读取 Cookie 用于 API 请求
4. 管理员前端只展示 `updated_at`，不展示 `config_value` 原文
5. YouTube API Key 需同时配置在两处（不存入此表）：
   - **GitHub Actions Secrets**（`YOUTUBE_API_KEY`）：Cron 脚本 YoutubeAdapter 使用
   - **Supabase Edge Function 环境变量**（`YOUTUBE_API_KEY`）：`parse-url` 函数解析 YouTube URL 时使用（`channels.list?forHandle=`）

### 5.4 ParsedUrl（URL 解析结果）

| 属性 | 值 |
|---|---|
| **对象名称** | ParsedUrl |
| **职责** | Edge Function `parse-url` 的返回对象，包含平台识别和标识提取结果 |
| **生命周期** | 临时对象，不持久化 |

**字段定义**：

| 字段 | 类型 | 可空 | 业务规则 |
|---|---|---|---|
| platform | enum | 否 | bilibili / youtube / zhihu |
| native_id | string | 否 | 平台内唯一标识 |
| display_name | string | 否 | 昵称获取失败时降级为 `{平台中文名}_{native_id前8位}` |

**平台解析规则**：

| 平台 | URL 匹配 | native_id 提取 | 昵称获取方式 |
|---|---|---|---|
| bilibili | 含 `bilibili.com` | 正则 `/space\.bilibili\.com\/(\d+)/` → mid | `x/space/acc/info?mid=` API |
| youtube | 含 `youtube.com/@` | 提取 `@handle` → `channels.list?forHandle=` → channelId | channels.list 响应 `snippet.title` |
| youtube | 含 `youtube.com/channel/UC` | 直接提取 channelId（无需 API 转换） | `channels.list?id={channelId}` 取 `snippet.title` |
| youtube | 含 `youtube.com/c/` | 提取自定义名 → `channels.list?forUsername=` → channelId | channels.list 响应 `snippet.title` |
| zhihu | 含 `zhihu.com` | 正则 `/people\/([^/?]+)/` 或 `/column\/([^/?]+)/` | RSSHub 接口获取 |
| — | 含 `zhuanlan.zhihu.com/p/` | — | 返回 `UNKNOWN_PLATFORM`，提示"请粘贴博主主页链接，而非文章链接" |

### 5.5 RawContent（原始内容）

| 属性 | 值 |
|---|---|
| **对象名称** | RawContent |
| **职责** | 平台适配器返回的标准化内容对象，是数据清洗的输出、UPSERT 的输入 |
| **生命周期** | 临时对象，UPSERT 后转化为 Content 持久化 |

**字段定义**：

| 字段 | 类型 | 可空 | 业务规则 |
|---|---|---|---|
| native_id | string | 否 | 平台内内容唯一 ID |
| content_type | enum | 否 | video / article / question / answer / post |
| title | string | 否 | 已清洗 HTML 标签 |
| cover_url | string | 是 | 统一为 HTTPS 绝对路径 |
| original_url | string | 否 | 可直接访问的原文链接 |
| published_at | string | 否 | ISO 8601 UTC 格式 |

### 5.6 PlatformAdapter（平台适配器接口）

| 属性 | 值 |
|---|---|
| **对象名称** | PlatformAdapter |
| **职责** | 抽象各平台抓取逻辑的统一接口，新增平台只需实现此接口 |
| **位置** | `scripts/cron/src/adapters/` |

**接口定义**：

```typescript
interface PlatformAdapter {
  readonly platform: 'bilibili' | 'youtube' | 'zhihu';

  // 获取博主最新内容（前 6 条）
  fetchLatest(monitor: Monitor): Promise<RawContent[]>;

  // 获取博主昵称（添加时同步调用一次）
  fetchDisplayName(monitor: Monitor): Promise<string | null>;
}
```

**各实现差异**：

| 适配器 | 数据源 | 鉴权 | 限速 | 特殊逻辑 |
|---|---|---|---|---|
| BilibiliAdapter | `x/space/wbi/arc/search` + `x/space/article/list` | Cookie (SESSDATA) | 同平台 ≥1.5s | 需要 WBI 签名；同时抓取视频 + 专栏文章（content_type=article） |
| YoutubeAdapter | `playlistItems.list` (uploads playlist) | API Key | 无 | 需先获取 uploads playlist ID；**平台级短路** |
| ZhihuAdapter | RSSHub HTTP 接口 | API Key | 同平台 ≥1.5s | 依赖 RSSHub 实例可用性；**平台级短路** |

**B站 WBI 签名流程**：

B站 `x/space/wbi/arc/search` 接口需要 WBI 签名参数（`w_rid`），流程如下：

1. 调用 `https://api.bilibili.com/x/web-interface/nav` 获取 `wbi_img` 字段中的 `img_url` 和 `sub_url`
2. 提取文件名部分作为 `img_key` 和 `sub_key`（去掉路径和后缀）
3. 将 `img_key` 和 `sub_key` 按固定位置表（32 位映射表）交错拼接，取前 32 位得到 `mixin_key`
4. 将请求参数按 key 字典序排列，拼接为 query string
5. 对 `query_string + mixin_key` 计算 MD5，得到 `w_rid`
6. 将 `w_rid` 和当前时间戳 `wts` 附加到请求参数中

> `mixin_key` 有效期约 24 小时，适配器应缓存并在失效时重新获取。

**YouTube uploads playlist 获取方式**：

YouTube 用户的上传视频存储在特定的 uploads playlist 中，需先通过 channel ID 获取：

```
GET https://www.googleapis.com/youtube/v3/channels
  ?part=contentDetails
  &id={channelId}
  &key={apiKey}

响应：contentDetails.relatedPlaylists.uploads → uploads playlist ID
```

获取 playlist ID 后，通过 `playlistItems.list` 抓取最新视频：

```
GET https://www.googleapis.com/youtube/v3/playlistItems
  ?part=snippet
  &playlistId={uploadsPlaylistId}
  &maxResults=6
  &key={apiKey}
```

**"穿透置顶内容"说明**：

B站和 YouTube 等平台的博主主页会有"置顶"内容（pinned video），这些置顶内容会占据列表前几条位置。适配器取前 6 条结果可以覆盖置顶区域，确保获取到最新非置顶内容。对于置顶内容：
- 如果 `published_at` 早于 `last_content_at`，视为旧内容不入库
- 如果 `published_at` 晚于 `last_content_at`，正常入库（博主可能重新置顶了新内容）

**平台级短路机制**：

当平台级基础设施故障时（如 YouTube API 配额用尽、RSSHub 实例宕机），同平台所有 monitor 都会失败，逐条 +1 会产生大量误告警。适配器层需实现平台级短路：

```typescript
// 适配器内部逻辑
async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
  // 先尝试第一条，检测平台级故障
  const probeResult = await this.tryFetch(monitors[0]);

  if (probeResult.error?.isPlatformLevel) {
    // 平台级短路：跳过本组所有 monitor，不逐个 fail_count +1
    // isPlatformLevel 判定条件：
    //   - YouTube: HTTP 403 + reason = 'quotaExceeded'
    //   - 知乎: RSSHub 实例不可达 (ECONNREFUSED / 5xx)
    //   - B站: HTTP 401/403 (Cookie 失效，平台级共享，一个失效全部失效)
    return { skipped: true, reason: probeResult.error.message, monitors: monitors.length };
  }

  // 非平台级故障，正常逐个处理（第一条的结果也要用）
  return this.fetchRemaining(probeResult, monitors.slice(1));
}
```

**CronRunner 中的短路处理**：

```
平台组执行结果：
  ├── 正常完成 → 正常汇总
  ├── 平台级短路 → 该组所有 monitor fail_count 不变，记录日志"平台级故障，跳过整组"
  └── 适配器初始化失败 → 同平台级短路处理
```

### 5.7 DeepLinkResolver（Deep Link 解析器）

| 属性 | 值 |
|---|---|
| **对象名称** | DeepLinkResolver |
| **职责** | 根据 (platform, content_type, native_id) 组合生成 Deep Link Schema |
| **位置** | `packages/shared/src/constants/deep-link.ts` |

**映射规则**：

| platform | content_type | Schema | MVP 支持 |
|---|---|---|---|
| bilibili | video | `bilibili://video/{native_id}` | ✅ |
| bilibili | article | `bilibili://article/{native_id}` | ✅ |
| youtube | video | `youtube://watch?v={native_id}` | ✅ |
| zhihu | * | — | ❌ 统一走 original_url |

**业务规则**：

1. 无法匹配 Schema 时，直接使用 `original_url` 网页打开
2. 知乎在 MVP 阶段不生成 Deep Link，统一走 `original_url`
3. 跳转流程：环境检测 → 静默复制 → Deep Link 唤醒 → 2 秒超时检测 → 兜底弹窗
4. 超时检测监听事件：`visibilitychange` / `pagehide` / `blur`
5. 系统浏览器 Deep Link 唤醒失败（2 秒超时）后的兜底弹窗内容：
   - 提示文案："链接已自动复制，打开 App 即可直接看"
   - 按钮 1：`[网页打开]` — 使用 `original_url` 在浏览器中打开
   - 按钮 2：`[关闭]` — 关闭弹窗

### 5.7.1 EnvironmentDetector（环境检测器）

| 属性 | 值 |
|---|---|
| **对象名称** | EnvironmentDetector |
| **职责** | 检测当前浏览器环境，决定跳转策略（Deep Link 还是兜底弹窗） |
| **位置** | `packages/shared/src/utils/environment.ts` |

**检测规则**：

| UA 特征 | 环境 | 跳转策略 |
|---|---|---|
| 含 `MicroMessenger` | 微信内 | 跳过 Deep Link，直接弹兜底弹窗引导用户复制链接到系统浏览器打开 |
| 含 `AlipayClient` | 支付宝内 | 同上，跳过 Deep Link，弹兜底弹窗 |
| 其他 | 系统浏览器 | 走 Deep Link 流程 |

**业务规则**：

1. 环境检测在 Deep Link 跳转前执行，避免在受限环境中无意义的唤醒尝试
2. 兜底弹窗内容：提示用户"当前环境不支持直接打开 App，请复制链接到系统浏览器"，并提供一键复制按钮

### 5.8 CronRunner（Cron 调度器）

| 属性 | 值 |
|---|---|
| **对象名称** | CronRunner |
| **职责** | GitHub Actions 每 30 分钟触发的主流程编排器 |
| **位置** | `scripts/cron/src/index.ts` |

**执行流程**：

```
CronRunner.run()
  │
  ├── 1. 获取行级锁（cron_locks 表）
  │     ├── 失败 → 记录日志"上一轮未完成，跳过"，退出
  │     └── 成功 → 继续
  │
  ├── 2. 查询 monitors WHERE is_active = true
  │
  ├── 2.5 YouTube 4 小时降频过滤：
  │     YouTube 组 monitor 中，仅保留满足以下条件的：
  │       last_sync_at IS NULL（从未抓取）
  │       OR last_sync_at < now() - INTERVAL '4 hours'
  │     被过滤掉的 YouTube monitor 不更新任何字段，不视为失败
  │     （B站和知乎组不受此限制，每轮全量执行）
  │
  │     具体查询：
  │       -- YouTube 组（降频过滤）
  │       GET /rest/v1/monitors?is_active=eq.true&platform=eq.youtube
  │         &or=(last_sync_at.is.null,last_sync_at.lt.{four_hours_ago_iso})
  │         &select=*
  │
  │       -- B站 + 知乎组（全量）
  │       GET /rest/v1/monitors?is_active=eq.true&platform=in.(bilibili,zhihu)&select=*
  │
  ├── 3. 按 platform 分组
  │     ├── bilibili 组 → BilibiliAdapter（串行，间隔 1.5s）
  │     ├── youtube 组  → YoutubeAdapter（串行）
  │     └── zhihu 组    → ZhihuAdapter（串行，间隔 1.5s）
  │     （三组使用 Promise.allSettled 并行执行，每组内部 try-catch 隔离）
  │
  │     平台组级别：某平台组整体异常不影响其他平台组
  │     （如 YouTube 配额用尽不影响 B站和知乎组）
  │
  ├── 4. 每条 monitor 的抓取流程（错误隔离边界）：
  │     ├── try {
  │     │     adapter.fetchLatest(monitor)
  │     │     ├── 成功 →
  │     │     │     4a. 写回前校验：monitor 是否仍存在且 is_active=true
  │     │     │         ├── 不存在或已关闭 → 跳过 UPSERT 和状态写回，丢弃本轮结果
  │     │     │         └── 存在且开启 → 数据清洗 → UPSERT → 状态回写
  │     │     │             → 若 name_auto=true 则尝试 fetchDisplayName 刷新昵称
  │     │     └── 失败 → fail_count +1 → 状态流转判断 → 告警判断
  │     ├── catch (error) {
  │     │     记录错误日志（monitor.id + error.message + stack）
  │     │     fail_count +1 → 状态流转
  │     │     继续下一条 monitor（不影响同组其他 monitor）
  │     │     注：极端竞态下（校验通过后 monitor 被删除），UPSERT 外键约束失败
  │     │     也由此 catch 捕获，不影响整体流程
  │     │ }
  │
  ├── 5. 汇总 CronResult
  │
  └── 6. 释放行级锁（finally 块中执行）
        UPDATE cron_locks SET locked_at=NULL WHERE id=1
        释放失败时记录错误日志，不影响本轮结果
        下一轮通过 15 分钟超时自动恢复
```

**错误隔离规则**：

| 隔离级别 | 说明 |
|---|---|
| monitor 级 | 单条 monitor 抓取异常（未捕获异常）被 try-catch 捕获，不影响同组其他 monitor。极端竞态下（写回前校验通过后 monitor 被删除），UPSERT 外键约束失败也由此 catch 捕获，记录错误日志后继续下一条 |
| 平台组级 | 某平台适配器初始化失败或平台级短路，不影响其他平台组 |
| 全局级 | 仅行级锁获取失败或数据库连接失败会导致整个 Cron 退出 |

---

## 6. 数据清洗规则

### 6.1 字段清洗规则

| 字段 | 清洗规则 |
|---|---|
| title | 去除 HTML 标签（`<[^>]+>`），trim 空白，截断至 300 字符 |
| cover_url | 统一为 HTTPS 协议，确保绝对路径（补全域名），无效时设为 null |
| original_url | 确保可直接访问（补全协议和域名） |
| published_at | 转换为 ISO 8601 UTC 格式（各平台原始格式不同） |
| native_id | 去除前后空白，确保与 Deep Link Schema 拼接安全 |

### 6.2 各平台时间格式转换

| 平台 | 原始格式 | 转换方式 |
|---|---|---|
| bilibili | Unix 时间戳（秒） | `new Date(ts * 1000).toISOString()` |
| youtube | ISO 8601 字符串（含时区） | 直接使用（已是 UTC） |
| zhihu (RSSHub) | RFC 2822 格式 | `new Date(rfc2822).toISOString()` |

### 6.3 各平台 content_type 映射

| 平台 | 原始内容类型 | 统一 content_type |
|---|---|---|
| bilibili | 视频 | video |
| bilibili | 专栏 | article |
| youtube | 视频 | video |
| zhihu (RSSHub) | 文章/专栏 | article |
| zhihu (RSSHub) | 回答 | answer |
| zhihu (RSSHub) | 问题 | question |
| zhihu (RSSHub) | 想法/pin | post |

---

## 7. 告警规则

### 7.1 触发条件

```
单条 monitor 抓取失败
  │
  ├── 平台级短路触发（YouTube 配额耗尽 / RSSHub 宕机）
  │   → 跳过整组，fail_count 不变，不告警
  │   → 记录日志"平台级故障，跳过 {platform} 组"
  │
  ├── fail_count < 3
  │   → 仅更新 fail_count + 1，不告警
  │
  └── fail_count ≥ 3
      → 更新 status = rate_limited
      → 推送告警通知（无静默期，每次达到条件都告警）
```

### 7.2 告警消息模板

```
⚠️ [{platform}] 博主 [{display_name}] 已连续 {fail_count} 次抓取失败
最后成功时间：{last_sync_at ?? '从未成功同步'}
当前状态：{status}
请检查 Cookie 或网络。
```

### 7.3 告警渠道

- 企业微信 Webhook（`WECOM_WEBHOOK_URL`）
- 若未配置 Webhook，仅记录到 GitHub Actions 日志

---

## 8. 边界场景处理

| 场景 | 处理方式 |
|---|---|
| 粘贴的 URL 博主已注销 | parse-url 返回 `UNKNOWN_PLATFORM` 或 API 返回 404，前端 Toast 提示 |
| 同一博主重复添加 | (platform, native_id) 唯一约束，返回 409 |
| B站 Cookie 过期/失效 | 适配器探测返回 401/403 → **平台级短路**，跳过本组所有 monitor，fail_count 不变。详见 5.6 平台级短路机制 |
| YouTube API 配额用尽 | 适配器探测返回 403 quotaExceeded → **平台级短路**，跳过本组所有 monitor，不逐个 +1 |
| 知乎 RSSHub 实例宕机 | 适配器探测返回 ECONNREFUSED/5xx → **平台级短路**，跳过本组所有 monitor，不逐个 +1 |
| 上一轮 Cron 未完成 | cron_locks 行级锁检测（locked_at 非空且未超 15 分钟） → 跳过本轮 |
| Cron 期间管理员删除了 monitor | 写回前校验 → 不存在则跳过写回 |
| 同平台密集请求 | 同平台请求间 sleep ≥ 1.5 秒 |
| UPSERT 命中软删除记录 | 通过 `columns` 参数限制更新字段，`is_display` 和 `created_at` 不在更新列中，数据库层面防止复活 |
| 封面图 URL 失效 | 前端 img onerror → 显示平台默认占位图 |
| H5 首次加载无数据 | 信息流显示空状态："暂无内容，请先在管理端添加博主" |
| B站二维码过期 | bilibili-auth 返回 `status: expired`，前端提示重新获取 |
| YouTube monitor 距上次抓取不足 4 小时 | CronRunner Step 2.5 降频过滤，本轮跳过，不更新任何字段，不视为失败 |
| monitor 抓取期间被管理员删除 | 写回前校验（fetchLatest 之后、UPSERT 之前）→ 不存在则跳过 UPSERT 和状态写回，避免外键约束失败 |
| 管理员关闭监控期间的新内容 | 写回前校验发现 is_active=false → 跳过 UPSERT，已抓取内容丢弃不入库。重新开启后仅抓取最新前 6 条，关闭期间更早的内容不补抓 |
| 数据库连接失败 | Cron 记录错误日志，退出本轮，30 分钟后 GitHub Actions 自动重试 |

---

## 9. 前端常量与展示规则

### 9.1 平台 Tag 配色常量

定义在 `packages/shared/src/constants/platforms.ts`：

| 平台 | 中文名称 | 品牌色 | Tailwind class 参考 |
|---|---|---|---|
| bilibili | B站 | `#FB7299` | `text-[#FB7299]` / `bg-[#FB7299]` |
| zhihu | 知乎 | `#0066FF` | `text-[#0066FF]` / `bg-[#0066FF]` |
| youtube | YouTube | `#FF0000` | `text-[#FF0000]` / `bg-[#FF0000]` |

### 9.2 H5 相对时间格式化规则

发布时间在前端使用相对时间展示（函数位置：`packages/shared/src/utils/time.ts`）：

| 条件 | 展示格式 | 示例 |
|---|---|---|
| 距现在 < 1 分钟 | `刚刚` | 刚刚 |
| 距现在 < 1 小时 | `{n}分钟前` | 32分钟前 |
| 距现在 < 24 小时 | `{n}小时前` | 2小时前 |
| 距现在 < 30 天 | `{n}天前` | 15天前 |
| 距现在 ≥ 30 天 | 显示绝对日期 | 2026-05-21 |

### 9.3 H5 平台筛选 Tab

H5 信息流顶部的平台筛选 Tab 列表（MVP 阶段，不含抖音）：

```
全部 | B站 | 知乎 | YouTube
```

Tab 配置定义在 `apps/h5/src/constants/tabs.ts`，每个 Tab 对应一个 platform filter 参数。

### 9.4 Admin SPA 登录认证流程

```
Admin SPA 登录流程：
  1. 管理员输入邮箱和密码
  2. 调用 Supabase Auth signInWithPassword(email, password)
  3. 成功 → 获取 session（含 access_token）
  4. access_token 存储在内存（refresh_token 存储在 secure cookie）
  5. 后续所有 REST API 请求携带 Authorization: Bearer {access_token}
  6. session 过期时自动使用 refresh_token 刷新
  7. 刷新失败 → 跳转到登录页

初始管理员账号：
  - 通过 Supabase Dashboard 手动创建（Supabase Auth → Users → Add user）
  - 角色为 authenticated（Supabase 默认）
  - MVP 阶段不需要注册功能，仅手动创建
```

### 9.5 Admin SPA 博主活跃度提示规则

Admin SPA 监控列表中，根据 `last_content_at` 展示活跃度提示：

| 条件 | 展示样式 | 说明 |
|---|---|---|
| `last_content_at` 距今 ≤ 30 天 | 正常展示 | 活跃状态 |
| `last_content_at` 距今 > 30 天 | 灰色提示"⚪ 该博主已超过 {N} 天未更新" | 可能停更，N 为动态天数 |
| `last_content_at` 距今 > 90 天 | 红色提示"⚪ 该博主已超过 {N} 天未更新" | 大概率停更，建议检查或移除 |

### 9.6 Admin SPA 状态筛选

Admin SPA 监控列表支持按运行状态筛选（下拉菜单：全部 / 正常 / 异常 / 已关闭）：

```
-- 按状态筛选
GET /rest/v1/monitors?status=eq.rate_limited&select=*&order=created_at.desc

-- 按状态 + 平台组合筛选
GET /rest/v1/monitors?status=eq.cookie_expired&platform=eq.bilibili&select=*&order=created_at.desc

-- 筛选已关闭
GET /rest/v1/monitors?is_active=eq.false&select=*&order=created_at.desc
```

### 9.7 Admin SPA 运行状态展示映射

Admin SPA 监控列表中，`status` 字段对应以下视觉样式：

| status 值 | 图标 | 颜色 | 说明 |
|---|---|---|---|
| `normal` | 🟢 | 绿色 | 正常运行 |
| `cookie_expired` | 🟡 | 黄色 | 连续失败 1~2 次，需关注 |
| `rate_limited` | 🔴 | 红色 | 连续失败 ≥3 次，已告警 |

### 9.8 Admin SPA last_sync_at 展示格式

Admin SPA 监控列表每行展示"最后同步时间"：

| 条件 | 展示格式 | 示例 |
|---|---|---|
| `last_sync_at` 非空 | 绝对时间 `YYYY-MM-DD HH:mm` | 2026-06-20 14:00 |
| `last_sync_at` 为 null | 文本"从未同步" | 从未同步 |

---

*文档版本：v1.6 | 基于 PRD v1.4 + PROJECT_CONTEXT.md | Review Round 6 修订版*
