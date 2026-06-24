# 知乎 API 直连 Spike 报告

> 日期：2026-06-22
> 目的：验证方案 B（ZhihuAdapter 改为直接调知乎 API v4）的可行性

---

## 1. 测试结果汇总

### 1.1 未登录 + 无签名

```
GET https://www.zhihu.com/api/v4/members/excited-vczh/articles?limit=3
→ HTTP 401
→ {"error":{"message":"第三方应用独立请求时，无此操作权限","code":602}}
```

结论：**所有内容接口强制要求签名或登录**。

### 1.2 获取匿名 Cookie（d_c0）

尝试通过 RSSHub 源码揭示的方式获取 `d_c0`：
1. 访问 `https://static.zhihu.com/zse-ck/v3.js` → 200，成功提取 `__zse_ck`
2. 带 `__zse_ck` 访问 `https://www.zhihu.com/` → **302 跳转到 `account/unhuman`**
3. 响应未种植 `d_c0` Cookie

结论：**本机 IP 已被标记为异常**，无法通过正常流程获取 `d_c0`。

### 1.3 带签名 header（无 d_c0）

根据 RSSHub `lib/routes/zhihu/utils.ts` 的签名逻辑：
```
x-zse-93 = '101_3_3.0'
x-zse-96 = '2.0_' + encrypt(md5('101_3_3.0+' + apiPath + '+' + d_c0))
```

测试结果：
```
→ HTTP 403
→ {"error":{"need_login":true,"code":40352,
   "message":"系统监测到您的网络环境存在异常，请点击下方验证按钮进行验证"}}
```

结论：**签名机制本身有效，但无法绕过 IP 级反爬**。

---

## 2. 关键技术发现

### 2.1 知乎 API v4 签名机制（RSSHub 逆向成果）

| 要素 | 来源 | 必要性 |
|---|---|---|
| `__zse_ck` | `static.zhihu.com/zse-ck/v3.js` 正则提取 | 必须 |
| `d_c0` | 访问主页时种植的设备 Cookie | 必须（签名输入） |
| `z_c0` | 扫码/密码登录获得 | 可选（RSSHub 标注 `optional: true`） |
| `x-zse-93` | 固定字符串 `101_3_3.0` | 必须 |
| `x-zse-96` | `2.0_` + 自定义加密(md5(串)) | 必须 |
| 加密函数 `g_encrypt` | RSSHub 从知乎 JS 逆向，存于 `execlib/x-zse-96-v3.ts` | 必须 |

### 2.2 反爬层级

知乎反爬分为三层，**层层递进**：

| 层级 | 机制 | 绕过方式 |
|---|---|---|
| L1 | 签名 header（x-zse-93/96） | 复用 RSSHub 逆向代码 |
| L2 | 设备 Cookie（d_c0） | 访问主页种植 |
| L3 | **IP 风控** | **无法绕过**，只能用干净 IP |

**L3 是致命问题**：GitHub Actions 的 Azure 美国机房 IP 几乎肯定会被知乎标记为异常。

### 2.3 API 返回字段映射（基于 RSSHub 源码推断）

即使能拿到数据，字段映射可行：

| RawContent 字段 | 知乎 API 字段 | 说明 |
|---|---|---|
| native_id | `item.id` | 回答/文章 ID |
| content_type | 根据 endpoint 区分 | answers→answer, articles→article |
| title | `item.question.title`（回答）/ `item.title`（文章） | |
| cover_url | `item.thumbnail` 或 `item.image_url` | 可能需要 fallback |
| original_url | 拼接 `question/{qid}/answer/{aid}` | |
| published_at | `item.created_time * 1000` | Unix 秒时间戳 |

---

## 3. 方案 B 可行性结论

### 3.1 核心结论

**方案 B 不可行**（至少在 GitHub Actions 上不可行）。

理由：
1. **IP 风控无法绕过**：知乎对数据中心 IP 有严格人机验证，GitHub Actions 跑不起来
2. **签名机制虽可复用**，但只能在 IP 干净的前提下工作
3. **即使带 `z_c0` 登录 Cookie，IP 仍可能被标记**（未测试，但知乎风控逻辑通常如此）

### 3.2 部分可行的场景

方案 B 在以下场景可能可行，但都偏离原架构：

| 场景 | 可行性 | 架构改动 |
|---|---|---|
| Cron 脚本跑在住宅 IP（本地 NAS/树莓派） | 中 | 砍 GitHub Actions，自建定时任务 |
| Cron 脚本走海外住宅代理 | 中高 | 增加代理池，成本上升 |
| Cron 脚本跑在国内云主机 | 高 | 砍 GitHub Actions，改用腾讯云/阿里云函数 |

---

## 4. 替代方案推荐

### 4.1 方案 C-1：MVP 砍知乎，Phase 2 再决策

- 立即推进 B站 + YouTube 两平台闭环
- 知乎适配器所有 Step 标注为"Phase 2 延后"
- 需要修改的文档：Taskplan 6.9-6.10、9.2、10.x 知乎筛选；SPEC 5.6、9.3；PRD 平台范围声明

### 4.2 方案 C-2：知乎改为本地脚本 + 手动导入

- 用户在本地（住宅 IP）跑 ZhihuAdapter 脚本
- 脚本写入 Supabase（复用 service_role key）
- Admin SPA 提供"手动触发本地抓取"按钮（调用本地脚本）
- 代价：失去 GitHub Actions 全自动优势，但知乎数据能稳定入库

### 4.3 方案 C-3：自建 RSSHub + 国内云主机

- RSSHub 部署在国内云主机（腾讯云轻量 5元/月即可）
- GitHub Actions 调 RSSHub（国内云主机提供干净 IP）
- 代价：多一个服务要运维，RSSHub 知乎路由仍依赖上游维护

### 4.4 不推荐：方案 B 原版

直接在 GitHub Actions 调知乎 API v4 — **实测不可行**。

---

## 5. 我的推荐

**方案 C-1（MVP 砍知乎）**，理由：

1. **spike 已证明方案 B 在 GitHub Actions 上不可行**，继续投入是浪费
2. **B站 + YouTube 足以验证架构**：parse-url / Cron / UPSERT / Deep Link / RLS / Admin SPA / H5 SPA 全部能覆盖
3. **Taskplan 改动最小**：只需把知乎相关 Step 标注延后
4. **Phase 2 有多条退路**：本地脚本 / 国内云主机 / RSSHub 国内部署，等 MVP 上线后根据真实需求选择

如果用户对知乎需求强烈且接受架构改动，**方案 C-3（自建 RSSHub 国内云主机）** 是次优选择——保留 GitHub Actions 全自动优势，把 IP 问题外包给国内云主机。

---

## 附录：测试脚本与原始响应

所有测试脚本和响应文件存于 `/tmp/zhihu_*.json` 和 `/tmp/zse_ck.js`，可复现。
