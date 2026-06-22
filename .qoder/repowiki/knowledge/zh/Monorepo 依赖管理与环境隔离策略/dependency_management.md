## 1. 依赖管理系统
项目采用 **pnpm workspace** 管理的 Monorepo 架构，实现多应用（Admin/H5）、共享库（Shared）与脚本（Cron）的统一依赖管理。

- **包管理器**：`pnpm`，利用其硬链接机制节省磁盘空间并防止幽灵依赖（Phantom Dependencies）。
- **工作区配置**：通过根目录 `pnpm-workspace.yaml` 定义工作区范围，涵盖 `apps/*`、`packages/*` 和 `scripts/*`。
- **版本锁定**：使用 `--frozen-lockfile` 参数在 CI/CD（GitHub Actions）中确保依赖安装的确定性，防止因 `package.json` 语义化版本范围导致的意外升级。

## 2. 关键依赖与分层
依赖根据运行环境和职责进行严格分层：

| 层级 | 核心依赖 | 用途 |
| :--- | :--- | :--- |
| **前端 (Apps)** | `@supabase/supabase-js`, `react`, `vite` | 构建 SPA，通过 Anon Key 与 Supabase 交互。 |
| **共享 (Packages)** | `typescript` (dev) | 定义跨端共享的 TypeScript 类型与常量 (`@content-hub/shared`)。 |
| **后端脚本 (Scripts)** | `tsx`, `@supabase/supabase-js` | Node.js 环境下的定时抓取逻辑，使用 Service Role Key。 |
| **边缘函数 (Supabase)** | Deno 标准库, `@supabase/supabase` | Deno 运行时，处理轻量级业务逻辑（如 URL 解析）。 |

## 3. 敏感信息与环境变量管理
项目遵循“代码与配置分离”原则，严禁在代码库中硬编码敏感信息：

- **存储位置**：所有密钥（`SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `RSSHUB_API_KEY`）均存储在 **GitHub Secrets** 或 **Vercel Environment Variables** 中。
- **权限隔离**：
  - `SUPABASE_ANON_KEY`：仅用于前端，受 RLS（行级安全）策略约束。
  - `SUPABASE_SERVICE_ROLE_KEY`：仅用于 GitHub Actions Cron 脚本和 Edge Functions，绕过 RLS，拥有最高数据库权限。
- **本地开发**：提供 `.env.example` 作为模板，开发者需自行复制为 `.env` 并填充本地测试密钥。

## 4. 外部服务依赖治理
- **RSSHub 中转**：知乎内容抓取依赖独立部署的 RSSHub 实例，通过 `RSSHUB_URL` 和 `RSSHUB_API_KEY` 进行鉴权调用，避免直接面对知乎的高强度反爬。
- **平台 API 配额保护**：YouTube 适配器通过环境变量注入 API Key，并在脚本层实现降频逻辑（每 4 小时一次），以保护每日 10,000 units 的免费配额。

## 5. 开发者规范
1. **安装依赖**：始终在根目录执行 `pnpm install`，由 pnpm 自动链接工作区内的本地包。
2. **类型同步**：`packages/shared` 是类型的唯一数据源。Edge Functions 由于无法引用 npm 包，需在 `_shared/types.ts` 中手动维护副本并标注同步来源。
3. **CI 安装**：在 GitHub Actions 中必须使用 `pnpm install --frozen-lockfile` 以确保构建环境的一致性。