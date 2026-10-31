# 校园论坛系统


> [!IMPORTANT]
> **本项目已列入重构计划（进行中）** —— 早期代码由 AI 快速堆叠而成，缺少模块边界与约束，维护成本较高。
> 当前按模块逐个清理，主干分支可能处于半改状态。
> **请优先使用 [Releases](https://github.com/XEKernel/school-forum/releases) 中的构建**，而不是直接编译 main。


一个功能完善的校园社区论坛系统，支持多学校、多班级的用户管理和丰富的内容交互功能。

> ⚠️ **重要声明：本项目代码由 AI 生成，未经专业安全审计，可能存在未知漏洞与风险。
> 部署与使用前请务必阅读 [PROJECT-NOTICE.md](./PROJECT-NOTICE.md)（项目说明与风险声明）。**

> **管理员配置（安全变更）**：`adminUsers` 只接受已注册用户的 UUID，**不再接受 QQ 号**。首次部署请先注册账号，然后在服务器上运行 `node scripts/promote-admin.js <QQ或用户名或邮箱或UUID>` 完成提权。

## 相关仓库

| 项目 | 仓库地址 |
|-----|---------|
| 服务端 + Web 端（本仓库） | https://github.com/XEKernel/school-forum |
| Android 客户端 | https://github.com/XEKernel/school-forum-android |

> Android 客户端为原生 Java 应用（Java + OkHttp），通过 REST API 与本服务端通信。

## 项目简介

本系统是一个面向校园用户的开源论坛平台，提供帖子发布、评论互动、用户关注、消息通知、内容收藏等核心功能。支持 Markdown 语法、LaTeX 数学公式渲染和代码高亮显示。

### 技术栈

| 类别 | 技术 |
|-----|------|
| 后端框架 | Node.js + Express |
| 数据库 | MongoDB |
| 缓存 | Redis（可选） |
| 前端 | 原生 HTML/CSS/JavaScript |
| 内容渲染 | Markdown-it + MathJax + Highlight.js |
| 身份验证 | JWT 双 Token（accessToken + refreshToken）+ bcryptjs 密码加密 |

### 主要功能

| 功能模块 | 描述 |
|---------|------|
| 用户系统 | 注册登录、个人资料、头像上传、密码/邮箱/QQ修改、账户注销、图形验证码人机验证、**邮箱验证码找回密码（忘记密码）** |
| 账号安全 | **新设备登录检测**（站内消息 + 邮件双重安全提醒）、登录失败限流与账户锁定、**密码重置/修改后旧 Token 全端失效**、refreshToken 黑名单 |
| 帖子系统 | 发帖、编辑、删除、搜索、浏览量统计、评论点赞、栏目分类 |
| 互动系统 | 点赞、点踩、评论、**6 层嵌套回复**（超深自动折叠）、**回复点赞** |
| 社交功能 | 关注用户、粉丝列表、关注动态 |
| 私信系统 | 发送私信、会话列表、消息记录、未读计数 |
| 黑名单 | 拉黑/取消拉黑、拉黑列表管理 |
| 收藏系统 | 收藏帖子、标签分类、批量管理 |
| 通知系统 | 系统通知、评论/点赞/关注提醒、**广播通知（管理后台群发全体消息）**、**新设备登录提醒**、已读标记 |
| 公告系统 | 发布公告、置顶、启用/禁用管理 |
| 栏目系统 | 论坛栏目管理、用户申请创建栏目、栏目帖子筛选、推荐排序算法 |
| 管理后台 | 用户管理、帖子审核、日志查看、举报处理、**IP统计（含设备/浏览器识别）**、运行模式、栏目管理、**公告/消息管理（群发站内消息）** |
| 安全防护 | JWT 认证、限流、XSS过滤、MongoDB注入防护、登录锁定、图形验证码、**refreshToken 黑名单**、**重置密码后旧 Token 失效**、**新设备登录检测** |
| 内容渲染 | Markdown、LaTeX 公式、代码高亮 |

> 💡 **QQ 快捷登录（可选功能，默认不启用）**
>
> 系统内置 QQ 互联快捷登录（OAuth2.0），但**默认关闭**——不配置即可正常使用，登录页仅保留
> 邮箱注册/登录。如需启用：在 [QQ 互联](https://connect.qq.com) 申请网站应用后，在 `.env`
> 填写 `QQ_APP_ID` / `QQ_APP_SECRET` / `QQ_REDIRECT_URI`（回调地址为
> `你的域名/api/auth/qq/callback`）并重启服务，登录页即显示「QQ 快捷登录」按钮。
> 部署时可运行 `deploy.sh` 按提示选择是否启用。

---

## 目录结构

```
school-forum/
├── server.js                    # 服务入口文件
├── package.json                 # 项目依赖配置
├── package-lock.json            # 依赖锁定文件
├── README.md                    # 项目说明文档
├── PROJECT-NOTICE.md            # 项目说明与风险声明（部署前必读）
├── API.md                       # API 接口文档
├── deploy.sh                     # Linux 一键部署脚本（完整安装）
├── setup.sh                      # Linux 配置向导（仅修改配置）
├── start.sh                      # Linux 启动脚本
├── DeploymentGuide.md           # 详细部署指南
├── .env                         # 环境变量配置
│
├── data/                        # 数据目录
│   └── config.json              # 系统配置文件
│
├── public/                      # 静态资源目录
│   ├── index.html               # 首页
│   ├── login.html               # 登录页
│   ├── admin.html               # 管理后台
│   ├── profile.html             # 个人资料页
│   ├── post-detail.html         # 帖子详情页
│   ├── edit-simple.html         # 发帖/编辑页
│   ├── favorites.html           # 收藏页
│   ├── follow-list.html         # 关注/粉丝列表页
│   ├── following.html           # 关注动态页
│   ├── message.html             # 消息通知页
│   ├── chat.html                # 私信聊天页
│   ├── blacklist.html           # 黑名单管理页
│   ├── settings.html            # 设置页
│   ├── category.html            # 栏目浏览页
│   ├── categories.html          # 栏目总览页
│   ├── forgot-password.html     # 忘记密码（找回密码）页
│   ├── qq-callback.html         # QQ 授权回调处理页（可选功能）
│   ├── qq-register.html         # QQ 新用户补全资料页（可选功能）
│   │
│   ├── css/                     # 样式文件
│   │   ├── style.css            # 主样式
│   │   ├── admin.css            # 管理后台样式
│   │   ├── login.css            # 登录页样式
│   │   ├── profile.css          # 个人资料样式
│   │   ├── post-detail.css      # 帖子详情样式
│   │   ├── edit-simple.css      # 编辑页样式
│   │   ├── favorites.css        # 收藏页样式
│   │   ├── follow-list.css      # 关注列表样式
│   │   ├── following.css        # 关注动态样式
│   │   ├── message.css          # 消息页样式
│   │   ├── settings.css         # 设置页样式
│   │   ├── categories.css       # 栏目页样式
│   │   ├── error-styles.css     # 错误页样式
│   │   └── console-logs-enhanced.css
│   │
│   ├── js/                      # 前端脚本
│   │   ├── main.js              # 主逻辑
│   │   ├── auth.js              # 认证相关
│   │   ├── user.js              # 用户模块
│   │   ├── posts.js             # 帖子模块
│   │   ├── post-detail.js       # 帖子详情
│   │   ├── comments.js          # 评论模块
│   │   ├── edit-simple.js       # 编辑功能
│   │   ├── profile.js           # 个人资料
│   │   ├── favorites.js         # 收藏功能
│   │   ├── follow-list.js       # 关注列表
│   │   ├── following.js         # 关注动态
│   │   ├── message.js           # 消息通知
│   │   ├── settings.js          # 设置功能
│   │   ├── admin.js             # 管理后台
│   │   ├── stats.js             # 统计数据
│   │   ├── category.js          # 栏目模块
│   │   ├── utils.js             # 工具函数
│   │   ├── categories.js        # 栏目总览页面逻辑
│   │   ├── category-page.js     # 栏目页逻辑
│   │   ├── blacklist-page.js    # 黑名单页逻辑
│   │   ├── index-custom.js      # 首页自定义脚本
│   │   ├── settings-init.js     # 设置页初始化
│   │   ├── init-basic.js        # 基础初始化模板
│   │   ├── init-with-stats.js   # 带统计的初始化模板
│   │   ├── init-requires-login.js # 需要登录的页面初始化
│   │   ├── mathjax-config.js    # MathJax 基础配置
│   │   ├── mathjax-full.js      # MathJax 完整配置
│   │   └── highlight-init.js    # 代码高亮初始化
│   │
│   ├── images/                  # 图片资源
│   │   ├── logo.svg             # 网站Logo
│   │   ├── default-avatar.svg   # 默认头像
│   │   └── avatars/             # 用户头像存储
│   │
│   ├── errors/                  # 错误页面
│   │   ├── 403.html             # 无权限页面
│   │   ├── 404.html             # 未找到页面
│   │   ├── 502.html             # 服务错误页面
│   │   └── maintenance.html     # 维护模式页面
│   │
│   └── libs/                    # 第三方库
│       ├── markdown-it/         # Markdown 渲染
│       ├── mathjax/             # LaTeX 公式渲染
│       ├── katex/               # KaTeX 公式渲染
│       └── highlight.js/        # 代码高亮
│
├── src/                         # 后端源码
│   ├── config/                  # 配置模块
│   │   ├── constants.js         # 常量定义
│   │   └── security.js          # 安全配置（CORS/Helmet等）
│   │
│   ├── controllers/             # 控制器
│   │   ├── userController.js    # 用户控制器
│   │   ├── postController.js    # 帖子控制器（含推荐算法）
│   │   ├── followController.js  # 关注控制器
│   │   ├── favoriteController.js# 收藏控制器
│   │   ├── notificationController.js # 通知控制器
│   │   ├── messageController.js # 私信控制器
│   │   ├── blacklistController.js    # 黑名单控制器
│   │   ├── announcementController.js # 公告控制器
│   │   ├── categoryController.js # 栏目控制器
│   │   ├── adminController.js   # 管理控制器
│   │   ├── reportController.js  # 举报控制器
│   │   ├── statsController.js   # 统计控制器
│   │   ├── configController.js  # 配置控制器
│   │   └── runModeController.js # 运行模式控制器
│   │
│   ├── middleware/              # 中间件
│   │   ├── adminAuth.js         # 管理员 JWT 认证
│   │   ├── jwtAuth.js           # 用户 JWT 认证
│   │   ├── uploadMiddleware.js  # 文件上传
│   │   ├── maintenanceMode.js   # 维护/自毁模式检查
│   │   ├── rateLimitMiddleware.js # 请求限流
│   │   └── security.js          # XSS/注入防护、请求ID等
│   │
│   ├── models/                  # 数据模型
│   │   ├── index.js             # 数据库连接
│   │   ├── User.js              # 用户模型
│   │   ├── Post.js              # 帖子模型（含categoryId字段）
│   │   ├── Follow.js            # 关注模型
│   │   ├── Favorite.js          # 收藏模型
│   │   ├── FavoriteTag.js       # 收藏标签模型
│   │   ├── Notification.js      # 通知模型
│   │   ├── Report.js            # 举报模型
│   │   ├── BannedUser.js        # 封禁用户模型
│   │   ├── DeletedPost.js       # 已删帖子模型
│   │   ├── Message.js           # 私信消息模型
│   │   ├── Conversation.js      # 会话模型
│   │   ├── Blacklist.js         # 黑名单模型
│   │   ├── Announcement.js      # 公告模型
│   │   ├── Category.js          # 栏目模型
│   │   └── CategoryApplication.js # 栏目申请模型
│   │
│   ├── routes/                  # 路由定义
│   │   ├── index.js             # 路由汇总
│   │   ├── userRoutes.js        # 用户路由
│   │   ├── postRoutes.js        # 帖子路由
│   │   ├── followRoutes.js      # 关注路由
│   │   ├── favoriteRoutes.js    # 收藏路由
│   │   ├── notificationRoutes.js# 通知路由
│   │   ├── messageRoutes.js     # 私信路由
│   │   ├── blacklistRoutes.js   # 黑名单路由
│   │   ├── announcementRoutes.js# 公告路由
│   │   ├── categoryRoutes.js    # 栏目路由
│   │   ├── adminRoutes.js       # 管理路由
│   │   ├── reportRoutes.js      # 举报路由
│   │   ├── statsRoutes.js       # 统计路由
│   │   ├── configRoutes.js      # 配置路由
│   │   └── runModeRoutes.js     # 运行模式路由
│   │
│   └── utils/                   # 工具函数
│       ├── authUtils.js         # 认证工具
│       ├── configUtils.js       # 配置工具
│       ├── dataUtils.js         # 数据工具
│       ├── emailUtils.js        # 邮件工具
│       ├── logger.js            # 日志工具
│       ├── redisUtils.js        # Redis工具
│       ├── userAgent.js         # User-Agent 解析（设备/浏览器识别）
│       ├── qqOAuth.js           # QQ 互联 OAuth 工具（可选功能）
│       └── validationUtils.js   # 验证工具
│
└── node_modules/                # 依赖包
```

---

## API 接口

完整的 API 接口文档请参考 [API.md](./API.md)，包含：

- 所有接口的详细参数说明
- 请求/响应示例
- 数据模型定义
- 错误码说明

### API 接口文档

### 基础接口

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/health` | 健康检查 |
| GET | `/404` | 404 错误页面 |
| GET | `/403` | 403 错误页面 |
| GET | `/502` | 502 错误页面 |

---

### 用户模块

#### 认证相关

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/captcha` | 获取图形验证码（SVG） |
| POST | `/register` | 用户注册 |
| POST | `/login` | 用户登录 |
| POST | `/refresh-token` | 刷新访问令牌 |
| POST | `/logout` | 用户登出 |
| POST | `/auth/verify` | 验证登录状态 |
| POST | `/send-verification-code` | 发送注册验证码 |
| POST | `/send-login-verification-code` | 发送登录验证码 |
| POST | `/send-password-change-code` | 发送密码修改验证码 🔑 |
| POST | `/verify-password-change-code` | 验证密码修改验证码 🔑 |
| POST | `/change-password` | 修改密码 🔑 |
| POST | `/send-email-change-code` | 发送邮箱修改验证码 🔑 |
| POST | `/verify-email-change` | 验证并完成邮箱修改 🔑 |
| POST | `/change-qq` | 修改 QQ 号 🔑 |
| POST | `/send-deletion-code` | 发送账户注销验证码 🔑 |
| POST | `/delete-account` | 注销账户 🔑 |

#### 用户资料

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/users/:id` | 获取用户资料 |
| PUT | `/users/:id` | 修改用户资料 🔑 |
| PUT | `/users/:id/settings` | 更新用户设置 🔑 |
| POST | `/users/:id/avatar` | 上传头像 🔑 |
| DELETE | `/users/:id/avatar` | 删除头像 🔑 |

> 🔑 = 需要携带 `Authorization: Bearer <token>` 头

---

### 帖子模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/posts` | 获取帖子列表（支持分页、搜索、栏目筛选、推荐排序） |
| POST | `/posts` | 发布新帖子（含栏目选择） |
| GET | `/posts/:id` | 获取帖子详情 |
| PUT | `/posts/:id` | 编辑帖子 |
| DELETE | `/posts/:id` | 删除帖子 |
| POST | `/posts/:id/view` | 增加浏览量 |
| POST | `/posts/:id/like` | 点赞帖子 |
| POST | `/posts/:id/dislike` | 点踩帖子 |

#### 评论相关

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/posts/:id/comments` | 添加评论 |
| POST | `/posts/:id/comments/:commentId/replies` | 回复评论 |
| DELETE | `/posts/:id/comments/:commentId` | 删除评论 |
| POST | `/posts/:id/comments/:commentId/like` | 点赞评论 |

---

### 栏目模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/categories` | 获取所有已启用栏目 |
| GET | `/categories/:id` | 获取单个栏目详情 |
| GET | `/categories/:id/posts` | 获取某栏目的帖子 |
| POST | `/category-applications` | 申请新建栏目 🔑 |

---

### 关注模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/follow` | 关注用户 |
| DELETE | `/follow` | 取消关注 |
| GET | `/follow/status` | 检查关注状态 |
| GET | `/follow/stats/:userId` | 获取关注/粉丝数 |
| GET | `/follow/new-posts/:userId` | 获取关注用户新帖子数 |
| POST | `/follow/mark-viewed` | 标记已查看关注动态 |
| GET | `/following/:userId` | 获取关注列表 |
| GET | `/followers/:userId` | 获取粉丝列表 |
| GET | `/following/posts/:userId` | 获取关注用户的帖子 |

---

### 收藏模块

#### 收藏操作

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/favorites/:postId` | 收藏帖子 |
| DELETE | `/favorites/:postId` | 取消收藏 |
| GET | `/favorites/:postId/check` | 检查是否已收藏 |
| PUT | `/favorites/:postId/tag` | 更新收藏标签 |

#### 收藏列表

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/favorites/user/:userId` | 获取用户收藏列表 |
| GET | `/favorites/user/:userId/count` | 获取收藏数量 |

#### 批量操作

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/favorites/batch/delete` | 批量删除收藏 |
| POST | `/favorites/batch/move` | 批量移动到标签 |

#### 标签管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/favorites/tags/:userId` | 获取用户标签 |
| POST | `/favorites/tags` | 创建标签 |
| PUT | `/favorites/tags/:tagId` | 更新标签 |
| DELETE | `/favorites/tags/:tagId` | 删除标签 |
| PUT | `/favorites/tags/order` | 更新标签排序 |

---

### 通知模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/notifications` | 获取通知列表 |
| POST | `/notifications/:id/read` | 标记单条已读 |
| POST | `/notifications/read-all` | 标记全部已读 |

---

### 举报模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/reports/types` | 获取举报类型 |
| POST | `/reports` | 提交举报 |
| GET | `/reports/user/:userId` | 获取用户举报历史 |

---

### 统计模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/stats` | 获取统计数据 |
| GET | `/search` | 搜索帖子/用户 |

---

### 私信模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/messages` | 发送私信 🔑 |
| GET | `/messages` | 获取消息记录 🔑 |
| GET | `/messages/unread` | 获取未读消息数 🔑 |
| GET | `/messages/check-permission` | 检查发送权限 |
| GET | `/messages/contactable-users` | 获取可联系用户 🔑 |
| DELETE | `/messages/:messageId` | 删除单条消息 🔑 |
| GET | `/conversations` | 获取会话列表 🔑 |
| DELETE | `/conversations/:conversationId` | 删除会话 🔑 |

---

### 黑名单模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/block` | 拉黑用户 |
| POST | `/unblock` | 取消拉黑 |
| GET | `/block/status` | 检查拉黑状态 |
| GET | `/block/relation` | 检查拉黑关系 |
| GET | `/blocked/:userId` | 获取拉黑列表 |
| GET | `/blocked/count/:userId` | 获取拉黑数量 |

---

### 公告模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/announcements/active` | 获取有效公告列表 |
| GET | `/announcements/:id` | 获取公告详情 |

---

### 运行模式模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/run-mode` | 获取当前运行模式 |
| GET | `/maintenance-message` | 获取维护模式消息 |

---

### 配置模块

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/schools` | 获取学校列表 |
| GET | `/public` | 获取公开配置 |

---

### 管理后台模块

> 以下接口需要管理员权限

#### 帖子管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/posts` | 获取帖子列表（含已删除） |
| DELETE | `/admin/posts/:id` | 永久删除帖子 |

#### 用户管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/users` | 获取所有用户 |
| GET | `/admin/banned-users` | 获取封禁用户列表 |
| POST | `/admin/users/:id/ban` | 封禁用户 |
| POST | `/admin/users/:id/unban` | 解封用户 |

#### 评论管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/comments` | 获取所有评论 |
| DELETE | `/admin/comments/:id` | 删除评论 |

#### 举报管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/reports` | 获取举报列表 |
| GET | `/admin/reports/stats` | 获取举报统计 |
| POST | `/admin/reports/:reportId/process` | 处理举报 |

#### 统计与日志

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/stats` | 获取详细统计 |
| GET | `/admin/recent-activity` | 获取最近活动 |
| GET | `/admin/logs` | 获取日志 |
| GET | `/admin/logs/dates` | 获取日志日期列表 |
| DELETE | `/admin/logs` | 清空日志 |
| DELETE | `/admin/logs/date` | 删除指定日期日志 |
| GET | `/admin/ip-stats` | 获取 IP 访问统计列表 |
| GET | `/admin/ip-stats/summary` | 获取 IP 统计摘要 |
| DELETE | `/admin/ip-stats/:ip` | 清除指定 IP 统计 |
| DELETE | `/admin/ip-stats` | 清除所有 IP 统计 |

#### 系统配置

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/config` | 获取配置 |
| PUT | `/admin/config` | 更新配置 |

#### 管理员管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/admins` | 获取管理员列表 |
| POST | `/admin/admins` | 添加管理员 |
| DELETE | `/admin/admins` | 删除管理员 |

#### 公告管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/announcements` | 获取所有公告 |
| POST | `/admin/announcements` | 创建公告 |
| PUT | `/admin/announcements/:id` | 更新公告 |
| DELETE | `/admin/announcements/:id` | 删除公告 |
| PATCH | `/admin/announcements/:id/toggle-status` | 切换公告启用状态 |
| PATCH | `/admin/announcements/:id/toggle-pinned` | 切换公告置顶状态 |
| PATCH | `/admin/announcements/batch-status` | 批量更新公告状态 |

#### 栏目管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/admin/categories` | 获取所有栏目（含禁用的） |
| POST | `/admin/categories` | 创建栏目 |
| PUT | `/admin/categories/:id` | 更新栏目 |
| DELETE | `/admin/categories/:id` | 删除栏目 |
| PATCH | `/admin/categories/:id/toggle-status` | 切换栏目启用状态 |
| GET | `/admin/category-applications` | 获取所有栏目申请 |
| POST | `/admin/category-applications/:id/approve` | 批准栏目申请 |
| POST | `/admin/category-applications/:id/reject` | 拒绝栏目申请 |

#### 运行模式管理

| 方法 | 路径 | 描述 |
|-----|------|------|
| POST | `/admin/run-mode` | 设置运行模式（正常/维护/只读） |
| POST | `/admin/self-destruct/level3` | 自毁三级：删除帖子/评论/私信 |
| POST | `/admin/self-destruct/level2` | 自毁二级：清空数据库 |
| POST | `/admin/self-destruct/level1` | 自毁一级：删除论坛文件 |

---

## 配置说明

项目配置文件位于 `data/config.json`，首次运行时会自动生成默认配置。

### 完整配置示例

```json
{
  "adminUsers": [],
  "mongodb": {
    "uri": "mongodb://localhost:27017/school-forum",
    "username": "",
    "password": "",
    "authSource": "admin"
  },
  "redis": {
    "host": "localhost",
    "port": 6379,
    "password": "",
    "db": 0
  },
  "upload": {
    "allowedTypes": [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp"
    ],
    "maxFileSize": 33554432,
    "maxFiles": 32
  },
  "password": {
    "saltRounds": 10
  },
  "pagination": {
    "defaultPage": 1,
    "defaultLimit": 100
  },
  "contentLimits": {
    "post": 10000,
    "comment": 500,
    "username": { "min": 2, "max": 20 },
    "qq": { "min": 5, "max": 15 },
    "password": { "min": 6 }
  },
  "schools": [
    {
      "id": "XXXX",
      "name": "XX学校",
      "classInfo": [
        { "year": 2024, "classCount": 25 }
      ]
    }
  ]
}
```

### 配置项说明

| 配置项 | 类型 | 说明 |
|-------|------|------|
| `adminUsers` | `string[]` | 管理员用户 UUID 列表（**不接受 QQ**；首次部署用 `scripts/promote-admin.js` 提权） |
| `mongodb.uri` | `string` | MongoDB 连接字符串 |
| `mongodb.username` | `string` | MongoDB 用户名（可选，用于认证） |
| `mongodb.password` | `string` | MongoDB 密码（可选，用于认证） |
| `mongodb.authSource` | `string` | MongoDB 认证数据库（默认 admin） |
| `redis.host` | `string` | Redis 服务器地址 |
| `redis.port` | `number` | Redis 端口 |
| `redis.password` | `string` | Redis 密码（无密码留空） |
| `redis.db` | `number` | Redis 数据库编号 |
| `upload.allowedTypes` | `string[]` | 允许上传的文件类型 |
| `upload.maxFileSize` | `number` | 单文件最大字节数 |
| `upload.maxFiles` | `number` | 单次最多上传文件数 |
| `password.saltRounds` | `number` | bcrypt 加密轮数 |
| `pagination.defaultPage` | `number` | 默认页码 |
| `pagination.defaultLimit` | `number` | 默认每页数量 |
| `contentLimits.post` | `number` | 帖子最大长度 |
| `contentLimits.comment` | `number` | 评论最大长度 |
| `contentLimits.username` | `object` | 用户名长度范围 |
| `contentLimits.qq` | `object` | QQ号长度范围 |
| `contentLimits.password` | `object` | 密码最小长度 |
| `schools` | `array` | 学校配置列表 |

### 学校配置说明

```json
{
  "id": "XXXX",
  "name": "XX学校",
  "classInfo": [
    { "year": 2024, "classCount": 25 }
  ]
}
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| `id` | `string` | 学校唯一标识 |
| `name` | `string` | 学校名称 |
| `classInfo` | `array` | 年级信息 |
| `classInfo[].year` | `number` | 入学年份 |
| `classInfo[].classCount` | `number` | 该年级班级数量 |

---

## 快速开始

### 环境要求

| 软件 | 版本要求 |
|-----|---------|
| Node.js | 18+ |
| MongoDB | 4.4+ |
| Redis | 可选 |

### 安装运行

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后访问 `http://localhost:3000` 即可进入论坛。

### 环境变量

创建 `.env` 文件配置以下变量（参考 `.env.example`）：

| 变量名 | 说明 | 默认值 |
|-------|------|-------|
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |
| `MONGODB_URI` | MongoDB 连接字符串 | — |
| `MONGODB_USERNAME` | MongoDB 用户名 | — |
| `MONGODB_PASSWORD` | MongoDB 密码 | — |
| `MONGODB_AUTHSOURCE` | MongoDB 认证数据库 | `admin` |
| `REDIS_HOST` | Redis 服务器地址 | `localhost` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_PASSWORD` | Redis 密码 | — |
| `JWT_SECRET` | 用户 JWT 密钥（**必填**） | — |
| `JWT_EXPIRES_IN` | 访问令牌有效期 | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | 刷新令牌有效期 | `30d` |
| `ADMIN_JWT_SECRET` | 管理员 JWT 密钥（**必填**） | — |
| `ADMIN_JWT_EXPIRES_IN` | 管理员令牌有效期 | `24h` |
| `SMTP_HOST` | SMTP 服务器地址 | — |
| `SMTP_PORT` | SMTP 端口 | `465` |
| `SMTP_SECURE` | 是否使用 SSL | `true` |
| `SMTP_USER` | SMTP 用户名 | — |
| `SMTP_PASS` | SMTP 密码/授权码 | — |
| `CORS_ORIGIN` | 允许的跨域来源（逗号分隔） | `localhost` |
| `MAX_REQUEST_SIZE` | 请求体最大大小（MB） | `10` |
| `LOGIN_MAX_ATTEMPTS` | 最大登录尝试次数 | `5` |
| `LOGIN_LOCK_TIME` | 锁定时间（毫秒） | `1800000` |
| `PASSWORD_MIN_LENGTH` | 密码最小长度 | `8` |
| `PASSWORD_REQUIRE_UPPERCASE` | 密码需含大写字母 | `true` |
| `PASSWORD_REQUIRE_LOWERCASE` | 密码需含小写字母 | `true` |
| `PASSWORD_REQUIRE_NUMBER` | 密码需含数字 | `true` |
| `PASSWORD_REQUIRE_SPECIAL` | 密码需含特殊字符 | `false` |
| `RATE_LIMIT_WINDOW_MS` | 限流窗口时间（毫秒） | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | 窗口内最大请求数 | `100` |
| `QQ_APP_ID` | QQ 互联 AppID（**可选**，不配置则 QQ 登录关闭） | — |
| `QQ_APP_SECRET` | QQ 互联 AppSecret（**可选**） | — |
| `QQ_REDIRECT_URI` | QQ 授权回调地址（**可选**，需与 QQ 互联后台一致） | — |

> **注意**：`JWT_SECRET` 和 `ADMIN_JWT_SECRET` 未配置时服务将拒绝启动。

---

## 部署说明

### 一键部署脚本

| 脚本 | 用途 | 适用场景 |
|-----|------|---------|
| `deploy.sh` | Linux 完整部署 | 首次部署，安装所有依赖 |
| `setup.sh` | Linux 配置向导 | 已有环境，仅修改配置 |

### 配置向导（setup）功能

- ✅ 检测现有配置，保留已有值不覆盖
- ✅ 支持 5 种操作模式：交互式配置、快速配置、查看配置、智能更新 IP、退出
- ✅ 快速模式：完成基础配置；管理员注册后用 `scripts/promote-admin.js` 提权
- ✅ 智能 IP 检测：自动识别 192.168.x.x 或 10.x.x.x 内网地址
- ✅ 配置变更自动备份（`.env.bak`）

```bash
# Linux 配置向导
chmod +x setup.sh
./setup.sh
```

### 详细部署指南

完整的服务器部署步骤请参考 [校园论坛部署指南](./DeploymentGuide.md)，包含：

- Ubuntu 服务器配置
- Node.js / MongoDB / Redis 安装（使用清华镜像加速）
- PM2 进程管理
- 防火墙配置
- 常见问题排查

---

## 开发方式

本项目**主要由 AI 辅助完成**：作者负责需求定义、架构取舍与验收测试，具体代码实现大量由 AI 生成。

早期开发阶段提示词工程欠缺 —— 上下文给得随意、约束条件没写清、模块边界也没提前划定，
导致部分实现耦合偏高，改动容易牵一发动全身。后续开发已改为**先定接口与模块边界，再让 AI 产出实现**。

二次开发建议：先读目录结构与核心类，确认数据流向，再动代码。

## 许可证

MIT License