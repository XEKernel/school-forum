/**
 * 接口限流中间件
 * 使用Redis实现滑动窗口限流
 */
const { rateLimiter } = require('../utils/redisUtils');
const { getSecurityConfig } = require('../utils/configUtils');
const logger = require('../utils/logger');

/**
 * 创建限流中间件
 * @param {object} options - 配置选项
 * @param {number} options.limit - 时间窗口内最大请求数
 * @param {number} options.window - 时间窗口（秒）
 * @param {string} options.message - 超过限制时的错误消息
 * @param {function} options.keyGenerator - 自定义key生成函数
 */
function createRateLimiter(options = {}) {
  const {
    limit = 100,
    window = 60,
    message = '请求过于频繁，请稍后再试',
    keyGenerator = null
  } = options;

  return async (req, res, next) => {
    try {
      // 生成限流key
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      // 关键：endpoint 只取路径（不含查询字符串），否则攻击者加 ?x=1 即可绕过限流
      // 规范化：Express 路由大小写不敏感、忽略尾斜杠，
      // 若 key 直接用原始 path，/api/Login、/api/login/ 会各开一个计数桶，
      // 登录与验证码接口的 5 次/分钟形同虚设。
      const rawEndpoint = keyGenerator ? keyGenerator(req) : (req.path || req.url).split('?')[0];
      const endpoint = String(rawEndpoint || '').toLowerCase().replace(/\/+$/, '');
      
      // 检查是否超过限制
      const result = await rateLimiter.check(ip, endpoint, limit, window);
      
      // 设置响应头
      res.set('X-RateLimit-Limit', limit);
      res.set('X-RateLimit-Remaining', result.remaining);
      res.set('X-RateLimit-Reset', result.resetTime);
      
      if (!result.allowed) {
        logger.logWarn('接口限流触发', {
          ip,
          endpoint,
          limit,
          window
        });
        
        return res.status(429).json({
          success: false,
          message,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }
      
      next();
    } catch (error) {
      // 限流检查失败时放行请求
      logger.logError('限流检查失败', { error: error.message });
      next();
    }
  };
}

// 预定义的限流配置（从动态安全配置读取参数）
function getDynamicRateLimiters() {
  const sec = getSecurityConfig();
  return {
    // 通用API限流
    general: createRateLimiter({
      limit: sec.rateLimitGeneral || 100,
      window: 60,
      message: '请求过于频繁，请稍后再试'
    }),
    
    // 严格限流：每分钟20次（用于敏感操作）
    strict: createRateLimiter({
      limit: 20,
      window: 60,
      message: '操作过于频繁，请稍后再试'
    }),
    
    // 宽松限流：每分钟300次（用于浏览等非敏感操作）
    loose: createRateLimiter({
      limit: 300,
      window: 60,
      message: '请求过于频繁，请稍后再试'
    }),
    
    // 登录限流
    login: createRateLimiter({
      limit: sec.rateLimitLogin || 5,
      window: 60,
      message: '登录尝试过于频繁，请稍后再试'
    }),
    
    // 发帖限流
    post: createRateLimiter({
      limit: sec.rateLimitPost || 10,
      window: 60,
      message: '发帖过于频繁，请稍后再试'
    }),
    
    // 评论限流
    comment: createRateLimiter({
      limit: sec.rateLimitComment || 30,
      window: 60,
      message: '评论过于频繁，请稍后再试'
    }),
    
    // 搜索限流
    search: createRateLimiter({
      limit: sec.rateLimitSearch || 30,
      window: 60,
      message: '搜索过于频繁，请稍后再试'
    }),
    
    // 验证码限流
    verificationCode: createRateLimiter({
      limit: sec.rateLimitVerify || 1,
      window: 60,
      message: '验证码发送过于频繁，请稍后再试'
    })
  };
}

// 向后兼容的静态导出（实际调用时动态读取）
const rateLimiters = new Proxy({}, {
  get(target, prop) {
    const dynamic = getDynamicRateLimiters();
    return dynamic[prop];
  }
});

module.exports = {
  createRateLimiter,
  rateLimiters
};
