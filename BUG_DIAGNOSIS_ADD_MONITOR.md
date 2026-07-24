# 添加小红书/知乎/抖音博主失败诊断报告

## 诊断结论速览

| 问题 | 根因 | 风险等级 | 修复复杂度 |
|---|---|---|---|
| 抖音短链添加失败 | 短链重定向到 `www.iesdouyin.com/share/user/...?sec_uid=...`，代码正则只匹配 `douyin.com/user/...` | **P0** | 低 |
| 小红书短链添加失败 | 用户提供的 `xhslink.com/m/...` 返回 404/无效页面，不是用户主页短链；错误提示不够精确 | **P1** | 中 |
| 知乎添加后状态异常 | 添加成功但 Cron 抓取失败，状态进入 `rate_limited`；具体原因需看 RSSHub 日志 | **P1** | 中 |

---

## 1. 抖音：短链解析失败

### 1.1 现象
输入 `https://v.douyin.com/44EWedi56gw/`，Admin 提示：

> 请粘贴抖音个人主页链接

### 1.2 现场复现
用 iPhone UA 请求该短链，得到如下重定向链：

```http
HTTP/2 302
location: https://www.iesdouyin.com/share/user/MS4wLjABAAAAEmvQHM6FnoEYhF13w5HFVYX9s0Ygatmf53DDsGv3jgM?from_ssr=1&...&sec_uid=MS4wLjABAAAAEmvQHM6FnoEYhF13w5HFVYX9s0Ygatmf53DDsGv3jgM&...
```

注意：抖音短链**不是**跳到 `www.douyin.com/user/<sec_uid>`，而是跳到 `www.iesdouyin.com/share/user/...?sec_uid=...`。

### 1.3 代码缺陷
`supabase/functions/parse-url/index.ts`：

```ts
const DOUYIN_USER_RE = /douyin\.com\/user\/([^/?#]+)/;
```

该正则有三个问题：
1. 只匹配 `douyin.com/user/...` 路径形式，**无法匹配** `iesdouyin.com/share/user/...`。
2. 从 `iesdouyin.com/share/user/...` 路径中正则匹配到的是 `share`，不是 `sec_uid`。
3. 没有从 URL 查询参数中读取 `sec_uid`。

因此 `parseDouyin` 中的 `DOUYIN_USER_RE.exec(resolvedUrl)` 返回 `null`，最终提示"请粘贴抖音个人主页链接"。

### 1.4 修复建议
修改 `parseDouyin` 的解析逻辑：

1. 支持从 `iesdouyin.com/share/user/...?sec_uid=...` 的查询参数中提取 `sec_uid`。
2. 兜底仍支持 `douyin.com/user/<sec_uid>` 路径形式。
3. 短链缓存表 `short_link_cache` 的 `resolved_type` 应统一使用 `"sec_uid"`（与当前 `"people"` 不一致，会导致 Cron 侧也混用）。

伪代码：

```ts
function extractDouyinSecUid(url: string): string | null {
  const parsed = new URL(url);
  const secUid = parsed.searchParams.get("sec_uid");
  if (secUid) return secUid;
  const pathMatch = parsed.pathname.match(/\/user\/([^/?#]+)/);
  if (pathMatch) return pathMatch[1];
  return null;
}
```

---

## 2. 小红书：短链无效或格式不支持

### 2.1 现象
输入 `https://xhslink.com/m/2hROLJex74z`，Admin 提示：

> 无法解析该小红书短链接，请使用完整链接

### 2.2 现场复现

**HEAD 请求：**
```http
HTTP/2 404
```

**GET 请求：**
返回小红书 H5 落地页（`window.__INITIAL_STATE__` 中用户数据为空），并未重定向到 `www.xiaohongshu.com/user/profile/...`。

### 2.3 根因判断
该短链本身**不是有效的个人主页短链**或**已过期**。小红书短链通常有：
- 笔记短链：`xhslink.com/a/...`、`xhslink.com/m/...`，解析到单篇笔记
- 用户主页短链：App 内分享用户主页时，通常也有短链，但可能路径不同

当前代码只支持短链解析到 `xiaohongshu.com/user/profile/...`。如果短链本身不指向用户主页，解析失败是正确行为，但提示语太模糊，用户不知道该换什么链接。

### 2.4 修复建议

1. **增强错误提示**：
   - 短链 HTTP 404 → "该短链已失效或不存在，请重新获取"
   - 短链重定向到首页/非用户页 → "该短链指向的不是小红书个人主页，请使用 'www.xiaohongshu.com/user/profile/xxx' 链接"

2. **支持更多小红书短链模式**：
   - 如果短链最终解析到笔记详情页，可尝试从页面 HTML 中提取 `userId` 并返回用户主页（但依赖页面结构，易变）。
   - 至少应记录解析后的真实 URL，便于排查。

3. **在 Admin 输入框 placeholder 增加示例**：
   - 例如：`https://www.xiaohongshu.com/user/profile/5f...` 或 `https://xhslink.com/xxxxx`

---

## 3. 知乎：添加成功但状态异常

### 3.1 现象
截图中已有一条知乎 monitor：`知乎_0a88f900`，状态为 🔴（红色，即 `rate_limited`）。

### 3.2 代码分析
`parse-url` 对知乎只是简单解析 URL，返回 fallback displayName：

```ts
if (ZHIHU_PEOPLE_RE.exec(url)) {
  native_id = peopleId;
  displayName = `知乎用户_${peopleId}`;  // 截图中看到的名字
  native_type = "people";
}
```

所以"知乎_0a88f900"这个名字**符合预期**（代码没有去知乎服务器获取真实昵称），不是问题本身。

### 3.3 状态异常原因
Cron 执行后，该 monitor 被标记为 `rate_limited`（红色），说明连续失败 ≥3 次。可能原因：

1. **RSSHub 未配置或不可达**：`RSSHUB_URL` 环境变量为空，或 `supabase/functions/parse-url` 的 `RSSHUB_URL` secret 未设置。
2. **RSSHub 路由问题**：`scripts/cron/src/adapters/zhihu.ts` 使用 `/zhihu/people/activities/${cleanId}` 或 `/zhihu/zhuanlan/${cleanId}`，如果 RSSHub 实例不支持该路由或返回 404，会失败。
3. **用户 ID 不存在**：`0a88f900` 这个 ID 可能不是真实用户（但用户输入什么不得而知）。
4. **网络/代理问题**：知乎 RSSHub 路由需要代理，如果 `ZHIHU_PROXY_LIST` 未配置或代理失效，会失败。

### 3.4 修复建议

1. **添加时预校验**：在 Admin 点击"添加"后，先让 `parse-url` 或 Cron 侧做一次 RSSHub 探测，确认该用户/专栏可访问，再入库。避免添加无效 monitor。
2. **Admin 显示平台状态**：如果 RSSHub 未配置或平台暂停，添加/列表页应给出明显提示。
3. **检查 `RSSHUB_URL` 配置**：确认腾讯云服务器 `.env.production` 和 Supabase Edge Function Secrets 都已设置。
4. **Cron 抓取日志记录**：把每次失败的完整错误信息写入表或日志，便于排查是路由 404、网络超时还是反爬。

---

## 4. 其他发现

### 4.1 `parse-url` 短链缓存的 key 不一致
- 抖音：用 `url` 作为 short_code（合理）。
- 小红书：用 `url` 作为 short_code（合理）。
- 但缓存的 `resolved_type` 对抖音是 `"people"`，对小红书是 `"people"`，而抖音实际应使用 `"sec_uid"`。

### 4.2 HEAD 请求可能不被所有短链服务支持
抖音用 HEAD 可以拿到 302；小红书用 HEAD 返回 404。建议短链解析失败时，降级为 GET 请求并跟随重定向，提高兼容性。

### 4.3 缺少错误日志收集
当前 `parse-url` 只在 console.error 输出日志，生产环境难以排查。建议把解析失败的关键信息（原始 URL、最终 URL、错误码）写入 `short_link_cache` 或一张日志表。

---

## 5. 修复计划

### 5.1 P0：修复抖音短链解析
**文件**：`supabase/functions/parse-url/index.ts`

1. 新增 `extractDouyinSecUid(url)`，优先从 `sec_uid` 查询参数提取，其次从 `/user/<sec_uid>` 路径提取。
2. 修改 `DOUYIN_USER_RE` 或改用 `URL` 解析。
3. 抖音缓存 `resolved_type` 统一为 `"sec_uid"`。
4. 确保重定向后的 URL 包含 `sec_uid` 时也能正确入库。

**验收**：用 `https://v.douyin.com/44EWedi56gw/` 添加成功，native_id 为 `MS4wLjABAAAA...`。

### 5.2 P1：增强小红书短链解析与错误提示
**文件**：`supabase/functions/parse-url/index.ts`

1. 短链解析失败时，根据 HTTP 状态码/最终 URL 给出更精确的错误提示。
2. 对 `xhslink.com` 的多种路径尝试解析；如果最终不是 `user/profile/...`，明确告知用户。
3. 在 Admin placeholder 增加完整链接示例。

### 5.3 P1：知乎添加校验与状态提示
**文件**：`supabase/functions/parse-url/index.ts`、`apps/admin/src/pages/MonitorList.tsx`

1. 添加知乎 monitor 时，先用 RSSHub 探测一次 `people/activities` 或 `zhuanlan` 路由是否 200。
2. 探测失败则阻止入库，并提示"该知乎主页/专栏无法访问，请检查链接或 RSSHub 配置"。
3. Admin 平台筛选下方增加平台状态展示（如 RSSHub 未配置、平台暂停等）。

### 5.4 P2：统一短链解析降级策略
**文件**：`supabase/functions/parse-url/index.ts`

1. `resolveRedirect` 支持 HEAD 失败时自动降级为 GET。
2. 记录解析失败日志到 `short_link_cache` 或新表 `short_link_parse_logs`。

---

## 6. 验证步骤

1. 本地启动 Supabase Edge Functions：
   ```bash
   supabase functions serve parse-url --env-file ./supabase/.env.local
   ```
2. 测试抖音短链：
   ```bash
   curl -X POST http://localhost:54321/functions/v1/parse-url \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://v.douyin.com/44EWedi56gw/"}'
   ```
   期望返回：`platform: douyin`，`native_id` 为 `MS4wLjABAAAA...`。
3. 测试小红书无效短链：
   ```bash
   curl -X POST http://localhost:54321/functions/v1/parse-url \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://xhslink.com/m/2hROLJex74z"}'
   ```
   期望返回：明确提示"该短链无法定位到个人主页，请使用完整链接"。
4. 测试知乎链接：确保 `RSSHUB_URL` 已配置，再用真实知乎主页/专栏链接测试添加。

---

## 7. 影响评估

- **对已有功能的影响**：仅修改 `parse-url` 和 Admin 校验，不影响 B站/YouTube 现有逻辑。
- **数据库影响**：如需新增日志表，需要一条迁移；否则无需数据库改动。
- **上线风险**：抖音修复是低风险纯解析逻辑调整；小红书/知乎需要真实环境验证 RSSHub 和短链行为。
