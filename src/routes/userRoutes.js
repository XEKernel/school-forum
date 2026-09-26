const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { upload } = require('../middleware/uploadMiddleware');
const { authenticateUser, optionalAuth } = require('../middleware/jwtAuth');
// 发码类接口的精确限流（server.js 的路径子串匹配覆盖不到下面 4 条：
// '-login-' 不含 '/login'、'-change-code' 也不匹配任何子串规则）
const { rateLimiters } = require('../middleware/rateLimitMiddleware');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');

// 创建头像存储目录
const AVATAR_DIR = path.join(__dirname, '../../public/images/avatars');
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

// 头像上传的multer配置
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, AVATAR_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// 允许的扩展名 → mimetype 映射（与 uploadMiddleware 保持一致，杜绝危险文件落地）
const AVATAR_EXTENSION_MIME_MAP = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.bmp': ['image/bmp'],
  '.avif': ['image/avif'],
  '.heic': ['image/heic'],
  '.heif': ['image/heif']
};

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const expectedMimes = AVATAR_EXTENSION_MIME_MAP[ext] || [];
    // 扩展名 + mimetype 双重校验并强制匹配（SVG 一律拒绝，防止脚本注入）
    if (expectedMimes.length > 0 && expectedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('只支持 JPG, PNG, GIF, WebP 格式的图片');
      err.statusCode = 400; // 文件类型错误属客户端错误，返回 400 而非 500
      cb(err, false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// 获取图形验证码
router.get('/captcha', userController.getCaptcha);

// 用户注册
router.post('/register', userController.register);

// 发送验证码
router.post('/send-verification-code', userController.sendVerificationCode);

// 发送登录验证码
router.post('/send-login-verification-code', rateLimiters.verificationCode, userController.sendLoginVerificationCode);

// 发送密码修改验证码（需要验证当前密码）
router.post('/send-password-change-code', authenticateUser, rateLimiters.verificationCode, userController.sendPasswordChangeCode);

// 验证密码修改验证码
router.post('/verify-password-change-code', authenticateUser, userController.verifyPasswordChangeCode);

// 修改密码（验证验证码后）
router.post('/change-password', authenticateUser, userController.changePassword);

// 发送邮箱修改验证码（需要验证当前密码）
router.post('/send-email-change-code', authenticateUser, rateLimiters.verificationCode, userController.sendEmailChangeCode);

// 验证邮箱修改并完成修改
router.post('/verify-email-change', authenticateUser, userController.verifyEmailChange);

// 修改QQ号（需要验证密码）
router.post('/change-qq', authenticateUser, userController.changeQQ);

// 用户登录
router.post('/login', userController.login);

// 忘记密码（未登录）：发送重置验证码 / 重置密码
router.post('/forgot-password/send-code', userController.forgotPasswordSendCode);
router.post('/forgot-password/reset', userController.forgotPasswordReset);

// 刷新访问令牌
router.post('/refresh-token', userController.refreshToken);

// 用户登出
router.post('/logout', userController.logout);

// 管理员登出
router.post('/admin/logout', userController.adminLogout);

// ===== QQ 快捷登录 =====
// QQ 登录配置状态（登录页判断是否显示按钮）
router.get('/auth/qq/status', userController.getQqStatus);
// 获取 QQ 授权 URL（登录场景，无需登录）
router.get('/auth/qq/authorize-url', userController.getQqAuthorizeUrl);
// 获取 QQ 授权 URL（绑定场景，需登录）
router.get('/auth/qq/authorize-url-bind', authenticateUser, userController.getQqAuthorizeUrl);
// QQ 授权回调（QQ 服务器重定向）
router.get('/auth/qq/callback', userController.qqCallback);
// 前端取 QQ 授权结果（state 为凭证）
router.get('/auth/qq/result', userController.getQqResult);
// QQ 新用户补全资料并注册
router.post('/auth/qq/complete-profile', userController.qqCompleteProfile);
// 解绑 QQ
router.post('/auth/qq/unbind', authenticateUser, userController.unbindQq);
// 查询 QQ 绑定状态（设置页）
router.get('/auth/qq/bind-status', authenticateUser, userController.getQqBindStatus);

// 验证用户登录状态（optionalAuth：有JWT时验证，无JWT时放行）
router.post('/auth/verify', optionalAuth, userController.verifyAuth);

// 获取用户个人资料
router.get('/users/:id', authenticateUser, userController.getUserProfile);

// 用户资料路由别名（兼容 Android）
router.get('/user/profile/:id', authenticateUser, userController.getUserProfile);

// 修改用户资料
router.put('/users/:id', authenticateUser, userController.updateUserProfile);

// 更新用户资料路由别名（兼容 Android）
// 挂 avatarUpload.single('avatar')：支持 multipart 提交（头像文件 + 文本字段，
// 文本字段由 multer 合并到 req.body；非 multipart 请求 multer 自动跳过）
router.post('/user/update-profile', authenticateUser, avatarUpload.single('avatar'), userController.updateUserProfile);

// 更新用户设置（支持PUT和POST方法）
router.put('/users/:id/settings', authenticateUser, userController.updateUserSettings);
router.post('/users/:id/settings', authenticateUser, userController.updateUserSettings);

// 通知设置
// 获取通知设置（需登录，身份来自 JWT；:userId 段仅作兼容保留）
router.get('/user/notification-settings/:userId', authenticateUser, userController.getNotificationSettings);
router.post('/user/notification-settings', authenticateUser, userController.updateNotificationSettings);

// 隐私设置
router.post('/user/privacy-settings', authenticateUser, userController.updatePrivacySettings);

// 更新QQ号
router.post('/user/update-qq', authenticateUser, userController.changeQQ);

// 上传用户头像
router.post('/users/:id/avatar', authenticateUser, avatarUpload.single('avatar'), userController.uploadAvatar);

// 删除用户头像
router.delete('/users/:id/avatar', authenticateUser, userController.removeAvatar);

// 发送账户注销验证码
router.post('/send-deletion-code', authenticateUser, rateLimiters.verificationCode, userController.sendDeletionCode);

// 注销用户账户
router.post('/delete-account', authenticateUser, userController.deleteAccount);

// 导出用户个人数据
router.get('/user/export-data', authenticateUser, userController.exportData);

// 导入用户数据
router.post('/user/import-data', authenticateUser, userController.importData);

module.exports = router;