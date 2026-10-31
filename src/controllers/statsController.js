const { 
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { getPaginationConfig } = require('../config/constants');
const logger = require('../utils/logger');
const { ipStats, isRedisConnected } = require('../utils/redisUtils');
const Post = require('../models/Post');
const User = require('../models/User');

// 转义正则特殊字符（用于搜索）
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const statsController = {
  // 获取统计数据
  async getStats(req, res) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 全部走 DB 计数/聚合，不再全量加载
      const [totalUsers, totalPosts, todayPosts, activeUsers, commentsAgg, likesAgg, anonymousPosts] = await Promise.all([
        User.countDocuments({}),
        Post.countDocuments({ isDeleted: false }),
        Post.countDocuments({ isDeleted: false, timestamp: { $gte: today } }),
        User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
        Post.aggregate([
          { $match: { isDeleted: false } },
          { $project: { c: { $size: { $ifNull: ['$comments', []] } } } },
          { $group: { _id: null, total: { $sum: '$c' } } }
        ]),
        Post.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$likes', 0] } } } }
        ]),
        Post.countDocuments({ isDeleted: false, anonymous: { $in: [true, 'true'] } })
      ]);

      const stats = {
        totalUsers,
        totalPosts,
        todayPosts,
        totalComments: commentsAgg.length ? commentsAgg[0].total : 0,
        totalLikes: likesAgg.length ? likesAgg[0].total : 0,
        activeUsers,
        anonymousPosts
      };

      res.json(generateSuccessResponse({ stats }));
    } catch (error) {
      logger.logError('获取统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 搜索功能
  async search(req, res) {
    try {
      const paginationConfig = getPaginationConfig();
      const { q, type = 'posts', page = paginationConfig.defaultPage, limit = paginationConfig.defaultLimit } = req.query;
      
      if (!q) {
        return res.status(400).json(generateErrorResponse('搜索关键词不能为空'));
      }

      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || paginationConfig.defaultPage);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || paginationConfig.defaultLimit));
      
      if (type === 'posts') {
        // 可见性过滤：此前只有 isDeleted + content，未登录也能搜到
        // visibility='self' / 'followers' 的帖子全文与作者 UUID。
        // 口径与 postController.getPosts 保持一致。
        const viewerId = req.user && req.user.id ? req.user.id : null;
        const query = { isDeleted: false, content: new RegExp(escapeRegex(q), 'i') };

        const visibleClauses = [{ visibility: 'public' }, { visibility: { $exists: false } }];
        if (viewerId) visibleClauses.push({ userId: viewerId });
        query.$or = visibleClauses;

        const [rawPosts, total] = await Promise.all([
          Post.find(query).sort({ timestamp: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
          Post.countDocuments(query)
        ]);

        // PII 脱敏：未登录用户隐藏学校/年级/班级与点赞者 UUID 列表
        const results = rawPosts.map(p => {
          if (viewerId) return p;
          return { ...p, school: '', grade: '', className: '', likedBy: [], dislikedBy: [] };
        });

        res.json(generateSuccessResponse({
          results,
          total,
          type: 'posts'
        }));
      } else if (type === 'users') {
        // 用户搜索会返回 school/grade/className 等 PII，且可按用户名批量枚举账号，必须登录后使用
        if (!req.user) {
          return res.status(401).json(generateErrorResponse('请先登录后再搜索用户', 401));
        }
        const query = { username: new RegExp(escapeRegex(q), 'i') };
        const [users, total] = await Promise.all([
          User.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
          User.countDocuments(query)
        ]);
        // 改为白名单：此前是「剔除 6 个字段」，导致 loginDevices（最近 10 次登录的
        // IP + 设备指纹）、role（管理员身份）、settings、lastLogin、passwordChangedAt
        // 全部随搜索结果公开，未登录即可按用户名枚举。
        const results = users.map(user => ({
          id: user.id,
          username: user.username,
          avatar: user.avatar || null,
          school: user.school || '',
          grade: user.grade || '',
          className: user.className || '',
          createdAt: user.createdAt
        }));

        res.json(generateSuccessResponse({
          results,
          total,
          type: 'users'
        }));
      } else {
        return res.status(400).json(generateErrorResponse('不支持的搜索类型'));
      }
    } catch (error) {
      logger.logError('搜索失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取IP访问统计列表
  async getIpStats(req, res) {
    try {
      if (!isRedisConnected()) {
        return res.status(503).json(generateErrorResponse('Redis未连接，无法获取IP统计', 503));
      }

      const { limit = 50, order = 'desc' } = req.query;
      const stats = await ipStats.getAllStats({
        limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
        order
      });

      res.json(generateSuccessResponse({
        stats,
        total: stats.length
      }));
    } catch (error) {
      logger.logError('获取IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取IP统计摘要
  async getIpStatsSummary(req, res) {
    try {
      if (!isRedisConnected()) {
        return res.status(503).json(generateErrorResponse('Redis未连接，无法获取IP统计', 503));
      }

      const summary = await ipStats.getSummary();
      res.json(generateSuccessResponse({ summary }));
    } catch (error) {
      logger.logError('获取IP统计摘要失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取指定IP的访问次数
  async getIpAccessCount(req, res) {
    try {
      if (!isRedisConnected()) {
        return res.status(503).json(generateErrorResponse('Redis未连接，无法获取IP统计', 503));
      }

      const { ip } = req.params;
      if (!ip) {
        return res.status(400).json(generateErrorResponse('IP地址不能为空'));
      }

      const count = await ipStats.getAccessCount(ip);
      res.json(generateSuccessResponse({ ip, count }));
    } catch (error) {
      logger.logError('获取IP访问次数失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 清除指定IP的统计
  async clearIpStats(req, res) {
    try {
      if (!isRedisConnected()) {
        return res.status(503).json(generateErrorResponse('Redis未连接', 503));
      }

      const { ip } = req.params;
      if (!ip) {
        return res.status(400).json(generateErrorResponse('IP地址不能为空'));
      }

      const success = await ipStats.clearIp(ip);
      if (success) {
        logger.logSystemEvent('已清除IP统计', { ip });
        res.json(generateSuccessResponse({ message: 'IP统计已清除', ip }));
      } else {
        res.status(500).json(generateErrorResponse('清除IP统计失败'));
      }
    } catch (error) {
      logger.logError('清除IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 清除所有IP统计
  async clearAllIpStats(req, res) {
    try {
      if (!isRedisConnected()) {
        return res.status(503).json(generateErrorResponse('Redis未连接', 503));
      }

      const clearedCount = await ipStats.clearAll();
      logger.logSystemEvent('已清除所有IP统计', { clearedCount });
      res.json(generateSuccessResponse({ 
        message: '所有IP统计已清除',
        clearedCount 
      }));
    } catch (error) {
      logger.logError('清除所有IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = statsController;
