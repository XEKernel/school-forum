/**
 * 安全中间件模块
 * 提供多层安全防护
 */
const xss = require('xss');
const { XSS_CONFIG, SENSITIVE_FIELDS } = require('../config/security');
const logger = require('../utils/logger');

/**
 * XSS 过滤中间件
 * 自动过滤请求体中的 XSS 攻击代码
 */
/**
 * 递归净化任意值（字符串走 xss 白名单，对象/数组递归）。
 *
 * 提到模块级是为了让 multipart 上传后的 body 也能复用同一套规则：
 * multer 在路由层才解析表单，全局 xssFilter 运行时 req.body 还是 undefined，
 * 所有「带图发帖 / 评论 / 私信」的文本字段此前完全绕过 XSS 过滤。
 */
function sanitizeValue(obj) {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return xss(obj, XSS_CONFIG);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeValue(item));
  }

  const filtered = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // 敏感字段原样保留（不净化）：列表里混有 camelCase（newPassword / accessToken 等），
      // 单靠 key.toLowerCase() 与 includes 比对永远不命中，故逐个转小写比较。
      if (SENSITIVE_FIELDS.some(f => f.toLowerCase() === key.toLowerCase())) {
        filtered[key] = obj[key];
      } else {
        filtered[key] = sanitizeValue(obj[key]);
      }
    }
  }
  return filtered;
}

/**
 * 净化一个请求体对象（供上传中间件在 multer 解析完成后调用）。
 * @param {object} body
 * @returns {object}
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  return sanitizeValue(body);
}

/**
 * XSS 过滤中间件
 * 自动过滤请求体 / 查询参数 / 路由参数中的 XSS 攻击代码
 */
function xssFilter(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }
  next();
}

/**
 * 请求 ID 生成中间件
 * 为每个请求生成唯一 ID，便于追踪
 */
function requestIdMiddleware(req, res, next) {
  const { v4: uuidv4 } = require('uuid');
  const requestId = req.headers['x-request-id'] || uuidv4();
  
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  next();
}

/**
 * 敏感信息过滤（日志脱敏）
 * 实现已统一到 utils/logger —— logger 在 formatLogMessage 里对**所有**日志统一脱敏，
 * 不再依赖调用方自觉。这里保留同名导出，兼容既有引用，避免出现两份实现各脱一半。
 */
function sanitizeLogData(data) {
  return logger.sanitizeLogData(data);
}

/**
 * SQL/NoSQL 注入检测中间件
 * 检测并阻止潜在的注入攻击
 */
function injectionGuard(req, res, next) {
  // 危险模式列表
  const dangerousPatterns = [
    // NoSQL 注入 - 检查以 $ 开头的操作符
    /\$where/i,
    /\$ne/i,
    /\$gt/i,
    /\$lt/i,
    /\$or/i,
    /\$and/i,
    /\$not/i,
    /\$nor/i,
    /\$exists/i,
    /\$type/i,
    /\$expr/i,
    /\$jsonSchema/i,
    /\$mod/i,
    /\$regex/i,
    /\$text/i,
    /\$search/i,
    /\$elemMatch/i,
    // SQL 注入 - 仅检测完整的注入语句模式（非单独关键词）
    /('|")\s*(or|and)\s+['\d]/i,  // ' or 1=1, " and 1
    /(--\s*$)/i,                     // SQL 注释截断
    /(;\s*(drop|delete|truncate|alter)\s)/i,  // 危险 SQL 语句拼接
    /(union\s+(all\s+)?select)/i     // UNION SELECT 注入
  ];

  // 跳过注入检测的字段（密码等用户凭证不应被内容过滤）
  const SKIP_FIELDS = new Set(['password', 'newPassword', 'confirmPassword', 'currentPassword']);

  /**
   * 递归检查对象
   */
  function checkObject(obj, path = '') {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(obj)) {
            logger.logSecurityEvent('potential_injection_detected', {
              path: path,
              value: obj.substring(0, 100),
              pattern: pattern.toString(),
              ip: req.ip
            });
            return true;
          }
        }
      }
      return false;
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        // 检查键名
        if (key.startsWith('$')) {
          logger.logSecurityEvent('nosql_injection_key_detected', {
            key: key,
            path: currentPath,
            ip: req.ip
          });
          return true;
        }

        // 跳过密码等凭证字段的值内容检测
        if (SKIP_FIELDS.has(key)) {
          continue;
        }
        
        // 递归检查值
        if (checkObject(obj[key], currentPath)) {
          return true;
        }
      }
    }
    
    return false;
  }

  // 检查请求体
  if (req.body && checkObject(req.body, 'body')) {
    return res.status(400).json({
      success: false,
      message: '请求包含不允许的内容'
    });
  }

  // 检查查询参数
  if (req.query && checkObject(req.query, 'query')) {
    return res.status(400).json({
      success: false,
      message: '请求参数包含不允许的内容'
    });
  }

  next();
}

/**
 * IP 黑名单检查中间件
 */
function createIpBlacklistMiddleware(getBlacklistedIps) {
  return async function ipBlacklistMiddleware(req, res, next) {
    // 统一用 req.ip：它遵循 express 的 trust proxy 策略，与限流键保持一致。
    // 直接读 x-forwarded-for 完全由客户端控制，被封禁者带一个假头即可绕过。
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';

    try {
      const blacklistedIps = await getBlacklistedIps();
      
      if (blacklistedIps && blacklistedIps.includes(clientIp)) {
        logger.logSecurityEvent('blacklisted_ip_access_attempt', {
          ip: clientIp,
          path: req.path
        });
        
        return res.status(403).json({
          success: false,
          message: '访问被拒绝'
        });
      }
    } catch (error) {
      logger.logError('IP黑名单检查失败', { error: error.message });
    }

    next();
  };
}

/**
 * 安全响应头设置中间件
 * 补充 Helmet 未覆盖的安全头
 */
function additionalSecurityHeaders(req, res, next) {
  // 移除可能暴露服务器信息的头
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // 添加额外的安全头
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  
  next();
}

/**
 * 错误处理中间件 - 隐藏敏感错误信息
 */
function secureErrorHandler(err, req, res, next) {
  // 记录完整错误到日志
  logger.logError('请求错误', {
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  // 生产环境隐藏错误详情
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 根据错误类型返回适当的响应
  let statusCode = err.status || err.statusCode || 500;
  let message = '服务器内部错误';
  
  // 特定错误类型的友好提示
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = '请求数据验证失败';
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = '身份验证失败';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = '登录已过期，请重新登录';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = '文件大小超过限制';
  } else if (statusCode === 404) {
    message = '请求的资源不存在';
  } else if (statusCode === 403) {
    message = '没有权限访问';
  } else if (!isProduction) {
    // 开发环境返回详细错误
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    message: message,
    requestId: req.requestId
  });
}

module.exports = {
  xssFilter,
  sanitizeBody,
  requestIdMiddleware,
  sanitizeLogData,
  injectionGuard,
  createIpBlacklistMiddleware,
  additionalSecurityHeaders,
  secureErrorHandler
};
