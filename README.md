# 多平台内容中枢

多平台内容中枢是一个用于聚合、抓取和管理多平台内容的项目，包含管理后台、H5 前台，以及基于 Supabase 的后端服务和 Edge Functions。

---

## 腾讯云服务器直连与部署配置 (Tencent Cloud Direct Deployment)

针对直接连接腾讯云服务器部署与运维的场景，关键参数与指令配置如下：

### 1. SSH 连接参数

| 参数项 | 配置值 | 说明 |
|---|---|---|
| **SSH Host / IP** | `124.222.54.39` | 腾讯云生产服务器公网 IP |
| **SSH 用户名** | `root` | 服务器最高管理员账号 |
| **SSH 端口** | `22` | 标准 SSH 端口 |
| **私钥 / 密码路径** | `~/.ssh/id_rsa` 或 `.pem` 文件 | 配合私钥 `ssh -i <私钥路径> root@124.222.54.39` (或使用本地 `~/.ssh/config`) |
| **真实秘钥保存规范** | `.env` / `.env.production` | 敏感秘钥存放在 `.env.production`，受 `.gitignore` 保护防止泄露 |

### 2. 服务器目录结构

| 目录/文件路径 | 用途描述 |
|---|---|
| `/opt/content-hub` | **服务器项目根目录** (执行 `git pull` 主路径) |
| `/opt/content-hub/.env.production` | **服务器生产环境变量文件** (存储服务级敏感 Key) |
| `/opt/content-hub/apps/h5/dist` | **H5 移动端前端静态目录** (域名 `https://mpchub.top`) |
| `/opt/content-hub/apps/admin/dist` | **Admin 管理端静态目录** (域名 `https://admin.mpchub.top`) |
| `/opt/content-hub/scripts/cron` | **定时抓取引擎服务目录** |

### 3. 服务托管与 Docker / PM2 启动方式

#### A. PM2 进程守护 (定时抓取引擎)
- **进程名称**：`content-hub-cron`
- **运行程序**：`/opt/content-hub/scripts/cron/dist/index.js`
- **重启/状态命令**：
  ```bash
  ssh root@124.222.54.39 "cd /opt/content-hub && git pull origin main && pnpm --filter @content-hub/cron build && pm2 restart content-hub-cron"
  ssh root@124.222.54.39 "pm2 status"
  ```

#### B. Docker Compose 容器服务 (RSSHub + Redis)
- **配置文件**：`/opt/content-hub/docker-compose.yml`
- **包含服务**：`rsshub` (1200 端口) + `redis`
- **启动/重新加载命令**：
  ```bash
  ssh root@124.222.54.39 "cd /opt/content-hub && docker compose --env-file .env.production up -d --force-recreate rsshub"
  ```

#### C. 前端 SPA 构建与上传部署
- **H5 端**：
  ```bash
  pnpm --filter h5 build && scp -r apps/h5/dist/* root@124.222.54.39:/opt/content-hub/apps/h5/dist/
  ```
- **Admin 端**：
  ```bash
  pnpm --filter admin build && scp -r apps/admin/dist/* root@124.222.54.39:/opt/content-hub/apps/admin/dist/
  ```

---

## 项目结构

- `apps/admin`：管理后台，负责用户、博主、内容、系统配置等管理能力 (访问域名 `admin.mpchub.top`)
- `apps/h5`：H5 前台，负责用户登录、订阅管理和内容浏览 (访问域名 `mpchub.top`)
- `supabase`：数据库迁移 (Migrations)、RLS 策略、Edge Functions
- `scripts/cron`：定时任务与运维相关脚本 (PM2 托管)
- `packages/shared`：前后端共享常量和类型 (`@content-hub/shared`)

---

## 核心文档

仓库里更详细的设计和部署说明，建议优先看这些文档：

- `PROJECT_CONTEXT.md`：项目长期性架构、技术选型与完整踩坑记录
- `Taskplan.md`：微步执行计划与自测标准
- `DIFY_MANUAL_SETUP.md`：Dify 手工安装与配置
- `DIFY_WORKFLOW_GUIDE.md`：Dify 工作流说明

---

## 技术栈

- React + TypeScript + Vite
- Supabase Cloud (PostgreSQL + PostgREST + Edge Functions)
- Docker / Docker Compose (自部署 RSSHub)
- PM2 (定时任务守护进程)
- 腾讯云 Nginx 反向代理

---

## 环境变量

各应用使用各自的 `.env.local` 或 `.env` / `.env.production` 文件提供环境变量。受 `.gitignore` 保护，切勿泄露真实秘钥。

常见环境变量：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `DIFY_API_URL`
- `DIFY_API_KEY`
- `YOUTUBE_API_KEY`
- `RSSHUB_URL`
- `TWITTER_AUTH_TOKEN`

---

## 安全提醒

- 仓库中的真实敏感秘钥存放在 `.env` 和服务器 `/opt/content-hub/.env.production` 中
- Git 严禁追踪任何秘钥明文
