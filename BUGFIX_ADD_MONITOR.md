# 添加博主失败修复记录

## 已修复的问题

### 1. 抖音短链解析失败 ✅
**文件**：`supabase/functions/parse-url/index.ts`

**改动**：
- 新增 `extractDouyinSecUid()`，支持从 `www.iesdouyin.com/share/user/...?sec_uid=...` 提取 `sec_uid`。
- 修复前代码只匹配 `douyin.com/user/...`，无法识别抖音短链实际重定向到的域名。
- 缓存类型从 `people` 改为 `sec_uid`，`monitors.native_type` 保持 `null`（符合数据库约束）。

**验证**：本地测试 `https://v.douyin.com/44EWedi56gw/` 可解析出 `MS4wLjABAAAA...`。

### 2. 小红书短链解析增强 ✅
**文件**：`supabase/functions/parse-url/index.ts`

**改动**：
- 短链解析器从只用 `HEAD` 改为 `HEAD` 失败时自动降级 `GET`。
- 新增 `extractXiaohongshuUserId()`，支持从 `www.xiaohongshu.com/user/profile/...` 和页面 HTML 中提取 `userId`。
- 优化错误提示：区分"短链失效"和"短链无法定位个人主页"。
- `monitors.native_type` 保持 `null`。

**注意**：用户提供的小红书短链 `https://xhslink.com/m/2hROLJex74z` 本身已失效/不是个人主页短链（HEAD 404），所以修复后仍会报错，但提示会更明确。如果用户换一个有效的小红书主页短链，现在可以解析。

### 3. Admin 输入框占位文案优化 ✅
**文件**：`apps/admin/src/pages/MonitorList.tsx`

**改动**：placeholder 从泛泛的"粘贴 B站/YouTube/知乎/抖音/小红书博主主页链接..."改为具体示例：
> 粘贴博主主页链接：B站(space.bilibili.com/xxx)、YouTube(@xxx)、知乎(zhihu.com/people/xxx)、抖音(v.douyin.com/xxx 或 douyin.com/user/xxx)、小红书(xhslink.com/xxx 或 xiaohongshu.com/user/profile/xxx)

---

## 未修复的问题

### 知乎添加后状态异常 ⏸️
截图中的知乎 monitor `知乎_0a88f900` 显示红色状态，说明 Cron 抓取失败。这个问题不在 `parse-url` 层，而是：
- RSSHub 是否已配置且可访问
- 知乎用户/专栏 ID 是否真实存在
- 知乎 RSSHub 路由是否被反爬/返回 404

**需要用户配合**：请提供一条你输入的知乎链接（完整 URL），并确认生产环境 `RSSHUB_URL` 已配置。我可以进一步排查 Cron 日志。

---

## 下一步

1. 部署 `supabase/functions/parse-url` 到 Supabase：
   ```bash
   supabase functions deploy parse-url
   ```
2. 重新测试抖音短链 `https://v.douyin.com/44EWedi56gw/` 添加。
3. 用一个有效的小红书主页短链重新测试小红书添加。
4. 提供知乎链接和 RSSHub 状态，继续排查知乎状态异常。
