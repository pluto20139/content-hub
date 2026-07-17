# 腾讯云服务器连接与运维指南 (SERVER_README)

本项目部署在腾讯云国内服务器上。以下是连接服务器、常用运维操作以及环境配置的详细说明。

---

## 1. 如何连接服务器

由于您的本地 Mac 电脑上已配置并授权了 SSH 密钥（`~/.ssh/id_rsa`），您在连接服务器时**不需要输入任何密码或 Token 令牌**，即可直接通过密钥安全登录。

### 终端一键连接命令
在您的本地电脑终端（Terminal）中，直接执行以下命令：
```bash
ssh root@124.222.54.39
```

### 基础连接信息汇总
* **服务器公网 IP 地址**：`124.222.54.39`
* **SSH 登录用户名**：`root`
* **SSH 端口**：`22`
* **认证方式**：SSH 密钥对（本地私钥：`~/.ssh/id_rsa`，已自动绑定云端授权）

---

## 2. 项目部署路径及结构

登录服务器后，项目所在的代码和运行根目录为：
```bash
cd /opt/content-hub
```

### 常用运行服务与管理 (PM2)
后台的爬虫定时任务和 Dify 同步任务由 **PM2** 守护进程管理。

* **查看运行状态**：
  ```bash
  pm2 status
  ```
* **查看定时任务实时输出日志**：
  ```bash
  pm2 logs content-hub-cron
  ```
* **手动热重载服务（重新加载最新环境变量与代码）**：
  ```bash
  pm2 reload content-hub-cron --update-env
  ```

---

## 3. 环境变量与凭证密钥 (Tokens)

服务器环境运行配置文件存放在项目根目录下的 `.env.production` 中：
```bash
# 查看云服务器上的生产环境配置
cat /opt/content-hub/.env.production
```

### 关键系统密钥与连接 Token
如果您需要在本地或服务器上操作相关第三方云服务，以下是项目正在使用的 Token 信息：

* **Supabase 数据库连接信息**：
  * **API 地址 (URL)**：`https://betbudnsetunpmdhjipo.supabase.co`
  * **服务角色管理 Token (SERVICE_ROLE_KEY)**：`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJldGJ1ZG5zZXR1bnBtZGhqaXBvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjEwMTU2OSwiZXhwIjoyMDk3Njc3NTY5fQ.ttIZtxFRiXWA39aMe_qR5i1mFh8qWlGbRlGXECkP72k` （具备数据库最高读写 RLS 旁路权限）
* **Dify 平台 API 密钥**：
  * **API URL**：`https://api.dify.ai/v1`
  * **Workflow Token (DIFY_API_KEY)**：`app-gy0u9u8f2AkavLHigwWCDA0F`
* **YouTube Data API Key**：
  * **Token Key**：`AIzaSyBfVzR9KCwvIVXSJjYoMstieowOZOZyfBo`

---

## 4. 常见问题排查命令

### 检查 Nginx 静态网页服务状态
前端 H5 页面由 Nginx 托管分发：
```bash
# 检查 Nginx 配置文件是否正确
nginx -t

# 重启 / 重载 Nginx 服务
systemctl reload nginx
```

### 检查本地自建 RSSHub 服务状态
知乎与小红书的爬取依赖于服务器本地 Docker 运行的 RSSHub 容器：
```bash
# 查看 RSSHub 容器是否在运行
docker ps | grep rsshub

# 查看 RSSHub 运行日志
docker logs -f rsshub
```
