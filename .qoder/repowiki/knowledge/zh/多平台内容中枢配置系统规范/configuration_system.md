## 1. 系统概述
本项目采用**分层配置管理**策略，结合 **Supabase Vault**、**GitHub Secrets** 和 **Vercel Environment Variables** 实现敏感信息与运行时配置的隔离。核心原则是“前端零信任，后端最小化暴露”，通过 RLS（行级安全）和密钥层级严格控制配置访问权限。

## 2. 核心配置文件与位置
- **环境变量示例**: `.env.example` - 定义所有必需的环境变量模板。
- **Supabase 配置**: `supabase/config.toml` - 管理 Supabase 项目本地开发配置。
- **工作流配置**: `.github/workflows/cron-fetch.yml` - 定义 CI/CD 及定时任务的环境注入逻辑。
- **共享常量**: `packages/shared/src/constants/` - 存储平台标识、Deep Link Schema 等非敏感业务配置。

## 3. 配置分层架构
### 3.1 敏感凭证层 (Secrets)
- **GitHub Secrets**: 存储高权限密钥，如 `SUPABASE_SERVICE_ROLE_KEY`、`YOUTUBE_API_KEY`、`RSSHUB_API_KEY`。仅 GitHub Actions Cron 脚本和 Edge Functions 可访问。
- **Supabase Vault**: 存储动态敏感数据，如 B站 Cookie (`BILIBILI_COOKIE_*`)。通过 Edge Function 扫码获取后加密存入数据库，避免硬编码。
- **Vercel Env Vars**: 存储前端公开密钥 `SUPABASE_ANON_KEY` 及服务端构建所需的基础 URL。

### 3.2 业务配置层 (Database & Constants)
- **platform_configs 表**: 存储各平台的运行时配置（如代理 IP、API 端点），支持管理员在后台动态更新。
- **Shared Packages**: `@content-hub/shared` 包作为 Single Source of Truth，同步前后端的平台枚举、配色方案及 Deep Link 模板。

## 4. 开发者规范
- **命名约定**: 所有环境变量必须使用全大写蛇形命名法（如 `RSSHUB_URL`）。
- **安全红线**: 
  - `SUPABASE_SERVICE_ROLE_KEY` 严禁出现在前端代码或公开仓库中。
  - 第三方 API Key 必须通过 Secrets 注入，禁止硬编码在 `scripts/` 或 `apps/` 目录下。
- **配置同步**: 新增环境变量时，必须同步更新 `.env.example` 并在 `PROJECT_CONTEXT.md` 的“环境变量清单”中登记。
- **Edge Functions 限制**: Deno 环境无法直接读取 npm 包配置，需在 `_shared/` 目录下手动维护类型与常量副本，并标注同步来源。