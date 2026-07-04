# V1.1 代码 Review 报告（第三轮修复后审查）

> 审查范围：V1.1 迭代全部新增/修改代码（基于用户再次修复后的版本）  
> 对照依据：`SPEC.md`、`PRD_V1.1.md`、`V1.1_TASK_PLAN.md`  
> 审查维度：PRD 业务符合性、字段遗漏、状态遗漏、权限遗漏、异常场景遗漏、对已有功能的影响  
> 审查时间：2026-07-04

---

## 1. 核心结论

**本轮修复效果显著。上一版报告中的 3 个 P1 问题已全部解决，未发现新的 P0 级问题。**

当前 V1.1 代码在业务主链路（5 平台解析、抓取、隐藏、Deep Link、封面代理、防复活）上已符合 PRD 要求。剩余问题集中在 **P2/P3 级** 的文档同步、代码整洁、管理端体验优化和部署配置补全，不影响核心功能上线。

**建议**：修完剩余 P2 后即可进入集成测试；P3 可放上线后迭代。

---

## 2. P0 级问题

**无。**

---

## 3. P1 级问题修复验证

| 编号 | 问题 | 修复状态 | 验证说明 |
|---|---|---|---|
| P1-1 | 知乎 `article`/`answer` Deep Link schema 与 PRD 不符 | ✅ 已修复 | `packages/shared/src/constants/deep-link.ts:14-15` 已改为 `zhihu://zhuanlan/{native_id}` 和 `zhihu://answer/{native_id}` |
| P1-2 | YouTube `/c/` 自定义链接未支持 | ✅ 已修复 | `supabase/functions/parse-url/index.ts:168-214` 新增 `resolveYoutubeC`，通过 canonical / meta / JSON 三种方式解析 `/c/` 到 channelId |
| P1-3 | B站/YouTube `native_type` 与 PRD 不符 | ✅ 已修复 | B站返回 `native_type: "user"`（`parse-url/index.ts:124`），YouTube 返回 `native_type: null`（`index.ts:224`）；迁移 `014` 已扩展 CHECK 约束允许 `user` |

---

## 4. P2 级问题（建议修复）

### 4.1 `SPEC.md` 权限示例与当前实现不一致

| 项目 | 内容 |
|---|---|
| **问题** | `supabase/migrations/013` 将 `contents_anon_read` 放宽为 `USING (true)`，使匿名用户可读取所有 `is_display=false` 内容（含 30 天软删除）。但 `SPEC.md` 第 5.2 节示例仍写 `is_display=eq.true`（lines 303、306）。 |
| **风险等级** | **P2** |
| **影响** | 代码与 SPEC 文档不一致，新接手的开发者会按旧文档理解权限边界。 |
| **代码位置** | `SPEC.md:303-306`、`supabase/migrations/013_v1_1_allow_anon_read_hidden.sql:5-7` |
| **修改建议** | 在 SPEC 中新增 V1.1 权限变更说明：anon 已允许读取全部 contents（含已隐藏），但只能 UPDATE 将 `is_display` 改为 `false`；主 feed 通过前端/接口参数过滤 `is_display=true`。 |
| **是否影响已有功能** | 否，仅文档同步。 |

### 4.2 Admin 未展示新平台风控暂停状态

| 项目 | 内容 |
|---|---|
| **问题** | Cron 已在 `platform_configs` 中写入 `platform_status`（知乎/抖音/小红书），但 Admin 页面仅展示 B站 Cookie 状态，新平台被风控暂停时管理员无感知。 |
| **风险等级** | **P2** |
| **影响** | 管理员无法判断知乎/抖音/小红书抓取失败是配置问题还是被平台风控暂停，排错效率低。 |
| **代码位置** | `apps/admin/src/pages/MonitorList.tsx:88-108`（只查 `platform="bilibili"`） |
| **修改建议** | 在 B站 Cookie 状态卡片下方或平台筛选栏顶部，增加"平台风控状态"区域，遍历 `platform_configs` 中 `config_key='platform_status'` 且 platform 为 zhihu/douyin/xiaohongshu 的记录，显示暂停原因和恢复时间。 |
| **是否影响已有功能** | 否，纯展示增强。 |

### 4.3 `RSSHUB_API_KEY` 声明但未使用

| 项目 | 内容 |
|---|---|
| **问题** | `supabase/config.toml:388` 配置了 `RSSHUB_API_KEY`，但 Cron 适配器请求 RSSHub 时未在 header 中携带该 key；`.env.example` 中也没有该变量。 |
| **风险等级** | **P2** |
| **影响** | 若 RSSHub 实例启用了访问鉴权，所有新平台抓取会 401 失败；若未启用，则该 secret 为无效配置，造成混淆。 |
| **代码位置** | `supabase/config.toml:388`、`scripts/cron/src/adapters/zhihu.ts:66`、`xiaohongshu.ts:78`、`douyin.ts:60` |
| **修改建议** | 方案 A：在 RSSHub 请求头中增加 `Authorization: Bearer ${RSSHUB_API_KEY}`（或 RSSHub 实际要求的 header），并同步写入 `.env.example`。  <br>方案 B：如果当前 RSSHub 实例不鉴权，从 `config.toml` 和 `.env.example` 中移除 `RSSHUB_API_KEY`，避免误导。 |
| **是否影响已有功能** | 取决于 RSSHub 部署是否开启鉴权。 |

### 4.4 `EDGE_PROXY_LIST` 在 `parse-url` 中声明但未使用

| 项目 | 内容 |
|---|---|
| **问题** | `supabase/functions/parse-url/index.ts:30` 读取了 `EDGE_PROXY_LIST`，但函数内没有任何使用它的代码；`config.toml` 也未配置该 secret。 |
| **风险等级** | **P2** |
| **影响** | 存在 dead env 引用；若未来需要 Edge Function 侧走代理解析短链，当前代码不会生效。 |
| **代码位置** | `supabase/functions/parse-url/index.ts:30`、`supabase/config.toml:386-388` |
| **修改建议** | 要么在 `resolveRedirect` 中接入 `EDGE_PROXY_LIST`（对 B站/抖音/小红书短链解析使用代理），要么删除该变量读取。 |
| **是否影响已有功能** | 否。 |

### 4.5 知乎专栏 RSSHub 路由名与 PRD 不一致

| 项目 | 内容 |
|---|---|
| **问题** | PRD 4.1 写知乎专栏路由为 `/zhihu/column/:id`，代码中使用 `/zhihu/zhuanlan/:id`。 |
| **风险等级** | **P2** |
| **影响** | 文档/代码命名不一致，维护时容易误解。 |
| **代码位置** | `scripts/cron/src/adapters/zhihu.ts:55`、`zhihu.ts:176` |
| **修改建议** | 确认 RSSHub 实际可用路由：若实际路由为 `zhuanlan`，则同步更新 PRD；若实际路由为 `column`，则更新代码。 |
| **是否影响已有功能** | 否，若当前路由可用则功能正常。 |

### 4.6 小红书移动网页兜底请求缺少超时

| 项目 | 内容 |
|---|---|
| **问题** | 小红书 `fetchLatestFromMobileWeb` 未设置 `AbortController` 超时，若 `www.xiaohongshu.com` 挂起，会阻塞当前 monitor 的后续处理。 |
| **风险等级** | **P2** |
| **影响** | 极端网络异常下 Cron 单平台组执行时间不可控。 |
| **代码位置** | `scripts/cron/src/adapters/xiaohongshu.ts:139-154` |
| **修改建议** | 为移动网页兜底请求增加 10s 超时，与 RSSHub 主路径一致。 |
| **是否影响已有功能** | 否，提升稳定性。 |

---

## 5. P3 级问题（可后续优化）

### 5.1 `image-proxy` 未在 `config.toml` 中注册

`supabase/functions/image-proxy/` 目录已存在，但 `config.toml` 中缺少 `[functions.image-proxy]` 和 `verify_jwt = false` 配置。Supabase CLI 会自动发现函数，但显式注册更稳妥。

### 5.2 `monitors-query.ts` 注释过时

`scripts/cron/src/lib/monitors-query.ts:9` 注释仍写 `others = bilibili`，实际现在 `others` 包含 bilibili/zhihu/douyin/xiaohongshu。

### 5.3 H5 顶部 7 个 Tab 在窄屏下略显拥挤

已实现 `overflow-x-auto`，但 7 个 Tab 横向滚动体验一般。上线后可优化为底部固定 Tab 或下拉筛选。

---

## 6. 字段 / 状态 / 权限 / 异常遗漏检查

### 6.1 字段遗漏

| 字段/表 | 状态 | 说明 |
|---|---|---|
| `monitors.native_type` | ✅ 已添加 | 约束扩展为 `people/column/user`，B站用 `user`、知乎用 `people/column`、其余为空。 |
| `contents.is_display` | ✅ 复用 | 按产品决策复用，防复活机制通过 `upsertContent` 的 `columns` 参数保证。 |
| `platform_configs.platform_status` | ✅ 已添加 | 新平台反爬暂停状态已实现。 |
| `short_link_cache` 表 | ✅ 已添加 | 含 RLS policy。 |
| `image-proxy` Edge Function | ✅ 已添加 | 含 SSRF 白名单。 |

### 6.2 状态遗漏

| 状态场景 | 状态 |
|---|---|
| 新平台状态机 `normal → cookie_expired → rate_limited` | ✅ 正常 |
| 平台级短路暂停/恢复 | ✅ 正常 |
| 隐藏失败回滚 | ✅ 正常 |
| 隐藏与 30 天软删除共用 `is_display` | ✅ 按产品决策实现 |
| 删除 monitor 后隐藏内容归属 | ✅ `monitor_id` 为 NULL 时 fallback 到 `original_url` |
| 防复活机制 | ✅ `upsertContent` 不更新 `is_display` |
| RSSHub 主路径超时 | ✅ 知乎/抖音/小红书均已加 10s 超时 |

### 6.3 权限遗漏

| 权限点 | 状态 |
|---|---|
| anon 隐藏 `is_display` 改 false | ✅ 受限 |
| anon 恢复 `is_display` 改 true | ✅ 被阻止 |
| anon 读取 30 天软删除内容 | ✅ 按产品决策允许，但 SPEC 需同步 |
| `platform_configs_admin` 脱敏 | ✅ 已对 `cookie`/`proxy_list` 脱敏 |
| `short_link_cache` 访问控制 | ✅ 仅 service_role |
| `image-proxy` SSRF 防护 | ✅ 已加白名单 |

### 6.4 异常场景遗漏

| 异常场景 | 状态 |
|---|---|
| H5 隐藏 PATCH 失败 | ✅ 已回滚并 Toast |
| 连续点击隐藏 | ✅ `isHiding` 禁用 |
| 短链解析超时 | ✅ 10s timeout |
| RSSHub 空列表 | ✅ 视为成功 |
| 封面 403 | ✅ `image-proxy` 兜底 |
| 代理池全部失效 | ✅ 平台级短路 |
| 知乎 monitor 缺少 native_type | ✅ DB CHECK + Admin 校验 |
| 知乎 post Deep Link fallback | ✅ 已处理 |
| 小红书移动网页兜底超时 | ❌ 缺少 |

---

## 7. 对已有功能的影响

| 功能 | 影响 | 说明 |
|---|---|---|
| B站 抓取 | 无影响 | 核心逻辑未改动。 |
| YouTube 抓取 | 无影响 | 未改动。 |
| Admin 监控列表 | 轻微影响 | 新增平台筛选、native_type 展示；新平台风控状态未展示。 |
| H5 信息流 | 正面影响 | 新增 5 平台 Tab、隐藏功能、已隐藏 Tab、封面代理。 |
| 权限模型 | 显著影响 | anon 可读取所有 `is_display=false` 内容，包括 30 天软删除内容，需在 SPEC 中明确。 |
| 数据库结构 | 扩展影响 | 新增 `native_type`、扩展 platform 枚举、新增 `short_link_cache`、新增 `platform_status`。 |

---

## 8. 修复优先级建议

### 建议上线前修复（P2）
1. **同步更新 `SPEC.md`**：在权限章节说明 `contents_anon_read` 已放宽为 `USING (true)`，并解释与"已隐藏" Tab 的关系。
2. **Admin 展示新平台风控状态**：在 B站 Cookie 状态区域下方增加知乎/抖音/小红书暂停状态卡片。
3. **明确 `RSSHUB_API_KEY` 用法**：要么在 Cron 请求中携带，要么从配置中移除。
4. **清理 `EDGE_PROXY_LIST`**：要么在 `parse-url` 短链解析中实际使用，要么删除相关代码和 `config.toml` 配置。
5. **统一知乎专栏路由命名**：确认 RSSHub 实际路由后同步文档或代码。
6. **小红书移动网页兜底加 10s 超时**。

### 可上线后优化（P3）
7. 在 `config.toml` 中显式注册 `[functions.image-proxy]`。
8. 更新 `monitors-query.ts` 中 `others` 的注释。
9. H5 顶部 Tab 可优化为底部固定或下拉，提升移动端体验。

---

## 9. 总结

经过三轮修复，V1.1 代码已满足 PRD 的核心业务目标：

- 5 平台（B站/YouTube/知乎/抖音/小红书）添加与解析 ✅
- B站/全平台封面展示与防盗链兜底 ✅
- 用户主动隐藏与"已隐藏"查看入口 ✅
- 隐藏数据不物理删除、防复活 ✅
- 生产环境无 Mock 数据写入 ✅
- 知乎 `native_type` 与 Deep Link ✅
- 平台风控暂停与代理池 ✅

剩余问题均为文档、配置、管理端展示和细节稳定性，不构成上线阻塞。建议按 P2 清单修复后，进行一轮端到端测试（重点：知乎文章/回答 Deep Link、YouTube `/c/` 添加、各平台占位图颜色、Admin 风控状态）。