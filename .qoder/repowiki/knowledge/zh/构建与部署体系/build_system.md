## 1. 构建系统概览
本项目采用 **Monorepo** 架构，使用 **pnpm workspace** 进行多包管理。核心构建工具为 **Vite 5**（前端应用）和 **tsx/Node.js**（后端脚本）。项目未包含传统的 `Makefile` 或根级 `Dockerfile`，而是依赖云服务商（Vercel, Supabase, GitHub Actions）的托管与自动化能力。

## 2. 关键构建与部署组件

### 2.1 前端构建 (Vite + React)
- **工具**: Vite 5, TypeScript, Tailwind CSS
- **应用**: 
  - `apps/admin`: 配置管理端 SPA
  - `apps/h5`: 用户端 H5 SPA
- **部署**: 静态资源托管于 **Vercel**。构建过程由 Vercel 自动触发（基于 Git 推送），无需本地手动执行 `build` 命令。

### 2.2 后端自动化 (GitHub Actions)
- **调度器**: GitHub Actions (`cron-fetch.yml`)
- **频率**: 每 30 分钟触发一次 (`*/30 * * * *`)
- **执行环境**: `ubuntu-latest`, Node.js 20
- **构建流程**:
  1. Checkout 代码
  2. Setup Node.js & pnpm
  3. `pnpm install --frozen-lockfile`
  4. `pnpm --filter cron tsx src/index.ts` (直接运行 TypeScript 脚本，无需预编译)

### 2.3 数据库与边缘计算 (Supabase)
- **迁移管理**: SQL 脚本位于 `supabase/migrations/`，通过 Supabase CLI 或 Dashboard 应用。
- **边缘函数**: Deno TypeScript 位于 `supabase/functions/`。采用 "fat functions" 模式，共享代码置于 `_shared` 目录（不部署）。
- **部署**: 通过 Supabase CLI (`supabase functions deploy`) 或 Dashboard 手动/CI 部署。

### 2.4 外部服务 (RSSHub)
- **部署方式**: Docker 容器
- **平台**: Railway 或 Fly.io
- **配置**: 需启用 `ACCESS_CONTROL` (API Key) 以保障安全。

## 3. 开发约定与工作流

### 3.1 依赖管理
- **包管理器**: 强制使用 `pnpm`。
- **Workspace**: 根目录 `pnpm-workspace.yaml` 定义工作区。
- **共享类型**: `packages/shared` 作为前后端类型的唯一数据源 (Single Source of Truth)。

### 3.2 环境变量管理
- **敏感信息**: `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY` 等严禁硬编码。
- **存储位置**: 
  - 前端: Vercel Environment Variables
  - Cron: GitHub Secrets
  - 本地: `.env` (参考 `.env.example`)

### 3.3 版本与发布
- **前端**: 随 Git 推送到主分支自动部署至 Vercel。
- **Cron 脚本**: 随 Git 推送更新，下次定时任务自动拉取最新代码执行。
- **数据库**: 迁移脚本需手动或通过 CI 应用到 Supabase 实例。

## 4. 开发者注意事项
1. **无本地 Docker 构建**: 除 RSSHub 外，核心业务逻辑不依赖本地 Docker 构建。
2. **TypeScript 直跑**: Cron 脚本使用 `tsx` 直接运行 `.ts` 文件，简化了构建步骤。
3. **Edge Functions 同步**: Deno 环境无法引用 npm 包，需手动同步 `packages/shared` 中的类型到 `supabase/functions/_shared/`。
4. **互斥锁**: Cron 任务依赖 PostgreSQL `pg_advisory_lock` 实现互斥，无需额外部署 Redis。