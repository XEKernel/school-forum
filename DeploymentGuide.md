# 校园论坛系统服务器部署指南

本文档指导您将校园论坛系统部署到 Ubuntu 服务器上，并使用清华大学开源软件镜像源加速软件下载。

> 相关仓库：服务端本仓库 [XEKernel/school-forum](https://github.com/XEKernel/school-forum) · Android 客户端 [XEKernel/school-forum-android](https://github.com/XEKernel/school-forum-android)

---

## 快速开始（推荐）

### 一键部署（首次安装）

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本将自动完成：系统环境检查 → Node.js 安装 → MongoDB/Redis 安装 → 交互式配置 → PM2 启动。

### 配置向导（已有环境）

如果服务器已有 Node.js / MongoDB / Redis，仅需修改配置：

```bash
chmod +x setup.sh
./setup.sh
```

支持的配置操作：

| 模式 | 功能 |
|-----|------|
| 交互式配置 | 逐一输入管理员 IP、CORS、SMTP 等 |
| 快速配置 | 基础配置（管理员注册后用 `scripts/promote-admin.js` 提权） |
| 查看配置 | 显示当前 .env 和 config.json 内容 |
| 智能更新 IP | 自动检测 192.168.x.x 内网地址并写入 |

> 配置向导**不会覆盖已有配置**，仅更新你指定的部分，并自动备份原文件。

---

## 1. 前提条件
- 一台运行 Ubuntu 20.04 或更高版本的服务器（本文以 Ubuntu 20.04/22.04 为例）。
- 拥有服务器的 SSH 访问权限（用户名和密码或密钥）。
- 本地已配置好的论坛项目压缩包（如 `forum.zip` 或 `forum.tar.gz`），其中已包含正确的配置文件（如数据库连接、邮箱 SMTP 等）。
- 基本熟悉 Linux 命令行操作。

---

## 2. 连接服务器
使用 **MobaXterm**（或其他 SSH 客户端）连接到您的服务器：
- 打开 MobaXterm，点击“Session” -> “SSH”。
- 输入服务器 IP 地址和用户名（例如 `ubuntu` 或 `root`），点击“OK”。
- 输入密码或使用密钥登录。

---

## 3. 配置系统软件源为清华源（可选但推荐）
为了加快软件包下载速度，可将 Ubuntu 的 apt 源更换为清华大学镜像源。

### 3.1 备份原 sources.list
```bash
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
```

### 3.2 替换为清华源
根据您的 Ubuntu 版本，执行以下命令自动替换（以 20.04 和 22.04 为例）：
```bash
# 如果是 Ubuntu 20.04 (focal)
sudo sed -i 's/archive.ubuntu.com/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list
sudo sed -i 's/security.ubuntu.com/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list

# 如果是 Ubuntu 22.04 (jammy)，同样适用以上命令（因为域名结构相同）
```
或者直接使用清华源提供的脚本（需联网）：
```bash
# 自动检测版本并替换
curl -s https://mirrors.tuna.tsinghua.edu.cn/help/ubuntu/ | sudo bash
```

### 3.3 更新软件包列表
```bash
sudo apt update
sudo apt upgrade -y   # 可选，升级所有软件包
```

---

## 4. 安装基础工具
```bash
sudo apt install -y curl git unzip tar
```

---

## 5. 安装 Node.js 24（使用清华镜像）

### 5.1 安装 nvm（Node Version Manager）
```bash
# 使用清华镜像加速下载 nvm 安装脚本
export NVM_NODEJS_ORG_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/
curl -o- https://gitee.com/mirrors/nvm/raw/master/install.sh | bash
```
> 注：如果直接使用官方 nvm 安装脚本（raw.githubusercontent.com）可能较慢，这里使用了 Gitee 上的镜像。

安装完成后，重新加载环境变量：
```bash
source ~/.bashrc
```

### 5.2 使用 nvm 安装 Node.js 24
```bash
# 设置 Node.js 下载镜像为清华源（加速二进制下载）
export NVM_NODEJS_ORG_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/
nvm install 24
nvm alias default 24
```

### 5.3 验证安装
```bash
node -v   # 应输出 v24.14.0 或类似
npm -v    # 应输出 11.9.0 或类似
```

### 5.4 配置 npm 使用国内镜像（可选但推荐）
```bash
npm config set registry https://registry.npmmirror.com
```
> 说明：使用淘宝 NPM 镜像（已迁移至 npmmirror），国内访问速度快。

---

## 6. 安装 MongoDB（使用清华镜像）

### 6.1 导入 MongoDB 公钥
```bash
sudo apt install -y gnupg
curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/ubuntu/pool/main/m/mongodb-org/ | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server.gpg
```
> 注：清华镜像站也提供了 MongoDB 的公钥，但直接使用官方公钥亦可，此处为统一镜像，可改用从清华下载公钥。为简化，可直接使用官方公钥（官方公钥下载也很快）：
```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-6.0.gpg
```

### 6.2 添加 MongoDB 清华源
```bash
. /etc/os-release
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
```

### 6.3 更新并安装 MongoDB
```bash
sudo apt update
sudo apt install -y mongodb-org
```

### 6.4 启动 MongoDB 并设置开机自启
```bash
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 6.5 检查 MongoDB 运行状态
```bash
sudo systemctl status mongod
```

### 6.6 备用方案：若 CPU 不支持 AVX2 指令集（安装 MongoDB 4.4.30）
某些旧款 CPU 不支持 AVX2，MongoDB 6.0 无法运行。此时请安装 4.4.30 版本：

1. 添加 4.4 清华源：
   ```bash
   . /etc/os-release
   echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-4.4.gpg ] https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
   ```
   （需要先导入 4.4 公钥，可从官方或清华获取）
2. 更新并安装指定版本：
   ```bash
   sudo apt update
   sudo apt install -y mongodb-org=4.4.30 mongodb-org-server=4.4.30 mongodb-org-shell=4.4.30 mongodb-org-mongos=4.4.30 mongodb-org-tools=4.4.30
   ```
3. 启动并设置开机自启。

---

## 7. 安装 Redis（可选）
如果您的论坛系统使用 Redis 存储会话或验证码，建议安装。
```bash
sudo apt install -y redis-server
sudo systemctl start redis
sudo systemctl enable redis
```
验证 Redis 运行：
```bash
sudo systemctl status redis-server
```

---

## 8. 上传项目代码
1. 在 MobaXterm 左侧的文件浏览器中，导航到您希望存放项目的目录（例如 `/home/你的用户名/`）。  
   **注意**：将“你的用户名”替换为实际的服务器用户名，或直接使用 `cd ~` 进入家目录。

2. 从本地 Windows 文件夹中直接拖拽项目压缩包（如 `forum.zip`）到该目录。

3. 解压文件：
   ```bash
   # 如果是 zip 包
   unzip forum.zip -d forum   # 将内容解压到 forum 文件夹
   # 如果是 tar.gz 包
   tar -xzf forum.tar.gz
   ```
   解压后进入项目目录：
   ```bash
   cd forum   # 根据实际解压出的文件夹名调整
   ```

---

## 9. 安装 Node.js 依赖
在项目目录下执行：
```bash
npm install
```
由于已配置 npm 国内镜像，依赖下载速度会明显提升。

---

## 10. 测试运行
在项目目录下启动论坛应用（请根据实际入口文件调整，常见为 `server.js` 或 `app.js`）：
```bash
node server.js
# 或
npm start
```
如果控制台输出类似 `Server running on port 3000` 的信息，说明运行成功。  
此时可以暂时关闭终端（按 `Ctrl+C` 停止），进入下一步持久化运行。

---

## 11. 使用 PM2 持久化运行
PM2 可以让 Node.js 应用在后台运行，并在服务器重启后自动启动。

### 11.1 安装 PM2
```bash
sudo npm install -g pm2
```

### 11.2 启动应用
请确认项目的入口文件名（如 `server.js`、`app.js`、`index.js`）。以下以 `server.js` 为例：
```bash
pm2 start server.js --name forum
```
- `--name forum` 指定进程名为 `forum`，便于管理。

### 11.3 保存当前进程列表
```bash
pm2 save
```

### 11.4 设置开机自启
```bash
pm2 startup
```
执行后，终端会输出一行带有 `sudo env` 的命令，**请复制并执行该命令**。例如：
```
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u 你的用户名 --hp /home/你的用户名
```
执行完成后，PM2 将在系统启动时自动恢复进程。

### 11.5 常用 PM2 命令
- 查看运行状态：`pm2 status`
- 查看日志：`pm2 logs forum`
- 重启应用：`pm2 restart forum`
- 停止应用：`pm2 stop forum`

---

## 12. 防火墙放行应用端口
假设您的论坛运行在 3000 端口，执行：
```bash
sudo ufw allow 3000/tcp
```
如果启用了 UFW 防火墙，还需确保 SSH 端口（22）已放行，以免断开连接：
```bash
sudo ufw allow 22/tcp
sudo ufw enable   # 如果 UFW 未启用
```

---

## 13. 访问论坛
在浏览器中输入 `http://你的服务器IP:3000`，即可看到论坛首页。

---

## 14. 常见问题排查

### 14.1 MongoDB 连接失败
- 检查 MongoDB 是否运行：`sudo systemctl status mongod`
- 确认项目配置文件（如 `config.json`）中的数据库连接字符串是否正确，例如：
  ```json
  "mongodb": {
    "uri": "mongodb://localhost:27017/school-forum",
    "username": "",
    "password": "",
    "authSource": "admin"
  }
  ```
- 如果 MongoDB 启用了认证，需要填写 `username` 和 `password` 字段
- 检查 MongoDB 端口（默认 27017）是否被占用或防火墙阻止
- 可通过环境变量覆盖配置：`MONGODB_URI`、`MONGODB_USERNAME`、`MONGODB_PASSWORD`

### 14.2 邮件发送失败
- 确认邮箱已开启 SMTP 服务并生成**授权码**（QQ 邮箱：设置 → 账户 → 开启 SMTP；网易 163 同样需要授权码）。
- 在 `.env` 中正确配置发件信息：`SMTP_HOST`（如 `smtp.qq.com` 或 `smtp.163.com`）、
  `SMTP_PORT`（SSL 用 465）、`SMTP_SECURE=true`、`SMTP_USER`（邮箱账号）、
  `SMTP_PASS`（**授权码**，非登录密码）。
- 检查服务器能否访问外网（如 `ping smtp.qq.com`）。

### 14.3 Redis 连接失败
- 检查 Redis 运行状态：`sudo systemctl status redis-server`
- 查看 `redisUtils.js` 或配置文件中 Redis 连接参数（默认无密码，主机 127.0.0.1:6379）。

### 14.4 图片上传失败
- 确保 `public/images` 目录存在且有写权限：
  ```bash
  mkdir -p public/images
  chmod 755 public/images
  ```
- 检查 `config.json` 中的上传限制（如文件大小、允许类型）是否合理。

### 14.5 管理员后台无法访问（权限问题）
- 确认您的用户 UUID 已加入 `adminUsers`（首次部署运行 `node scripts/promote-admin.js <QQ或用户ID>` 提权）。
- 重启应用使配置生效：`pm2 restart forum`

### 14.6 PM2 启动后无法访问
- 检查应用是否监听正确的端口：`pm2 logs forum` 查看错误日志。
- 确认防火墙已放行该端口。
- 检查是否使用了 `0.0.0.0` 作为监听地址（有些框架默认只监听 `127.0.0.1`，需修改为 `0.0.0.0` 才能对外访问）。

### 14.7 QQ 快捷登录（可选功能）配置
- QQ 快捷登录为**可选功能，默认不启用**；不配置不影响系统，登录页仅使用邮箱注册/登录。
- 启用步骤：
  1. 在 [QQ 互联](https://connect.qq.com) 注册开发者并创建**网站应用**（需实名认证）。
  2. 在 QQ 互联后台配置授权回调地址，必须与 `QQ_REDIRECT_URI` 完全一致，
     格式为 `https://你的域名/api/auth/qq/callback`。
  3. 在 `.env` 填写：
     ```
     QQ_APP_ID=你的AppID
     QQ_APP_SECRET=你的AppSecret
     QQ_REDIRECT_URI=https://你的域名/api/auth/qq/callback
     ```
  4. 重启服务：`pm2 restart forum`，登录页即显示「QQ 快捷登录」按钮。
- 也可在部署时运行 `deploy.sh`，按提示选择是否启用（默认不启用）。
- 排查：登录页无 QQ 按钮 → 检查 `.env` 三项是否已填且服务已重启；授权后
  回调报错 → 检查回调地址与 QQ 互联后台是否一致。

### 14.8 部署前安全自查（重要）
- 项目代码由 AI 生成，**未经专业安全审计**。正式使用前请务必阅读仓库根目录
  [PROJECT-NOTICE.md](./PROJECT-NOTICE.md)，并执行以下自查：
  - `npm audit` 检查依赖漏洞，修复高危项
  - 为 MongoDB / Redis 设置强密码并仅监听内网/本机（不要暴露公网）
  - 使用 HTTPS 部署（可配合 Nginx/Caddy 反向代理）
  - 定期备份 MongoDB 数据并验证可恢复
  - 生产环境建议通过 OWASP ZAP 等工具做一次安全扫描

---

按照以上步骤，您应该能够顺利将校园论坛系统部署到服务器上，并且所有软件包均从清华大学镜像源加速下载。如果遇到其他问题，请根据错误提示结合常见问题部分进行排查，或咨询项目维护者。