const { createClient } = require('redis');
const { readConfig } = require('./configUtils');

let redisClient = null;
let isConnected = false;

// ===================== 连接配置读取 =====================

/**
 * 从环境变量 + config.json 读取 Redis 配置
 * 环境变量优先级高于 config.json
 */
function buildRedisConfig() {
  const fileConfig = readConfig().redis || {};

  const host     = process.env.REDIS_HOST     || fileConfig.host     || 'localhost';
  const port     = parseInt(process.env.REDIS_PORT || fileConfig.port || 6379, 10);
  const password = process.env.REDIS_PASSWORD || fileConfig.password || undefined;
  const db       = parseInt(process.env.REDIS_DB   || fileConfig.db   || 0, 10);
  const username = process.env.REDIS_USERNAME || fileConfig.username || undefined;

  // TLS：REDIS_TLS=true 或 rediss:// 协议时启用
  const tlsEnabled = process.env.REDIS_TLS === 'true' || fileConfig.tls === true;

  // 连接超时（毫秒），默认 5 秒
  const connectTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT || fileConfig.connectTimeout || 5000, 10);

  // 命令超时（毫秒），默认 3 秒
  const commandTimeout = parseInt(process.env.REDIS_COMMAND_TIMEOUT || fileConfig.commandTimeout || 3000, 10);

  return { host, port, password, db, username, tlsEnabled, connectTimeout, commandTimeout };
}

/**
 * 初始化Redis连接
 */
async function initRedis() {
  if (redisClient && isConnected) {
    return redisClient;
  }

  const { host, port, password, db, username, tlsEnabled, connectTimeout, commandTimeout } = buildRedisConfig();

  const clientOptions = {
    socket: {
      host,
      port,
      connectTimeout,
      // 自动重连策略：指数退避，最多重试 10 次
      reconnectStrategy: (retries) => {
        if (retries >= 10) {
          console.error('[Redis] 达到最大重连次数，停止重连');
          return new Error('Redis 重连失败：已超过最大重试次数');
        }
        const delay = Math.min(retries * 500, 5000); // 500ms ~ 5s
        console.warn(`[Redis] 第 ${retries + 1} 次重连，等待 ${delay}ms...`);
        return delay;
      },
      ...(tlsEnabled ? { tls: true } : {})
    },
    commandsQueueMaxLength: 512,
    disableOfflineQueue: false
  };

  // 认证信息
  if (password) clientOptions.password = password;
  if (username) clientOptions.username = username;
  if (db)       clientOptions.database = db;

  // 若设置了命令超时，使用 socket 层超时包装
  if (commandTimeout > 0) {
    clientOptions.socket.timeout = commandTimeout;
  }

  redisClient = createClient(clientOptions);

  redisClient.on('connect', () => {
    console.log('[Redis] 正在连接...');
  });

  redisClient.on('ready', () => {
    isConnected = true;
    console.log(`[Redis] 连接就绪 ${host}:${port} db=${db}${tlsEnabled ? ' (TLS)' : ''}`);
  });

  redisClient.on('reconnecting', () => {
    isConnected = false;
    console.warn('[Redis] 连接断开，正在重连...');
  });

  redisClient.on('end', () => {
    isConnected = false;
    console.log('[Redis] 连接已关闭');
  });

  redisClient.on('error', (err) => {
    // ECONNREFUSED 等常见错误只打 warn，避免刷屏
    const isCommonError = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
    if (isCommonError) {
      console.warn('[Redis] 连接错误:', err.message);
    } else {
      console.error('[Redis] 连接错误:', err.message);
    }
  });

  try {
    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error('[Redis] 初始化失败:', error.message);
    throw error;
  }
}

/**
 * 获取Redis客户端
 */
function getRedisClient() {
  if (!redisClient || !isConnected) {
    throw new Error('Redis未连接，请先调用initRedis()');
  }
  return redisClient;
}

/**
 * 关闭Redis连接
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
    console.log('[Redis] 连接已关闭');
  }
}

/**
 * 检查Redis是否已连接
 */
function isRedisConnected() {
  return isConnected;
}

/**
 * 验证码相关操作
 * 注意：key 带场景前缀（register/login/password/emailChange/deletion），
 * 防止同一邮箱在不同场景共用验证码（此前验证码不绑定用途可被跨场景使用）
 */
const verificationCode = {
  // 验证码过期时间（5分钟）
  EXPIRE_TIME: 5 * 60,

  // 发送间隔时间（60秒）
  SEND_INTERVAL: 60,

  /**
   * 生成验证码存储的key
   * @param {string} email
   * @param {string} scenario - 场景（register/login/password/emailChange/deletion）
   */
  getKey(email, scenario = 'default') {
    return `verification:${scenario}:${email.toLowerCase()}`;
  },

  /**
   * 生成发送时间戳的key
   */
  getTimestampKey(email, scenario = 'default') {
    return `verification:timestamp:${scenario}:${email.toLowerCase()}`;
  },

  /**
   * 存储验证码
   */
  async set(email, code, scenario = 'default') {
    const client = getRedisClient();
    const key = this.getKey(email, scenario);
    const timestampKey = this.getTimestampKey(email, scenario);
    
    // 使用multi批量执行
    const multi = client.multi();
    multi.setEx(key, this.EXPIRE_TIME, code);
    multi.setEx(timestampKey, this.SEND_INTERVAL, Date.now().toString());
    
    await multi.exec();
  },

  /**
   * 获取验证码
   */
  async get(email, scenario = 'default') {
    const client = getRedisClient();
    const key = this.getKey(email, scenario);
    return await client.get(key);
  },

  /**
   * 删除验证码
   */
  async delete(email, scenario = 'default') {
    const client = getRedisClient();
    const key = this.getKey(email, scenario);
    await client.del(key);
  },

  /**
   * 检查是否在发送间隔内
   * @returns {boolean} true表示在间隔内，不能发送
   */
  async isInInterval(email, scenario = 'default') {
    const client = getRedisClient();
    const timestampKey = this.getTimestampKey(email, scenario);
    const timestamp = await client.get(timestampKey);
    return !!timestamp;
  },

  /**
   * 验证验证码
   * @returns {object} { valid: boolean, message: string }
   */
  async verify(email, code, scenario = 'default') {
    const storedCode = await this.get(email, scenario);
    
    if (!storedCode) {
      return {
        valid: false,
        message: '验证码不存在或已过期'
      };
    }
    
    if (storedCode !== code) {
      return {
        valid: false,
        message: '验证码错误'
      };
    }
    
    // 验证成功，删除验证码
    await this.delete(email, scenario);
    
    return {
      valid: true,
      message: '验证码验证成功'
    };
  }
};

/**
 * IP访问统计相关操作
 */
const ipStats = {
  // IP访问计数的前缀key
  PREFIX: 'ip:stats:',
  // IP最后访问时间的前缀key
  LAST_ACCESS_PREFIX: 'ip:lastAccess:',
  // 设备信息（User-Agent 解析结果）前缀key
  UA_PREFIX: 'ip:ua:',

  /**
   * 获取IP统计的key
   */
  getKey(ip) {
    return `${this.PREFIX}${ip}`;
  },

  /**
   * 获取IP最后访问时间的key
   */
  getLastAccessKey(ip) {
    return `${this.LAST_ACCESS_PREFIX}${ip}`;
  },

  /**
   * 获取设备信息key
   */
  getUaKey(ip) {
    return `${this.UA_PREFIX}${ip}`;
  },

  /**
   * 记录一次访问
   * @param {string} ip - 访问IP
   * @param {string} userAgent - User-Agent 字符串（用于识别设备/来源）
   */
  async recordAccess(ip, userAgent) {
    if (!isConnected) {
      return;
    }
    try {
      const client = getRedisClient();
      const key = this.getKey(ip);
      const lastAccessKey = this.getLastAccessKey(ip);
      const now = new Date().toISOString();

      // 解析并存储设备信息（每次更新，反映最近一次访问的设备）
      let uaJson = null;
      try {
        const { parseUserAgent } = require('./userAgent');
        uaJson = JSON.stringify(parseUserAgent(userAgent));
      } catch (uaError) {
        console.error('[Redis] 解析User-Agent失败:', uaError.message);
      }
      const uaKey = this.getUaKey(ip);
      
      // 使用 multi 批量执行：增加计数 + 更新最后访问时间 + 更新设备信息
      // 加 TTL（30 天）：防止 ip:stats:* key 永久堆积导致 Redis 内存无限增长
      const multi = client.multi();
      multi.incr(key);
      multi.set(lastAccessKey, now);
      multi.expire(key, 30 * 24 * 60 * 60);
      multi.expire(lastAccessKey, 30 * 24 * 60 * 60);
      if (uaJson) {
        multi.set(uaKey, uaJson);
        multi.expire(uaKey, 30 * 24 * 60 * 60);
      }
      await multi.exec();
    } catch (error) {
      console.error('[Redis] 记录IP访问失败:', error.message);
    }
  },

  /**
   * 获取指定IP的访问次数
   * @param {string} ip - IP地址
   * @returns {Promise<number>} 访问次数
   */
  async getAccessCount(ip) {
    if (!isConnected) {
      return 0;
    }
    try {
      const client = getRedisClient();
      const key = this.getKey(ip);
      const count = await client.get(key);
      return parseInt(count) || 0;
    } catch (error) {
      console.error('[Redis] 获取IP访问次数失败:', error.message);
      return 0;
    }
  },

  /**
   * 获取所有IP访问统计
   * @param {object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {string} options.order - 排序方式 'asc' 或 'desc'
   * @returns {Promise<Array>} IP访问统计数组 [{ip, count, lastAccess}, ...]
   */
  async getAllStats(options = {}) {
    const { limit = 100, order = 'desc' } = options;
    
    if (!isConnected) {
      return [];
    }
    
    try {
      const client = getRedisClient();
      const keys = [];
      
      // 扫描所有IP统计key
      for await (const key of client.scanIterator({
        MATCH: `${this.PREFIX}*`,
        COUNT: 1000
      })) {
        keys.push(key);
      }

      // 获取所有IP的访问次数和最后访问时间
      const stats = [];
      for (const key of keys) {
        const count = await client.get(key);
        const ip = key.replace(this.PREFIX, '');
        
        // 获取最后访问时间
        const lastAccessKey = this.getLastAccessKey(ip);
        const lastAccess = await client.get(lastAccessKey);

        // 获取设备信息（解析后的 User-Agent）
        let uaInfo = null;
        try {
          const uaKey = this.getUaKey(ip);
          const uaRaw = await client.get(uaKey);
          if (uaRaw) {
            uaInfo = JSON.parse(uaRaw);
          }
        } catch (uaError) {
          console.error('[Redis] 读取设备信息失败:', uaError.message);
        }
        
        stats.push({
          ip,
          count: parseInt(count) || 0,
          lastAccess: lastAccess || null,
          ua: uaInfo || { source: '未知', device: '未知' }
        });
      }

      // 排序
      stats.sort((a, b) => {
        if (order === 'desc') {
          return b.count - a.count;
        }
        return a.count - b.count;
      });

      // 限制返回数量
      return stats.slice(0, limit);
    } catch (error) {
      console.error('[Redis] 获取IP访问统计失败:', error.message);
      return [];
    }
  },

  /**
   * 获取IP统计总数
   * @returns {Promise<object>} { uniqueIps, totalVisits }
   */
  async getSummary() {
    if (!isConnected) {
      return { uniqueIps: 0, totalVisits: 0 };
    }
    
    try {
      const client = getRedisClient();
      let uniqueIps = 0;
      let totalVisits = 0;

      for await (const key of client.scanIterator({
        MATCH: `${this.PREFIX}*`,
        COUNT: 1000
      })) {
        uniqueIps++;
        const count = await client.get(key);
        totalVisits += parseInt(count) || 0;
      }

      return { uniqueIps, totalVisits };
    } catch (error) {
      console.error('[Redis] 获取IP统计摘要失败:', error.message);
      return { uniqueIps: 0, totalVisits: 0 };
    }
  },

  /**
   * 清除指定IP的统计
   * @param {string} ip - IP地址
   */
  async clearIp(ip) {
    if (!isConnected) {
      return false;
    }
    try {
      const client = getRedisClient();
      const key = this.getKey(ip);
      const lastAccessKey = this.getLastAccessKey(ip);
      const uaKey = this.getUaKey(ip);
      
      // 同时删除访问计数、最后访问时间和设备信息
      await client.del(key);
      await client.del(lastAccessKey);
      await client.del(uaKey);
      return true;
    } catch (error) {
      console.error('[Redis] 清除IP统计失败:', error.message);
      return false;
    }
  },

  /**
   * 清除所有IP统计
   */
  async clearAll() {
    if (!isConnected) {
      return 0;
    }
    try {
      const client = getRedisClient();
      let clearedCount = 0;

      // 清除访问计数
      for await (const key of client.scanIterator({
        MATCH: `${this.PREFIX}*`,
        COUNT: 1000
      })) {
        await client.del(key);
        clearedCount++;
      }

      // 清除最后访问时间
      for await (const key of client.scanIterator({
        MATCH: `${this.LAST_ACCESS_PREFIX}*`,
        COUNT: 1000
      })) {
        await client.del(key);
      }

      return clearedCount;
    } catch (error) {
      console.error('[Redis] 清除所有IP统计失败:', error.message);
      return 0;
    }
  }
};

/**
 * 用户缓存相关操作
 */
const userCache = {
  // 缓存前缀
  PREFIX: 'user:',
  // 过期时间（30分钟）
  EXPIRE_TIME: 30 * 60,

  getKey(userId) {
    return `${this.PREFIX}${userId}`;
  },

  /**
   * 获取用户缓存
   */
  async get(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const data = await client.get(this.getKey(userId));
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[Redis] 获取用户缓存失败:', error.message);
      return null;
    }
  },

  /**
   * 设置用户缓存
   */
  async set(userId, userData) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(this.getKey(userId), this.EXPIRE_TIME, JSON.stringify(userData));
      return true;
    } catch (error) {
      console.error('[Redis] 设置用户缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 删除用户缓存
   */
  async delete(userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(this.getKey(userId));
      return true;
    } catch (error) {
      console.error('[Redis] 删除用户缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 批量删除用户缓存
   */
  async deleteMultiple(userIds) {
    if (!isConnected || !userIds.length) return 0;
    try {
      const client = getRedisClient();
      const keys = userIds.map(id => this.getKey(id));
      return await client.del(keys);
    } catch (error) {
      console.error('[Redis] 批量删除用户缓存失败:', error.message);
      return 0;
    }
  }
};

/**
 * 帖子缓存相关操作
 */
const postCache = {
  PREFIX: 'post:',
  EXPIRE_TIME: 10 * 60, // 10分钟

  getKey(postId) {
    return `${this.PREFIX}${postId}`;
  },

  /**
   * 获取帖子缓存
   */
  async get(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const data = await client.get(this.getKey(postId));
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[Redis] 获取帖子缓存失败:', error.message);
      return null;
    }
  },

  /**
   * 设置帖子缓存
   */
  async set(postId, postData) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(this.getKey(postId), this.EXPIRE_TIME, JSON.stringify(postData));
      return true;
    } catch (error) {
      console.error('[Redis] 设置帖子缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 删除帖子缓存
   */
  async delete(postId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(this.getKey(postId));
      // 同时删除相关的计数缓存
      await client.del(`post:${postId}:likes`);
      await client.del(`post:${postId}:views`);
      await client.del(`post:${postId}:comments`);
      return true;
    } catch (error) {
      console.error('[Redis] 删除帖子缓存失败:', error.message);
      return false;
    }
  }
};

/**
 * 关注关系缓存相关操作
 */
const followCache = {
  FOLLOWING_PREFIX: 'user:following:',
  FOLLOWER_COUNT_PREFIX: 'user:follower_count:',
  FOLLOWING_COUNT_PREFIX: 'user:following_count:',
  EXPIRE_TIME: 30 * 60,

  /**
   * 获取用户关注的人ID列表
   */
  async getFollowingIds(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const members = await client.sMembers(`${this.FOLLOWING_PREFIX}${userId}`);
      return members;
    } catch (error) {
      console.error('[Redis] 获取关注列表缓存失败:', error.message);
      return null;
    }
  },

  /**
   * 设置用户关注的人ID列表
   */
  async setFollowingIds(userId, followingIds) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      const key = `${this.FOLLOWING_PREFIX}${userId}`;
      // 先删除旧的
      await client.del(key);
      // 添加新的
      if (followingIds.length > 0) {
        await client.sAdd(key, followingIds);
      }
      await client.expire(key, this.EXPIRE_TIME);
      return true;
    } catch (error) {
      console.error('[Redis] 设置关注列表缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 检查是否关注（快速判断）
   */
  async isFollowing(followerId, followingId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const isMember = await client.sIsMember(`${this.FOLLOWING_PREFIX}${followerId}`, followingId);
      return isMember;
    } catch (error) {
      console.error('[Redis] 检查关注状态失败:', error.message);
      return null;
    }
  },

  /**
   * 添加关注关系
   */
  async addFollowing(followerId, followingId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      // 添加到关注列表
      await client.sAdd(`${this.FOLLOWING_PREFIX}${followerId}`, followingId);
      // 增加计数
      await this.incrFollowingCount(followerId);
      await this.incrFollowerCount(followingId);
      return true;
    } catch (error) {
      console.error('[Redis] 添加关注关系失败:', error.message);
      return false;
    }
  },

  /**
   * 移除关注关系
   */
  async removeFollowing(followerId, followingId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      // 从关注列表移除
      await client.sRem(`${this.FOLLOWING_PREFIX}${followerId}`, followingId);
      // 减少计数
      await this.decrFollowingCount(followerId);
      await this.decrFollowerCount(followingId);
      return true;
    } catch (error) {
      console.error('[Redis] 移除关注关系失败:', error.message);
      return false;
    }
  },

  /**
   * 获取粉丝数
   */
  async getFollowerCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.FOLLOWER_COUNT_PREFIX}${userId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      console.error('[Redis] 获取粉丝数缓存失败:', error.message);
      return null;
    }
  },

  /**
   * 获取关注数
   */
  async getFollowingCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.FOLLOWING_COUNT_PREFIX}${userId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      console.error('[Redis] 获取关注数缓存失败:', error.message);
      return null;
    }
  },

  /**
   * 设置粉丝数
   */
  async setFollowerCount(userId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.FOLLOWER_COUNT_PREFIX}${userId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      console.error('[Redis] 设置粉丝数缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 设置关注数
   */
  async setFollowingCount(userId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.FOLLOWING_COUNT_PREFIX}${userId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      console.error('[Redis] 设置关注数缓存失败:', error.message);
      return false;
    }
  },

  /**
   * 增加粉丝数
   */
  async incrFollowerCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.FOLLOWER_COUNT_PREFIX}${userId}`;
      const val = await client.incr(key);
      // 计数 key 带 TTL，防止无界增长
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      console.error('[Redis] 增加粉丝数失败:', error.message);
      return null;
    }
  },

  /**
   * 减少粉丝数
   */
  async decrFollowerCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.FOLLOWER_COUNT_PREFIX}${userId}`;
      const val = await client.decr(key);
      // 计数 key 带 TTL，防止无界增长
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      console.error('[Redis] 减少粉丝数失败:', error.message);
      return null;
    }
  },

  /**
   * 增加关注数
   */
  async incrFollowingCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.FOLLOWING_COUNT_PREFIX}${userId}`;
      const val = await client.incr(key);
      // 计数 key 带 TTL，防止无界增长
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      console.error('[Redis] 增加关注数失败:', error.message);
      return null;
    }
  },

  /**
   * 减少关注数
   */
  async decrFollowingCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.FOLLOWING_COUNT_PREFIX}${userId}`;
      const val = await client.decr(key);
      // 计数 key 带 TTL，防止无界增长
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      console.error('[Redis] 减少关注数失败:', error.message);
      return null;
    }
  },

  /**
   * 清除用户关注相关缓存
   */
  async clearUserFollowCache(userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(`${this.FOLLOWING_PREFIX}${userId}`);
      await client.del(`${this.FOLLOWER_COUNT_PREFIX}${userId}`);
      await client.del(`${this.FOLLOWING_COUNT_PREFIX}${userId}`);
      return true;
    } catch (error) {
      console.error('[Redis] 清除用户关注缓存失败:', error.message);
      return false;
    }
  }
};

/**
 * 帖子计数器缓存（点赞、浏览、评论数）
 */
const postCounters = {
  LIKES_PREFIX: 'post:likes:',
  VIEWS_PREFIX: 'post:views:',
  COMMENTS_PREFIX: 'post:comments:',
  DISLIKES_PREFIX: 'post:dislikes:',
  LIKED_BY_PREFIX: 'post:liked_by:',
  DISLIKED_BY_PREFIX: 'post:disliked_by:',
  EXPIRE_TIME: 5 * 60, // 5分钟

  /**
   * 获取点赞数
   */
  async getLikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.LIKES_PREFIX}${postId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置点赞数
   */
  async setLikes(postId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.LIKES_PREFIX}${postId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 增加点赞
   */
  async incrLikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.LIKES_PREFIX}${postId}`;
      const val = await client.incr(key);
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      return null;
    }
  },

  /**
   * 减少点赞
   */
  async decrLikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.LIKES_PREFIX}${postId}`;
      const val = await client.decr(key);
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      return null;
    }
  },

  /**
   * 获取点踩数
   */
  async getDislikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.DISLIKES_PREFIX}${postId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置点踩数
   */
  async setDislikes(postId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.DISLIKES_PREFIX}${postId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 增加点踩
   */
  async incrDislikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.DISLIKES_PREFIX}${postId}`;
      const val = await client.incr(key);
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      return null;
    }
  },

  /**
   * 减少点踩
   */
  async decrDislikes(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.DISLIKES_PREFIX}${postId}`;
      const val = await client.decr(key);
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      return null;
    }
  },

  /**
   * 获取浏览数
   */
  async getViews(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.VIEWS_PREFIX}${postId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 增加浏览数
   */
  async incrViews(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.VIEWS_PREFIX}${postId}`;
      const val = await client.incr(key);
      await client.expire(key, this.EXPIRE_TIME);
      return val;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置浏览数
   */
  async setViews(postId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.VIEWS_PREFIX}${postId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 检查用户是否点赞
   */
  async isLiked(postId, userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      return await client.sIsMember(`${this.LIKED_BY_PREFIX}${postId}`, userId);
    } catch (error) {
      return null;
    }
  },

  /**
   * 添加点赞用户
   */
  async addLikedBy(postId, userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.sAdd(`${this.LIKED_BY_PREFIX}${postId}`, userId);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 移除点赞用户
   */
  async removeLikedBy(postId, userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.sRem(`${this.LIKED_BY_PREFIX}${postId}`, userId);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 检查用户是否点踩
   */
  async isDisliked(postId, userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      return await client.sIsMember(`${this.DISLIKED_BY_PREFIX}${postId}`, userId);
    } catch (error) {
      return null;
    }
  },

  /**
   * 添加点踩用户
   */
  async addDislikedBy(postId, userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.sAdd(`${this.DISLIKED_BY_PREFIX}${postId}`, userId);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 移除点踩用户
   */
  async removeDislikedBy(postId, userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.sRem(`${this.DISLIKED_BY_PREFIX}${postId}`, userId);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 清除帖子所有计数缓存
   */
  async clearPostCounters(postId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(`${this.LIKES_PREFIX}${postId}`);
      await client.del(`${this.DISLIKES_PREFIX}${postId}`);
      await client.del(`${this.VIEWS_PREFIX}${postId}`);
      await client.del(`${this.COMMENTS_PREFIX}${postId}`);
      await client.del(`${this.LIKED_BY_PREFIX}${postId}`);
      await client.del(`${this.DISLIKED_BY_PREFIX}${postId}`);
      return true;
    } catch (error) {
      return false;
    }
  }
};

/**
 * 通知缓存相关操作
 */
const notificationCache = {
  UNREAD_PREFIX: 'user:unread:',
  COUNT_PREFIX: 'user:notification_count:',
  EXPIRE_TIME: 60, // 1分钟

  /**
   * 获取未读通知数
   */
  async getUnreadCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.UNREAD_PREFIX}${userId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置未读通知数
   */
  async setUnreadCount(userId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.UNREAD_PREFIX}${userId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 增加未读通知数
   */
  async incrUnreadCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const key = `${this.UNREAD_PREFIX}${userId}`;
      const count = await client.incr(key);
      // 该 key 此前没有任何 TTL，用户不再活跃也不会被清理（永久驻留）；
      // 补一个 90 天滑动过期兜底，未读数本身也会在标记已读时被 delete
      await client.expire(key, 90 * 24 * 60 * 60);
      return count;
    } catch (error) {
      return null;
    }
  },

  /**
   * 清除未读数（标记已读）
   */
  async clearUnreadCount(userId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.set(`${this.UNREAD_PREFIX}${userId}`, '0');
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 减少未读数
   */
  async decrUnreadCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.decr(`${this.UNREAD_PREFIX}${userId}`);
      // 确保不会变成负数
      if (count < 0) {
        await client.set(`${this.UNREAD_PREFIX}${userId}`, '0');
        return 0;
      }
      return count;
    } catch (error) {
      return null;
    }
  }
};

/**
 * 收藏缓存相关操作
 */
const favoriteCache = {
  COUNT_PREFIX: 'post:favorite_count:',
  USER_COUNT_PREFIX: 'user:favorite_count:',
  USER_FAVORITES_PREFIX: 'user:favorites:',
  EXPIRE_TIME: 5 * 60,

  /**
   * 获取帖子收藏数
   */
  async getPostFavoriteCount(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.COUNT_PREFIX}${postId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置帖子收藏数
   */
  async setPostFavoriteCount(postId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.COUNT_PREFIX}${postId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 增加收藏数
   */
  async incrPostFavoriteCount(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      return await client.incr(`${this.COUNT_PREFIX}${postId}`);
    } catch (error) {
      return null;
    }
  },

  /**
   * 减少收藏数
   */
  async decrPostFavoriteCount(postId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      return await client.decr(`${this.COUNT_PREFIX}${postId}`);
    } catch (error) {
      return null;
    }
  },

  /**
   * 获取用户收藏数
   */
  async getUserFavoriteCount(userId) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const count = await client.get(`${this.USER_COUNT_PREFIX}${userId}`);
      return count ? parseInt(count) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置用户收藏数
   */
  async setUserFavoriteCount(userId, count) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(`${this.USER_COUNT_PREFIX}${userId}`, this.EXPIRE_TIME, count.toString());
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 清除帖子收藏缓存
   */
  async clearPostFavoriteCache(postId) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(`${this.COUNT_PREFIX}${postId}`);
      return true;
    } catch (error) {
      return false;
    }
  }
};

/**
 * 会话管理（Token存储）
 */
const sessionCache = {
  PREFIX: 'session:',
  EXPIRE_TIME: 7 * 24 * 60 * 60, // 7天

  getKey(token) {
    return `${this.PREFIX}${token}`;
  },

  /**
   * 设置会话
   */
  async set(token, userId, ttl = this.EXPIRE_TIME) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(this.getKey(token), ttl, userId);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 获取会话
   */
  async get(token) {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      return await client.get(this.getKey(token));
    } catch (error) {
      return null;
    }
  },

  /**
   * 删除会话
   */
  async delete(token) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(this.getKey(token));
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 刷新会话过期时间
   */
  async refresh(token, ttl = this.EXPIRE_TIME) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.expire(this.getKey(token), ttl);
      return true;
    } catch (error) {
      return false;
    }
  }
};

/**
 * 接口限流
 */
const rateLimiter = {
  PREFIX: 'rate:',
  
  getKey(ip, endpoint) {
    return `${this.PREFIX}${ip}:${endpoint}`;
  },

  /**
   * 检查是否超过限制
   * @param {string} ip - 客户端IP
   * @param {string} endpoint - 接口路径
   * @param {number} limit - 限制次数
   * @param {number} window - 时间窗口（秒）
   * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
   */
  async check(ip, endpoint, limit = 100, window = 60) {
    if (!isConnected) return { allowed: true, remaining: limit, resetTime: 0 };
    
    try {
      const client = getRedisClient();
      const key = this.getKey(ip, endpoint);
      
      const current = await client.get(key);
      
      if (!current) {
        // 首次请求，设置计数
        await client.setEx(key, window, '1');
        return { allowed: true, remaining: limit - 1, resetTime: Date.now() + window * 1000 };
      }
      
      const count = parseInt(current);
      
      if (count >= limit) {
        // 超过限制
        const ttl = await client.ttl(key);
        return { allowed: false, remaining: 0, resetTime: Date.now() + ttl * 1000 };
      }
      
      // 增加计数
      await client.incr(key);
      return { allowed: true, remaining: limit - count - 1, resetTime: Date.now() + window * 1000 };
    } catch (error) {
      // 出错时允许请求
      return { allowed: true, remaining: limit, resetTime: 0 };
    }
  },

  /**
   * 重置限制
   */
  async reset(ip, endpoint) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(this.getKey(ip, endpoint));
      return true;
    } catch (error) {
      return false;
    }
  }
};

/**
 * 图形验证码缓存
 */
const captchaCache = {
  // 验证码过期时间（5分钟）
  EXPIRE_TIME: 5 * 60,

  getKey(captchaId) {
    return `captcha:${captchaId}`;
  },

  /**
   * 存储验证码答案
   */
  async set(captchaId, code) {
    if (!isConnected) {
      return this._setToMemory(captchaId, code);
    }
    try {
      const client = getRedisClient();
      await client.setEx(this.getKey(captchaId), this.EXPIRE_TIME, code);
      return true;
    } catch (error) {
      // fallback 到内存
      return this._setToMemory(captchaId, code);
    }
  },

  /**
   * 写入进程内存储（Redis 不可用时的兜底）
   * 顺带清理已过期条目：这里此前只增不删，长期无 Redis 运行时 Map 会持续膨胀
   */
  _setToMemory(captchaId, code) {
    if (!this._memoryStore) this._memoryStore = new Map();
    const now = Date.now();
    for (const [key, entry] of this._memoryStore) {
      if (entry.expireAt <= now) this._memoryStore.delete(key);
    }
    this._memoryStore.set(captchaId, { code, expireAt: now + this.EXPIRE_TIME * 1000 });
    return true;
  },

  /**
   * 验证验证码（验证后删除，一次性使用）
   */
  async verify(captchaId, inputCode) {
    if (!isConnected) {
      return this._verifyFromMemory(captchaId, inputCode);
    }
    try {
      const client = getRedisClient();
      const key = this.getKey(captchaId);
      const stored = await client.get(key);
      if (!stored) return { valid: false, message: '验证码已过期' };
      // 验证后立即删除（一次性使用）
      await client.del(key);
      if (stored.toLowerCase() === inputCode.toLowerCase()) {
        return { valid: true, message: '验证成功' };
      }
      return { valid: false, message: '验证码错误' };
    } catch (error) {
      // 降级策略与「Redis 未连接」保持一致：退到进程内存储再判一次，
      // 而不是直接判定验证失败（set 写入时同样有内存兜底，两边口径统一）
      return this._verifyFromMemory(captchaId, inputCode);
    }
  },

  /**
   * 进程内验证（Redis 不可用/报错时的兜底路径）
   */
  _verifyFromMemory(captchaId, inputCode) {
    if (!this._memoryStore) return { valid: false, message: '验证码已过期' };
    const entry = this._memoryStore.get(captchaId);
    if (!entry) return { valid: false, message: '验证码已过期' };
    if (Date.now() > entry.expireAt) {
      this._memoryStore.delete(captchaId);
      return { valid: false, message: '验证码已过期' };
    }
    this._memoryStore.delete(captchaId);
    if (entry.code.toLowerCase() === inputCode.toLowerCase()) {
      return { valid: true, message: '验证成功' };
    }
    return { valid: false, message: '验证码错误' };
  }
};

/**
 * 热门帖子缓存
 */
const hotPostsCache = {
  KEY: 'hot_posts',
  EXPIRE_TIME: 5 * 60,

  /**
   * 获取热门帖子列表
   */
  async get() {
    if (!isConnected) return null;
    try {
      const client = getRedisClient();
      const data = await client.get(this.KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * 设置热门帖子列表
   */
  async set(posts) {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.setEx(this.KEY, this.EXPIRE_TIME, JSON.stringify(posts));
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 清除热门帖子缓存
   */
  async clear() {
    if (!isConnected) return false;
    try {
      const client = getRedisClient();
      await client.del(this.KEY);
      return true;
    } catch (error) {
      return false;
    }
  }
};

/**
 * QQ 快捷登录会话缓存（state 关联：授权发起 → 回调 → 前端取结果 → 补全资料）
 * 带内存 fallback（Redis 不可用时进程内 Map）
 */
const qqCache = {
  // 会话过期时间（10分钟）
  EXPIRE_TIME: 10 * 60,

  getKey(state) {
    return `qq:session:${state}`;
  },

  /**
   * 存储 QQ 会话
   * @param {string} state - 防 CSRF 随机串
   * @param {object} data - { type: 'login'|'bind', userId?, openid?, nickname?, avatar?, gender?, result? }
   */
  async set(state, data) {
    const json = JSON.stringify(data);
    if (!isConnected) {
      if (!this._memoryStore) this._memoryStore = new Map();
      this._memoryStore.set(this.getKey(state), { data, expireAt: Date.now() + this.EXPIRE_TIME * 1000 });
      return true;
    }
    try {
      const client = getRedisClient();
      await client.setEx(this.getKey(state), this.EXPIRE_TIME, json);
      return true;
    } catch (error) {
      console.error('[Redis] 存储QQ会话失败:', error.message);
      return false;
    }
  },

  /**
   * 获取 QQ 会话
   */
  async get(state) {
    if (!state) return null;
    if (!isConnected) {
      if (!this._memoryStore) return null;
      const item = this._memoryStore.get(this.getKey(state));
      if (!item) return null;
      if (Date.now() > item.expireAt) {
        this._memoryStore.delete(this.getKey(state));
        return null;
      }
      return item.data;
    }
    try {
      const client = getRedisClient();
      const raw = await client.get(this.getKey(state));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error('[Redis] 获取QQ会话失败:', error.message);
      return null;
    }
  },

  /**
   * 删除 QQ 会话（一次性消费）
   */
  async del(state) {
    if (!state) return;
    if (!isConnected) {
      if (this._memoryStore) this._memoryStore.delete(this.getKey(state));
      return;
    }
    try {
      const client = getRedisClient();
      await client.del(this.getKey(state));
    } catch (error) {
      console.error('[Redis] 删除QQ会话失败:', error.message);
    }
  }
};

module.exports = {
  initRedis,
  getRedisClient,
  closeRedis,
  isRedisConnected,
  verificationCode,
  ipStats,
  // 新增缓存模块
  userCache,
  postCache,
  followCache,
  postCounters,
  notificationCache,
  favoriteCache,
  sessionCache,
  rateLimiter,
  hotPostsCache,
  captchaCache,
  qqCache
};
