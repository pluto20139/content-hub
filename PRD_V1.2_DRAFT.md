# 多平台内容中枢 V1.2 PRD（草案，待确认）

## 一、版本目标

在 V1.1 基础上新增 **AI 内容总结** 和 **详情页** 两个核心功能，提升用户消费内容的效率。

---

## 二、核心需求

### 需求 1：接入 Dify 工作流，自动生成内容总结

#### 2.1.1 流程

```
Cron 抓取新内容 → 入库（summary=null, summary_status=pending）
                  ↓
            异步调用 Dify 工作流（传 标题 + original_url + 平台 + content_type）
                  ↓
            Dify 返回 summary 文本
                  ↓
            更新 contents.summary + summary_status=completed
                  ↓
            H5 详情页展示 summary
```

#### 2.1.2 为什么是异步而非同步

| 方案 | 优点 | 缺点 |
|---|---|---|
| Cron 同步调 Dify | 简单 | Dify 平均 5-15s/条，20 条新内容会阻塞 Cron 2-5 分钟 |
| **Cron 异步调 Dify（推荐）** | 不阻塞抓取，summary 后台生成 | 需要管理 pending 状态 |
| 独立 worker 轮询 | 完全解耦 | 多一个进程要维护 |

推荐方案：Cron 入库后，在同一个 Cron 进程内用 `Promise.allSettled` 并发调用 Dify（不 await 阻塞下一轮抓取），或者用 `setImmediate` 推到下一 tick。

#### 2.1.3 Dify 工作流输入/输出

**输入**（POST 到 Dify workflow API）：
```json
{
  "inputs": {
    "title": "视频标题",
    "url": "https://www.bilibili.com/video/BVxxxxx",
    "platform": "bilibili",
    "content_type": "video"
  },
  "response_mode": "blocking"
}
```

**输出**：
```json
{
  "data": {
    "outputs": {
      "summary": "这是一条关于xxx的视频，博主主要分享了..."
    }
  }
}
```

#### 2.1.4 Dify 工作流内部逻辑（你需要在 Dify 平台配置）

Dify 工作流节点建议：
1. **HTTP 请求节点**：根据 `url` 抓取视频页面 / 调用平台 API 获取文案/字幕
2. **LLM 节点**：将文案/字幕 + 标题 传给大模型，prompt 类似"请用 100 字以内总结这条视频的核心内容"
3. **输出节点**：返回 summary 文本

> ⚠️ 各平台字幕获取难度不同：YouTube 有字幕 API、B站有字幕接口、抖音/小红书/知乎可能只有标题和描述。Dify 工作流需要根据平台分支处理。

#### 2.1.5 需要你确认

- [ ] 你是否已有 Dify 实例（自建 or 云端）？
- [ ] Dify 工作流是否需要我来帮你设计，还是你自己配置？
- [ ] Dify 总结只针对视频类内容，还是所有内容（图文/回答/笔记）都要总结？

---

### 需求 2：新增详情页

#### 2.2.1 页面结构

```
┌─────────────────────────────┐
│  ← 返回                      │
├─────────────────────────────┤
│                             │
│   [封面大图]                  │
│                             │
│   平台标签  发布时间           │
│                             │
│   视频标题（大字号）           │
│                             │
│   ── AI 内容总结 ──           │
│                             │
│   Lorem ipsum dolor sit      │
│   amet, consectetur...       │
│   (summary 文本)              │
│                             │
│   ── 原始链接 ──              │
│   https://www.bilibili...    │
│                             │
├─────────────────────────────┤
│  [ 📱 跳转到 App ]  ← 常驻    │
└─────────────────────────────┘
```

#### 2.2.2 路由设计

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | Feed 信息流 | 现有首页 |
| `/detail/:id` | 详情页 | 新增 |

#### 2.2.3 卡片点击行为变更

| 版本 | 点击卡片 | 跳转按钮 |
|---|---|---|
| V1.1 | 直接调起 Deep Link → 打开原生 App | 无 |
| **V1.2** | 路由跳转到 `/detail/:id` 详情页 | 详情页底部常驻，点击才调起 Deep Link |

#### 2.2.4 详情页"跳转"按钮逻辑

- 按钮始终固定在屏幕底部（`position: sticky; bottom: 0`）
- 点击触发 Deep Link 逻辑（复用 V1.1 的 `getDeepLink` + fallback modal）
- 按钮文案：`📱 跳转到 App`
- 如果当前环境是微信/支付宝：按钮文案改为 `📋 复制链接`，点击复制 + 弹窗提示

#### 2.2.5 需要你确认

- [ ] 详情页是否需要"分享"功能？（分享给朋友）
- [ ] 详情页是否需要"不感兴趣/隐藏"按钮？
- [ ] summary 生成中时，详情页显示什么？（推荐：骨架屏 + "AI 总结生成中..."）
- [ ] summary 生成失败时，详情页显示什么？（推荐：显示失败 + 重试按钮）

---

## 三、数据库变更

### 3.1 contents 表新增字段

```sql
ALTER TABLE contents ADD COLUMN summary       TEXT,
                      ADD COLUMN summary_status VARCHAR(20) DEFAULT NULL,
                      ADD COLUMN summary_at     TIMESTAMPTZ DEFAULT NULL;

-- summary_status: pending / completed / failed / NULL(未触发)
```

### 3.2 新增索引

```sql
CREATE INDEX idx_contents_summary_pending
  ON contents (summary_status)
  WHERE summary_status = 'pending';
```

### 3.3 需要你确认

- [ ] summary 字段长度是否需要限制？（建议不限，Dify 返回多长就存多长）
- [ ] 是否需要记录 Dify 调用耗时？（建议加 `summary_duration_ms INT` 字段）

---

## 四、Cron 改动

### 4.1 抓取后触发 Dify 总结

```ts
// content-writer.ts 新增
async function triggerSummary(contentId: number, title: string, url: string, platform: string, contentType: string): Promise<void> {
  // 1. 标记 summary_status = pending
  // 2. POST 到 Dify workflow API
  // 3. 成功 → 更新 summary + summary_status = completed + summary_at
  // 4. 失败 → summary_status = failed
}
```

### 4.2 新增配置

```env
# .env.production
DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

### 4.3 需要你确认

- [ ] Dify 调用超时设多少？（建议 30s）
- [ ] Dify 调用失败是否重试？（建议重试 1 次，间隔 5s）
- [ ] 是否需要限速？（建议并发 ≤ 5，避免 Dify 过载）

---

## 五、H5 前端改动

### 5.1 新增路由

安装 `react-router-dom`（V1.1 已在 package.json 但未使用，这次正式启用）。

```tsx
// App.tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Feed />} />
    <Route path="/detail/:id" element={<DetailPage />} />
  </Routes>
</BrowserRouter>
```

### 5.2 ContentCard 点击改为路由跳转

```tsx
// ContentCard.tsx
import { useNavigate } from "react-router-dom";

const navigate = useNavigate();
onClick={() => navigate(`/detail/${content.id}`)}
```

### 5.3 新增 DetailPage 组件

```tsx
// pages/DetailPage.tsx
- 查询单条 content（含 summary, summary_status）
- 展示封面大图 + 标题 + 平台 + 时间 + AI 总结
- 底部常驻"跳转到 App"按钮
- summary_status = pending → 骨架屏
- summary_status = failed → 失败提示 + 重试按钮
```

### 5.4 需要你确认

- [ ] 详情页是否支持轮询 summary（pending 时每 5s 查一次直到 completed）？还是手动刷新？
- [ ] 详情页返回时是否回到 Feed 原位置？（需要路由状态管理）

---

## 六、Admin 改动

### 6.1 内容列表新增 summary 状态列

在 MonitorList 或新增 ContentList 页面，展示每条内容的 summary_status。

### 6.2 需要你确认

- [ ] 是否需要在 Admin 手动触发某条内容的 Dify 重新总结？
- [ ] 是否需要在 Admin 查看 summary 全文？

---

## 七、影响评估

| 维度 | 影响 |
|---|---|
| 数据库 | 新增 3 个字段 + 1 个索引，不影响现有数据 |
| Cron | 新增 Dify 调用逻辑，抓取耗时不变（异步） |
| H5 | 新增路由 + 详情页，卡片点击行为变更 |
| Admin | 可选新增 summary 状态展示 |
| 部署 | 新增 Dify 环境变量配置 |
| V1.1 兼容 | summary=null 时详情页正常显示，不影响已有功能 |

---

## 八、待确认决策清单

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | Dify 实例是否已有？ | 需要你提供 Dify API URL 和 Key |
| 2 | Dify 工作流谁来配置？ | 我可以给 prompt 模板和节点设计，你在 Dify 平台操作 |
| 3 | 总结范围：仅视频 vs 全部内容？ | 建议全部内容（视频/图文/回答/笔记）都总结 |
| 4 | Dify 调用超时 | 30s |
| 5 | Dify 失败重试 | 重试 1 次，间隔 5s |
| 6 | Dify 并发限制 | ≤ 5 |
| 7 | 详情页 summary pending 时 | 骨架屏 + "AI 总结生成中..." |
| 8 | 详情页 summary failed 时 | 显示失败 + 手动重试按钮 |
| 9 | 详情页是否轮询 summary | 建议轮询，每 5s 一次，最多 6 次 |
| 10 | 详情页返回位置 | 回到 Feed 原位置（浏览器默认行为即可） |
| 11 | 是否需要分享功能 | V1.2 不做，V1.3 再考虑 |
| 12 | Admin 是否手动触发重试 | 建议支持 |
| 13 | summary 字段长度 | 不限制 |
| 14 | 是否记录 Dify 耗时 | 建议加 `summary_duration_ms` 字段 |
