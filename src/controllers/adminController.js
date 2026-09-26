const {
  getPosts,
  getUsers,
  getPostById,
  getUserById,
  updateUser,
  getBannedUsers,
  banUser: createBanRecord,
  unbanUser: removeBanRecord,
  getDeletedPosts,
  permanentDeletePost,
  cleanupPostRelations,
  deletePost,
  updatePost,
  createNotification
} = require('../utils/dataUtils');
const { v4: uuidv4 } = require('uuid');
const {
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { getPaginationConfig } = require('../config/constants');
const { postCache, userCache } = require('../utils/redisUtils');
const logger = require('../utils/logger');
const Post = require('../models/Post');
const User = require('../models/User');

// 转义正则特殊字符（用于搜索）
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 管理员用户列表允许下发的字段白名单
// 此前是 User.find({}).lean() 全量返回（只删了 password），email / qqOpenId / loginDevices /
// settings / birthday 等个人信息也会一并下发，而后台列表并不使用这些字段
const ADMIN_USER_FIELDS = [
  'id', 'username', 'qq', 'avatar', 'school', 'grade', 'className', 'enrollmentYear',
  'postCount', 'commentCount', 'isActive', 'role', 'createdAt', 'lastLogin',
  'banReason', 'banStartTime', 'banEndTime', 'bannedBy'
].join(' ');

// 日志查询单次最多解析的行数（只取最新这些行，避免整份日志进内存）
const MAX_LOG_LINES = 20000;

const adminController = {
  // 管理员功能 - 获取帖子列表（包含已删除帖子）
  async getAdminPosts(req, res) {
    try {
      const paginationConfig = getPaginationConfig();
      const { page = paginationConfig.defaultPage, limit = paginationConfig.defaultLimit, search = '' } = req.query;
      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || paginationConfig.defaultPage);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || paginationConfig.defaultLimit));

      logger.logInfo('管理员访问帖子列表', {
        page: pageNum,
        limit: limitNum,
        search,
        ip: req.ip
      });

      // 包含已删除的帖子；搜索条件下推 MongoDB（管理员可见全部）
      const query = {};
      if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ content: re }, { username: re }];
      }

      const [posts, total] = await Promise.all([
        Post.find(query).sort({ timestamp: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
        Post.countDocuments(query)
      ]);

      res.json(generateSuccessResponse({
        posts,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalPosts: total,
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }));
    } catch (error) {
      logger.logError('管理员获取帖子错误', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 永久删除帖子
  async deletePostPermanently(req, res) {
    try {
      const postId = req.params.id;
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { reason } = req.body;

      const post = await getPostById(postId, true);

      if (!post) {
        logger.logWarn('永久删除帖子失败：帖子不存在', { postId, adminId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 永久删除帖子
      await permanentDeletePost(postId);

      // 清帖子缓存：postCache TTL 10 分钟，且读取时校验的是缓存快照里的 isDeleted，
      // 不清缓存则已删内容最多还能读到 10 分钟（作者软删路径每处都清了，管理员路径此前漏了）
      await postCache.delete(postId);

      // 清理关联数据：收藏与通知（举报记录保留作为治理凭据）
      await cleanupPostRelations(postId);

      // 清理落盘图片（永久删除才做；软删可被恢复，不能动文件）
      // 此前只删库记录，public/images 里的文件成为永久垃圾
      const { removeImageFiles } = require('../middleware/uploadMiddleware');
      const imageCleanup = await removeImageFiles(post.images || []);

      // 记录管理员永久删除帖子日志
      logger.logSecurityEvent('管理员永久删除帖子', {
        adminId,
        postId,
        postAuthor: post.username,
        reason: reason || '无',
        imageFilesDeleted: imageCleanup.deleted,
        imageFilesFailed: imageCleanup.failed,
        ip: req.ip
      });
      
      // 更新用户发帖数
      // 两点修正：
      // 1) 帖子若已被作者软删（作者软删时已扣过一次），这里必须跳过，否则重复扣减
      // 2) 改成带条件的原子 $inc（postCount > 0 才扣），不再「读-改-写」覆盖，
      //    避免并发下丢失其他帖子的计数变更
      if (!post.isDeleted) {
        await User.updateOne(
          { id: post.userId, postCount: { $gt: 0 } },
          { $inc: { postCount: -1 } }
        );
        await userCache.delete(post.userId);
      }
      
      // 发送系统通知给帖子作者
      const notificationController = require('./notificationController');
      notificationController.createPostDeletedNotification(postId, post.userId, reason, adminId);
      
      res.json(generateSuccessResponse({}, '帖子已永久删除'));
    } catch (error) {
      logger.logError('永久删除帖子失败', { error: error.message, postId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 封禁用户
  async banUser(req, res) {
    try {
      const userId = req.params.id;
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { duration, reason } = req.body;
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 计算封禁结束时间
      const banDuration = parseInt(duration) || 7;
      const banEndTime = new Date();
      
      if (banDuration === 365) {
        // 永久封禁
        banEndTime.setFullYear(banEndTime.getFullYear() + 100);
      } else {
        banEndTime.setDate(banEndTime.getDate() + banDuration);
      }
      
      // 更新用户状态
      await updateUser(userId, {
        isActive: false,
        banStartTime: new Date().toISOString(),
        banEndTime: banEndTime.toISOString(),
        banReason: reason || '违反论坛规定',
        bannedBy: adminId
      });
      
      // 记录封禁信息
      const admin = await getUserById(adminId);
      await createBanRecord({
        id: require('uuid').v4(),
        userId: user.id,
        username: user.username,
        qq: user.qq,
        reason: reason || '违反论坛规定',
        bannedAt: new Date(),
        bannedBy: adminId,
        bannedByName: admin ? admin.username : '',
        banDuration: banDuration,
        unbanAt: banEndTime,
        isActive: true
      });

      // 记录封禁用户日志
      logger.logUserAction('封禁用户', adminId, user.username, {
        targetUserId: user.id,
        targetUsername: user.username,
        targetQQ: user.qq,
        duration: banDuration,
        reason: reason || '违反论坛规定',
        banEndTime: banEndTime.toISOString()
      });

      // 发送系统通知给被封禁用户
      const notificationController = require('./notificationController');
      notificationController.createAccountBannedNotification(userId, reason, banEndTime.toISOString(), adminId);

      res.json(generateSuccessResponse({
        banInfo: {
          username: user.username,
          banStartTime: new Date().toISOString(),
          banEndTime: banEndTime.toISOString(),
          banReason: reason || '违反论坛规定',
          bannedBy: adminId
        }
      }, `用户 ${user.username} 已被封禁 ${banDuration === 365 ? '永久' : banDuration + ' 天'}`));
    } catch (error) {
      logger.logError('封禁用户失败', { error: error.message, userId: req.params.id, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 解封用户
  async unbanUser(req, res) {
    try {
      const userId = req.params.id;
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      
      const user = await getUserById(userId);
      
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      
      // 解封用户
      await updateUser(userId, {
        isActive: true,
        $unset: { banStartTime: 1, banEndTime: 1, banReason: 1, bannedBy: 1 }
      });
      
      // 更新封禁记录
      await removeBanRecord(userId);

      // 记录解封用户日志
      logger.logUserAction('解封用户', adminId, user.username, {
        targetUserId: user.id,
        targetUsername: user.username
      });

      res.json(generateSuccessResponse({}, `用户 ${user.username} 已解封`));
    } catch (error) {
      logger.logError('解封用户失败', { error: error.message, userId: req.params.id, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取所有用户
  async getAllUsers(req, res) {
    try {
      const users = await User.find({}).select(ADMIN_USER_FIELDS).lean();
      res.json(generateSuccessResponse({ users }));
    } catch (error) {
      logger.logError('获取用户列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取封禁用户列表
  async getBannedUsers(req, res) {
    try {
      const bannedUsers = await User.find({ isActive: false }).select(ADMIN_USER_FIELDS).lean();
      res.json(generateSuccessResponse({ bannedUsers }));
    } catch (error) {
      logger.logError('获取封禁用户列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取详细统计数据
  async getDetailedStats(req, res) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);

      // 基础统计（全部走 DB 计数/聚合，不再全量加载）
      const [totalUsers, totalPosts, bannedUsers] = await Promise.all([
        User.countDocuments({}),
        Post.countDocuments({ isDeleted: false }),
        User.countDocuments({ isActive: false })
      ]);

      // 时间范围统计
      const [todayPosts, weekPosts, monthPosts] = await Promise.all([
        Post.countDocuments({ isDeleted: false, timestamp: { $gte: today } }),
        Post.countDocuments({ isDeleted: false, timestamp: { $gte: weekAgo } }),
        Post.countDocuments({ isDeleted: false, timestamp: { $gte: monthAgo } })
      ]);

      // 有发帖的活跃用户数
      const activeUserIds = await Post.distinct('userId', { isDeleted: false });
      const activeUsers = activeUserIds.length;

      // 年级/学校分布、评论数、点赞数、匿名帖数（聚合）
      const [gradeAgg, schoolAgg, commentsAgg, likesAgg, anonymousPosts] = await Promise.all([
        User.aggregate([{ $group: { _id: '$grade', count: { $sum: 1 } } }]),
        User.aggregate([{ $group: { _id: '$school', count: { $sum: 1 } } }]),
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

      const gradeDistribution = {};
      gradeAgg.forEach(g => { if (g._id) gradeDistribution[g._id] = g.count; });
      const schoolDistribution = {};
      schoolAgg.forEach(s => { if (s._id) schoolDistribution[s._id] = s.count; });

      const totalComments = commentsAgg.length ? commentsAgg[0].total : 0;
      const totalLikes = likesAgg.length ? likesAgg[0].total : 0;
      const normalPosts = totalPosts - anonymousPosts;

      // 最活跃用户（发帖数 + 评论数聚合，取 top 10）
      const [postCountAgg, commentCountAgg] = await Promise.all([
        Post.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: '$userId', postCount: { $sum: 1 } } }
        ]),
        Post.aggregate([
          { $match: { isDeleted: false, comments: { $exists: true, $ne: [] } } },
          { $unwind: '$comments' },
          { $group: { _id: '$comments.userId', commentCount: { $sum: 1 } } }
        ])
      ]);

      const activityMap = {};
      postCountAgg.forEach(a => {
        activityMap[a._id] = activityMap[a._id] || { userId: a._id, postCount: 0, commentCount: 0 };
        activityMap[a._id].postCount = a.postCount;
      });
      commentCountAgg.forEach(a => {
        activityMap[a._id] = activityMap[a._id] || { userId: a._id, postCount: 0, commentCount: 0 };
        activityMap[a._id].commentCount = a.commentCount;
      });

      // 批量补充用户名/学校/年级
      const activityUserIds = Object.keys(activityMap);
      let userActivity = [];
      if (activityUserIds.length > 0) {
        const actUsers = await User.find({ id: { $in: activityUserIds } }).select('id username school grade').lean();
        const userMap = {};
        actUsers.forEach(u => { userMap[u.id] = u; });
        userActivity = activityUserIds.map(uid => {
          const u = userMap[uid] || {};
          const a = activityMap[uid];
          return {
            username: u.username || uid,
            school: u.school,
            grade: u.grade,
            postCount: a.postCount,
            commentCount: a.commentCount,
            totalActivity: a.postCount + a.commentCount
          };
        }).sort((a, b) => b.totalActivity - a.totalActivity).slice(0, 10);
      }

      const detailedStats = {
        totalUsers,
        totalPosts,
        bannedUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,

        todayPosts,
        weekPosts,
        monthPosts,

        totalComments,
        totalLikes,
        averageLikesPerPost: totalPosts > 0 ? (totalLikes / totalPosts).toFixed(2) : 0,
        averageCommentsPerPost: totalPosts > 0 ? (totalComments / totalPosts).toFixed(2) : 0,

        anonymousPosts,
        normalPosts,
        anonymousPercentage: totalPosts > 0 ? ((anonymousPosts / totalPosts) * 100).toFixed(2) : 0,

        gradeDistribution,
        schoolDistribution,

        topActiveUsers: userActivity
      };

      res.json(generateSuccessResponse({ stats: detailedStats }));
    } catch (error) {
      logger.logError('获取详细统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取最近活动
  async getRecentActivity(req, res) {
    try {
      // 获取最近24小时的帖子 + 最近注册的用户（DB 级查询）
      const dayAgo = new Date();
      dayAgo.setDate(dayAgo.getDate() - 1);

      const [recentPosts, rawRecentUsers] = await Promise.all([
        Post.find({ isDeleted: false, timestamp: { $gte: dayAgo } })
          .sort({ timestamp: -1 })
          .limit(20)
          .lean(),
        User.find({}).sort({ createdAt: -1 }).limit(10).select(ADMIN_USER_FIELDS).lean()
      ]);

      // 获取最近注册的用户
      const recentUsers = rawRecentUsers;
      
      res.json(generateSuccessResponse({
        recentPosts,
        recentUsers
      }));
    } catch (error) {
      logger.logError('获取最近活动失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取所有评论
  async getAdminComments(req, res) {
    try {
      const paginationConfig = getPaginationConfig();
      const { page = paginationConfig.defaultPage, limit = paginationConfig.defaultLimit, search = '' } = req.query;
      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || paginationConfig.defaultPage);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || paginationConfig.defaultLimit));
      // 聚合管道：展开评论子文档，过滤/排序/分页全部在数据库层完成
      const pipeline = [
        { $match: { isDeleted: false, comments: { $exists: true, $ne: [] } } },
        { $unwind: '$comments' },
        { $project: {
            postId: '$id',
            postContent: { $substrCP: ['$content', 0, 50] },
            contentLen: { $strLenCP: { $ifNull: ['$content', ''] } },
            comment: '$comments'
        } }
      ];

      if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        pipeline.push({ $match: { $or: [{ 'comment.content': re }, { 'comment.username': re }] } });
      }

      const countResult = await Post.aggregate([...pipeline, { $count: 'total' }]);
      const total = countResult.length ? countResult[0].total : 0;

      pipeline.push(
        { $sort: { 'comment.timestamp': -1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum }
      );

      const results = await Post.aggregate(pipeline);
      const comments = results.map(r => ({
        ...r.comment,
        postId: r.postId,
        postContent: r.postContent + (r.contentLen > 50 ? '...' : '')
      }));

      res.json(generateSuccessResponse({
        comments,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalComments: total,
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }));
    } catch (error) {
      logger.logError('管理员获取评论失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 删除评论
  async deleteComment(req, res) {
    try {
      const commentId = req.params.id;
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { postId, reason } = req.body;
      
      if (!postId) {
        return res.status(400).json(generateErrorResponse('帖子ID不能为空'));
      }
      
      const post = await getPostById(postId, true);

      if (!post) {
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      const comments = post.comments || [];
      const commentIndex = comments.findIndex(c => c.id === commentId);
      
      if (commentIndex === -1) {
        return res.status(404).json(generateErrorResponse('评论不存在'));
      }
      
      const deletedComment = comments[commentIndex];
      
      // 删除评论
      comments.splice(commentIndex, 1);
      await updatePost(postId, { comments });
      
      // 更新用户评论数
      const user = await getUserById(deletedComment.userId);
      if (user) {
        await updateUser(deletedComment.userId, { commentCount: Math.max(0, (user.commentCount || 0) - 1) });
      }
      
      // 发送系统通知给评论作者
      const notificationController = require('./notificationController');
      notificationController.createCommentDeletedNotification(postId, commentId, deletedComment.userId, reason, adminId);
      
      res.json(generateSuccessResponse({}, '评论已删除'));
    } catch (error) {
      logger.logError('删除评论失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取日志
  getLogs(req, res) {
    try {
      const { page = 1, limit = 50, level, search, date } = req.query;
      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

      logger.logInfo('管理员访问日志', { page, limit, level, search, date, ip: req.ip });

      const loggerUtil = require('../utils/logger');
      // 有界读取：只取最新 MAX_LOG_LINES 行（readLogs 走尾部字节读取，不会把整份日志读进内存）。
      // 此前传 0 表示"读取全部"，日志文件变大后会直接把整个文件 + 解析结果堆在内存里。
      const logLines = loggerUtil.readLogs(date || null, MAX_LOG_LINES);

      // 解析日志行
      let logs = logLines.map(line => {
        try {
          // 解析日志格式: [timestamp] [LEVEL] message | Data: {...}
          const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+?)(?:\s+\|\s+Data:\s+(.+))?$/);
          if (match) {
            const [, timestamp, logLevel, message, dataStr] = match;
            return {
              timestamp,
              level: logLevel,
              message: message.trim(),
              data: dataStr ? JSON.parse(dataStr) : null
            };
          }
          // 如果格式不匹配，返回一个简化对象
          return {
            timestamp: new Date().toISOString(),
            level: 'UNKNOWN',
            message: line,
            data: null
          };
        } catch (error) {
          // 解析失败时返回原始行
          return {
            timestamp: new Date().toISOString(),
            level: 'UNKNOWN',
            message: line,
            data: null
          };
        }
      });

      // 按级别过滤
      if (level && level !== 'ALL') {
        logs = logs.filter(log => log.level === level);
      }

      // 按关键词搜索
      if (search) {
        const searchLower = search.toLowerCase();
        logs = logs.filter(log =>
          log.message.toLowerCase().includes(searchLower) ||
          (log.data && JSON.stringify(log.data).toLowerCase().includes(searchLower))
        );
      }

      // 倒序排列（最新的在前）
      logs.reverse();

      // 分页
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedLogs = logs.slice(startIndex, endIndex);

      res.json(generateSuccessResponse({
        logs: paginatedLogs,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(logs.length / limitNum),
          totalLogs: logs.length,
          hasNext: endIndex < logs.length,
          hasPrev: startIndex > 0
        }
      }));
    } catch (error) {
      logger.logError('获取日志失败', { error: error.message, stack: error.stack });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取可用的日志日期列表
  getAvailableDates(req, res) {
    try {
      const loggerUtil = require('../utils/logger');
      const dates = loggerUtil.getAvailableLogDates();
      
      res.json(generateSuccessResponse({ dates }));
    } catch (error) {
      logger.logError('获取日志日期列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 清空指定日期的日志
  clearLogs(req, res) {
    try {
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { date } = req.body;

      logger.logSecurityEvent('管理员清空日志', { adminId, date, ip: req.ip });

      const loggerUtil = require('../utils/logger');
      loggerUtil.clearLogs(date || null);

      logger.logSystemEvent('日志已清空', { adminId, date });

      res.json(generateSuccessResponse({}, '日志已清空'));
    } catch (error) {
      logger.logError('清空日志失败', { error: error.message, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 删除指定日期的日志文件
  deleteLogsByDate(req, res) {
    try {
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { date } = req.body;

      if (!date) {
        return res.status(400).json(generateErrorResponse('日期不能为空'));
      }

      logger.logSecurityEvent('管理员删除日志文件', { adminId, date, ip: req.ip });

      const loggerUtil = require('../utils/logger');
      const success = loggerUtil.deleteLogs(date);

      if (success) {
        logger.logSystemEvent('日志文件已删除', { adminId, date });
        res.json(generateSuccessResponse({}, '日志文件已删除'));
      } else {
        res.status(404).json(generateErrorResponse('日志文件不存在'));
      }
    } catch (error) {
      logger.logError('删除日志文件失败', { error: error.message, adminId: req.admin?.id, date: req.body.date });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取IP访问统计列表
  async getIpStats(req, res) {
    try {
      const { limit = 50, order = 'desc' } = req.query;
      const { ipStats } = require('../utils/redisUtils');
      
      logger.logInfo('管理员访问IP统计列表', { limit, order, ip: req.ip });
      
      // 分页钳制（与 postController 一致）：limit ∈ [1,100]
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const stats = await ipStats.getAllStats({ limit: limitNum, order });
      
      res.json(generateSuccessResponse({ stats }));
    } catch (error) {
      logger.logError('获取IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 获取IP访问统计摘要
  async getIpStatsSummary(req, res) {
    try {
      const { ipStats } = require('../utils/redisUtils');
      
      const summary = await ipStats.getSummary();
      
      res.json(generateSuccessResponse({ summary }));
    } catch (error) {
      logger.logError('获取IP统计摘要失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 清除指定IP统计
  async clearIpStats(req, res) {
    try {
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      const { ip } = req.body;
      
      if (!ip) {
        return res.status(400).json(generateErrorResponse('IP地址不能为空'));
      }
      
      const { ipStats } = require('../utils/redisUtils');
      await ipStats.clearIp(ip);
      
      logger.logSecurityEvent('管理员清除IP统计', { adminId, ip, operatorIp: req.ip });
      
      res.json(generateSuccessResponse({}, `IP ${ip} 统计已清除`));
    } catch (error) {
      logger.logError('清除IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员功能 - 清除所有IP统计
  async clearAllIpStats(req, res) {
    try {
      // adminId 来自 JWT 认证中间件，不信任 req.body
      const adminId = req.admin.id;
      
      const { ipStats } = require('../utils/redisUtils');
      await ipStats.clearAll();
      
      logger.logSecurityEvent('管理员清除所有IP统计', { adminId, operatorIp: req.ip });
      
      res.json(generateSuccessResponse({}, '所有IP统计已清除'));
    } catch (error) {
      logger.logError('清除所有IP统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 管理员群发站内消息（全体用户通知）
  async broadcastMessage(req, res) {
    try {
      const adminId = req.admin.id;
      const { title, content } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json(generateErrorResponse('消息标题不能为空'));
      }
      if (title.trim().length > 100) {
        return res.status(400).json(generateErrorResponse('消息标题最多100个字符'));
      }
      if (!content || !content.trim()) {
        return res.status(400).json(generateErrorResponse('消息内容不能为空'));
      }
      if (content.trim().length > 2000) {
        return res.status(400).json(generateErrorResponse('消息内容最多2000个字符'));
      }

      // 创建广播通知（target='all'，全体用户消息列表可见）
      await createNotification({
        id: uuidv4(),
        userId: null,
        target: 'all',
        type: 'system',
        systemType: 'broadcast',
        title: title.trim(),
        message: content.trim(),
        timestamp: new Date().toISOString(),
        read: false
      });

      logger.logSecurityEvent('admin_broadcast_message', {
        adminId,
        title: title.trim(),
        contentLength: content.trim().length
      });

      res.json(generateSuccessResponse({}, '群发消息成功，所有用户将收到通知'));
    } catch (error) {
      logger.logError('群发消息失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = adminController;
