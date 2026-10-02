const fs = require('fs');
const path = require('path');

// 直接定义数据目录路径，避免循环依赖
const DATA_DIR = path.join(__dirname, '../../data/');

// 配置文件路径
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// 配置缓存：避免每个请求多次同步读文件（此前每请求 6+ 次 readFileSync 阻塞事件循环）
// 缓存 3 秒，写配置时立即失效；极端情况下最多延迟 3 秒生效
const CONFIG_CACHE_TTL = 3000;
let _configCache = null;
let _configCacheTime = 0;

// 运行模式定义
const RUN_MODES = {
  NORMAL: 'normal',           // 正常模式
  DEBUG: 'debug',             // 调试模式
  MAINTENANCE: 'maintenance', // 维护模式
  SELF_DESTRUCT: 'self_destruct' // 自毁模式
};

// 自毁模式级别定义
const SELF_DESTRUCT_LEVELS = {
  LEVEL_3: 3,  // 删除所有帖子、评论、私信
  LEVEL_2: 2,  // 清空数据库
  LEVEL_1: 1   // 删除论坛文件
};

// 默认配置
const DEFAULT_CONFIG = {
  // 管理员列表
  adminUsers: ['1635075096'],
  
  // 运行模式配置
  runMode: {
    current: RUN_MODES.NORMAL,  // 当前运行模式
    maintenanceMessage: '网站正在维护中，请稍后再试', // 维护模式提示消息
    debugLogLevel: 'debug',     // 调试模式日志级别
    selfDestructLevel: null,    // 自毁模式级别
    lastModeChange: null,       // 最后一次模式变更时间
    changedBy: null             // 变更操作者
  },
  
  // MongoDB 连接配置
  mongodb: {
    uri: 'mongodb://localhost:27017/school-forum'
  },
  
  // 文件上传配置
  upload: {
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/svg+xml', 'image/avif', 'image/heic', 'image/heif'],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 20
  },
  
  // 密码加密配置
  password: {
    saltRounds: 10
  },
  
  // 分页配置
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    // 内存精排（推荐/相关等）候选集上限
    maxCandidates: 1000
  },
  
  // 内容长度限制
  contentLimits: {
    post: 10000,
    comment: 500,
    username: {
      min: 2,
      max: 20
    },
    qq: {
      min: 5,
      max: 15
    },
    password: {
      min: 6
    }
  },
  
  // 学校列表配置
  schools: [
    { id: 'school-1', name: 'XX学校' },
    { id: 'school-2', name: 'XX学校' },
    { id: 'school-3', name: 'XX学校' },
    { id: 'school-4', name: 'XX学校' },
    { id: 'school-5', name: 'XX学校' }
  ],
  
  // 安全防护配置
  security: {
    // 网络连接
    allowHTTP: true,                    // 允许HTTP连接（关闭则强制HTTPS）
    hstsEnabled: false,                 // 启用HSTS
    corsAllowAllDev: true,              // 开发模式放行所有CORS来源
    corsExtraOrigins: [],               // 额外允许的CORS来源
    
    // 频率限制
    rateLimitEnabled: true,             // 启用接口限流
    rateLimitGeneral: 100,              // 通用API（次/分钟）
    rateLimitRead: 600,                 // 只读GET接口（次/分钟）
    rateLimitLogin: 5,                  // 登录（次/分钟）
    rateLimitPost: 10,                  // 发帖（次/分钟）
    rateLimitComment: 30,               // 评论（次/分钟）
    rateLimitSearch: 30,                // 搜索（次/分钟）
    rateLimitVerify: 1,                 // 验证码（次/分钟）
    
    // 登录安全
    loginMaxAttempts: 5,                // 最大登录尝试次数
    loginLockTime: 30,                  // 锁定时间（分钟）
    jwtExpiresDays: 7,                  // JWT过期时间（天）
    
    // 密码策略
    passwordMinLength: 8,               // 最小长度
    passwordRequireUppercase: true,      // 要求大写字母
    passwordRequireLowercase: true,      // 要求小写字母
    passwordRequireNumber: true,         // 要求数字
    passwordRequireSpecial: false,       // 要求特殊字符
    
    // XSS与注入防护
    xssFilterEnabled: true,             // XSS过滤
    injectionGuardEnabled: true,        // SQL/NoSQL注入防护
    mongoSanitizeEnabled: true,         // MongoDB注入清洗
    hppGuardEnabled: true,              // HTTP参数污染防护
    
    // 安全响应头
    helmetEnabled: true,                // Helmet安全头
    cspEnabled: true,                   // 内容安全策略
    frameGuard: true                    // 禁止iframe嵌入
  }
};

/**
 * 初始化配置文件
 */
function initConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      writeConfig(DEFAULT_CONFIG);
      console.log('配置文件已创建:', CONFIG_FILE);
    }
  } catch (error) {
    console.error('初始化配置文件失败:', error);
  }
}

/**
 * 读取配置文件（带 3 秒内存缓存，避免每请求同步读盘）
 * @returns {object} 配置对象
 */
function readConfig() {
  // 命中缓存且未过期：直接返回
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_TTL) {
    return _configCache;
  }
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      initConfig();
    }
    
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(content);
    
    // 合并默认配置，确保所有必需的配置项都存在
    const merged = mergeWithDefaults(config);
    _configCache = merged;
    _configCacheTime = now;
    return merged;
  } catch (error) {
    console.error('读取配置文件失败:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 写入配置文件（写后立即失效缓存，保证后续读取到最新配置）
 * @param {object} config - 配置对象
 */
function writeConfig(config) {
  try {
    // 与磁盘上的原文件合并后再写：readConfig() 走的是白名单过滤后的视图
    // （mergeWithDefaults），直接写回会把「不在白名单里但确实存在」的键丢掉
    // —— 实测会把 mongodb.username/password、redis.password 一起抹掉。
    let onDisk = {};
    try {
      onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (_) {
      onDisk = {};
    }
    const merged = mergePlainObjects(onDisk, config);
    const configStr = JSON.stringify(merged, null, 2);

    // 原子写：先写临时文件再 rename。直接 writeFileSync 在进程被杀/磁盘满时
    // 会留下半截 JSON，下次启动解析失败 → 整站配置丢失。
    // ⚠ 权限：rename 会用临时文件的权限覆盖目标文件，而临时文件按 umask 落盘是 644 ——
    // config.json 里含 MongoDB/Redis 口令，必须显式写 600 并继承原文件权限。
    let mode = 0o600;
    try {
      mode = fs.statSync(CONFIG_FILE).mode & 0o777;
    } catch (_) {
      // 目标文件不存在时用 600
    }
    const tmpFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmpFile, configStr, { encoding: 'utf8', mode });
    fs.chmodSync(tmpFile, mode);
    fs.renameSync(tmpFile, CONFIG_FILE);
    _configCache = null;
    _configCacheTime = 0;
  } catch (error) {
    console.error('写入配置文件失败:', error);
    throw error;
  }
}

/**
 * 递归合并普通对象（overlay 覆盖 base），数组与标量以 overlay 为准
 * 用途：写配置时保留磁盘上应用不管理的键（例如 mongodb/redis 凭据）
 */
function mergePlainObjects(base, overlay) {
  if (Array.isArray(base) || Array.isArray(overlay)) return overlay;
  if (!base || typeof base !== 'object' || !overlay || typeof overlay !== 'object') return overlay;
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        prev && typeof prev === 'object' && !Array.isArray(prev)) {
      out[key] = mergePlainObjects(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 合并配置与默认配置
 * @param {object} config - 用户配置
 * @returns {object} 合并后的配置
 */
function mergeWithDefaults(config) {
  return {
    adminUsers: config.adminUsers || DEFAULT_CONFIG.adminUsers,
    runMode: {
      current: config.runMode?.current || DEFAULT_CONFIG.runMode.current,
      maintenanceMessage: config.runMode?.maintenanceMessage || DEFAULT_CONFIG.runMode.maintenanceMessage,
      debugLogLevel: config.runMode?.debugLogLevel || DEFAULT_CONFIG.runMode.debugLogLevel,
      selfDestructLevel: config.runMode?.selfDestructLevel || DEFAULT_CONFIG.runMode.selfDestructLevel,
      lastModeChange: config.runMode?.lastModeChange || DEFAULT_CONFIG.runMode.lastModeChange,
      changedBy: config.runMode?.changedBy || DEFAULT_CONFIG.runMode.changedBy
    },
    mongodb: {
      uri: config.mongodb?.uri || DEFAULT_CONFIG.mongodb.uri
    },
    upload: {
      allowedTypes: config.upload?.allowedTypes || DEFAULT_CONFIG.upload.allowedTypes,
      maxFileSize: config.upload?.maxFileSize || DEFAULT_CONFIG.upload.maxFileSize,
      maxFiles: config.upload?.maxFiles || DEFAULT_CONFIG.upload.maxFiles
    },
    password: {
      saltRounds: config.password?.saltRounds || DEFAULT_CONFIG.password.saltRounds
    },
    pagination: {
      defaultPage: config.pagination?.defaultPage || DEFAULT_CONFIG.pagination.defaultPage,
      defaultLimit: config.pagination?.defaultLimit || DEFAULT_CONFIG.pagination.defaultLimit,
      maxCandidates: config.pagination?.maxCandidates || DEFAULT_CONFIG.pagination.maxCandidates
    },
    contentLimits: {
      post: config.contentLimits?.post || DEFAULT_CONFIG.contentLimits.post,
      comment: config.contentLimits?.comment || DEFAULT_CONFIG.contentLimits.comment,
      username: {
        min: config.contentLimits?.username?.min || DEFAULT_CONFIG.contentLimits.username.min,
        max: config.contentLimits?.username?.max || DEFAULT_CONFIG.contentLimits.username.max
      },
      qq: {
        min: config.contentLimits?.qq?.min || DEFAULT_CONFIG.contentLimits.qq.min,
        max: config.contentLimits?.qq?.max || DEFAULT_CONFIG.contentLimits.qq.max
      },
      password: {
        min: config.contentLimits?.password?.min || DEFAULT_CONFIG.contentLimits.password.min
      }
    },
    schools: config.schools || [],
    security: {
      allowHTTP: config.security?.allowHTTP ?? DEFAULT_CONFIG.security.allowHTTP,
      hstsEnabled: config.security?.hstsEnabled ?? DEFAULT_CONFIG.security.hstsEnabled,
      corsAllowAllDev: config.security?.corsAllowAllDev ?? DEFAULT_CONFIG.security.corsAllowAllDev,
      corsExtraOrigins: config.security?.corsExtraOrigins || DEFAULT_CONFIG.security.corsExtraOrigins,
      rateLimitEnabled: config.security?.rateLimitEnabled ?? DEFAULT_CONFIG.security.rateLimitEnabled,
      rateLimitGeneral: config.security?.rateLimitGeneral ?? DEFAULT_CONFIG.security.rateLimitGeneral,
      rateLimitRead: config.security?.rateLimitRead ?? DEFAULT_CONFIG.security.rateLimitRead,
      rateLimitLogin: config.security?.rateLimitLogin ?? DEFAULT_CONFIG.security.rateLimitLogin,
      rateLimitPost: config.security?.rateLimitPost ?? DEFAULT_CONFIG.security.rateLimitPost,
      rateLimitComment: config.security?.rateLimitComment ?? DEFAULT_CONFIG.security.rateLimitComment,
      rateLimitSearch: config.security?.rateLimitSearch ?? DEFAULT_CONFIG.security.rateLimitSearch,
      rateLimitVerify: config.security?.rateLimitVerify ?? DEFAULT_CONFIG.security.rateLimitVerify,
      loginMaxAttempts: config.security?.loginMaxAttempts ?? DEFAULT_CONFIG.security.loginMaxAttempts,
      loginLockTime: config.security?.loginLockTime ?? DEFAULT_CONFIG.security.loginLockTime,
      jwtExpiresDays: config.security?.jwtExpiresDays ?? DEFAULT_CONFIG.security.jwtExpiresDays,
      passwordMinLength: config.security?.passwordMinLength ?? DEFAULT_CONFIG.security.passwordMinLength,
      passwordRequireUppercase: config.security?.passwordRequireUppercase ?? DEFAULT_CONFIG.security.passwordRequireUppercase,
      passwordRequireLowercase: config.security?.passwordRequireLowercase ?? DEFAULT_CONFIG.security.passwordRequireLowercase,
      passwordRequireNumber: config.security?.passwordRequireNumber ?? DEFAULT_CONFIG.security.passwordRequireNumber,
      passwordRequireSpecial: config.security?.passwordRequireSpecial ?? DEFAULT_CONFIG.security.passwordRequireSpecial,
      xssFilterEnabled: config.security?.xssFilterEnabled ?? DEFAULT_CONFIG.security.xssFilterEnabled,
      injectionGuardEnabled: config.security?.injectionGuardEnabled ?? DEFAULT_CONFIG.security.injectionGuardEnabled,
      mongoSanitizeEnabled: config.security?.mongoSanitizeEnabled ?? DEFAULT_CONFIG.security.mongoSanitizeEnabled,
      hppGuardEnabled: config.security?.hppGuardEnabled ?? DEFAULT_CONFIG.security.hppGuardEnabled,
      helmetEnabled: config.security?.helmetEnabled ?? DEFAULT_CONFIG.security.helmetEnabled,
      cspEnabled: config.security?.cspEnabled ?? DEFAULT_CONFIG.security.cspEnabled,
      frameGuard: config.security?.frameGuard ?? DEFAULT_CONFIG.security.frameGuard
    }
  };
}

/**
 * 获取当前运行模式
 * @returns {object} 运行模式配置
 */
function getRunMode() {
  const config = readConfig();
  return config.runMode || DEFAULT_CONFIG.runMode;
}

/**
 * 设置运行模式
 * @param {string} mode - 运行模式
 * @param {string} adminId - 操作管理员ID
 * @param {object} options - 额外选项
 * @returns {boolean} 是否成功
 */
function setRunMode(mode, adminId, options = {}) {
  try {
    if (!Object.values(RUN_MODES).includes(mode)) {
      console.error('无效的运行模式:', mode);
      return false;
    }
    
    const config = readConfig();
    config.runMode = {
      current: mode,
      maintenanceMessage: options.maintenanceMessage || config.runMode?.maintenanceMessage || DEFAULT_CONFIG.runMode.maintenanceMessage,
      debugLogLevel: options.debugLogLevel || config.runMode?.debugLogLevel || DEFAULT_CONFIG.runMode.debugLogLevel,
      selfDestructLevel: options.selfDestructLevel || null,
      lastModeChange: new Date().toISOString(),
      changedBy: adminId
    };
    
    writeConfig(config);
    return true;
  } catch (error) {
    console.error('设置运行模式失败:', error);
    return false;
  }
}

/**
 * 检查是否处于维护模式
 * @returns {boolean}
 */
function isMaintenanceMode() {
  const runMode = getRunMode();
  return runMode.current === RUN_MODES.MAINTENANCE;
}

/**
 * 检查是否处于调试模式
 * @returns {boolean}
 */
function isDebugMode() {
  const runMode = getRunMode();
  return runMode.current === RUN_MODES.DEBUG;
}

/**
 * 检查是否处于自毁模式
 * @returns {boolean}
 */
function isSelfDestructMode() {
  const runMode = getRunMode();
  return runMode.current === RUN_MODES.SELF_DESTRUCT;
}

/**
 * 添加管理员
 * @param {string} adminId - 管理员ID（QQ号或用户ID）
 * @returns {boolean} 是否成功
 */
function addAdmin(adminId) {
  try {
    const config = readConfig();
    
    if (!config.adminUsers.includes(adminId)) {
      config.adminUsers.push(adminId);
      writeConfig(config);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('添加管理员失败:', error);
    return false;
  }
}

/**
 * 删除管理员
 * @param {string} adminId - 管理员ID
 * @returns {boolean} 是否成功
 */
function removeAdmin(adminId) {
  try {
    const config = readConfig();
    
    const index = config.adminUsers.indexOf(adminId);
    if (index > -1) {
      // 确保至少保留一个管理员
      if (config.adminUsers.length > 1) {
        config.adminUsers.splice(index, 1);
        writeConfig(config);
        return true;
      }
      return false;
    }
    
    return false;
  } catch (error) {
    console.error('删除管理员失败:', error);
    return false;
  }
}

/**
 * 更新配置
 * @param {object} updates - 要更新的配置项
 * @returns {boolean} 是否成功
 */
function updateConfig(updates) {
  try {
    const config = readConfig();
    
    // 深度合并配置
    const updatedConfig = deepMerge(config, updates);
    
    writeConfig(updatedConfig);
    return true;
  } catch (error) {
    console.error('更新配置失败:', error);
    return false;
  }
}

/**
 * 深度合并对象
 * @param {object} target - 目标对象
 * @param {object} source - 源对象
 * @returns {object} 合并后的对象
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * 获取配置文件路径
 * @returns {string} 配置文件路径
 */
function getConfigFilePath() {
  return CONFIG_FILE;
}

/**
 * 获取安全防护配置
 * @returns {object} 安全配置对象
 */
function getSecurityConfig() {
  const config = readConfig();
  return config.security || DEFAULT_CONFIG.security;
}

module.exports = {
  initConfig,
  readConfig,
  writeConfig,
  addAdmin,
  removeAdmin,
  updateConfig,
  getConfigFilePath,
  DEFAULT_CONFIG,
  RUN_MODES,
  SELF_DESTRUCT_LEVELS,
  getRunMode,
  setRunMode,
  isMaintenanceMode,
  isDebugMode,
  isSelfDestructMode,
  getSecurityConfig
};