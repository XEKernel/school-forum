/**
 * 安全配置模块
 * 管理所有安全相关的配置项
 */
require('dotenv').config();

const path = require('path');

// JWT 配置
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  issuer: 'school-forum',
  audience: 'school-forum-users'
};

// 管理员 JWT 配置
const ADMIN_JWT_CONFIG = {
  secret: process.env.ADMIN_JWT_SECRET,
  expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '24h',
  issuer: 'school-forum-admin',
  audience: 'school-forum-admin'
};

// 启动时校验关键安全配置
if (!JWT_CONFIG.secret) {
  console.error('[SECURITY] JWT_SECRET 未配置！请在 .env 文件中设置 JWT_SECRET');
  process.exit(1);
}
if (!ADMIN_JWT_CONFIG.secret) {
  console.error('[SECURITY] ADMIN_JWT_SECRET 未配置！请在 .env 文件中设置 ADMIN_JWT_SECRET');
  process.exit(1);
}

// CORS 配置
// 自动检测允许的域名列表
const getAllowedOrigins = () => {
  const origins = [];
  
  // 从环境变量添加配置的域名
  if (process.env.CORS_ORIGIN) {
    origins.push(...process.env.CORS_ORIGIN.split(',').map(o => o.trim()));
  }
  
  // 添加 localhost 默认值（如果没配置其他）
  if (origins.length === 0) {
    origins.push('http://localhost:2080', 'http://127.0.0.1:2080');
  }
  
  // 自动添加服务器 IP（从环境变量或请求头检测）
  if (process.env.SERVER_IP) {
    origins.push(`http://${process.env.SERVER_IP}:3000`);
    origins.push(`http://${process.env.SERVER_IP}:2080`);
  }
  
  // 开发模式下添加所有本地 IP 段
  if (process.env.NODE_ENV === 'development') {
    origins.push(/^http:\/\/192\.168\.\d+\.\d+:\d+$/);
    origins.push(/^http:\/\/10\.\d+\.\d+\.\d+:\d+$/);
    origins.push(/^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/);
    origins.push(/^http:\/\/localhost:\d+$/);
  }
  
  return origins;
};

const CORS_CONFIG = {
  // 允许的域名列表
  origins: getAllowedOrigins(),
  // 开发模式下是否允许所有来源（已废弃：安全风险，CORS 凭据 + 任意 Origin 可导致 CSRF）
  allowAllInDev: false,
  // CORS 选项
  options: {
    origin: function (origin, callback) {
      // 允许无 origin 的请求（如移动应用、Postman、服务器间调用）
      if (!origin) return callback(null, true);
      
      // 开发/生产统一白名单验证
      const isAllowed = CORS_CONFIG.origins.some(allowed => {
        if (allowed instanceof RegExp) return allowed.test(origin);
        return allowed === origin;
      });
      
      if (isAllowed) return callback(null, true);
      
      // 拒绝未授权来源：不设置 CORS 头（浏览器将阻止请求）
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400 // 24小时
  }
};

// Helmet 安全头配置
// 检测是否使用 HTTPS（生产环境应使用 HTTPS）
const isHTTPS = process.env.HTTPS_ENABLED === 'true' || 
                (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.includes('https://'));

const HELMET_CONFIG = {
contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false, // 禁用，避免 HTTP 环境下警告
  crossOriginResourcePolicy: { policy: 'same-origin' }, // 限制跨源资源读取
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  // HSTS 只在 HTTPS 环境下启用
  hsts: isHTTPS ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: false, // 禁用，避免 HTTP 环境下警告
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
};

// 登录安全配置
const LOGIN_SECURITY = {
  // 最大尝试次数
  maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  // 锁定时间（毫秒）
  lockTime: parseInt(process.env.LOGIN_LOCK_TIME) || 30 * 60 * 1000, // 30分钟
  // Redis key 前缀
  redisPrefix: 'login_attempts:'
};

// 密码策略配置
const PASSWORD_POLICY = {
  minLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
  requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
  requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
  requireNumber: process.env.PASSWORD_REQUIRE_NUMBER !== 'false',
  requireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL === 'true',
  // 正则表达式
  get pattern() {
    let pattern = '';
    if (this.requireLowercase) pattern += '(?=.*[a-z])';
    if (this.requireUppercase) pattern += '(?=.*[A-Z])';
    if (this.requireNumber) pattern += '(?=.*\\d)';
    if (this.requireSpecial) pattern += '(?=.*[!@#$%^&*(),.?":{}|<>])';
    pattern += `.{${
     this.minLength},}`;
    return new RegExp(`^${pattern}$`);
  }
};

// 请求限制配置
const REQUEST_LIMITS = {
  // 请求体最大大小（MB）
  maxBodySize: parseInt(process.env.MAX_REQUEST_SIZE) || 10,
  // Rate limit 窗口时间（毫秒）
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  // Rate limit 最大请求数
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
};

// XSS 过滤配置
const XSS_CONFIG = {
  // 白名单标签
  whiteList: {
    a: ['href', 'title', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    br: [],
    p: [],
    strong: [],
    em: [],
    u: [],
    s: [],
    code: [],
    pre: [],
    blockquote: [],
    ul: [],
    ol: [],
    li: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    th: [],
    td: []
  },
  // 是否允许 HTML
  allowHtml: true,
  // 是否过滤属性中的危险内容
  stripIgnoreTag: true
};

// 敏感字段列表（日志中需要隐藏）
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'session',
  'apiKey',
  'secret',
  'emailCode',
  'smtpPass',
  // 验证码类：此前缺失，导致注册/改密失败日志里落盘明文验证码
  'verificationcode',
  'captchacode',
  'deletioncode'
];

// 短名且易误伤的键：只做「精确匹配」，避免用子串匹配把 statusCode / errorCode 一并脱敏
const SENSITIVE_EXACT_KEYS = ['code'];

module.exports = {
  JWT_CONFIG,
  ADMIN_JWT_CONFIG,
  CORS_CONFIG,
  HELMET_CONFIG,
  LOGIN_SECURITY,
  PASSWORD_POLICY,
  REQUEST_LIMITS,
  XSS_CONFIG,
  SENSITIVE_FIELDS,
  SENSITIVE_EXACT_KEYS,
  // 动态获取登录安全配置（优先使用管理员面板配置）
  getDynamicLoginSecurity: function() {
    try {
      const { getSecurityConfig } = require('../utils/configUtils');
      const sec = getSecurityConfig();
      return {
        maxAttempts: sec.loginMaxAttempts || LOGIN_SECURITY.maxAttempts,
        lockTime: (sec.loginLockTime || 30) * 60 * 1000,
        redisPrefix: LOGIN_SECURITY.redisPrefix
      };
    } catch (e) {
      return LOGIN_SECURITY;
    }
  },
  // 动态获取密码策略（优先使用管理员面板配置）
  getDynamicPasswordPolicy: function() {
    try {
      const { getSecurityConfig } = require('../utils/configUtils');
      const sec = getSecurityConfig();
      const policy = {
        minLength: sec.passwordMinLength || PASSWORD_POLICY.minLength,
        requireUppercase: sec.passwordRequireUppercase ?? PASSWORD_POLICY.requireUppercase,
        requireLowercase: sec.passwordRequireLowercase ?? PASSWORD_POLICY.requireLowercase,
        requireNumber: sec.passwordRequireNumber ?? PASSWORD_POLICY.requireNumber,
        requireSpecial: sec.passwordRequireSpecial ?? PASSWORD_POLICY.requireSpecial
      };
      // 生成正则
      let pattern = '';
      if (policy.requireLowercase) pattern += '(?=.*[a-z])';
      if (policy.requireUppercase) pattern += '(?=.*[A-Z])';
      if (policy.requireNumber) pattern += '(?=.*\\d)';
      if (policy.requireSpecial) pattern += '(?=.*[!@#$%^&*(),.?":{}|<>])';
      pattern += `.{${
       policy.minLength},}`;
      policy.pattern = new RegExp(`^${pattern}$`);
      return policy;
    } catch (e) {
      return PASSWORD_POLICY;
    }
  }
};
