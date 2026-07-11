# 多平台内容中枢 V1.2 PRD

## 一、版本目标

接入 Dify AI 工作流，为每条抓取到的内容自动生成 AI 总结；新增详情页，用户点击卡片进入详情页阅读总结，详情页底部常驻"跳转到 App"按钮。

---

## 二、功能清单

| # | 功能 | 优先级 |
|---|---|---|
| F1 | Cron 抓取新内容后，异步调用 Dify 工作流生成 summary | P0 |
| F2 | contents 表新增 summary 相关字段 | P0 |
| F3 | H5 新增详情页路由 `/detail/:id` | P0 |
| F4 | ContentCard 点击改为路由跳转详情页（不再直接调起 App） | P0 |
| F5 | 详情页底部常驻"跳转到 App"按钮，点击调起 Deep Link | P0 |
| F6 | 详情页 summary pending 时骨架屏 + 轮询 | P0 |
| F7 | 详情页 summary failed 时显示失败 + 重试按钮 | P0 |
| F8 | 详情页返回时回到 Feed 原位置 | P1 |

---

## 三、数据库变更

### 3.1 新增字段

```sql
ALTER TABLE contents ADD COLUMN summary            TEXT,
                      ADD COLUMN summary_status    VARCHAR(20) DEFAULT NULL,
                      ADD COLUMN summary_at        TIMESTAMPTZ DEFAULT NULL,
                      ADD COLUMN summary_duration_ms INT       DEFAULT NULL;

-- summary_status 取值: NULL(未触发) / pending / completed / failed
```

### 3.2 新增索引

```sql
CREATE INDEX idx_contents_summary_pending
  ON contents (summary_status)
  WHERE summary_status = 'pending';
```

### 3.3 RLS

summary 字段随 contents 行的现有 RLS 策略，anon 可读（与 title/cover_url 同权限级别）。

---

## 四、Dify AI 内容总结

### 4.1 整体流程

```
Cron 抓取新内容
    ↓
upsertContent 入库（summary=null, summary_status=pending）
    ↓
加入 Dify 总结队列（Promise 池，并发 ≤ 5）
    ↓
取出 content → POST Dify Workflow API（30s 超时）
    ↓
  ├─ 成功 → UPDATE summary=xxx, summary_status=completed, summary_at=now(), summary_duration_ms=耗时
  ├─ 失败 → 等待 5s → 重试 1 次
  │    ├─ 重试成功 → 同成功
  │    └─ 重试失败 → UPDATE summary_status=failed
  └─ 队列继续取下一条，直到清空
```

### 4.2 并发池设计（不遗漏）

```ts
async function processSummaryQueue(items: SummaryTask[], concurrency = 5): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await triggerDifySummary(item);  // 含重试逻辑
    }
  });
  await Promise.all(workers);
}
```

> 保证所有 items 都会被处理，不会因并发限制而遗漏。

### 4.3 Dify Workflow API 调用

**请求**：
```http
POST {DIFY_API_URL}
Authorization: Bearer {DIFY_API_KEY}
Content-Type: application/json

{
  "inputs": {
    "title": "视频标题",
    "url": "https://www.bilibili.com/video/BVxxxxx",
    "platform": "bilibili",
    "content_type": "video"
  },
  "response_mode": "blocking",
  "user": "content-hub-cron"
}
```

**响应**：
```json
{
  "data": {
    "outputs": {
      "summary": "这是一条关于xxx的视频，博主主要分享了..."
    }
  }
}
```

### 4.4 Cron 侧传给 Dify 的输入

| 字段 | 来源 | 说明 |
|---|---|---|
| `title` | RawContent.title | 内容标题 |
| `url` | RawContent.original_url | 原始链接 |
| `platform` | RawContent.platform | 平台标识 |
| `content_type` | RawContent.content_type | 内容类型 |

### 4.5 关于 Dify 工作流内部是否需要抓取正文

**现状**：Cron adapter 返回的 RawContent 只有 title/cover_url/original_url，**没有正文/字幕/描述**。

**两个方案**：

| 方案 | Cron 侧改动 | Dify 工作流复杂度 | 总结质量 |
|---|---|---|---|
| **A（推荐）** | adapter 提取 RSSHub 返回的 `description`/`content_html` 字段，作为 `raw_text` 传给 Dify | 低（Dify 只做 LLM 总结） | 中（依赖 RSSHub 提供的描述质量） |
| **B** | 不改 adapter，只传 title+url | 高（Dify 内部用 HTTP 节点抓取各平台页面） | 中-高（Dify 自己抓的内容更全） |

> 本版 PRD 采用**方案 B**（按你确认的"复杂度由 Dify 工作流内部处理"）。方案 A 作为 V1.3 优化项。
> Dify 工作流的配置详见 `DIFY_WORKFLOW_GUIDE.md`。

### 4.6 环境变量

```env
DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

---

## 五、H5 前端改动

### 5.1 路由

```tsx
// App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";

<BrowserRouter>
  <Routes>
    <Route path="/" element={<Feed />} />
    <Route path="/detail/:id" element={<DetailPage />} />
  </Routes>
</BrowserRouter>
```

### 5.2 ContentCard 点击行为变更

```tsx
// V1.1: onClick → handleClick(content) → window.location.href = deepLink
// V1.2: onClick → navigate(`/detail/${content.id}`)
```

### 5.3 详情页结构

```
┌─────────────────────────────┐
│  ← 返回                      │  ← 顶部导航栏
├─────────────────────────────┤
│                             │
│   [封面大图 16:9]            │  ← referrerPolicy="no-referrer"
│                             │
│   [B站]  3小时前             │  ← 平台标签 + 相对时间
│                             │
│   视频标题（text-lg）        │  ← 大字号标题
│                             │
│   ── AI 内容总结 ──          │  ← 分隔线 + 标题
│                             │
│   ✅ completed:              │
│   Lorem ipsum dolor sit      │  ← summary 全文
│   amet, consectetur...       │
│                             │
│   ⏳ pending:                 │
│   [骨架屏 shimmer 动画]      │  ← 轮询每 5s，最多 6 次
│   "AI 总结生成中..."         │
│                             │
│   ❌ failed:                  │
│   "总结生成失败"             │
│   [重试] 按钮                │
│                             │
├─────────────────────────────┤
│  [ 📱 跳转到 App ]           │  ← position: sticky; bottom: 0
└─────────────────────────────┘
```

### 5.4 "跳转到 App"按钮

- `position: fixed; bottom: 0; left: 0; right: 0;`
- 白底上阴影，按钮蓝色全宽
- 点击触发 Deep Link 逻辑（复用 V1.1 的 `getDeepLink` + fallback modal）
- 微信/支付宝环境：按钮文案改为 `📋 复制链接`，点击复制 + 弹窗

### 5.5 summary 轮询

```ts
// DetailPage.tsx
useEffect(() => {
  if (content.summary_status !== "pending") return;
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    const { data } = await supabase.from("contents").select("summary,summary_status").eq("id", id).single();
    if (data?.summary_status === "completed") {
      setContent(data);
      clearInterval(timer);
    } else if (data?.summary_status === "failed") {
      setContent(data);
      clearInterval(timer);
    } else if (attempts >= 6) {
      clearInterval(timer);  // 最多 6 次 × 5s = 30s
    }
  }, 5000);
  return () => clearInterval(timer);
}, [content.summary_status]);
```

### 5.6 返回 Feed 原位置

- 使用 `react-router-dom` 的 `useNavigate(-1)` 返回
- Feed 组件保持 mounted（使用 `Outlet` 或缓存策略），滚动位置自动恢复
- 或使用 `history` 的 `scrollRestoration`

### 5.7 summary 失败重试

详情页显示"总结生成失败" + 重试按钮，点击：
```ts
// POST to a new Edge Function: retry-summary
await fetch("/functions/v1/retry-summary", { body: JSON.stringify({ content_id: id }) });
// Edge Function 内部调 Dify，更新 summary_status=pending → 再走正常流程
```

---

## 六、Edge Function 新增

### 6.1 retry-summary

```ts
// supabase/functions/retry-summary/index.ts
// POST { content_id: number }
// 1. 查询 content 的 title/url/platform/content_type
// 2. 更新 summary_status = pending
// 3. 调用 Dify workflow
// 4. 更新 summary + summary_status + summary_at + summary_duration_ms
```

---

## 七、Cron 改动

### 7.1 content-writer.ts 新增

```ts
// 入库后触发 Dify 总结（异步，不阻塞 Cron 主流程）
async function triggerDifySummary(content: { id: number; title: string; url: string; platform: string; contentType: string }): Promise<void>
```

### 7.2 index.ts 改动

在 `processPlatformGroup` 中，每条新内容 upsert 成功后，收集到 `summaryQueue` 数组。平台组处理完后，统一调用 `processSummaryQueue(summaryQueue, 5)`。

### 7.3 不阻塞下一轮 Cron

`processSummaryQueue` 在 `run()` 的末尾 `await`，确保当前轮次所有 summary 都处理完（含重试）后才退出。如果超时，Cron 进程会被 lock 机制保护，下一轮会跳过。

---

## 八、部署配置

### 8.1 腾讯云服务器 .env.production 新增

```env
DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

### 8.2 Supabase Edge Function Secrets 新增

```env
DIFY_API_URL=...
DIFY_API_KEY=...
```

### 8.3 数据库迁移

```bash
supabase db push
```

---

## 九、V1.1 兼容性

| 维度 | 影响 |
|---|---|
| 现有 contents 数据 | summary 字段为 NULL，详情页显示"暂无总结"，不影响展示 |
| ContentCard 点击 | 从直接跳 App 改为进详情页，已有用户需适应 |
| Deep Link 逻辑 | 不变，从 ContentCard 迁移到详情页"跳转"按钮 |
| V1.1 隐藏功能 | 不变，详情页不设隐藏按钮 |
| V1.1 性能优化（缓存/懒加载） | 作为 V1.2 前置任务一起做 |

---

## 十、V1.2.1 扩展图文内容 AI 总结

### 10.1 功能目标
将 AI 总结的触发和执行范围从单一的 `video` 扩展至所有内容类型（`video`, `article`, `question`, `answer`, `post`）。使得知乎图文、B站专栏等也能在 H5 Feed 及详情页中正常显示并轮询生成 AI 内容要点。

### 10.2 新增 Edge Function: article-fetcher
由于非视频的图文类正文抓取面临不同的平台限制（如知乎需 RSSHub 中转，B站专栏需专栏 view API，抖音与小红书正文反爬严），设计一个统一的边缘服务 `article-fetcher`：
- **API 定义**：POST `/functions/v1/article-fetcher` -> `{"content_text": "..."}`。
- **知乎**：查询 Supabase Secrets 中的 `RSSHUB_URL`，拉取对应 `activities` 或 `zhuanlan` 的 RSS JSON 订阅，通过 `native_id` 进行匹配，获得 `content_html` 并剔除 HTML 标签，返回纯文本。
- **B站专栏**：调用官方 `https://api.bilibili.com/x/article/view?id={id}` 获取专栏 HTML 正文并转换为纯文本。
- **小红书/抖音**：强防爬，暂不抓取正文，返回空字符串让 Dify 工作流走“基于标题推断”的兜底流程。

### 10.3 调度逻辑变更
1.  **解除视频类型检查**：
    - `dify.ts` 中的 pending 查询从只筛选 `.eq("content_type", "video")` 改为包括五种类型：`.in("content_type", ["video", "article", "question", "answer", "post"])`。
    - `retry-summary` 解除 `content_type !== "video"` 的守卫拦截，允许所有图文类型点击重试。
    - `trigger_summaries.ts` 重置脚本同步更新。
2.  **内容提取路由**：
    - `dify.ts` 中根据内容类型分流：`video` 类型继续走原有字幕/简介抓取，非 `video`（图文类）调用新部署的 `article-fetcher` 边缘服务。

