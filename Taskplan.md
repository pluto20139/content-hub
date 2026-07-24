# 执行计划 (Taskplan.md)：多平台内容中枢 V2.0.0 极小微步分解

> 状态：已根据代码库实际现状全面修正（更新于 2026-07-24）  
> 基线说明：代码库中 `018_v2_0_multi_tenant.sql`、`H5Auth.tsx`、`getInitialUserId()` 和 `x.ts` (X/Twitter适配器) 已存在。本计划聚焦于补全超管体系、超管控制台重构与 H5 订阅管理。

---

## 阶段一：数据库与后端 API 网关基础建设

### Step 1: 超级管理员初始化与安全策略 (`019_admin_role.sql`)
- **前置现状**：`018_v2_0_multi_tenant.sql` 已完成 `user_id` 关联、`monitors_unique`/`contents_unique` 约束以及多租户查询索引（`idx_monitors_user_platform`、`idx_contents_user_display_published`）。
- **改动文件**：`supabase/migrations/019_admin_role.sql`
- **执行内容**：
  - 编写 Supabase SQL 脚本完成 `admin@mpchub.top` 账号在 Auth 中的创建与 `app_metadata.is_admin = true` 属性注入；
  - 补充超管 RLS 逻辑辅助函数 `is_admin()`，供边缘函数及 RLS 校验使用。
- **自测标准**：
  - 数据库能正常运行 Migration；
  - Supabase Auth 中存在 `admin@mpchub.top` 且带有 `app_metadata: { "is_admin": true }`。

### Step 2: 管理端安全网关 Edge Function (`supabase/functions/admin-api/index.ts`)
- **改动文件**：`[NEW] supabase/functions/admin-api/index.ts`
- **执行内容**：
  - 校验 Request Header 中的 JWT，通过 Supabase Auth 获取用户身份并严格匹配 `app_metadata.is_admin === true`；
  - 采用轻量 Action/Path 路由架构，支持以下管理员特权接口：
    - 读取类：`GET /stats`（全站 KPI 汇总）、`GET /users`（用户列表）、`GET /monitors`（全局博主列表）、`GET /contents`（全局内容库）；
    - 操作类：`POST /users/create`（开通新账号，使用 Service Role Key 调用 Supabase Auth Admin API）、`POST /settings/cron-trigger`（手动触发 Cron）。
- **自测标准**：
  - 部署函数 `npx supabase functions deploy admin-api`；
  - 使用普通用户 JWT 请求 `/stats` 返回 `403 Forbidden`；
  - 使用 `admin@mpchub.top` JWT 请求 `/stats` 返回正确的全站 200 JSON 数据。

---

## 阶段二：H5 移动端极简体验与独立全屏二级页

### Step 3: H5 匿名模式登录弹窗 (`LoginModal.tsx`)
- **前置现状**：`apps/h5/src/components/H5Auth.tsx` 已实现完整的登录/注册组件逻辑。
- **改动文件**：`[NEW] apps/h5/src/components/LoginModal.tsx`
- **执行内容**：
  - 基于 iOS 毛玻璃半透明遮罩设计弹窗容器，封装已有的 `H5Auth` 组件；
  - 接收 `isOpen`、`onClose` 与 `onSuccess(userId: string)` 回调，满足从 Feed 页面点击 ⚙️ 设置时的快捷唤醒。
- **自测标准**：
  - 组件引入后在 Feed 界面可顺畅弹窗唤起，支持登录与注册，成功后触发 `onSuccess` 并关闭弹窗。

### Step 4: H5 独立全屏二级订阅管理页 (`MyMonitors.tsx`)
- **改动文件**：`[NEW] apps/h5/src/pages/MyMonitors.tsx`
- **执行内容**：
  - **顶栏**：iOS 毛玻璃导航栏，提供 `← 返回信息流` 按钮与 `我的订阅` 标题；
  - **模块 1（添加订阅）**：URL 输入框 + 解析按钮，调用 `parse-url` 识别平台与 native_id，随后写入当前用户的 `monitors` 表；
  - **模块 2（订阅列表）**：展示当前用户订阅的博主，支持切换 `is_active` 状态、行内修改 `display_name`、删除确认；
  - **模块 3（账号中心）**：展示当前登录邮箱、一键复制 `https://mpchub.top?u=userId` 专属阅读链接、退出登录。
- **自测标准**：
  - 页面独立渲染良好，用户能成功添加新博主、修改昵称、开关激活状态与删除订阅。

### Step 5: H5 主入口与状态路由集成 (`App.tsx`)
- **前置现状**：`App.tsx` 已具备 `getInitialUserId()` 解析 `?u=` 参数功能。
- **改动文件**：`[MODIFY] apps/h5/src/App.tsx`
- **执行内容**：
  - 增加页面视图状态 `viewMode: 'feed' | 'monitors'`；
  - 顶栏右侧新增 ⚙️ 设置按钮：
    - 已登录状态：点击直接切换至 `MyMonitors` 二级全屏页；
    - 未登录（仅靠 `?u=` 浏览）状态：点击唤起 `LoginModal` 提示登录；
  - 从 `MyMonitors` 点击 `← 返回信息流` 时，自动刷新 Feed 中的 SWR 缓存数据。
- **自测标准**：
  - 场景 A（已登录）、场景 B（匿名 `?u=`）、场景 C（全新访问）三种状态下点击 ⚙️ 行为均符合预期；
  - 从订阅管理返回 Feed 后，最新添加的博主内容能即刻刷新展现。

---

## 阶段三：Admin 平台超级控制台重构

### Step 6: Admin 封闭式登录与 AuthGuard 强化 (`Login.tsx` & `AuthGuard.tsx`)
- **改动文件**：`[MODIFY] apps/admin/src/pages/Login.tsx`, `[MODIFY] apps/admin/src/components/AuthGuard.tsx`
- **执行内容**：
  - `Login.tsx`：移除“免费注册”切卡，定位为封闭式“多平台内容中枢 - 平台管理控制台”；
  - `AuthGuard.tsx`：在获取 Session 后，校验 `session.user.app_metadata?.is_admin === true`，非管理员强制调用 `signOut()` 并跳转至 `# /login` 提示“无超级管理权限”。
- **自测标准**：
  - 登录页无公开注册入口；
  - 普通用户账号尝试登录 Admin 会被强行登出并提示无权限。

### Step 7: Admin 侧边栏与 Layout 通用框架 (`Sidebar.tsx` & `Layout.tsx`)
- **改动文件**：`[NEW] apps/admin/src/components/Sidebar.tsx`, `[NEW] apps/admin/src/components/Layout.tsx`, `[MODIFY] apps/admin/src/App.tsx`
- **执行内容**：
  - 打造后台通用 Layout 布局，集成左侧固定 Sidebar 侧边栏与主内容区；
  - Sidebar 包含 5 大导航切卡：
    - `#/dashboard`（概览仪表盘）
    - `#/users`（用户管理）
    - `#/monitors`（全网博主）
    - `#/contents`（数据仓库）
    - `#/settings`（系统运维）
  - 响应 Hash 路由变化，实现高亮与跳转。
- **自测标准**：
  - 侧边栏在各 Hash 路由间切换自如，高亮状态准确。

### Step 8: Admin 概览仪表盘页面 (`Dashboard.tsx`)
- **改动文件**：`[NEW] apps/admin/src/pages/Dashboard.tsx`
- **执行内容**：
  - 请求 `admin-api` 的 `GET /stats` 接口，渲染全站 5 大核心 KPI 指标卡片（总用户数、总监控博主数、全站内容数、24H 新增数、异常博主数）；
  - 呈现 6 平台（B站、YouTube、知乎、抖音、小红书、X）的博主分布比例与系统最新抓取流水。
- **自测标准**：
  - 仪表盘能精准展示数据库真实的聚合统计数据。

### Step 9: Admin 用户管理与账号开通页面 (`UserList.tsx`)
- **改动文件**：`[NEW] apps/admin/src/pages/UserList.tsx`
- **执行内容**：
  - 列表展示全量系统用户（Email、注册时间、订阅博主数、专属 H5 链接）；
  - 提供 **【+ 开通新账号】** 模态框，管理员输入 Email 与初始密码后，调用 `admin-api` 的 `POST /users/create` 接口完成建号；
  - 支持一键复制该用户的专属 H5 链接 `https://mpchub.top?u=userId`。
- **自测标准**：
  - 管理员能顺畅创建新用户，创建后列表中即刻更新，一键复制专属链接正确。

### Step 10: Admin 跨租户全量博主中枢 (`MonitorList.tsx`)
- **改动文件**：`[MODIFY] apps/admin/src/pages/MonitorList.tsx`
- **执行内容**：
  - 将原有的单用户 MonitorList 升级为超级管理员视角，展示全网博主，增加【归属用户 Email】列；
  - 支持按平台、激活状态、归属用户搜索筛选；
  - 支持全局停用、启用、行内修改昵称与强行删除博主。
- **自测标准**：
  - 管理员可全局视角检索任意用户的博主，并可跨租户管理博主状态。

### Step 11: Admin 数据仓库与 AI 摘要管理 (`ContentList.tsx`)
- **改动文件**：`[NEW] apps/admin/src/pages/ContentList.tsx`
- **执行内容**：
  - 分页检索全站 `contents` 记录，支持标题关键字、平台、内容类型及 AI 摘要状态（pending/success/failed）多维筛选；
  - 实时预览 Dify AI 生成的摘要卡片；
  - 对 `summary_status = 'failed'` 的记录提供 **【重试 AI 摘要】** 按钮（调用 `retry-summary` Edge Function）；
  - 支持全局切换 `is_display` 显隐状态。
- **自测标准**：
  - 筛选与搜索响应迅速；重试按钮能成功将摘要状态重置为 `pending`。

### Step 12: Admin 系统设置与 Cron 运维面板 (`Settings.tsx`)
- **改动文件**：`[NEW] apps/admin/src/pages/Settings.tsx`
- **执行内容**：
  - **B站配置**：继承扫码登录功能（调用 `bilibili-auth`），展示 SESSDATA 状态；
  - **RSSHub 状态**：检测服务器本地 RSSHub 服务连通性；
  - **Cron 调度**：查看 `cron_locks` 运行锁状态，提供 **【手动强行触发抓取】** 按钮（调用 `admin-api` 的 `POST /settings/cron-trigger`）。
- **自测标准**：
  - 显示各服务与配额正常；点击强行触发能成功激活后台 Cron 流程。

---

## 阶段四：全量构建、生产部署与终极双端验收

### Step 13: Monorepo 编译与腾讯云生产部署
- **执行内容**：
  - 编译 shared 包：`pnpm --filter @content-hub/shared build`；
  - 构建部署 H5 端：`pnpm --filter h5 build` 并上传至 `/opt/content-hub/apps/h5/dist`；
  - 构建部署 Admin 端：`pnpm --filter admin build` 并上传至 `/opt/content-hub/apps/admin/dist`；
  - 部署 Edge Function `admin-api`；
  - Nginx 状态与 HTTPS 证书路由检查。
- **自测标准**：
  - **H5 验收 (`https://mpchub.top`)**：匿名访问、`?u=` 浏览、登录、进入 `MyMonitors` 增删改查全流程顺畅；
  - **Admin 验收 (`https://admin.mpchub.top`)**：`admin@mpchub.top` 登录，仪表盘、用户开通、全网博主管理、数据仓库摘要重试及系统运维功能全部正常。
