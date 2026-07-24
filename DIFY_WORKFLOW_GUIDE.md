# Dify 工作流配置指南

## 一、前置准备

### 1.1 部署 Dify 实例

你可以选择：
- **Dify 云端**：访问 https://cloud.dify.ai 注册（免费额度够用）
- **自建 Dify**：Docker Compose 部署到腾讯云服务器（与 RSSHub 同机）

自建方式：
```bash
git clone https://github.com/langgenius/dify.git
cd dify/docker
docker compose up -d
```

### 1.2 准备 LLM 模型

在 Dify 设置 → 模型供应商 中配置一个 LLM：
- **推荐**：DeepSeek-V3（性价比高，中文总结质量好）
- 备选：GPT-4o-mini、通义千问

---

## 二、创建工作流

### 2.1 入口

Dify 首页 → 创建空白应用 → 选择"工作流应用"→ 命名为"内容总结"

### 2.2 输入变量定义

在 Start 节点定义 4 个输入变量：

| 变量名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | 文本输入 | 是 | 内容标题 |
| `url` | 文本输入 | 是 | 原始链接 |
| `platform` | 下拉选项 | 是 | bilibili / youtube / zhihu / douyin / xiaohongshu |
| `content_type` | 下拉选项 | 是 | video / article / question / answer / post |

---

## 三、工作流节点设计

### 总览

```
Start
  ↓
[条件分支] 按 platform 分支
  ├─ bilibili → [HTTP请求] 获取视频信息 → [LLM总结]
  ├─ youtube  → [HTTP请求] 获取视频信息 → [LLM总结]
  ├─ zhihu    → [HTTP请求] 获取文章内容 → [LLM总结]
  ├─ douyin   → [HTTP请求] 获取视频信息 → [LLM总结]
  └─ xiaohongshu → [HTTP请求] 获取笔记内容 → [LLM总结]
  ↓
End（输出 summary）
```

### 3.1 节点 1：条件分支

添加"条件分支"节点，按 `platform` 变量分 5 条支路。

### 3.2 节点 2：HTTP 请求（各平台不同）

#### B站分支

```
HTTP 请求节点
方法: GET
URL: https://api.bilibili.com/x/web-interface/view?bvid={{url中提取bvid}}
Headers:
  User-Agent: Mozilla/5.0
```

从返回的 JSON 中提取 `data.desc`（视频简介）。

> 如果你用的是 RSSHub，也可以用 `{{RSSHUB_URL}}/bilibili/video/{{bvid}}` 获取。

#### YouTube 分支

```
HTTP 请求节点
方法: GET
URL: https://www.youtube.com/oembed?url={{url}}&format=json
```

从返回的 JSON 中提取 `title` + `author_name`（oEmbed 不提供完整描述，但作为辅助信息）。

> YouTube 字幕需要专用 API，Dify HTTP 节点较难获取。可以先只用标题+简介做总结。

#### 知乎分支

```
HTTP 请求节点
方法: GET
URL: {{RSSHUB_URL}}/zhihu/answers/{{url中提取answer_id}}
Headers:
  User-Agent: Mozilla/5.0
```

从返回的 RSS JSON 中提取 `items[0].content_html`。

#### 抖音分支

```
HTTP 请求节点
方法: GET
URL: {{RSSHUB_URL}}/douyin/video/{{url中提取video_id}}
Headers:
  User-Agent: Mozilla/5.0
```

#### 小红书分支

```
HTTP 请求节点
方法: GET
URL: {{RSSHUB_URL}}/xiaohongshu/note/{{url中提取note_id}}
Headers:
  User-Agent: Mozilla/5.0
```

### 3.3 节点 3：LLM 总结

每条支路的 HTTP 请求完成后，汇入同一个 **LLM 节点**。

**LLM 节点配置**：

| 配置项 | 值 |
|---|---|
| 模型 | DeepSeek-V3 或 GPT-4o-mini |
| 温度 | 0.3 |
| 最大 token | 500 |

**System Prompt**：

```
你是一个内容总结助手。用户会给你一条来自社交平台的内容信息，包括标题、平台、内容类型和可能抓取到的正文/简介。

请根据这些信息，用简洁的中文总结这条内容的核心要点：

1. 总结长度控制在 50-150 字
2. 提取关键信息：主题、观点、结论
3. 客观陈述，不加主观评价
4. 如果正文内容为空，仅基于标题进行推断总结，并在开头标注"[基于标题推断]"
5. 不要使用"这条视频"、"这篇文章"等冗余前缀
```

**User Prompt**：

```
标题：{{title}}
平台：{{platform}}
内容类型：{{content_type}}
链接：{{url}}

抓取到的正文/简介：
{{http_response_body_or_标题推断}}

请总结：
```

### 3.4 节点 4：End

**输出变量**：
- 变量名：`summary`
- 值：`{{llm_node_output.text}}`

---

## 四、发布与获取 API

### 4.1 发布工作流

点击右上角"发布"按钮。

### 4.2 获取 API 信息

进入"访问 API"页面，记录：

| 项 | 值 |
|---|---|
| API URL | `https://your-dify-instance.com/v1/workflows/run` |
| API Key | `app-xxxxxxxxxxxxxxxx` |

### 4.3 测试 API

```bash
curl -X POST https://your-dify-instance.com/v1/workflows/run \
  -H "Authorization: Bearer app-xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "title": "10分钟学会 React Hooks",
      "url": "https://www.bilibili.com/video/BV1xx411m7nD",
      "platform": "bilibili",
      "content_type": "video"
    },
    "response_mode": "blocking",
    "user": "test"
  }'
```

期望返回：
```json
{
  "data": {
    "outputs": {
      "summary": "博主用10分钟讲解了React Hooks的核心概念，包括useState、useEffect、useContext三个最常用的Hook..."
    }
  }
}
```

---

## 五、将 API 信息配置到项目

### 5.1 腾讯云服务器

SSH 到服务器，编辑 `/opt/content-hub/.env.production`：

```env
DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

### 5.2 Supabase Edge Function Secrets

在项目目录执行：

```bash
cd /Users/Zhuanz1/Desktop/AI文件夹/多平台中枢
supabase secrets set DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
supabase secrets set DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

### 5.3 本地 .env（开发环境）

```env
DIFY_API_URL=https://your-dify-instance.com/v1/workflows/run
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

---

## 六、注意事项

1. **各平台正文获取不稳定**：B站/抖音/小红书可能有反爬，HTTP 请求节点可能拿不到内容。LLM 会 fallback 到仅基于标题总结（标注"[基于标题推断]"）。
2. **RSSHub 复用**：如果你的 RSSHub 实例已经在运行，Dify HTTP 节点可以直接调 RSSHub 的 API 获取内容详情，比直接调平台 API 更稳定。
3. **模型成本**：DeepSeek-V3 约 ¥0.001/次总结，1000 条内容约 ¥1。GPT-4o-mini 约 $0.001/次。
4. **超时**：Dify 工作流默认超时 60s，Cron 侧设 30s 超时会先于 Dify 触发。如果 Dify 经常超时，考虑简化工作流（去掉 HTTP 抓取，只用标题总结）。
