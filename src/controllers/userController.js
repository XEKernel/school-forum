const { v4: uuidv4 } = require('uuid');
const {
  hashPassword,
  comparePassword,
  calculateCurrentGrade,
  validateUserInput
} = require('../utils/authUtils');
const {
  createUser,
  updateUser,
  getUserById,
  createNotification
} = require('../utils/dataUtils');
const {
  isQQRegistered,
  isUsernameExists,
  userExists,
  isUserActive,
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { sendVerificationEmail, verifyCode, sendNewDeviceLoginEmail } = require('../utils/emailUtils');
const { parseUserAgent } = require('../utils/userAgent');
const { userCache, notificationCache, captchaCache, qqCache } = require('../utils/redisUtils');
const qqOAuth = require('../utils/qqOAuth');
const logger = require('../utils/logger');
const User = require('../models/User');

// 公共邮箱验证正则
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userController = {
  // 生成图形验证码
  async getCaptcha(req, res) {
    try {
      // 生成随机 4 位数字
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const captchaId = uuidv4();

      // 存储到 Redis（5分钟过期，验证后立即失效）
      await captchaCache.set(captchaId, code);

      // 生成 SVG 图片
      const svg = generateCaptchaSvg(code);

      // 以图片形式返回（避免 JSON 中的文本可被脚本解析）
      res.setHeader('X-Captcha-Id', captchaId);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(svg);
    } catch (error) {
      logger.logError('生成验证码失败', { error: error.message });
      res.status(500).json(generateErrorResponse('生成验证码失败', 500));
    }
  },

  // 验证图形验证码（内部辅助方法）
  async _verifyCaptcha(captchaId, captchaCode) {
    if (!captchaId || !captchaCode) {
      return { valid: false, message: '请输入图形验证码' };
    }
    return await captchaCache.verify(captchaId, captchaCode);
  },

  // 发送验证码
  async sendVerificationCode(req, res) {
    try {
      const { email, captchaId, captchaCode } = req.body;

      if (!email) {
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      // 验证邮箱格式
      if (!emailRegex.test(email)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      // 验证图形验证码（防止匿名滥用邮件发送）
      const captchaResult = await userController._verifyCaptcha(captchaId, captchaCode);
      if (!captchaResult.valid) {
        return res.status(400).json(generateErrorResponse(captchaResult.message));
      }

      // 发送验证码邮件
      await sendVerificationEmail(email);

      res.json(generateSuccessResponse({}, '验证码已发送到您的邮箱'));
    } catch (error) {
      logger.logError('发送验证码失败', { error: error.message, email: req.body.email });
      res.status(500).json(generateErrorResponse(error.message || '发送验证码失败', 500));
    }
  },

  // 发送登录验证码
  async sendLoginVerificationCode(req, res) {
    try {
      const { email, captchaId, captchaCode } = req.body;

      if (!email) {
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      // 验证邮箱格式
      if (!emailRegex.test(email)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      // 验证图形验证码
      const captchaResult = await userController._verifyCaptcha(captchaId, captchaCode);
      if (!captchaResult.valid) {
        return res.status(400).json(generateErrorResponse(captchaResult.message));
      }

      // 发送验证码邮件（登录场景）
      await sendVerificationEmail(email, 'login');

      res.json(generateSuccessResponse({}, '验证码已发送到您的邮箱'));
    } catch (error) {
      logger.logError('发送登录验证码失败', { error: error.message, email: req.body.email });
      res.status(500).json(generateErrorResponse(error.message || '发送验证码失败', 500));
    }
  },

  // 发送密码修改验证码（需要验证当前密码）
  async sendPasswordChangeCode(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { currentPassword } = req.body;

      if (!currentPassword) {
        return res.status(400).json(generateErrorResponse('请输入当前密码'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证当前密码
      const isPasswordValid = await comparePassword(currentPassword, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('密码修改验证码发送失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('当前密码错误'));
      }

      // 发送验证码到用户邮箱（密码修改场景）
      await sendVerificationEmail(user.email, 'password');

      logger.logUserAction('发送密码修改验证码', userId, user.username, { ip: req.ip });

      res.json(generateSuccessResponse({ email: user.email }, '验证码已发送到您的邮箱'));
    } catch (error) {
      logger.logError('发送密码修改验证码失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse(error.message || '发送验证码失败', 500));
    }
  },

  // 验证密码修改验证码
  async verifyPasswordChangeCode(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { verificationCode } = req.body;

      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('验证码不能为空'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证验证码
      const codeVerification = await verifyCode(user.email, verificationCode, 'password');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('密码修改验证码验证失败', { userId, ip: req.ip });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      logger.logUserAction('密码修改验证码验证成功', userId, user.username, { ip: req.ip });

      res.json(generateSuccessResponse({}, '验证码验证成功'));
    } catch (error) {
      logger.logError('验证密码修改验证码失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 修改密码（验证验证码后）
  async changePassword(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { currentPassword, newPassword, verificationCode } = req.body;

      if (!currentPassword) {
        return res.status(400).json(generateErrorResponse('请输入当前密码'));
      }

      if (!newPassword) {
        return res.status(400).json(generateErrorResponse('请输入新密码'));
      }

      if (newPassword.length < 6) {
        return res.status(400).json(generateErrorResponse('密码至少6个字符'));
      }

      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('请输入验证码'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证当前密码
      const isPasswordValid = await comparePassword(currentPassword, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('密码修改失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('当前密码错误'));
      }

      // 验证验证码
      const codeVerification = await verifyCode(user.email, verificationCode, 'password');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('密码修改失败：验证码错误', { userId, ip: req.ip });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      // 加密新密码
      const hashedPassword = await hashPassword(newPassword);

      // 更新密码（passwordChangedAt 使所有旧 token 立即失效）
      await updateUser(userId, { password: hashedPassword, passwordChangedAt: new Date() });

      // 使当前 JWT 令牌失效（安全：防止密码修改后旧令牌仍可用）
      const { invalidateToken } = require('../middleware/jwtAuth');
      if (req.token) {
        await invalidateToken(req.token);
      }

      logger.logUserAction('密码修改成功', userId, user.username, { ip: req.ip });

      res.json(generateSuccessResponse({}, '密码修改成功'));
    } catch (error) {
      logger.logError('修改密码失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 忘记密码：发送重置验证码（未登录，校验 QQ+邮箱匹配 + 图形验证码防滥用）
  async forgotPasswordSendCode(req, res) {
    try {
      const { qq, email, captchaId, captchaCode } = req.body;

      if (!qq) {
        return res.status(400).json(generateErrorResponse('QQ号不能为空'));
      }

      if (!email) {
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      if (!emailRegex.test(email)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      // 图形验证码（一次性消费，防止匿名滥用邮件发送）
      const captchaResult = await userController._verifyCaptcha(captchaId, captchaCode);
      if (!captchaResult.valid) {
        return res.status(400).json(generateErrorResponse(captchaResult.message));
      }

      // 校验账号存在且 QQ 与邮箱匹配（统一错误文案，防止账号枚举）
      const user = await User.findOne({ qq });
      if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
        logger.logSecurityEvent('找回密码：账号信息不匹配', { qq, email, ip: req.ip });
        return res.status(400).json(generateErrorResponse('账号信息校验失败，请确认QQ号与邮箱正确'));
      }

      // 发送重置验证码（password 场景，与修改密码共用）
      await sendVerificationEmail(user.email, 'password');

      logger.logSecurityEvent('找回密码：重置验证码已发送', { userId: user.id, qq, ip: req.ip });

      res.json(generateSuccessResponse({}, '验证码已发送到您的邮箱，请查收'));
    } catch (error) {
      logger.logError('发送找回密码验证码失败', { error: error.message, qq: req.body.qq });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 忘记密码：重置密码（未登录，验证邮箱验证码后设置新密码）
  async forgotPasswordReset(req, res) {
    try {
      const { qq, email, verificationCode, newPassword } = req.body;

      if (!qq) {
        return res.status(400).json(generateErrorResponse('QQ号不能为空'));
      }

      if (!email) {
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('请输入邮箱验证码'));
      }

      if (!newPassword) {
        return res.status(400).json(generateErrorResponse('请输入新密码'));
      }

      if (newPassword.length < 6) {
        return res.status(400).json(generateErrorResponse('密码至少6个字符'));
      }

      if (newPassword.length > 64) {
        return res.status(400).json(generateErrorResponse('密码过长，最多64个字符'));
      }

      // 校验账号存在且 QQ 与邮箱匹配
      const user = await User.findOne({ qq });
      if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
        logger.logSecurityEvent('找回密码重置失败：账号信息不匹配', { qq, ip: req.ip });
        return res.status(400).json(generateErrorResponse('账号信息校验失败，请确认QQ号与邮箱正确'));
      }

      // 校验邮箱验证码（password 场景）
      const codeVerification = await verifyCode(user.email, verificationCode, 'password');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('找回密码重置失败：验证码错误', { userId: user.id, qq, ip: req.ip });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      // 加密并更新密码（passwordChangedAt 使该用户所有旧 token 立即失效）
      const hashedPassword = await hashPassword(newPassword);
      await updateUser(user.id, { password: hashedPassword, passwordChangedAt: new Date() });

      logger.logSecurityEvent('找回密码：密码已重置', { userId: user.id, qq, ip: req.ip });

      res.json(generateSuccessResponse({}, '密码重置成功，请使用新密码登录'));
    } catch (error) {
      logger.logError('找回密码重置失败', { error: error.message, qq: req.body.qq });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 用户注册
  async register(req, res) {
    try {
      const { qq, username, password, email, verificationCode, school, enrollmentYear, className, birthday, gender } = req.body;

      // 注：图形验证码已在发送邮箱验证码时校验过（一次性消费），
      // 此处不再重复校验，否则注册提交必然报"验证码已过期"

      // 验证输入
      const validationErrors = validateUserInput(req.body);
      if (validationErrors.length > 0) {
        logger.logWarn('用户注册失败：验证错误', { qq, username, errors: validationErrors });
        return res.status(400).json(generateErrorResponse(validationErrors[0]));
      }

      // 验证邮箱
      if (!email) {
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      if (!emailRegex.test(email)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      // 验证验证码
      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('验证码不能为空'));
      }

      // 验证验证码是否正确（使用原始邮箱验证，绑定 register 场景）
      const codeVerification = await verifyCode(email, verificationCode, 'register');
      if (!codeVerification.valid) {
        logger.logWarn('用户注册失败：验证码验证失败', { email, code: verificationCode });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      // 检查QQ是否已注册
      if (await isQQRegistered(qq)) {
        logger.logWarn('用户注册失败：QQ已注册', { qq });
        return res.status(400).json(generateErrorResponse('该QQ号已注册'));
      }

      // 检查用户名是否已存在
      if (await isUsernameExists(username)) {
        logger.logWarn('用户注册失败：用户名已存在', { username });
        return res.status(400).json(generateErrorResponse('用户名已存在'));
      }

      // 检查邮箱是否已被注册（不区分大小写）
      const { isEmailRegistered } = require('../utils/dataUtils');
      if (await isEmailRegistered(email)) {
        logger.logWarn('用户注册失败：邮箱已注册', { email });
        return res.status(400).json(generateErrorResponse('该邮箱已注册'));
      }

      // 加密密码
      const hashedPassword = await hashPassword(password);

      // 入学年份缺省/非法时默认当前年份（客户端只需传班级，年级由服务端按入学时间计算）
      const year = enrollmentYear ? (parseInt(enrollmentYear, 10) || new Date().getFullYear()) : new Date().getFullYear();

      // 计算当前年级
      const currentGrade = calculateCurrentGrade(year);

      const newUser = {
        id: uuidv4(),
        qq,
        username,
        email: email.toLowerCase(), // 统一转为小写存储
        password: hashedPassword,
        passwordChangedAt: new Date(), // 密码变更基准：注册时初始化为当前时间
        school,
        enrollmentYear: year,
        className,
        grade: currentGrade,
        birthday: birthday || null,
        gender: gender || '',
        createdAt: new Date().toISOString(),
        lastLogin: null,
        postCount: 0,
        commentCount: 0,
        isActive: true,
        settings: {
          theme: 'light',
        }
      };
      
      await createUser(newUser);

      // 记录用户注册日志
      logger.logUserAction('用户注册', newUser.id, newUser.username, {
        qq: newUser.qq,
        school: newUser.school,
        grade: newUser.grade,
        className: newUser.className
      });

      // 生成登录 Token
      const { generateAccessToken, generateRefreshToken } = require('../middleware/jwtAuth');
      const accessToken = generateAccessToken(newUser.id);
      const refreshToken = generateRefreshToken(newUser.id);

      // 返回用户信息（不包含密码）和 Token
      const { password: _, ...safeUser } = newUser;

      res.status(201).json(generateSuccessResponse({ 
        user: safeUser,
        accessToken,
        refreshToken
      }, '注册成功'));
    } catch (error) {
      logger.logError('注册失败', { error: error.message, body: req.body });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 用户登录（安全增强版）
  async login(req, res) {
    try {
      const { email, qq, password, verificationCode } = req.body;

      // 获取客户端 IP
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                       req.headers['x-real-ip'] || 
                       req.connection?.remoteAddress || 
                       req.socket?.remoteAddress ||
                       req.ip;

      // 导入 JWT 认证工具
      const { 
        generateAccessToken, 
        generateRefreshToken, 
        generateAdminToken,
        recordLoginAttempt, 
        checkLoginLocked 
      } = require('../middleware/jwtAuth');

      // 验证邮箱
      if (!email) {
        logger.logWarn('登录失败：邮箱为空', { ip: clientIp });
        return res.status(400).json(generateErrorResponse('邮箱不能为空'));
      }

      if (!emailRegex.test(email)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      if (!qq) {
        logger.logWarn('登录失败：QQ号为空', { ip: clientIp });
        return res.status(400).json(generateErrorResponse('QQ号不能为空'));
      }

      if (!password) {
        logger.logWarn('登录失败：密码为空', { qq, ip: clientIp });
        return res.status(400).json(generateErrorResponse('密码不能为空'));
      }

      // 注：图形验证码已在发送登录验证码时校验过（一次性消费），此处不再重复校验

      // 验证验证码
      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('验证码不能为空'));
      }

      // 检查登录是否被锁定
      const lockStatus = await checkLoginLocked(qq);
      if (lockStatus.locked) {
        const remainingMinutes = Math.ceil(lockStatus.lockTimeRemaining / 60000);
        logger.logSecurityEvent('登录被拒绝：账户锁定', { qq, ip: clientIp, remainingMinutes });
        return res.status(429).json(generateErrorResponse(
          `账户已锁定，请 ${remainingMinutes} 分钟后再试`
        ));
      }

      // 验证验证码是否正确（绑定 login 场景）
      const codeVerification = await verifyCode(email, verificationCode, 'login');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('登录失败：验证码验证失败', { email, ip: clientIp });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      // 直接查询用户（避免全量查询）
      const user = await User.findOne({ qq });

      if (!user) {
        // 记录登录失败
        await recordLoginAttempt(qq, false, clientIp);
        logger.logSecurityEvent('登录失败：用户不存在', { qq, ip: clientIp });
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证邮箱是否匹配
      if (user.email.toLowerCase() !== email.toLowerCase()) {
        await recordLoginAttempt(qq, false, clientIp);
        logger.logSecurityEvent('登录失败：邮箱与QQ不匹配', { qq, email, ip: clientIp });
        return res.status(400).json(generateErrorResponse('邮箱与QQ号不匹配'));
      }

      // 验证密码
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        // 记录登录失败
        const attemptResult = await recordLoginAttempt(qq, false, clientIp);
        
        logger.logSecurityEvent('登录失败：密码错误', {
          userId: user.id,
          username: user.username,
          qq: user.qq,
          ip: clientIp,
          attempts: attemptResult.attempts,
          remaining: attemptResult.remaining
        });

        const message = attemptResult.remaining 
          ? `密码错误，还剩 ${attemptResult.remaining} 次尝试机会`
          : '密码错误';
        
        return res.status(401).json(generateErrorResponse(message));
      }

      // 登录成功，清除失败记录
      await recordLoginAttempt(qq, true, clientIp);

      // 封禁检查：仅允许活跃封禁记录拦截；记录已过期/解封时自动恢复账号
      const BannedUser = require('../models/BannedUser');
      const activeBan = await BannedUser.isUserBanned(user.id);
      if (activeBan) {
        logger.logSecurityEvent('封禁用户尝试登录被拒绝', { userId: user.id, qq, ip: clientIp });
        return res.status(403).json(generateErrorResponse('该账号已被封禁，无法登录'));
      }
      if (user.isActive === false) {
        // User.isActive 仍为 false 但无活跃封禁记录 → 封禁已到期/已解封，自动恢复
        await updateUser(user.id, { isActive: true });
        user.isActive = true;
        logger.logInfo('登录时自动恢复已过封禁期的账号', { userId: user.id, qq });
      }

      // 检查是否是管理员
      const { getAdminUsers } = require('../config/constants');
      const adminUsers = getAdminUsers();
      const isAdmin = adminUsers.includes(user.qq) || adminUsers.includes(user.id);

      // 生成 JWT Token
      const accessToken = generateAccessToken(user.id, {
        username: user.username,
        qq: user.qq
      });
      const refreshToken = generateRefreshToken(user.id);

      // 管理员额外生成管理员 Token
      let adminToken = null;
      if (isAdmin) {
        adminToken = generateAdminToken(user.id, {
          username: user.username,
          qq: user.qq
        });
      }

      // 新设备登录检测（记录最近 10 个登录设备，用于安全提示）
      const uaInfo = parseUserAgent(req.headers['user-agent']);
      const isMobile = /移动/.test(uaInfo.device);
      const deviceFingerprint = [uaInfo.source, uaInfo.browser, uaInfo.os, isMobile ? 'mobile' : 'desktop'].join('|');
      const nowIso = new Date().toISOString();
      let loginDevices = user.loginDevices || [];
      const existingDevice = loginDevices.find(d => d && d.fingerprint === deviceFingerprint);
      const isNewDevice = !existingDevice;

      const deviceRecord = {
        fingerprint: deviceFingerprint,
        source: uaInfo.source,
        browser: uaInfo.browser,
        os: uaInfo.os,
        device: uaInfo.device,
        ip: clientIp,
        lastLoginAt: nowIso,
        count: (existingDevice ? existingDevice.count || 0 : 0) + 1
      };
      loginDevices = loginDevices.filter(d => d && d.fingerprint !== deviceFingerprint);
      loginDevices.unshift(deviceRecord);
      loginDevices = loginDevices.slice(0, 10);

      // 更新用户最后登录时间、年级和设备列表
      const currentGrade = calculateCurrentGrade(user.enrollmentYear);
      await updateUser(user.id, {
        lastLogin: nowIso,
        grade: currentGrade,
        loginDevices
      });

      // 新设备登录：站内消息提示（消息列表可见）+ 异步发送安全提醒邮件
      if (isNewDevice) {
        const deviceNotice = `检测到新设备登录：${uaInfo.device || '未知设备'}\n`
          + `系统：${uaInfo.os || '未知'}\n`
          + `IP：${clientIp}\n`
          + `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`
          + '如非本人操作，请尽快修改密码保护账号安全';
        try {
          await createNotification({
            id: uuidv4(),
            userId: user.id,
            target: 'user',
            type: 'system',
            systemType: 'new_device',
            title: '新设备登录提醒',
            message: deviceNotice,
            timestamp: nowIso,
            read: false
          });
        } catch (noticeError) {
          logger.logError('创建新设备登录通知失败', { error: noticeError.message, userId: user.id });
        }
        // 占位邮箱（QQ快捷注册用户未绑定真实邮箱）不发送邮件，避免退信打扰发件人
        if (user.email && !user.email.endsWith('@qq-oauth.local')) {
          sendNewDeviceLoginEmail(user.email, {
            device: uaInfo.device,
            os: uaInfo.os,
            ip: clientIp,
            time: new Date().toLocaleString('zh-CN', { hour12: false })
          });
        }
      }

      user.lastLogin = nowIso;
      user.grade = currentGrade;
      user.loginDevices = loginDevices;

      // 记录用户登录日志
      logger.logUserAction('用户登录', user.id, user.username, {
        isAdmin: isAdmin,
        ip: clientIp
      });

      // 记录安全事件
      logger.logSecurityEvent('login_success', {
        userId: user.id,
        username: user.username,
        qq: user.qq,
        isAdmin: isAdmin,
        ip: clientIp
      });

      // 返回用户信息（不包含密码和MongoDB特有字段）
      // 注意：必须先 toObject() 将 Mongoose 文档转为普通对象，否则展开运算符无法枚举 Schema 字段
      const { password: _, _id, __v, ...safeUser } = user.toObject();

      // 缓存用户信息到Redis
      await userCache.set(user.id, safeUser);

      // 构建响应数据
      const responseData = {
        user: safeUser,
        isAdmin: isAdmin,
        // JWT Token
        token: accessToken,
        refreshToken: refreshToken,
        // 新设备登录检测结果（前端用于安全提示）
        isNewDevice: isNewDevice,
        device: isNewDevice ? {
          source: uaInfo.source,
          browser: uaInfo.browser,
          os: uaInfo.os,
          device: uaInfo.device,
          ip: clientIp,
          time: nowIso
        } : null
      };

      // 管理员返回额外 Token
      if (isAdmin) {
        responseData.adminToken = adminToken;
      }

      res.json(generateSuccessResponse(responseData, isAdmin ? '管理员登录成功' : '登录成功'));
    } catch (error) {
      logger.logError('登录失败', { error: error.message, qq: req.body.qq });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户个人资料
  async getUserProfile(req, res) {
    try {
      const userId = req.params.id;
      // viewerId 来自已认证 JWT，防止客户端伪造
      const viewerId = req.user.id;
      const { getPostsByUserId } = require('../utils/dataUtils');
      const Follow = require('../models/Follow');
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 判断查看者与用户的关系
      const isSelf = viewerId === userId;
      let isFollower = false;
      
      if (viewerId && !isSelf) {
        // 检查是否是粉丝
        const followStatus = await Follow.findOne({ followerId: viewerId, followingId: userId });
        isFollower = !!followStatus;
      }
      
      // 获取用户的帖子
      const activePosts = await getPostsByUserId(userId, false);
      
      // 根据用户的帖子时间范围设置过滤帖子
      const postDisplayRange = user.settings?.privacy?.postDisplayRange || 'all';
      const filteredPostsByTime = filterPostsByTimeRange(activePosts, postDisplayRange, isSelf);
      
      // 根据帖子可见性过滤帖子
      const filteredPosts = filterPostsByVisibility(filteredPostsByTime, userId, viewerId, isFollower);
      
      // 根据隐私设置过滤用户信息（白名单制：他人仅公开字段，敏感 PII 不下发）
      // 管理员查看任意档案时与本人同等可见（后台审计需要）
      const viewer = viewerId && !isSelf ? await User.findOne({ id: viewerId }).select('isAdmin').lean() : null;
      const safeUser = filterUserInfoByPrivacy(user, isSelf, isFollower, !!(viewer && viewer.isAdmin));

      // 计算用户统计数据
      const userStats = {
        postCount: filteredPosts.length,
        commentCount: user.commentCount || 0,
        totalLikes: filteredPosts.reduce((sum, post) => sum + (post.likes || 0), 0),
        totalViews: filteredPosts.reduce((sum, post) => sum + (post.viewCount || 0), 0),
        joinDate: user.createdAt,
        lastLogin: isSelf ? user.lastLogin : null
      };
      
      res.json(generateSuccessResponse({
        user: safeUser,
        stats: userStats,
        recentPosts: filteredPosts.slice(0, 10),
        isSelf,
        isFollower
      }));
    } catch (error) {
      logger.logError('获取用户资料失败', { error: error.message, userId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 修改用户资料
  async updateUserProfile(req, res) {
    try {
      // 安全：仅允许修改自己的资料
      const userId = req.user.id;
      const { currentPassword, newPassword, username, settings, school, enrollmentYear, className, birthday, gender, signature } = req.body;
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      const updateData = {};
      
      // 验证当前密码（如果要修改密码）
      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json(generateErrorResponse('请输入当前密码'));
        }
        
        const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
          return res.status(401).json(generateErrorResponse('当前密码错误'));
        }
        
        // 加密新密码
        updateData.password = await hashPassword(newPassword);
      }
      
      // 更新用户名（如果提供了）
      if (username && username !== user.username) {
        // 检查用户名是否已存在（直接查询，避免全量加载）
        const existingUser = await User.findOne({ username, id: { $ne: userId } });
        if (existingUser) {
          return res.status(400).json(generateErrorResponse('用户名已存在'));
        }
        updateData.username = username;
      }
      
      // 更新学校（如果提供了）
      if (school && school !== user.school) {
        updateData.school = school;
      }
      
      // 更新入学年份（如果提供了）
      if (enrollmentYear && enrollmentYear !== user.enrollmentYear) {
        updateData.enrollmentYear = parseInt(enrollmentYear);
        // 重新计算年级
        const currentGrade = calculateCurrentGrade(enrollmentYear);
        updateData.grade = currentGrade;
      }
      
      // 更新班级（如果提供了）
      if (className && className !== user.className) {
        updateData.className = className;
      }
      
      // 更新出生日期（如果提供了）
      if (birthday !== undefined) {
        updateData.birthday = birthday || null;
      }
      
      // 更新性别（如果提供了）
      if (gender !== undefined) {
        const validGenders = ['male', 'female', 'other', 'secret', ''];
        if (gender && !validGenders.includes(gender)) {
          return res.status(400).json(generateErrorResponse('无效的性别值'));
        }
        // "secret" 在客户端表示保密，映射为空字符串（不在资料页显示）
        updateData.gender = (gender === 'secret') ? '' : (gender || '');
      }
      
      // 更新个性签名（如果提供了）
      if (signature !== undefined) {
        const currentSettings = user.settings || {};
        updateData.settings = { ...currentSettings, ...updateData.settings, signature: signature || '' };
      }

      // 更新头像（如果上传了新头像文件）
      // avatarUpload 中间件已做扩展名↔mimetype 白名单校验（jpg/png/gif/webp）
      if (req.file) {
        updateData.avatar = `/images/avatars/${req.file.filename}`;
      }
      
      // 更新设置（如果提供了）
      if (settings && typeof settings === 'object') {
        // 确保用户有settings对象
        const currentSettings = user.settings || {};
        
        // 合并设置（浅合并），保留已有的 signature 更新
        updateData.settings = { ...currentSettings, ...updateData.settings, ...settings };
      }
      
      const updatedUser = await updateUser(userId, updateData);
      
      // 清除用户缓存
      await userCache.delete(userId);
      
      const { password: _, ...safeUser } = updatedUser;
      
      res.json(generateSuccessResponse({ user: safeUser }, '资料更新成功'));
    } catch (error) {
      logger.logError('更新用户资料失败', { error: error.message, userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新用户设置
  async updateUserSettings(req, res) {
    try {
      // 安全：仅允许修改自己的设置
      const userId = req.user.id;
      // 支持两种格式：直接发送设置对象，或发送 { settings: {...} }
      const settings = req.body.settings || req.body;
      
      if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
        return res.status(400).json(generateErrorResponse('设置数据无效'));
      }
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 确保用户有settings对象
      const currentSettings = user.settings || {};
      
      // 深度合并设置
      const mergedSettings = { ...currentSettings };
      
      // 处理隐私设置的深度合并
      if (settings.privacy) {
        mergedSettings.privacy = {
          ...currentSettings.privacy,
          ...settings.privacy
        };
        
        // 处理 profileVisibility 的深度合并
        if (settings.privacy.profileVisibility) {
          mergedSettings.privacy.profileVisibility = {
            ...(currentSettings.privacy?.profileVisibility || {}),
            ...settings.privacy.profileVisibility
          };
        }
      }
      
      // 合并其他设置
      Object.keys(settings).forEach(key => {
        if (key !== 'privacy') {
          mergedSettings[key] = settings[key];
        }
      });
      
      const updateData = { settings: mergedSettings };
      
      const updatedUser = await updateUser(userId, updateData);
      
      // 清除用户缓存
      await userCache.delete(userId);
      
      const { password: _, ...safeUser } = updatedUser;
      
      res.json(generateSuccessResponse({ user: safeUser }, '设置更新成功'));
    } catch (error) {
      logger.logError('更新用户设置失败', { error: error.message, userId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 上传用户头像
  async uploadAvatar(req, res) {
    try {
      // 安全：仅允许上传到自己的账户
      const userId = req.user.id;
      
      if (!req.file) {
        return res.status(400).json(generateErrorResponse('请选择要上传的头像图片'));
      }
      
      // 验证文件类型（二次防御，与 multer fileFilter 一致；SVG 一律拒绝防脚本注入）
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/heic', 'image/heif'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json(generateErrorResponse('只支持 JPG、PNG、GIF、WEBP 格式的图片'));
      }
      
      // 验证文件大小（10MB限制）
      const maxSize = 10 * 1024 * 1024;
      if (req.file.size > maxSize) {
        return res.status(400).json(generateErrorResponse('图片大小不能超过 10MB'));
      }
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 更新用户头像路径
      const avatar = `/images/avatars/${req.file.filename}`;
      const updatedUser = await updateUser(userId, { avatar });
      
      // 清除用户缓存
      await userCache.delete(userId);
      
      const { password: _, ...safeUser } = updatedUser;
      
      res.json(generateSuccessResponse({ 
        user: safeUser, 
        avatarUrl: avatar 
      }, '头像上传成功'));
    } catch (error) {
      logger.logError('上传头像失败', { error: error.message, userId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 删除用户头像
  async removeAvatar(req, res) {
    try {
      // 安全：仅允许删除自己的头像
      const userId = req.user.id;
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 删除头像（设置为null，使用默认头像）
      const updatedUser = await updateUser(userId, { avatar: null });
      
      // 清除用户缓存
      await userCache.delete(userId);
      
      const { password: _, ...safeUser } = updatedUser;
      
      res.json(generateSuccessResponse({ 
        user: safeUser 
      }, '头像已移除'));
    } catch (error) {
      logger.logError('删除头像失败', { error: error.message, userId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 验证用户登录状态
  async verifyAuth(req, res) {
    try {
      // 身份必须来自 JWT 认证中间件（optionalAuth），绝不信任客户端 body 参数
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json(generateErrorResponse('请先登录'));
      }
      
      // 优先从Redis缓存获取用户信息
      let user = await userCache.get(userId);
      
      if (!user) {
        // 缓存未命中，从数据库获取
        user = await getUserById(userId);
        
        if (!user) {
          return res.status(404).json(generateErrorResponse('用户不存在'));
        }
        
        // 缓存用户信息
        const { password: _, _id, __v, ...safeUser } = user;
        await userCache.set(userId, safeUser);
        user = safeUser;
      }
      
      // 检查是否是管理员
      const { getAdminUsers } = require('../config/constants');
      const adminUsers = getAdminUsers();
      const isAdmin = adminUsers.includes(user.qq) || adminUsers.includes(user.id);
      
      // 检查用户是否被禁用
      const isBanned = user.isActive === false;
      
      res.json(generateSuccessResponse({ 
        user: user,
        isAdmin: isAdmin,
      isBanned: isBanned,
      valid: true
    }, '用户验证通过'));
    } catch (error) {
      logger.logError('验证用户状态失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 发送邮箱修改验证码（需要验证当前密码）
  async sendEmailChangeCode(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { currentPassword, newEmail } = req.body;

      if (!currentPassword) {
        return res.status(400).json(generateErrorResponse('请输入当前密码'));
      }

      if (!newEmail) {
        return res.status(400).json(generateErrorResponse('请输入新邮箱'));
      }

      // 验证邮箱格式
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json(generateErrorResponse('请输入有效的邮箱地址'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证当前密码
      const isPasswordValid = await comparePassword(currentPassword, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('邮箱修改验证码发送失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('当前密码错误'));
      }

      // 检查新邮箱是否已被注册
      const { isEmailRegistered } = require('../utils/dataUtils');
      if (await isEmailRegistered(newEmail)) {
        return res.status(400).json(generateErrorResponse('该邮箱已被其他用户使用'));
      }

      // 发送验证码到新邮箱
      await sendVerificationEmail(newEmail, 'emailChange');

      logger.logUserAction('发送邮箱修改验证码', userId, user.username, { newEmail, ip: req.ip });

      res.json(generateSuccessResponse({}, '验证码已发送到新邮箱'));
    } catch (error) {
      logger.logError('发送邮箱修改验证码失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse(error.message || '发送验证码失败', 500));
    }
  },

  // 验证邮箱修改并完成修改
  async verifyEmailChange(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { verificationCode, newEmail } = req.body;

      if (!verificationCode) {
        return res.status(400).json(generateErrorResponse('验证码不能为空'));
      }

      if (!newEmail) {
        return res.status(400).json(generateErrorResponse('新邮箱不能为空'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证验证码（绑定 emailChange 场景）
      const codeVerification = await verifyCode(newEmail, verificationCode, 'emailChange');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('邮箱修改验证码验证失败', { userId, newEmail, ip: req.ip });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      // 再次检查邮箱是否已被注册
      const { isEmailRegistered } = require('../utils/dataUtils');
      if (await isEmailRegistered(newEmail)) {
        return res.status(400).json(generateErrorResponse('该邮箱已被其他用户使用'));
      }

      // 更新邮箱
      const updatedUser = await updateUser(userId, { email: newEmail.toLowerCase() });

      logger.logUserAction('邮箱修改成功', userId, user.username, { 
        oldEmail: user.email, 
        newEmail: newEmail.toLowerCase(), 
        ip: req.ip 
      });

      const { password: _, ...safeUser } = updatedUser;

      res.json(generateSuccessResponse({ user: safeUser }, '邮箱修改成功'));
    } catch (error) {
      logger.logError('验证邮箱修改失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 修改QQ号
  async changeQQ(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { newQQ, qq, currentPassword } = req.body;
      const qqNumber = newQQ || qq;

      if (!qqNumber) {
        return res.status(400).json(generateErrorResponse('请输入新QQ号'));
      }

      // 验证QQ号格式
      const qqRegex = /^[1-9]\d{4,14}$/;
      if (!qqRegex.test(qqNumber)) {
        return res.status(400).json(generateErrorResponse('请输入有效的QQ号（5-15位数字）'));
      }

      // 获取用户信息
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证当前密码（防止会话被冒用时静默修改账号信息）
      if (!currentPassword) {
        return res.status(400).json(generateErrorResponse('请输入当前密码'));
      }
      const isPasswordValid = await comparePassword(currentPassword, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('QQ号修改失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('当前密码错误'));
      }

      // 检查新QQ号是否已被其他用户使用
      if (await isQQRegistered(qqNumber) && user.qq !== qqNumber) {
        return res.status(400).json(generateErrorResponse('该QQ号已被其他用户使用'));
      }

      // 更新QQ号
      await updateUser(userId, { qq: qqNumber });

      // 重新获取更新后的用户信息
      const updatedUser = await getUserById(userId);

      logger.logUserAction('QQ号修改成功', userId, user.username, { 
        oldQQ: user.qq, 
        newQQ: qqNumber, 
        ip: req.ip 
      });

      const { password: _, ...safeUser } = updatedUser;

      res.json(generateSuccessResponse({ user: safeUser }, 'QQ号修改成功'));
    } catch (error) {
      logger.logError('修改QQ号失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 刷新访问令牌
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json(generateErrorResponse('刷新令牌不能为空'));
      }

      const { verifyToken, generateAccessToken } = require('../middleware/jwtAuth');

      // 验证刷新令牌
      const result = verifyToken(refreshToken);

      if (!result.valid || result.decoded.type !== 'refresh') {
        return res.status(401).json(generateErrorResponse('无效的刷新令牌'));
      }

      // 检查刷新令牌是否已注销（登出/改密后旧 refresh token 不得继续换新 access token）
      const { getRedisClient } = require('../utils/redisUtils');
      try {
        const redis = getRedisClient();
        if (redis) {
          const isBlacklisted = await redis.get(`token_blacklist:${refreshToken}`);
          if (isBlacklisted) {
            return res.status(401).json(generateErrorResponse('刷新令牌已失效，请重新登录'));
          }
        }
      } catch (redisError) {
        // Redis 不可用时跳过黑名单检查，不阻断刷新
        logger.logWarn('刷新令牌黑名单检查跳过（Redis不可用）', { error: redisError.message });
      }

      // 获取用户信息
      const user = await getUserById(result.decoded.userId);
      if (!user) {
        return res.status(401).json(generateErrorResponse('用户不存在'));
      }

      // 生成新的访问令牌
      const newAccessToken = generateAccessToken(user.id, {
        username: user.username,
        qq: user.qq
      });

      res.json(generateSuccessResponse({
        token: newAccessToken
      }, '令牌刷新成功'));
    } catch (error) {
      logger.logError('刷新令牌失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 用户登出
  async logout(req, res) {
    try {
      const { token } = req.body;

      if (token) {
        const { invalidateToken } = require('../middleware/jwtAuth');
        await invalidateToken(token);
      }

      logger.logSecurityEvent('logout', {
        ip: req.ip,
        userId: req.user?.id
      });

      res.json(generateSuccessResponse({}, '登出成功'));
    } catch (error) {
      logger.logError('登出失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员登出
  async adminLogout(req, res) {
    try {
      const { token } = req.body;

      if (token) {
        const { invalidateToken } = require('../middleware/jwtAuth');
        await invalidateToken(token, true);
      }

      logger.logSecurityEvent('admin_logout', {
        ip: req.ip,
        adminId: req.admin?.id
      });

      res.json(generateSuccessResponse({}, '管理员登出成功'));
    } catch (error) {
      logger.logError('管理员登出失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 发送账户注销验证码
  async sendDeletionCode(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json(generateErrorResponse('密码不能为空'));
      }

      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证密码
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('账户注销验证码发送失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('密码错误'));
      }

      // 发送验证码邮件
      await sendVerificationEmail(user.email, 'deletion');

      logger.logUserAction('发送账户注销验证码', userId, user.username, {
        ip: req.ip
      });

      res.json(generateSuccessResponse({ 
        maskedEmail: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') 
      }, '验证码已发送到您的邮箱'));
    } catch (error) {
      logger.logError('发送账户注销验证码失败', { error: error.message });
      res.status(500).json(generateErrorResponse(error.message || '发送验证码失败', 500));
    }
  },

  // 注销用户账户
  async deleteAccount(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人账户
      const userId = req.user.id;
      const { password, verificationCode, keepData } = req.body;

      if (!password || !verificationCode) {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }

      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 验证密码
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        logger.logSecurityEvent('账户注销失败：密码错误', { userId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('密码错误'));
      }

      // 验证验证码
      const codeVerification = await verifyCode(user.email, verificationCode, 'deletion');
      if (!codeVerification.valid) {
        logger.logSecurityEvent('账户注销失败：验证码错误', { userId, ip: req.ip });
        return res.status(400).json(generateErrorResponse(codeVerification.message));
      }

      const keepPosts = keepData === true || keepData === 'true';
      const Post = require('../models/Post');
      const Follow = require('../models/Follow');
      const Favorite = require('../models/Favorite');
      const Notification = require('../models/Notification');
      const Blacklist = require('../models/Blacklist');
      const Message = require('../models/Message');
      const Conversation = require('../models/Conversation');
      const User = require('../models/User');

      // 如果不保留数据，删除用户相关数据
      if (!keepPosts) {
        // 删除用户的所有帖子
        await Post.deleteMany({ userId });
        
        // 删除用户的所有收藏
        await Favorite.deleteMany({ userId });
        
        // 删除用户的黑名单
        // 字段名是 blockerId / blockedId（见 models/Blacklist.js），
        // 此前写成 blocker / blocked 两个分支都不匹配，导致注销后拉黑记录一行都删不掉
        await Blacklist.deleteMany({ $or: [{ blockerId: userId }, { blockedId: userId }] });
      } else {
        // 保留数据但匿名化帖子
        await Post.updateMany(
          { userId },
          { 
            $set: { 
              userId: 'deleted_' + userId,
              username: '已注销用户'
            } 
          }
        );
      }
      
      // 删除关注关系
      await Follow.deleteMany({ $or: [{ followerId: userId }, { followingId: userId }] });
      
      // 删除通知
      // Notification 的字段是 userId（接收者）/ fromUserId（触发者），
      // 此前用的 recipientId / senderId 不存在 → 通知一条都删不掉
      await Notification.deleteMany({ $or: [{ userId }, { fromUserId: userId }] });
      
      // 删除消息和会话
      // Message 的字段是 senderId / receiverId，
      // 此前把接收侧写成 recipientId → 别人发来的私信在注销后仍留在库里（隐私残留）
      await Message.deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] });
      await Conversation.deleteMany({ participants: userId });
      
      // 删除用户头像文件
      if (user.avatar) {
        const fs = require('fs');
        const path = require('path');
        const avatarPath = path.join(__dirname, '../../public', user.avatar);
        if (fs.existsSync(avatarPath)) {
          fs.unlinkSync(avatarPath);
        }
      }
      
      // 删除用户账户
      await User.deleteOne({ id: userId });
      
      // 清除缓存
      await userCache.delete(userId);
      
      logger.logUserAction('账户注销成功', userId, user.username, {
        ip: req.ip,
        keepData: keepPosts
      });
      
      res.json(generateSuccessResponse({}, '账户已注销'));
    } catch (error) {
      logger.logError('注销账户失败', { error: error.message, userId: req.body.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取通知设置
  async getNotificationSettings(req, res) {
    try {
      // userId 来自已认证的 JWT（路由已加 authenticateUser），不信任 params.userId
      const userId = req.user.id;
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      const settings = user.settings?.notifications || {
        like: true,
        comment: true,
        commentReply: true,
        commentLike: true,
        follow: true,
        system: true
      };
      
      res.json(generateSuccessResponse({ settings }));
    } catch (error) {
      logger.logError('获取通知设置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新通知设置
  async updateNotificationSettings(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人设置
      const userId = req.user.id;
      const { type, enabled, ...batchSettings } = req.body;
      
      // 支持逐个更新（旧API）和批量更新（新API）
      const settings = {};
      
      if (type) {
        // 旧API：{ type: 'like', enabled: true }
        settings[type] = enabled === 'true' || enabled === true;
      } else if (Object.keys(batchSettings).length > 0) {
        // 新API：{ like: true, comment: true, ... }
        Object.assign(settings, batchSettings);
      } else {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      if (!user.settings) {
        user.settings = {};
      }
      if (!user.settings.notifications) {
        user.settings.notifications = {
          like: true,
          comment: true,
          commentReply: true,
          commentLike: true,
          follow: true,
          system: true
        };
      }
      
      // 合并新设置
      Object.assign(user.settings.notifications, settings);
      await updateUser(userId, { 'settings.notifications': user.settings.notifications });
      
      res.json(generateSuccessResponse({}, '设置已更新'));
    } catch (error) {
      logger.logError('更新通知设置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新隐私设置
  async updatePrivacySettings(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人设置
      const userId = req.user.id;
      const { field, value, ...batchSettings } = req.body;
      
      // 支持逐个更新（旧API）和批量更新（新API）
      const settings = {};
      
      if (field) {
        // 旧API：{ field: 'hideBlockedPosts', value: true }
        settings[field] = value;
      } else if (Object.keys(batchSettings).length > 0) {
        // 新API：{ hideBlockedPosts: true, hideBlockedComments: false, ... }
        Object.assign(settings, batchSettings);
      } else {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 批量更新：直接保存整个隐私设置对象
      // 前端发送 { hideBlockedPosts, hideBlockedComments, postDisplayRange, profileVisibility, ... }
      // 保存到 settings.privacy 路径下
      if (!user.settings) {
        user.settings = {};
      }
      user.settings.privacy = { ...(user.settings.privacy || {}), ...settings };
      await updateUser(userId, { 'settings.privacy': user.settings.privacy });
      
      // 兼容旧 API：同步更新 top-level privacySettings
      if (!user.privacySettings) {
        user.privacySettings = {
          gender: 'public', birthday: 'public', school: 'public',
          signature: 'public', joinDate: 'public', lastLogin: 'public'
        };
      }
      if (field) {
        user.privacySettings[field] = value;
        await updateUser(userId, { privacySettings: user.privacySettings });
      }
      
      res.json(generateSuccessResponse({}, '设置已更新'));
    } catch (error) {
      logger.logError('更新隐私设置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 导出用户个人数据
  async exportData(req, res) {
    try {
      const userId = req.user.id;

      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 获取请求中指定的导出范围（默认导出全部）
      const { include = 'all' } = req.query;
      const includeAll = include === 'all';
      const includes = include.split(',').map(s => s.trim());
      const want = (key) => includeAll || includes.includes(key);

      const exportResult = {
        exportedAt: new Date().toISOString(),
        exportVersion: '1.0',
        userId: user.id
      };

      // 基本资料
      if (want('profile')) {
        exportResult.profile = {
          username: user.username,
          email: user.email,
          qq: user.qq,
          gender: user.gender,
          birthday: user.birthday,
          school: user.school,
          enrollmentYear: user.enrollmentYear,
          className: user.className,
          grade: user.grade,
          avatar: user.avatar,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          signature: user.settings?.signature || ''
        };
      }

      // 帖子
      if (want('posts')) {
        const Post = require('../models/Post');
        const posts = await Post.find({ userId: user.id }).sort({ timestamp: -1 }).lean();
        exportResult.posts = posts.map(p => ({
          id: p.id,
          title: p.title,
          content: p.content,
          category: p.categoryId || null,
          timestamp: p.timestamp,
          likes: p.likes || 0,
          views: p.views || 0,
          visibility: p.visibility || 'public',
          tags: p.tags || [],
          images: (p.images || []).map(img => img.url)
        }));
      }

      // 收藏
      if (want('favorites')) {
        const Favorite = require('../models/Favorite');
        const favorites = await Favorite.find({ userId: user.id }).sort({ createdAt: -1 }).lean();
        exportResult.favorites = favorites.map(f => ({
          postId: f.postId,
          tagId: f.tagId || null,
          createdAt: f.createdAt
        }));
      }

      // 关注 / 粉丝
      if (want('follows')) {
        const Follow = require('../models/Follow');
        const following = await Follow.find({ followerId: user.id }).lean();
        const followers = await Follow.find({ followingId: user.id }).lean();
        exportResult.follows = {
          followingCount: following.length,
          followingIds: following.map(f => f.followingId),
          followerCount: followers.length,
          followerIds: followers.map(f => f.followerId)
        };
      }

      // 私信会话列表
      // 修正：Conversation 的字段是 updatedAt + lastMessage 子文档，
      // 不存在 lastMessageAt / messageCount（此前排序是空操作、导出值恒为 undefined）
      if (want('messages')) {
        const Conversation = require('../models/Conversation');
        const conversations = await Conversation.find({
          participants: user.id
        }).sort({ updatedAt: -1 }).lean();
        exportResult.conversations = conversations.map(c => ({
          id: c.id,
          participants: c.participants,
          updatedAt: c.updatedAt,
          lastMessage: c.lastMessage || null
        }));
      }

      // 通知记录
      // 修正：字段为 userId / fromUserId / read / timestamp，
      // 不存在 recipientId / senderId / isRead / createdAt（此前导出恒为空数组 + 全 null 字段）
      if (want('notifications')) {
        const Notification = require('../models/Notification');
        const notifications = await Notification.find({
          $or: [{ userId: user.id }, { target: 'all' }]
        })
          .sort({ timestamp: -1 })
          .limit(200)
          .lean();
        exportResult.notifications = notifications.map(n => ({
          type: n.type,
          target: n.target,
          fromUserId: n.fromUserId || null,
          content: n.content || n.message || null,
          // 广播通知的已读状态按用户记录在 readBy 里，个人通知用 read
          read: n.target === 'all'
            ? (Array.isArray(n.readBy) ? n.readBy.includes(user.id) : false)
            : !!n.read,
          timestamp: n.timestamp
        }));
      }

      // 设置
      if (want('settings')) {
        const { password: _p, _id, __v, ...safeUser } = user.toObject ? user.toObject() : { ...user };
        exportResult.settings = safeUser.settings || {};
      }

      logger.logUserAction('用户导出个人数据', userId, user.username, {
        include,
        ip: req.ip
      });

      // 以 attachment JSON 文件流形式返回
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="my-data-${user.id}-${Date.now()}.json"`
      );
      return res.json(exportResult);
    } catch (error) {
      logger.logError('导出用户数据失败', { error: error.message, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 导入用户数据（从 JSON 文件）
  async importData(req, res) {
    try {
      const userId = req.user.id;
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      let data;
      try {
        data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (_) {
        return res.status(400).json(generateErrorResponse('无效的 JSON 格式'));
      }

      // 校验格式版本
      if (!data.exportVersion || !data.userId) {
        return res.status(400).json(
          generateErrorResponse('文件格式无效：这不是有效的校园论坛数据导出文件')
        );
      }

      const { include = 'all' } = req.query;
      const includeAll = include === 'all';
      const includes = include.split(',').map(s => s.trim());
      const want = (key) => includeAll || includes.includes(key);

      const result = {
        postsImported: 0,
        postsSkipped: 0,
        favoritesImported: 0,
        favoritesSkipped: 0,
        followsImported: 0,
        followsSkipped: 0,
        settingsApplied: false,
        skippedTypes: []
      };

      // 帖子导入：建立 oldPostId → newPostId 映射
      const postIdMap = {}; // oldPostId → newPostId
      if (want('posts') && Array.isArray(data.posts) && data.posts.length > 0) {
        const Post = require('../models/Post');
        for (const p of data.posts) {
          try {
            const newId = require('uuid').v4();
            const now = Date.now();
            const newPost = new Post({
              id: newId,
              userId: userId,
              title: p.title || '无标题',
              content: p.content || '',
              categoryId: p.category || null,
              timestamp: p.timestamp || now,
              updatedAt: now,
              // 修复：likes 在 Post schema 中是 Number（此前传 [] 导致 CastError，导入全部失败）
              likes: 0,
              views: 0,
              visibility: p.visibility || 'public',
              tags: Array.isArray(p.tags) ? p.tags : [],
              images: Array.isArray(p.images)
                ? p.images.map(url => ({ url, type: 'image' }))
                : [],
              isEdited: false
            });
            await newPost.save();
            postIdMap[p.id] = newId;
            result.postsImported++;
          } catch (err) {
            logger.logError('导入帖子失败', { error: err.message, oldPostId: p.id });
            result.postsSkipped++;
          }
        }
      } else if (!want('posts')) {
        result.skippedTypes.push('posts');
      }

      // 收藏导入
      if (want('favorites') && Array.isArray(data.favorites) && data.favorites.length > 0) {
        const Favorite = require('../models/Favorite');
        for (const f of data.favorites) {
          // 如果该帖子也导入了，用新 ID；否则跳过
          const mappedPostId = postIdMap[f.postId];
          if (!mappedPostId) {
            result.favoritesSkipped++;
            continue;
          }
          try {
            const existing = await Favorite.findOne({ userId, postId: mappedPostId });
            if (existing) {
              result.favoritesSkipped++;
              continue;
            }
            const fav = new Favorite({
              userId,
              postId: mappedPostId,
              tagId: f.tagId || null,
              createdAt: f.createdAt || new Date()
            });
            await fav.save();
            result.favoritesImported++;
          } catch (err) {
            if (err.code !== 11000) {
              logger.logError('导入收藏失败', { error: err.message });
            }
            result.favoritesSkipped++;
          }
        }
      } else if (!want('favorites')) {
        result.skippedTypes.push('favorites');
      }

      // 关注/粉丝导入：重建关注关系（followingId 为目标用户，只要目标用户存在即可）
      if (want('follows') && data.follows) {
        const Follow = require('../models/Follow');
        // 重建"我关注的用户"列表
        const followingIds = Array.isArray(data.follows.followingIds)
          ? data.follows.followingIds
          : [];
        for (const targetUserId of followingIds) {
          if (targetUserId === userId) continue; // 不能关注自己
          try {
            const existing = await Follow.findOne({ followerId: userId, followingId: targetUserId });
            if (existing) continue;
            const targetUser = await getUserById(targetUserId);
            if (!targetUser) {
              result.followsSkipped++;
              continue;
            }
            const follow = new Follow({
              followerId: userId,
              followingId: targetUserId,
              createdAt: new Date()
            });
            await follow.save();
            result.followsImported++;
          } catch (err) {
            if (err.code !== 11000) {
              logger.logError('导入关注关系失败', { error: err.message });
            }
            result.followsSkipped++;
          }
        }
        // 粉丝（其他用户关注我）：不需要导入，粉丝是被动的
      } else if (!want('follows')) {
        result.skippedTypes.push('follows');
      }

      // 账号设置导入（除密码外）
      if (want('settings') && data.settings) {
        try {
          const allowedSettings = ['theme', 'notifications', 'privacy', 'signature'];
          const currentSettings = user.settings || {};
          for (const key of allowedSettings) {
            if (data.settings[key] !== undefined) {
              currentSettings[key] = data.settings[key];
            }
          }
          await updateUser(userId, { settings: currentSettings });
          result.settingsApplied = true;
        } catch (err) {
          logger.logError('导入设置失败', { error: err.message });
        }
      } else if (!want('settings')) {
        result.skippedTypes.push('settings');
      }

      // profile / messages / notifications 不可导入，跳过
      const nonImportable = ['profile', 'messages', 'notifications'];
      for (const t of nonImportable) {
        if (!result.skippedTypes.includes(t)) result.skippedTypes.push(t);
      }

      logger.logUserAction('用户导入个人数据', userId, user.username, {
        includedTypes: include,
        result,
        ip: req.ip
      });

      res.json(generateSuccessResponse({ data: result }, '数据导入完成'));
    } catch (error) {
      logger.logError('导入用户数据失败', { error: error.message, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // ==================== QQ 快捷登录 ====================

  /**
   * 获取 QQ 授权 URL（type=login 无需登录；type=bind 需登录）
   * GET /api/auth/qq/authorize-url?type=login
   * GET /api/auth/qq/authorize-url-bind （authenticateUser 中间件注入 req.user）
   */
  async getQqAuthorizeUrl(req, res) {
    try {
      if (!qqOAuth.isConfigured()) {
        return res.status(400).json(generateErrorResponse('QQ登录未配置，请联系管理员'));
      }
      const type = req.query.type === 'bind' ? 'bind' : 'login';
      const state = uuidv4();
      const session = { type };
      if (type === 'bind' && req.user) {
        session.userId = req.user.id;
      }
      await qqCache.set(state, session);
      const url = qqOAuth.getAuthorizeUrl(state);
      res.json(generateSuccessResponse({ url, state }, 'OK'));
    } catch (error) {
      logger.logError('获取QQ授权URL失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * QQ 授权回调（QQ 服务器重定向到此处）
   * GET /api/auth/qq/callback?code=xxx&state=yyy
   * 处理结果写入会话，302 重定向到前端 qq-callback.html?state=yyy
   */
  async qqCallback(req, res) {
    const { code, state } = req.query;
    const failRedirect = (msg) => {
      const url = `/qq-callback.html?state=${encodeURIComponent(state || '')}&error=1&message=${encodeURIComponent(msg || 'QQ授权失败')}`;
      res.redirect(url);
    };

    try {
      if (!code || !state) return failRedirect('QQ授权参数缺失');
      const session = await qqCache.get(state);
      if (!session) return failRedirect('QQ授权会话已过期，请重新登录');

      let profile;
      try {
        profile = await qqOAuth.getQqProfile(code);
      } catch (e) {
        logger.logError('QQ授权回调获取用户信息失败', { error: e.message, state });
        return failRedirect(e.message || 'QQ授权失败');
      }

      // 该 openid 是否已注册
      const existing = await User.findOne({ qqOpenId: profile.openid }).lean();

      if (session.type === 'bind') {
        // ===== 绑定场景（需登录）=====
        if (existing) {
          session.result = existing.id === session.userId
            ? { bound: true, same: true, nickname: profile.nickname, avatar: profile.avatar }
            : { bound: false, error: '该QQ已绑定其他账号' };
        } else {
          await updateUser(session.userId, { qqOpenId: profile.openid, avatar: profile.avatar || null });
          session.result = { bound: true, nickname: profile.nickname, avatar: profile.avatar };
        }
        await qqCache.set(state, session);
        return res.redirect(`/qq-callback.html?state=${encodeURIComponent(state)}`);
      }

      // ===== 登录场景 =====
      if (existing) {
        // 已有账号：构建登录响应
        const payload = await buildAuthPayload(existing, req);
        session.profile = profile;
        session.result = { needProfile: false, ...payload.responseData };
      } else {
        // 新用户：预注册，前端补全资料
        session.profile = profile;
        session.result = { needProfile: true };
      }
      await qqCache.set(state, session);
      return res.redirect(`/qq-callback.html?state=${encodeURIComponent(state)}`);
    } catch (error) {
      logger.logError('QQ授权回调失败', { error: error.message, state });
      return failRedirect('QQ授权处理失败');
    }
  },

  /**
   * 前端取 QQ 授权结果（state 为凭证，会话 TTL 10 分钟兜底）
   * GET /api/auth/qq/result?state=xxx
   */
  async getQqResult(req, res) {
    try {
      const { state } = req.query;
      if (!state) return res.status(400).json(generateErrorResponse('参数缺失'));
      const session = await qqCache.get(state);
      if (!session) return res.status(404).json(generateErrorResponse('QQ授权会话已过期，请重新登录'));
      const profile = session.profile || {};
      res.json(generateSuccessResponse({
        type: session.type,
        result: session.result || null,
        prefill: profile.nickname ? {
          nickname: profile.nickname,
          avatar: profile.avatar || '',
          gender: profile.gender || ''
        } : null,
        state
      }, 'OK'));
    } catch (error) {
      logger.logError('获取QQ授权结果失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * QQ 新用户补全资料并注册（学校/班级/入学年份等手动设置）
   * POST /api/auth/qq/complete-profile
   * body: { state, username, school, enrollmentYear, className, birthday?, gender? }
   */
  async qqCompleteProfile(req, res) {
    try {
      const { state, username, school, enrollmentYear, className, birthday, gender } = req.body;
      if (!state) return res.status(400).json(generateErrorResponse('参数缺失'));
      const session = await qqCache.get(state);
      if (!session || !session.profile || !session.profile.openid) {
        return res.status(400).json(generateErrorResponse('QQ授权会话已过期，请重新登录'));
      }
      const profile = session.profile;

      // 防重复：openid 可能已被注册（如另一浏览器同时完成补全）
      if (await User.findOne({ qqOpenId: profile.openid })) {
        return res.status(400).json(generateErrorResponse('该QQ已绑定账号，请直接登录'));
      }

      if (!username || !username.trim()) return res.status(400).json(generateErrorResponse('用户名不能为空'));
      if (!school || !school.trim()) return res.status(400).json(generateErrorResponse('学校不能为空'));
      if (!className || !className.trim()) return res.status(400).json(generateErrorResponse('班级不能为空'));

      // 用户名冲突加后缀
      let finalUsername = username.trim();
      let suffix = 1;
      while (await isUsernameExists(finalUsername)) {
        finalUsername = `${username.trim()}_${suffix++}`;
      }

      const year = enrollmentYear ? (parseInt(enrollmentYear, 10) || new Date().getFullYear()) : new Date().getFullYear();
      const currentGrade = calculateCurrentGrade(year);
      // openid 为 32 位十六进制，取末 10 位生成占位 QQ/邮箱（唯一；用户可后续在设置中修改）
      const openidSuffix = profile.openid.slice(-10);

      const newUser = {
        id: uuidv4(),
        qq: `q${openidSuffix}`,
        qqOpenId: profile.openid,
        username: finalUsername,
        email: `qq${openidSuffix}@qq-oauth.local`,
        password: require('crypto').randomBytes(16).toString('hex'), // 随机密码，QQ用户通过QQ登录
        passwordChangedAt: new Date(),
        school: school.trim(),
        enrollmentYear: year,
        className: className.trim(),
        grade: currentGrade,
        birthday: birthday || null,
        gender: gender || profile.gender || '',
        avatar: profile.avatar || null,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        postCount: 0,
        commentCount: 0,
        isActive: true,
        settings: {},
        loginDevices: []
      };

      const created = await createUser(newUser);
      await qqCache.del(state); // 一次性消费

      // 构建登录响应
      const payload = await buildAuthPayload(created, req);
      res.json(generateSuccessResponse(payload.responseData, '注册成功'));
    } catch (error) {
      logger.logError('QQ补全资料注册失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 解绑 QQ（QQ 快捷注册占位账号禁止解绑，否则无法登录）
   * POST /api/auth/qq/unbind （authenticateUser）
   */
  async unbindQq(req, res) {
    try {
      const userId = req.user.id;
      const user = await getUserById(userId);
      if (!user) return res.status(404).json(generateErrorResponse('用户不存在'));
      if (!user.qqOpenId) return res.status(400).json(generateErrorResponse('当前账号未绑定QQ'));
      // q 开头 + 10 位 hex 为占位号，解绑后无法登录
      if (typeof user.qq === 'string' && /^q[a-f0-9]{10}$/.test(user.qq)) {
        return res.status(400).json(generateErrorResponse('该账号为QQ快捷注册，解绑后将无法登录，暂不支持解绑'));
      }
      await updateUser(userId, { qqOpenId: null });
      res.json(generateSuccessResponse({}, 'QQ解绑成功'));
    } catch (error) {
      logger.logError('QQ解绑失败', { error: error.message, userId: req.user.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 查询 QQ 绑定状态（设置页用）
   * GET /api/auth/qq/bind-status （authenticateUser）
   */
  async getQqBindStatus(req, res) {
    try {
      const user = await getUserById(req.user.id);
      if (!user) return res.status(404).json(generateErrorResponse('用户不存在'));
      res.json(generateSuccessResponse({
        qqBound: !!user.qqOpenId,
        qqPlaceholder: !!(typeof user.qq === 'string' && /^q[a-f0-9]{10}$/.test(user.qq)),
        configured: qqOAuth.isConfigured()
      }, 'OK'));
    } catch (error) {
      logger.logError('查询QQ绑定状态失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * QQ 登录配置状态（登录页判断是否显示按钮）
   * GET /api/auth/qq/status
   */
  async getQqStatus(req, res) {
    try {
      res.json(generateSuccessResponse({ configured: qqOAuth.isConfigured() }, 'OK'));
    } catch (error) {
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

// 辅助函数：根据时间范围过滤帖子
function filterPostsByTimeRange(posts, range, isSelf) {
  // 如果是自己查看，显示所有帖子
  if (isSelf) {
    return posts;
  }
  
  const now = new Date();
  let cutoffDate;
  
  switch (range) {
    case '3days':
      cutoffDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      break;
    case '7days':
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1month':
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '6months':
      cutoffDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      break;
    case '1year':
      cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      return posts;
  }
  
  return posts.filter(post => new Date(post.timestamp) >= cutoffDate);
}

// 辅助函数：根据帖子可见性过滤帖子
function filterPostsByVisibility(posts, authorId, viewerId, isFollower) {
  return posts.filter(post => {
    const visibility = post.visibility || 'public';
    
    // 公开帖子：所有人可见
    if (visibility === 'public') {
      return true;
    }
    
    // 仅自己可见：只有作者可见
    if (visibility === 'self') {
      return viewerId === authorId;
    }
    
    // 仅粉丝可见：粉丝和作者可见
    if (visibility === 'followers') {
      return viewerId === authorId || isFollower;
    }
    
    return true;
  });
}

// 辅助函数：根据身份与隐私设置过滤用户信息
// 安全规则（2026-08-10 渗透测试修复：修复 IDOR / PII 过度暴露）：
// - 本人 / 管理员：返回完整档案（仍剔除 password / qqOpenId 等内部字段）
// - 其他用户：仅返回公开白名单字段（id/username/avatar/school/grade/
//   enrollmentYear/className/postCount/commentCount/createdAt/isAdmin）+
//   settings.signature + 用户通过隐私设置显式公开的 gender/birthday
//   （profileVisibility 设为 public 或 followers 且查看者是粉丝）；
//   email / qq / loginDevices / lastLogin / settings(除 signature) /
//   qqOpenId 等敏感字段一律不下发
function filterUserInfoByPrivacy(user, isSelf, isFollower, isAdminViewer) {
  // 内部字段永远不出接口
  const { password, qqOpenId, ...safeUser } = user;

  // 本人或管理员：显示完整档案
  if (isSelf || isAdminViewer) {
    return safeUser;
  }

  const profileVisibility = user.settings?.privacy?.profileVisibility || {};

  // 字段是否可见：仅显式设置为 public 或（followers 且查看者是粉丝）
  const isFieldVisible = (field) => {
    const visibility = profileVisibility[field];
    if (visibility === 'public') return true;
    if (visibility === 'followers') return isFollower;
    return false; // 未设置 / self → 不公开
  };

  // 白名单：固定公开字段
  const filteredUser = {};
  for (const field of ['id', 'username', 'avatar', 'school', 'grade', 'enrollmentYear', 'className', 'postCount', 'commentCount', 'createdAt', 'isAdmin']) {
    if (safeUser[field] !== undefined) {
      filteredUser[field] = safeUser[field];
    }
  }

  // 签名（前端从 settings.signature 读取，保持结构）
  filteredUser.settings = { signature: safeUser.settings?.signature || '' };

  // 用户显式公开的可选字段
  if (isFieldVisible('gender') && safeUser.gender) {
    filteredUser.gender = safeUser.gender;
  }
  if (isFieldVisible('birthday') && safeUser.birthday) {
    filteredUser.birthday = safeUser.birthday;
  }

  return filteredUser;
}

/**
 * 生成验证码 SVG 图片
 * 随机 4 位数字，带干扰线和噪点
 */
function generateCaptchaSvg(code) {
  const width = 150;
  const height = 52;

  // 为每个字符生成随机位置、旋转、倾斜和大小变化
  const chars = code.split('').map((char, i) => {
    const x = 20 + i * 30;
    const y = 32 + Math.random() * 12 - 6;
    const rotate = Math.random() * 50 - 25;          // ±25度旋转（原 ±10）
    const skewX = Math.random() * 20 - 10;            // 水平倾斜 ±10度
    const charFontSize = 26 + Math.floor(Math.random() * 8); // 26-34 随机大小
    const r = Math.floor(Math.random() * 80);
    const g = Math.floor(Math.random() * 80);
    const b = Math.floor(Math.random() * 80 + 40);
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${charFontSize}" font-weight="bold" fill="rgb(${r},${g},${b})" transform="rotate(${rotate},${x},${y}) skewX(${skewX})">${char}</text>`;
  }).join('');

  // 生成贝塞尔曲线干扰线（比直线更难被 OCR 过滤）
  const curves = Array.from({ length: 3 }, () => {
    const x1 = Math.random() * width * 0.3;
    const y1 = Math.random() * height;
    const cx1 = Math.random() * width * 0.5 + width * 0.2;
    const cy1 = Math.random() * height;
    const cx2 = Math.random() * width * 0.5 + width * 0.4;
    const cy2 = Math.random() * height;
    const x2 = width - Math.random() * width * 0.3;
    const y2 = Math.random() * height;
    const r = Math.floor(Math.random() * 150 + 100);
    const g = Math.floor(Math.random() * 150 + 100);
    const b = Math.floor(Math.random() * 150 + 100);
    return `<path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" stroke="rgba(${r},${g},${b},0.5)" stroke-width="1.5" fill="none"/>`;
  }).join('');

  // 生成直线干扰线
  const lines = Array.from({ length: 3 }, () => {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    const r = Math.floor(Math.random() * 150 + 100);
    const g = Math.floor(Math.random() * 150 + 100);
    const b = Math.floor(Math.random() * 150 + 100);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(${r},${g},${b},0.4)" stroke-width="1"/>`;
  }).join('');

  // 生成圆形噪点
  const dots = Array.from({ length: 80 }, () => {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.floor(Math.random() * 200);
    const g = Math.floor(Math.random() * 200);
    const b = Math.floor(Math.random() * 200);
    const radius = 0.5 + Math.random() * 1.5;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="rgba(${r},${g},${b},0.6)"/>`;
  }).join('');

  // 生成不规则色块噪点（小矩形 + 小线段，覆盖在字符上方）
  const blocks = Array.from({ length: 30 }, () => {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const w = 2 + Math.random() * 6;
    const h = 1 + Math.random() * 3;
    const rotate = Math.random() * 180;
    const r = Math.floor(Math.random() * 200);
    const g = Math.floor(Math.random() * 200);
    const b = Math.floor(Math.random() * 200);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(${r},${g},${b},0.35)" transform="rotate(${rotate},${x + w / 2},${y + h / 2})"/>`;
  }).join('');

  // 渲染顺序：背景 → 字符 → 干扰元素（字符被干扰覆盖，增加识别难度）
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f0f0f0" rx="4"/>${chars}${curves}${lines}${dots}${blocks}</svg>`;
}

/**
 * 构建登录成功响应（JWT 签发 + 新设备检测 + 站内/邮件提醒）——QQ 登录复用
 * 与 login 控制器逻辑一致，返回 { responseData }
 */
async function buildAuthPayload(user, req) {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection?.remoteAddress ||
                   req.socket?.remoteAddress ||
                   req.ip;

  const {
    generateAccessToken,
    generateRefreshToken,
    generateAdminToken
  } = require('../middleware/jwtAuth');

  const { getAdminUsers } = require('../config/constants');
  const adminUsers = getAdminUsers();
  const isAdmin = adminUsers.includes(user.qq) || adminUsers.includes(user.id);

  const accessToken = generateAccessToken(user.id, { username: user.username, qq: user.qq });
  const refreshToken = generateRefreshToken(user.id);
  let adminToken = null;
  if (isAdmin) adminToken = generateAdminToken(user.id, { username: user.username, qq: user.qq });

  // 新设备登录检测
  const uaInfo = parseUserAgent(req.headers['user-agent']);
  const isMobile = /移动/.test(uaInfo.device);
  const deviceFingerprint = [uaInfo.source, uaInfo.browser, uaInfo.os, isMobile ? 'mobile' : 'desktop'].join('|');
  const nowIso = new Date().toISOString();
  let loginDevices = user.loginDevices || [];
  const existingDevice = loginDevices.find(d => d && d.fingerprint === deviceFingerprint);
  const isNewDevice = !existingDevice;

  const deviceRecord = {
    fingerprint: deviceFingerprint,
    source: uaInfo.source,
    browser: uaInfo.browser,
    os: uaInfo.os,
    device: uaInfo.device,
    ip: clientIp,
    lastLoginAt: nowIso,
    count: (existingDevice ? existingDevice.count || 0 : 0) + 1
  };
  loginDevices = loginDevices.filter(d => d && d.fingerprint !== deviceFingerprint);
  loginDevices.unshift(deviceRecord);
  loginDevices = loginDevices.slice(0, 10);

  const currentGrade = calculateCurrentGrade(user.enrollmentYear);
  await updateUser(user.id, { lastLogin: nowIso, grade: currentGrade, loginDevices });

  // 新设备：站内消息 + 邮件提醒
  if (isNewDevice) {
    const deviceNotice = `检测到新设备登录：${uaInfo.device || '未知设备'}\n`
      + `系统：${uaInfo.os || '未知'}\n`
      + `IP：${clientIp}\n`
      + `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`
      + '如非本人操作，请尽快修改密码保护账号安全';
    try {
      await createNotification({
        id: uuidv4(),
        userId: user.id,
        target: 'user',
        type: 'system',
        systemType: 'new_device',
        title: '新设备登录提醒',
        message: deviceNotice,
        timestamp: nowIso,
        read: false
      });
    } catch (e) {
      logger.logError('创建新设备登录通知失败', { error: e.message, userId: user.id });
    }
    // 占位邮箱（QQ快捷注册用户未绑定真实邮箱）不发送邮件，避免退信打扰发件人
    if (user.email && !user.email.endsWith('@qq-oauth.local')) {
      sendNewDeviceLoginEmail(user.email, {
        device: uaInfo.device,
        os: uaInfo.os,
        ip: clientIp,
        time: new Date().toLocaleString('zh-CN', { hour12: false })
      });
    }
  }

  user.lastLogin = nowIso;
  user.grade = currentGrade;
  user.loginDevices = loginDevices;

  logger.logUserAction('QQ快捷登录', user.id, user.username, { isAdmin, ip: clientIp });
  logger.logSecurityEvent('qq_login_success', { userId: user.id, username: user.username, isAdmin, ip: clientIp });

  // 兼容 Mongoose document 与 lean 对象
  const { password: _, _id, __v, ...safeUser } = user.toObject ? user.toObject() : { ...user };
  await userCache.set(user.id, safeUser);

  const responseData = {
    user: safeUser,
    isAdmin,
    token: accessToken,
    refreshToken,
    isNewDevice,
    device: isNewDevice ? {
      source: uaInfo.source,
      browser: uaInfo.browser,
      os: uaInfo.os,
      device: uaInfo.device,
      ip: clientIp,
      time: nowIso
    } : null
  };
  if (isAdmin) responseData.adminToken = adminToken;

  return { responseData };
}

module.exports = userController;
