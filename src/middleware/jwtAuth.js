/**
 * JWT 认证中间件
 * 提供用户和管理员的 Token 认证
 */
const jwt = require('jsonwebtoken');
const { JWT_CONFIG, ADMIN_JWT_CONFIG, getDynamicLoginSecurity } = require('../config/security');
const { getRedisClient } = require('../utils/redisUtils');
const logger = require('../utils/logger');
const User = require('../models/User');

/**
 * 生成访问令牌
 */
function generateAccessToken(userId, payload = {}) {
  return jwt.sign(
    { 
      userId,
      type: 'access',
      ...payload 
    },
    JWT_CONFIG.secret,
    {
      expiresIn: JWT_CONFIG.expiresIn,
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience
    }
  );
}

/**
 * 生成刷新令牌
 */
function generateRefreshToken(userId) {
  return jwt.sign(
    { 
      userId,
      type: 'refresh'
    },
    JWT_CONFIG.secret,
    {
      expiresIn: JWT_CONFIG.refreshExpiresIn,
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience
    }
  );
}

/**
 * 生成管理员令牌
 */
function generateAdminToken(adminId, payload = {}) {
  return jwt.sign(
    { 
      adminId,
      type: 'admin',
      ...payload 
    },
    ADMIN_JWT_CONFIG.secret,
    {
      expiresIn: ADMIN_JWT_CONFIG.expiresIn,
      issuer: ADMIN_JWT_CONFIG.issuer,
      audience: ADMIN_JWT_CONFIG.audience
    }
  );
}

/**
 * 验证令牌
 */
function verifyToken(token, isAdmin = false) {
  const config = isAdmin ? ADMIN_JWT_CONFIG : JWT_CONFIG;
  
  try {
    const decoded = jwt.verify(token, config.secret, {
      issuer: config.issuer,
      audience: config.audience
    });
    return { valid: true, decoded };
  } catch (error) {
    return { 
      valid: false, 
      error: error.name,
      message: error.message 
    };
  }
}

// ==================== HttpOnly Cookie 传输 ====================
// 浏览器端不再把令牌放进 localStorage（XSS 可直接读走），改由 HttpOnly Cookie 传输；
// Authorization 头仍然支持（API / Android 客户端不受影响），头优先、Cookie 兜底。
// CSRF：SameSite=Lax + 状态变更接口全部走 POST/PUT/DELETE（跨站表单不会带上该 Cookie）。
const AUTH_COOKIES = {
  access: 'sf_access_token',
  refresh: 'sf_refresh_token',
  admin: 'sf_admin_token'
};

const DURATION_UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

// 把 '7d' / '24h' / '1800s' 这类配置值换算成毫秒（Cookie maxAge 需要毫秒）
function durationToMs(value, fallbackMs) {
  const matched = /^(\d+)\s*([smhd])?$/.exec(String(value || '').trim());
  if (!matched) return fallbackMs;
  const unit = DURATION_UNIT_MS[matched[2] || 's'];
  return parseInt(matched[1], 10) * unit;
}

// 轻量 Cookie 解析（避免为解析一个请求头引入 cookie-parser 依赖）
function parseCookies(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch (_) {
      out[key] = val;
    }
  }
  return out;
}

function isHttpsRequest(req) {
  if (req.secure) return true;
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  return proto === 'https';
}

/**
 * 是否为需要从响应体读取令牌的 API 客户端（安卓原生 App 等）
 *
 * 安全背景：令牌主通道是 HttpOnly Cookie。若浏览器侧响应体也返回明文令牌，
 * 一旦页面存在 XSS，即可用 Cookie 换一份明文令牌外传（绕过 HttpOnly）。
 * 因此令牌只返回给无法持有 Cookie 的原生客户端：
 *   - OkHttp（安卓 App）默认 UA 形如 `okhttp/4.12.0`
 *   - 或显式声明 `X-Client: app`
 * 浏览器（含移动网页版）一律走 Cookie，响应体不带令牌。
 * @param {object} req
 * @returns {boolean}
 */
function isApiClient(req) {
  const ua = req.get('user-agent') || '';
  if (/okhttp\//i.test(ua)) return true;
  return String(req.get('x-client') || '').toLowerCase() === 'app';
}

/**
 * 下发认证 Cookie（登录 / 注册 / QQ 登录 / 刷新令牌成功时调用）
 * @param {object} req
 * @param {object} res
 * @param {{accessToken?:string, refreshToken?:string, adminToken?:string}} tokens
 */
function setAuthCookies(req, res, tokens = {}) {
  const secure = isHttpsRequest(req);
  const write = (name, value, maxAge) => {
    if (!value) return;
    res.cookie(name, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge
    });
  };
  write(AUTH_COOKIES.access, tokens.accessToken, durationToMs(JWT_CONFIG.expiresIn, 7 * DURATION_UNIT_MS.d));
  write(AUTH_COOKIES.refresh, tokens.refreshToken, durationToMs(JWT_CONFIG.refreshExpiresIn, 30 * DURATION_UNIT_MS.d));
  write(AUTH_COOKIES.admin, tokens.adminToken, durationToMs(ADMIN_JWT_CONFIG.expiresIn, 24 * DURATION_UNIT_MS.h));
}

/**
 * 清除认证 Cookie（登出 / 改密 / 注销账户）
 */
function clearAuthCookies(res) {
  for (const name of Object.values(AUTH_COOKIES)) {
    res.clearCookie(name, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
}

/**
 * 提取请求中的令牌
 * 顺序：Authorization 头（API / Android 客户端）→ HttpOnly Cookie（浏览器主通道）
 * 安全说明：不支持 query 参数（token 出现在 URL 会泄露到访问日志/浏览器历史/Referer）
 * @param {object} req
 * @param {'access'|'refresh'|'admin'} kind - 取哪一类 Cookie
 */
function extractToken(req, kind = 'access') {
  // 优先从 Authorization 头获取
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const headerToken = authHeader.substring(7).trim();
    // 前端停用 localStorage 后可能残留 `Bearer ` 空值，此时继续走 Cookie
    if (headerToken) return headerToken;
  }

  // 回退到 HttpOnly Cookie
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIES[kind]] || null;
}

/**
 * 用户认证中间件
 */
async function authenticateUser(req, res, next) {
  try {
    const token = extractToken(req);
    
    if (!token) {
      logger.logWarn('认证失败：未提供Token', {
        path: req.path,
        method: req.method,
        hasAuthHeader: !!req.headers.authorization,
        authHeaderPrefix: req.headers.authorization ? req.headers.authorization.substring(0, 15) + '...' : 'N/A',
        contentType: req.headers['content-type']
      });
      return res.status(401).json({
        success: false,
        message: '请先登录'
      });
    }
    
    const result = verifyToken(token);
    
    if (!result.valid) {
      // 调试日志：记录验证失败的具体原因
      logger.logWarn('Token验证失败', {
        error: result.error,
        message: result.message,
        path: req.path,
        tokenPrefix: token.substring(0, 20) + '...'
      });
      
      if (result.error === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: '登录已过期，请重新登录',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      return res.status(401).json({
        success: false,
        message: '无效的身份验证'
      });
    }
    
    // 检查令牌是否在黑名单中（已注销）——Redis 不可用时跳过该检查，不阻断请求
    let isBlacklisted = null;
    try {
      const redis = getRedisClient();
      if (redis) {
        isBlacklisted = await redis.get(`token_blacklist:${token}`);
      }
    } catch (redisError) {
      logger.logWarn('令牌黑名单检查跳过（Redis不可用）', { error: redisError.message });
    }
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: '令牌已失效，请重新登录'
      });
    }
    
    // 验证用户是否存在（用户ID是自定义字符串UUID，不是MongoDB _id）
    const user = await User.findOne({ id: result.decoded.userId }).lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 密码变更后旧令牌失效检查（安全）：token 签发时间早于密码变更时间 → 拒绝
    // 覆盖忘记密码重置 / 修改密码后，旧 token（含其他设备）立即失效
    // 容差 1 秒：passwordChangedAt 为毫秒精度、token iat 为秒精度，同一秒内
    // 注册/变更后立即签发的 token 不应被误判为"密码已变更"
    if (user.passwordChangedAt && result.decoded.iat) {
      const changedAt = new Date(user.passwordChangedAt).getTime();
      if (result.decoded.iat * 1000 + 1000 < changedAt) {
        return res.status(401).json({
          success: false,
          message: '登录已失效，请重新登录',
          code: 'PASSWORD_CHANGED'
        });
      }
    }
    
    // 将用户信息附加到请求对象
    req.user = {
      id: user.id,
      username: user.username,
      qq: user.qq,
      avatar: user.avatar,
      role: user.role || 'user'
    };
    req.token = token;
    
    next();
  } catch (error) {
    logger.logError('用户认证失败', { 
      error: error.message,
      path: req.path
    });
    
    res.status(500).json({
      success: false,
      message: '认证服务错误'
    });
  }
}

/**
 * 将令牌加入黑名单（密码修改/注销时调用）
 */
async function blacklistToken(token, ttlSeconds = null) {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    let ttl = ttlSeconds;
    if (!ttl) {
      const result = verifyToken(token);
      if (result.valid && result.decoded.exp) {
        ttl = Math.max(0, result.decoded.exp - Math.floor(Date.now() / 1000));
      } else {
        ttl = JWT_CONFIG.refreshExpiresIn;
      }
    }
    if (ttl > 0) {
      await redis.set(`token_blacklist:${token}`, '1', 'EX', ttl);
      logger.logInfo('令牌已加入黑名单', { ttl });
    }
  } catch (error) {
    logger.logError('令牌黑名单操作失败', { error: error.message });
  }
}

/**
 * 管理员认证中间件
 */
async function authenticateAdmin(req, res, next) {
  try {
    // 管理员 Cookie 与用户 Cookie 分开存放，后台接口只认管理员那一个
    const token = extractToken(req, 'admin');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: '请提供管理员身份验证'
      });
    }
    
    const result = verifyToken(token, true);
    
    if (!result.valid) {
      if (result.error === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: '管理员会话已过期，请重新登录',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      return res.status(401).json({
        success: false,
        message: '无效的管理员身份验证'
      });
    }
    
    // 检查令牌黑名单——Redis 不可用时跳过该检查，不阻断请求
    let isBlacklisted = null;
    try {
      const redis = getRedisClient();
      if (redis) {
        isBlacklisted = await redis.get(`admin_token_blacklist:${token}`);
      }
    } catch (redisError) {
      logger.logWarn('管理员令牌黑名单检查跳过（Redis不可用）', { error: redisError.message });
    }
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: '管理员令牌已失效'
      });
    }
    
    // 验证管理员权限
    const { validateAdminPermission } = require('../utils/validationUtils');
    const validationResult = await validateAdminPermission(result.decoded.adminId);
    
    if (!validationResult.valid) {
      return res.status(403).json({
        success: false,
        message: validationResult.message
      });
    }
    
    // 将管理员信息附加到请求对象
    req.admin = {
      id: result.decoded.adminId,
      username: validationResult.user.username,
      role: 'admin'
    };
    req.token = token;
    
    next();
  } catch (error) {
    logger.logError('管理员认证失败', { 
      error: error.message,
      path: req.path
    });
    
    res.status(500).json({
      success: false,
      message: '认证服务错误'
    });
  }
}

/**
 * 可选认证中间件
 * 如果提供了令牌则验证，否则继续
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  
  if (!token) {
    return next();
  }
  
  try {
    const result = verifyToken(token);
    
    if (result.valid) {
      const user = await User.findOne({ id: result.decoded.userId }).lean();
      if (user) {
        req.user = {
          id: user.id,
          username: user.username,
          qq: user.qq,
          avatar: user.avatar,
          role: user.role || 'user'
        };
        req.token = token;
      }
    }
  } catch (error) {
    // 静默失败，继续处理请求
  }
  
  next();
}

/**
 * 注销令牌
 * 将令牌加入黑名单
 */
async function invalidateToken(token, isAdmin = false) {
  const redis = getRedisClient();
  if (!redis) return false;
  
  try {
    const result = verifyToken(token, isAdmin);
    if (!result.valid) return false;
    
    // 计算剩余有效期
    const expiresAt = result.decoded.exp * 1000;
    const ttl = Math.max(0, expiresAt - Date.now());
    
    // 存入黑名单
    const key = isAdmin ? `admin_token_blacklist:${token}` : `token_blacklist:${token}`;
    await redis.setEx(key, Math.ceil(ttl / 1000), '1');
    
    return true;
  } catch (error) {
    logger.logError('注销令牌失败', { error: error.message });
    return false;
  }
}

/**
 * 登录失败计数的进程内兜底（Redis 不可用或报错时使用）
 *
 * 降级策略统一：验证码（captchaCache）同样会在 Redis 异常时退到内存，
 * 这里保持一致 —— 既不因为 Redis 抖动就放行暴力破解（fail-open 丢保护），
 * 也不因为 Redis 抖动就把所有人锁在门外（fail-closed 丢可用性），
 * 而是退到单进程内计数，Redis 恢复后自动回到以 Redis 为准。
 * ⚠ 多实例部署时各实例计数不共享，暴力破解防护会按实例数削弱，生产多实例请确保 Redis 可用。
 */
const memoryLoginAttempts = new Map(); // identifier -> { count, expiresAt }
const MEMORY_ATTEMPTS_MAX_ENTRIES = 10000;

function pruneMemoryAttempts(now) {
  if (memoryLoginAttempts.size < MEMORY_ATTEMPTS_MAX_ENTRIES) return;
  for (const [key, entry] of memoryLoginAttempts) {
    if (entry.expiresAt <= now) memoryLoginAttempts.delete(key);
  }
  // 仍超上限则直接清空（宁可丢计数也不无限占用内存）
  if (memoryLoginAttempts.size >= MEMORY_ATTEMPTS_MAX_ENTRIES) memoryLoginAttempts.clear();
}

function memoryRecordFailure(identifier, lockMs) {
  const now = Date.now();
  pruneMemoryAttempts(now);
  const prev = memoryLoginAttempts.get(identifier);
  const count = (prev && prev.expiresAt > now ? prev.count : 0) + 1;
  memoryLoginAttempts.set(identifier, { count, expiresAt: now + lockMs });
  return count;
}

function memoryCheckLocked(identifier, maxAttempts) {
  const entry = memoryLoginAttempts.get(identifier);
  if (!entry) return { locked: false };
  if (entry.expiresAt <= Date.now()) {
    memoryLoginAttempts.delete(identifier);
    return { locked: false };
  }
  if (entry.count >= maxAttempts) {
    return { locked: true, lockTimeRemaining: entry.expiresAt - Date.now() };
  }
  return { locked: false };
}

/**
 * 登录失败追踪
 */
async function recordLoginAttempt(identifier, success, ip) {
  const LOGIN_SECURITY = getDynamicLoginSecurity();

  // getRedisClient 在 try 内调用：Redis 不可用时退到进程内计数（见文件头降级策略说明）
  try {
    const redis = getRedisClient();
    if (!redis) {
      if (success) {
        memoryLoginAttempts.delete(identifier);
        return { allowed: true };
      }
      const count = memoryRecordFailure(identifier, LOGIN_SECURITY.lockTime);
      if (count >= LOGIN_SECURITY.maxAttempts) {
        logger.logSecurityEvent('account_locked', { identifier, ip, attempts: count, source: 'memory' });
        return { allowed: false, attempts: count, lockTimeRemaining: LOGIN_SECURITY.lockTime };
      }
      return { allowed: true, attempts: count, remaining: LOGIN_SECURITY.maxAttempts - count };
    }

    const key = `${LOGIN_SECURITY.redisPrefix}${identifier}`;
  
    if (success) {
      // 登录成功，清除失败记录
      await redis.del(key);
      memoryLoginAttempts.delete(identifier);
      return { allowed: true };
    }
    
    // 登录失败，原子地自增计数并在首次失败时设置过期时间
    // 原实现是两条独立命令（INCR 后跟 EXPIRE），一旦在两者之间中断/断连，
    // key 会永不过期 → 该账号被永久锁死（且没有任何补偿路径）。
    // 改为在 Redis 端用 Lua 一次执行，保证「计数 + TTL」同时成立。
    const lockSeconds = Math.ceil(LOGIN_SECURITY.lockTime / 1000);
    const attempts = Number(await redis.eval(
      "local c = redis.call('INCR', KEYS[1])\n" +
      "if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\n" +
      "return c",
      { keys: [key], arguments: [String(lockSeconds)] }
    ));
    
    // 检查是否需要锁定
    if (attempts >= LOGIN_SECURITY.maxAttempts) {
      const ttl = await redis.ttl(key);
      logger.logSecurityEvent('account_locked', {
        identifier,
        ip,
        attempts,
        lockTimeRemaining: ttl
      });
      
      return { 
        allowed: false, 
        attempts,
        lockTimeRemaining: ttl * 1000
      };
    }
    
    return { 
      allowed: true, 
      attempts,
      remaining: LOGIN_SECURITY.maxAttempts - attempts
    };
  } catch (error) {
    logger.logError('记录登录尝试失败，退到进程内计数', { error: error.message });
    if (success) {
      memoryLoginAttempts.delete(identifier);
      return { allowed: true };
    }
    const count = memoryRecordFailure(identifier, LOGIN_SECURITY.lockTime);
    if (count >= LOGIN_SECURITY.maxAttempts) {
      return { allowed: false, attempts: count, lockTimeRemaining: LOGIN_SECURITY.lockTime };
    }
    return { allowed: true, attempts: count, remaining: LOGIN_SECURITY.maxAttempts - count };
  }
}

/**
 * 检查登录是否被锁定
 */
async function checkLoginLocked(identifier) {
  const LOGIN_SECURITY = getDynamicLoginSecurity();

  try {
    // getRedisClient 在 try 内调用：Redis 不可用时退到进程内计数（与 recordLoginAttempt 一致）
    const redis = getRedisClient();
    if (!redis) return memoryCheckLocked(identifier, LOGIN_SECURITY.maxAttempts);

    const key = `${LOGIN_SECURITY.redisPrefix}${identifier}`;
    const attempts = await redis.get(key);
    
    if (attempts && parseInt(attempts) >= LOGIN_SECURITY.maxAttempts) {
      const ttl = await redis.ttl(key);
      return {
        locked: true,
        lockTimeRemaining: ttl * 1000
      };
    }
    
    return { locked: false };
  } catch (error) {
    logger.logError('检查登录锁定失败，退到进程内计数', { error: error.message });
    return memoryCheckLocked(identifier, LOGIN_SECURITY.maxAttempts);
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateAdminToken,
  verifyToken,
  extractToken,
  setAuthCookies,
  clearAuthCookies,
  isApiClient,
  AUTH_COOKIES,
  authenticateUser,
  authenticateAdmin,
  optionalAuth,
  invalidateToken,
  recordLoginAttempt,
  checkLoginLocked
};
