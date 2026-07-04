# 前置调研结论：RSSHub 路由与新平台可用性

本调研报告针对 `V1.1_TASK_PLAN.md` 任务 0 进行开展，确认知乎、小红书和抖音在 RSSHub 上的路由、URL 结构以及登录态要求。

---

## 1. RSSHub 路由与 JSON 格式验证

通过在 RSSHub URL 后追加 `?format=json`，可以获得标准的 JSON Feed v1 格式。各平台路由结构如下：

### 1.1 知乎 (Zhihu)
- **用户动态** (包含文章、回答、想法)：
  - 路由：`/zhihu/people/activities/:id`
  - JSON 接口：`${RSSHUB_URL}/zhihu/people/activities/:id?format=json`
  - 返回条目：`item.url` 包含 `/answer/` 或 `/pin/` 等结构，便于识别内容类型。
- **用户专栏**：
  - 路由：`/zhihu/zhuanlan/:id`（RSSHub 使用 `zhuanlan` 路由）
  - JSON 接口：`${RSSHUB_URL}/zhihu/zhuanlan/:id?format=json`

### 1.2 小红书 (Xiaohongshu)
- **用户笔记**：
  - 路由：`/xiaohongshu/user/:user_id/notes`
  - JSON 接口：`${RSSHUB_URL}/xiaohongshu/user/:user_id/notes?format=json`

### 1.3 抖音 (Douyin)
- **博主视频**：
  - 路由：`/douyin/user/:uid`
  - JSON 接口：`${RSSHUB_URL}/douyin/user/:uid?format=json`

---

## 2. 关键设计结论

### 2.1 小红书主页短链
在小红书手机客户端（iOS/Android）中，用户点击“分享个人主页”所生成的短链接（例如 `xhslink.com/xxxxxx` 或 `sns.xiaohongshu.com/t/xxxxxx`），在通过 HTTP HEAD 方法获取重定向响应后，**可以成功解析出 `xiaohongshu.com/user/profile/:uid` 结构**。
因此，`parse-url` 应当支持对 `xhslink.com` 短链接的重定向解析。

### 2.2 知乎专栏 URL 模式
知乎专栏的 URL 模式主要包括：
- `https://zhuanlan.zhihu.com/:column_id` (主域名自定义路径)
- `https://zhuanlan.zhihu.com/c/:column_id` (c前缀路径)
- `https://www.zhihu.com/column/:column_id` (www子域名路径)
- **非专栏监控**：`/p/:article_id` 代表单篇文章，**明确不支持**将其添加为 monitor 监控对象。

### 2.3 小红书登录态限制与 Cookie 依赖
- **调研结果**：公共的 RSSHub 实例因为频繁访问小红书，通常会返回 403 / 503 封禁。自建 RSSHub 实例需要配置全局环境变量 `XIAOHONGSHU_COOKIE` 方可稳定抓取。
- **方案实施**：为了支持 Cookie 配置，我们将在 `platform_configs` 数据库表中增加对 `xiaohongshu` `cookie` 键的支持，并在爬虫运行时动态加载，保持与 B站 类似的凭证刷新隔离。生产环境必须配置代理或 RSSHub 凭证以防数据缺失，开发环境可以通过开启 Mock 开关获取 Mock 数据，但生产环境严禁将 Mock 数据写入数据库。
