# PRD V1.1：多平台内容中枢迭代需求

> 本文档基于 1.0 PRD/SPEC 和 1.1 迭代需求整理，作为 V1.1 版本的唯一实现依据。  
> 关键决策：① 不新增独立隐藏字段，复用 `is_display`；② `monitors` 新增 `native_type` 字段用于区分知乎 people/column；③ 抖音采用 RSSHub + 代理池 + 自托管方案；④ 生产环境**不允许 Mock 数据**；⑤ 隐藏功能面向 H5 匿名用户，不额外做防滥用机制。  
> 版本：V1.1 | 最后更新：2026-07-04

---

## 1. 迭代目标

在 1.0（B站 + YouTube）基础上，扩展为覆盖 **B站 / YouTube / 知乎 / 抖音 / 小红书** 五个平台的内容聚合；解决 B站封面 403 问题；新增用户主动隐藏与“已隐藏”查看入口；补齐 Deep Link 唤醒能力。

---

## 2. 功能需求

### 2.1 平台扩展

管理端添加监控时支持以下 URL 格式，由 `parse-url` Edge Function 解析：

| 平台 | 支持 URL 示例 | 解析输出 | 说明 |
|---|---|---|---|
| B站 | `https://space.bilibili.com/12345` | platform=`bilibili`, native_id=`12345`, native_type=`user` | 已有能力，保持不变 |
| YouTube | `https://youtube.com/@handle` / `/channel/UC...` / `/c/xxx` | platform=`youtube`, native_id=`channelId` | 已有能力，保持不变 |
| 知乎 | `https://www.zhihu.com/people/xxx` / `https://zhuanlan.zhihu.com/xxx` | platform=`zhihu`, native_id=`xxx`, native_type=`people`/`column` | **新增**；`native_type` 区分个人主页和专栏 |
| 抖音 | `https://v.douyin.com/xxxxx` / `https://www.douyin.com/user/MS4w...` | platform=`douyin`, native_id=`sec_uid` | **新增**；短链需先解析重定向 |
| 小红书 | `https://xhslink.com/xxxxx` / `https://www.xiaohongshu.com/user/profile/xxx` | platform=`xiaohongshu`, native_id=`uid` | **新增**；短链需先解析重定向 |

### 2.2 封面展示

所有平台内容卡片均展示真实封面图。

- B站封面通过 `referrerPolicy="no-referrer"` 绕过 CDN 防盗链；若仍失效，走 `img onerror` 平台占位图兜底。
- 知乎 / 抖音 / 小红书封面按各平台返回的 HTTPS URL 直接展示，同样带 `referrerPolicy="no-referrer"` 与 `onerror` 兜底。

### 2.3 主动隐藏

- H5 内容卡片右上角显示“×”隐藏按钮，点击后调用 `PATCH /rest/v1/contents?id=eq.{id}`，将 `is_display` 设为 `false`。
- 隐藏后卡片从当前列表即时移除（前端先过滤，再同步后端）。
- **不物理删除数据**，保留 `(platform, native_id)` 作为防重指纹；后续 Cron 抓取到同一内容时，UPSERT 只更新 `title/cover_url/original_url`，**严禁重置 `is_display`**（防复活机制）。
- 已隐藏内容超过 30 天同样会被 pg_cron 软删除任务处理，但 `is_display` 已是 `false`，无影响。

### 2.4 “已隐藏”查看入口

- H5 顶部 Tab 末尾增加 **“已隐藏”**：`全部 | B站 | YouTube | 知乎 | 抖音 | 小红书 | 已隐藏`。
- 已隐藏 Tab 查询 `is_display = false`，按 `published_at DESC` 展示。
- 已隐藏卡片**不显示隐藏按钮**，**不支持恢复**。
- 说明：该列表会同时包含用户手动隐藏和超过 30 天自动软删除的内容，按产品决策不做区分。

### 2.5 Deep Link 唤醒

| 平台 | content_type | Deep Link Schema | 兜底 |
|---|---|---|---|
| bilibili | video | `bilibili://video/{native_id}` | original_url |
| bilibili | article | `bilibili://article/{native_id}` | original_url |
| youtube | video | `youtube://watch?v={native_id}` | original_url |
| zhihu | question | `zhihu://question/{native_id}` | original_url |
| zhihu | answer | `zhihu://answer/{native_id}` | original_url |
| zhihu | article | `zhihu://zhuanlan/{native_id}` | original_url |
| zhihu | post | `zhihu://people/{monitor_native_id}/pins/{native_id}` | original_url |
| douyin | video | `snssdk1128://aweme/detail/{native_id}` | original_url |
| xiaohongshu | post | `xhsdiscover://item/{native_id}` | original_url |
| xiaohongshu | video | `xhsdiscover://item/{native_id}` | original_url |

> 小红书、抖音 Deep Link scheme 需在真机上实测确认，文档中给出首选方案，若实测不可用则统一走 `original_url`。

---

## 3. 数据模型变更

### 3.1 `monitors` 表

```sql
ALTER TABLE monitors
  ADD COLUMN native_type VARCHAR(20);

-- 扩展平台枚举
ALTER TABLE monitors DROP CONSTRAINT monitors_platform_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));

-- native_type 仅在知乎场景下为 people / column，其余平台为空
-- 去重约束仍使用 (platform, native_id)，因为 native_type 不改变内容级别的唯一性
```

### 3.2 `contents` 表

```sql
-- 扩展平台枚举
ALTER TABLE contents DROP CONSTRAINT contents_platform_check;
ALTER TABLE contents ADD CONSTRAINT contents_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));
```

### 3.3 `platform_configs` 表

```sql
-- 扩展平台枚举
ALTER TABLE platform_configs DROP CONSTRAINT platform_configs_platform_check;
ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));
```

---

## 4. 技术方案

### 4.1 抖音稳定抓取方案

抖音无公开 API，且反爬严格。V1.1 采用以下分层架构，目标是**相对最长可用时间、最快自动恢复**，但无法 100% 承诺“不封号”。

1. **自托管 RSSHub（推荐主路径）**
   - 在腾讯云国内节点（上海/北京）部署 RSSHub，降低访问延迟。
   - 使用路由 `/douyin/user/:sec_uid` 获取用户最新视频，返回 JSON 格式。
   - 配置 RSSHub 内部走代理池（见下文）。

2. **代理池（Proxy Pool）**
   - 接入住宅代理或移动代理（如 Bright Data、Oxylabs、Smartproxy）。
   - 每个请求按“随机代理 + 失败换代理”策略执行。
   - 当同一代理连续 2 次失败，自动标记为不可用，30 分钟后重新启用。

3. **短链解析器（Short-link Resolver）**
   - 使用代理 + 移动 UA 对 `v.douyin.com/xxxxx` 发起 HEAD 请求，跟踪重定向。
   - 从最终 URL 提取 `sec_uid`。
   - 将 `short_code -> sec_uid` 缓存 24 小时，避免重复解析。

4. **移动端网页兜底**
   - 当 RSSHub 不可用时，尝试直接请求 `m.douyin.com/user/{sec_uid}`（带移动 UA、Cookies、无 Referer）。
   - 解析 HTML 中的 `<script type="application/ld+json">` 或 `_SSR_HYDRATED_DATA` 获取前 6 条视频。

5. **反爬感知与平台级短路**
   - 当检测到验证码、登录页跳转、403、长时间超时，视为平台级封禁。
   - 触发平台级短路：跳过本轮抖音组所有 monitor，fail_count 不变，记录日志，并通知管理员。
   - 自动暂停 30 分钟后下一轮再尝试，避免进一步触发封禁。

6. **成本与风险提醒**
   - 住宅代理费用约 $5-15/GB，抖音视频页流量小，实际成本可控。
   - 即使使用代理，仍存在周期性被封可能，需人工维护代理池和 Cookie。

### 4.2 知乎 / 小红书抓取方案

| 平台 | 方案 | 说明 |
|---|---|---|
| 知乎 | 自托管 RSSHub | 使用 `/zhihu/people/activities/:id` 或 `/zhihu/people/posts/:id`；专栏使用 `/zhihu/column/:id` |
| 小红书 | 自托管 RSSHub + 移动端网页 | 优先 `/xiaohongshu/user/:uid`；失败时尝试 `www.xiaohongshu.com/user/profile/:uid` |

- 知乎/小红书同样配置代理池，但风控相对抖音宽松。
- RSSHub 不可达时走平台级短路，**不写 Mock 数据**。

### 4.3 封面防盗链

H5 图片统一设置：

```html
<img
  src={cover_url}
  referrerPolicy="no-referrer"
  onError={onPlaceholder}
/>
```

若 B站 CDN 仍返回 403，则增加 Edge Function `/image-proxy` 作为最终兜底：将图片 URL 作为参数，由服务端转发图片流，但优先使用 `no-referrer` 以降低成本。

---

## 5. 接口与权限

### 5.1 `parse-url` Edge Function 扩展

请求与响应格式不变，新增 `native_type` 字段：

```json
{
  "success": true,
  "data": {
    "platform": "zhihu",
    "native_id": "xxx",
    "native_type": "people",
    "display_name": "知乎用户_xxx"
  }
}
```

### 5.2 RLS 策略调整

为支持匿名用户隐藏内容，新增 `contents` 表策略：

```sql
-- 允许匿名用户将 is_display 更新为 false（防恶意写入：只能改这一列，且只能为 false）
CREATE POLICY contents_anon_hide ON contents
  FOR UPDATE TO anon
  USING (is_display = true)
  WITH CHECK (is_display = false);
```

> 注意：此策略允许任意访客隐藏任意内容，按产品决策 V1.1 不额外增加防滥用层。如后续需要限制，需引入前端指纹、IP 限频或登录态。

---

## 6. 交互与视觉

### 6.1 H5 Tab 栏

```
[全部] [B站] [YouTube] [知乎] [抖音] [小红书] [已隐藏]
```

- Tab 过多时横向滚动，当前选中 Tab 底部带高亮下划线。
- “已隐藏” Tab 视觉弱化（灰色文字）。

### 6.2 内容卡片

- 卡片右上角固定“×”隐藏按钮，点击区域 32×32px，颜色 `#9CA3AF`（灰 400），hover/active 变深。
- 点击隐藏按钮阻止冒泡，不触发卡片跳转。
- 隐藏操作前**不弹确认**，点击即生效（符合“快速过滤”场景）。

### 6.3 平台 Tag 配色

| 平台 | 中文名 | 品牌色 |
|---|---|---|
| bilibili | B站 | `#FB7299` |
| youtube | YouTube | `#FF0000` |
| zhihu | 知乎 | `#0066FF` |
| douyin | 抖音 | `#000000` |
| xiaohongshu | 小红书 | `#FF2442` |

---

## 7. 异常与边界处理

| 场景 | 处理方式 |
|---|---|
| 抖音短链解析失败 | `parse-url` 返回 `INVALID_URL`，提示“请检查抖音链接是否有效” |
| 抖音 RSSHub 被封 | 平台级短路，跳过整组，不更新 fail_count，记录日志并告警 |
| 知乎 RSSHub 不可达 | 同抖音平台级短路 |
| 小红书短链解析失败 | 同抖音 |
| 用户隐藏后 Cron 再次抓取到同一内容 | UPSERT 只更新 title/cover_url/original_url，is_display 保持 false |
| 用户隐藏 30 天后的内容 | 无变化，is_display 已是 false |
| 封面图 403（含 no-referrer） | 显示平台占位图 |
| 已隐藏 Tab 为空 | 展示空状态“暂无隐藏内容” |
| 匿名用户批量隐藏 | 按当前产品决策不拦截，后台可观测日志 |

---

## 8. 验收标准

- [ ] 5 个平台 URL 均可在管理端成功添加，不重复时返回 201，重复时返回 409。
- [ ] 知乎 people 和 column 类型在 `monitors` 表中 `native_type` 字段正确区分。
- [ ] B站内容卡片展示真实封面，失败时显示占位图。
- [ ] 知乎 / 抖音 / 小红书内容展示封面与标题。
- [ ] H5 隐藏按钮点击后卡片即时消失，且不会重新出现（防复活）。
- [ ] “已隐藏” Tab 可查看所有 `is_display=false` 的内容。
- [ ] 抖音抓取方案部署完成并至少连续 24 小时稳定运行。
- [ ] 生产环境不存在 Mock 数据写入。
- [ ] Deep Link 在系统浏览器中可唤醒对应 App，失败时弹兜底弹窗。
