const nodemailer = require('nodemailer');
const logger = require('./logger');
const { verificationCode, isRedisConnected } = require('./redisUtils');

// 内存存储作为备用（当Redis不可用时）
const memoryStore = new Map();

// 清理过期的内存验证码（每5分钟执行一次）
// .unref()：不因这个定时器把进程钉住（否则测试/子进程会一直不退出）
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// 创建邮件传输器
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// 生成6位随机验证码
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// 生成邮件HTML模板
const generateEmailTemplate = (code, scenario = 'register') => {
  // 根据场景定义不同的配置
  const scenarios = {
    register: {
      title: '邮箱验证码',
      welcome: '亲爱的同学，您好！<br><br>感谢您选择加入校园论坛。为了保障您的账户安全，我们为您准备了验证码以完成注册。',
      subject: '【校园论坛】注册验证码',
      features: [
        { icon: '📚', text: '学习交流' },
        { icon: '💬', text: '实时互动' },
        { icon: '🎯', text: '资源共享' }
      ]
    },
    login: {
      title: '登录验证码',
      welcome: '亲爱的同学，您好！<br><br>我们检测到您正在尝试登录校园论坛。为了保护您的账户安全，请使用以下验证码完成登录。',
      subject: '【校园论坛】登录验证码',
      features: [
        { icon: '🔐', text: '安全登录' },
        { icon: '🛡️', text: '账户保护' },
        { icon: '⚡', text: '快速验证' }
      ]
    },
    password: {
      title: '密码修改验证码',
      welcome: '亲爱的同学，您好！<br><br>我们收到了您修改密码的请求。为了确保是您本人操作，请使用以下验证码完成密码修改。',
      subject: '【校园论坛】密码修改验证码',
      features: [
        { icon: '🔒', text: '安全修改' },
        { icon: '🔄', text: '快速更新' },
        { icon: '✅', text: '验证通过' }
      ]
    },
    deletion: {
      title: '账户注销验证码',
      welcome: '亲爱的同学，您好！<br><br>我们收到了您注销账户的请求。这是一个不可逆的操作，为了确保是您本人操作，请使用以下验证码完成账户注销。',
      subject: '【校园论坛】账户注销验证码',
      features: [
        { icon: '⚠️', text: '谨慎操作' },
        { icon: '🔒', text: '安全验证' },
        { icon: '❌', text: '不可恢复' }
      ]
    }
  };

  const config = scenarios[scenario] || scenarios.register;

  return `
    <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* 邮件兼容样式 */
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background-color: #f7f9fc;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
    }
    .header {
      background: linear-gradient(135deg, #6c8eff 0%, #5b67d8 100%);
      padding: 40px 20px;
      text-align: center;
      color: white;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 10px;
      line-height: 1;
    }
    .title {
      font-size: 28px;
      font-weight: 700;
      margin: 0;
      letter-spacing: 1px;
    }
    .content {
      padding: 40px;
      color: #1e293b;
    }
    .welcome {
      font-size: 16px;
      margin-bottom: 30px;
      line-height: 1.6;
      color: #475569;
    }
    .code-container {
      background: #f0f5ff;
      padding: 30px;
      border-radius: 16px;
      text-align: center;
      margin: 30px 0;
      border: 1px solid #d9e6ff;
      box-shadow: 0 8px 20px rgba(108, 142, 255, 0.15);
    }
    .code-label {
      font-size: 14px;
      color: #6c8eff;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 2px;
      font-weight: 600;
    }
    .code {
      font-size: 42px;
      font-weight: 800;
      color: #1e3a8a;
      letter-spacing: 8px;
      font-family: 'Courier New', monospace;
      background: white;
      padding: 16px 32px;
      border-radius: 12px;
      display: inline-block;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .warning {
      background: #fff8e7;
      border-left: 4px solid #fbbf24;
      padding: 16px;
      margin: 30px 0 20px;
      border-radius: 8px;
      font-size: 14px;
      color: #92400e;
    }
    .features {
      display: flex;
      justify-content: space-around;
      margin: 30px 0 10px;
      padding: 20px 0;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
    }
    .feature {
      text-align: center;
    }
    .feature-icon {
      font-size: 24px;
      color: #6c8eff;
      margin-bottom: 8px;
    }
    .feature-text {
      font-size: 13px;
      color: #64748b;
      font-weight: 500;
    }
    .footer {
      background: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 6px 0;
    }
    a {
      color: #6c8eff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🎓</div>
      <h1 class="title">校园论坛</h1>
    </div>
    
    <div class="content">
      <p class="welcome">
        ${config.welcome}
      </p>
      
      <div class="code-container">
        <div class="code-label">${config.title}</div>
        <div class="code">${code}</div>
      </div>
      
      <div class="warning">
        ⚠️ 验证码有效期为 <strong>5分钟</strong>，请尽快使用。请勿将验证码泄露给他人。
      </div>
      
      <div class="features">
        ${config.features.map(f => `
          <div class="feature">
            <div class="feature-icon">${f.icon}</div>
            <div class="feature-text">${f.text}</div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="footer">
      <p>此邮件由系统自动发送，请勿回复</p>
      <p>&copy; 2026 校园论坛 · 保留所有权利</p>
    </div>
  </div>
</body>
</html>
  `;
};

// 发送验证码邮件
const sendVerificationEmail = async (email, scenario = 'register') => {
  try {
    // 统一使用小写邮箱作为 key
    const normalizedEmail = email.toLowerCase();
    
    // 检查是否在短时间内重复请求（按邮箱+场景）
    if (isRedisConnected()) {
      const inInterval = await verificationCode.isInInterval(normalizedEmail, scenario);
      if (inInterval) {
        throw new Error('请等待60秒后再次获取验证码');
      }
    } else {
      // 备用：内存存储检查
      const lastCode = memoryStore.get(`${scenario}:${normalizedEmail}`);
      if (lastCode && Date.now() - lastCode.timestamp < 60000) {
        throw new Error('请等待60秒后再次获取验证码');
      }
    }

    // 生成验证码
    const code = generateVerificationCode();

    // 创建邮件传输器
    const transporter = createTransporter();

    // 根据场景获取配置
    const scenarios = {
      register: '【校园论坛】注册验证码',
      login: '【校园论坛】登录验证码',
      password: '【校园论坛】密码修改验证码',
      deletion: '【校园论坛】账户注销验证码'
    };
    const subject = scenarios[scenario] || scenarios.register;

    // 生成HTML邮件模板
    const htmlTemplate = generateEmailTemplate(code, scenario);

    // 发送邮件
    const info = await transporter.sendMail({
      from: `"校园论坛" <${process.env.SMTP_USER}>`,
      to: email, // 发送给原始邮箱地址
      subject: subject,
      html: htmlTemplate
    });

    // 存储验证码（key 带场景前缀，防止跨场景使用）
    if (isRedisConnected()) {
      await verificationCode.set(normalizedEmail, code, scenario);
      logger.logInfo('验证码已存储到Redis', { email, scenario });
    } else {
      // 备用：内存存储
      memoryStore.set(`${scenario}:${normalizedEmail}`, {
        code,
        timestamp: Date.now()
      });
      logger.logInfo('验证码已存储到内存（Redis未连接）', { email, scenario });
    }

    logger.logInfo('验证码邮件发送成功', { email, scenario, messageId: info.messageId });

    return {
      success: true,
      message: '验证码已发送'
    };
  } catch (error) {
    logger.logError('发送验证码邮件失败', { email, error: error.message });
    throw error;
  }
};

/**
 * 新设备登录提醒邮件
 * @param {string} email - 用户邮箱
 * @param {object} info - { device, browser, os, ip, time }
 */
const sendNewDeviceLoginEmail = async (email, info = {}) => {
  try {
    const transporter = createTransporter();
    const now = new Date().toLocaleString('zh-CN', { hour12: false });

    const html = `
  <div style="font-family:'Microsoft YaHei',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f5f7fa;border-radius:12px;">
    <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06);">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:#fff7e6;display:flex;align-items:center;justify-content:center;font-size:26px;">⚠️</div>
        <h2 style="margin:0;font-size:20px;color:#1a1a1a;">检测到新设备登录</h2>
      </div>
      <p style="color:#666;font-size:14px;line-height:1.8;">您的账号在以下新设备上完成了登录：</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;margin:16px 0;">
        <tr>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:8px 0 0 8px;width:80px;color:#999;">设备</td>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:0 8px 8px 0;">${info.device || '未知'}</td>
        </tr>
        <tr><td style="padding:6px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:8px 0 0 8px;color:#999;">系统</td>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:0 8px 8px 0;">${info.os || '未知'}</td>
        </tr>
        <tr><td style="padding:6px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:8px 0 0 8px;color:#999;">IP 地址</td>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:0 8px 8px 0;"><code style="background:#eee;padding:2px 8px;border-radius:4px;">${info.ip || '未知'}</code></td>
        </tr>
        <tr><td style="padding:6px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:8px 0 0 8px;color:#999;">登录时间</td>
          <td style="padding:10px 14px;background:#f8f8f8;border-radius:0 8px 8px 0;">${info.time || now}</td>
        </tr>
      </table>
      <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:12px 16px;color:#ad6800;font-size:13px;line-height:1.7;">
        <strong>如果这不是您本人的操作</strong>，请立即登录并修改密码，以保护账号安全。
      </div>
      <div style="text-align:center;margin-top:24px;color:#bbb;font-size:12px;">
        此邮件由校园论坛系统自动发送，请勿直接回复
      </div>
    </div>
  </div>
  `;

    await transporter.sendMail({
      from: `"校园论坛" <${process.env.SMTP_USER}>`,
      to: email,
      subject: '【校园论坛】安全提醒：检测到新设备登录',
      html
    });

    logger.logSecurityEvent('new_device_login_email_sent', { email, ip: info.ip });
    return { success: true };
  } catch (error) {
    logger.logError('发送新设备登录提醒邮件失败', { email, error: error.message });
    return { success: false };
  }
};

// 验证验证码（scenario 绑定用途，防止跨场景复用）
const verifyCode = async (email, code, scenario = 'default') => {
  // 统一使用小写邮箱作为 key
  const normalizedEmail = email.toLowerCase();
  
  // 优先使用Redis
  if (isRedisConnected()) {
    return await verificationCode.verify(normalizedEmail, code, scenario);
  }
  
  // 备用：内存存储验证
  const storedData = memoryStore.get(`${scenario}:${normalizedEmail}`);
  
  if (!storedData) {
    return { valid: false, message: '验证码不存在或已过期' };
  }
  
  // 检查验证码是否过期（5分钟）
  if (Date.now() - storedData.timestamp > 5 * 60 * 1000) {
    memoryStore.delete(`${scenario}:${normalizedEmail}`);
    return { valid: false, message: '验证码已过期' };
  }
  
  // 验证验证码是否正确
  if (storedData.code !== code) {
    return { valid: false, message: '验证码错误' };
  }
  
  // 验证成功，删除验证码
  memoryStore.delete(`${scenario}:${normalizedEmail}`);
  
  return { valid: true, message: '验证码验证成功' };
};

module.exports = {
  sendVerificationEmail,
  sendNewDeviceLoginEmail,
  verifyCode
};
