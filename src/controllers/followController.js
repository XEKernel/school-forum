const Follow = require('../models/Follow');
const User = require('../models/User');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const Blacklist = require('../models/Blacklist');
const { v4: uuidv4 } = require('uuid');
const {
  generateErrorResponse,
  generateSuccessResponse,
  userExists,
  isAdminUser
} = require('../utils/validationUtils');
const { followCache, notificationCache, userCache } = require('../utils/redisUtils');
const logger = require('../utils/logger');

// 检查用户是否启用了关注通知
async function isFollowNotificationEnabled(userId) {
  try {
    const user = await User.findOne({ id: userId });
    if (!user || !user.settings || !user.settings.notifications) {
      return true;
    }
    return user.settings.notifications.follow !== false;
  } catch (error) {
    return true;
  }
}

const followController = {
  // 关注用户
  async followUser(req, res) {
    try {
      // followerId 来自已认证的 JWT，防止伪造
      const followerId = req.user.id;
      const { followingId } = req.body;

      if (!followingId) {
        return res.status(400).json(generateErrorResponse('被关注的用户ID不能为空'));
      }

      // 不能关注自己
      if (followerId === followingId) {
        return res.status(400).json(generateErrorResponse('不能关注自己'));
      }

      // 检查被关注的用户是否存在
      if (!await userExists(followingId)) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 检查黑名单：如果被关注者拉黑了关注者，则不能关注
      const isBlockedByTarget = await Blacklist.isBlocked(followingId, followerId);
      if (isBlockedByTarget) {
        return res.status(403).json(generateErrorResponse('无法关注该用户'));
      }

      // 检查黑名单：如果关注者拉黑了被关注者，也禁止关注
      const hasBlockedTarget = await Blacklist.isBlocked(followerId, followingId);
      if (hasBlockedTarget) {
        return res.status(403).json(generateErrorResponse('您已拉黑该用户，请先取消拉黑'));
      }

      // 检查是否已关注
      const isFollowing = await Follow.isFollowing(followerId, followingId);
      if (isFollowing) {
        return res.status(400).json(generateErrorResponse('已经关注了该用户'));
      }

      // 获取关注者信息
      const follower = await User.findOne({ id: followerId });
      const followerUsername = follower ? follower.username : '用户';

      // 创建关注关系
      await Follow.create({
        followerId,
        followingId,
        createdAt: new Date()
      });

      // 更新Redis缓存
      await followCache.addFollowing(followerId, followingId);

      // 创建关注通知（如果用户启用了关注通知）
      if (await isFollowNotificationEnabled(followingId)) {
        await Notification.create({
          id: uuidv4(),
          userId: followingId,
          type: 'follow',
          fromUserId: followerId,
          fromUsername: followerUsername,
          timestamp: new Date(),
          read: false
        });
        
        // 增加Redis中的未读通知数
        await notificationCache.incrUnreadCount(followingId);
      }

      logger.logUserAction('关注用户', followerId, '', {
        followingId
      });

      res.json(generateSuccessResponse({
        following: true
      }, '关注成功'));
    } catch (error) {
      logger.logError('关注用户失败', { error: error.message, body: req.body });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 取消关注
  async unfollowUser(req, res) {
    try {
      // followerId 来自已认证的 JWT，防止伪造
      const followerId = req.user.id;
      const { followingId } = req.body;

      if (!followingId) {
        return res.status(400).json(generateErrorResponse('被关注的用户ID不能为空'));
      }

      // 删除关注关系
      const result = await Follow.findOneAndDelete({ followerId, followingId });

      if (!result) {
        return res.status(400).json(generateErrorResponse('未关注该用户'));
      }

      // 更新Redis缓存
      await followCache.removeFollowing(followerId, followingId);

      logger.logUserAction('取消关注', followerId, '', {
        followingId
      });

      res.json(generateSuccessResponse({
        following: false
      }, '取消关注成功'));
    } catch (error) {
      logger.logError('取消关注失败', { error: error.message, body: req.body });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 检查关注状态
  async checkFollowStatus(req, res) {
    try {
      const { followerId, followingId } = req.query;

      if (!followerId || !followingId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      logger.logInfo('检查关注状态', { followerId, followingId });

      // 直接从数据库检查（更可靠）
      const isFollowing = await Follow.isFollowing(followerId, followingId);
      
      logger.logInfo('关注状态检查结果', { followerId, followingId, isFollowing });

      // 同步更新Redis缓存
      if (isFollowing) {
        await followCache.addFollowing(followerId, followingId);
      }

      res.json(generateSuccessResponse({
        isFollowing
      }));
    } catch (error) {
      logger.logError('检查关注状态失败', { error: error.message, query: req.query });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户的关注数和粉丝数
  async getFollowStats(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 优先从Redis缓存获取
      let followingCount = await followCache.getFollowingCount(userId);
      let followerCount = await followCache.getFollowerCount(userId);

      // 如果缓存未命中，从数据库获取并缓存
      if (followingCount === null) {
        followingCount = await Follow.getFollowingCount(userId);
        await followCache.setFollowingCount(userId, followingCount);
      }

      if (followerCount === null) {
        followerCount = await Follow.getFollowerCount(userId);
        await followCache.setFollowerCount(userId, followerCount);
      }

      res.json(generateSuccessResponse({
        followingCount,
        followerCount
      }));
    } catch (error) {
      logger.logError('获取关注统计失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户关注的人列表
  async getFollowingList(req, res) {
    try {
      const userId = req.params.userId;
      const currentUserId = req.query.currentUserId; // 当前登录用户ID
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取关注列表
      const followingList = await Follow.getFollowingList(userId, limit, skip);

      // 获取用户详细信息
      const followingIds = followingList.map(f => f.followingId);
      const users = await User.find({ id: { $in: followingIds } });

      // 获取当前用户关注的人（用于判断关注状态）
      let currentUserFollowingIds = [];
      if (currentUserId && currentUserId !== userId) {
        currentUserFollowingIds = await Follow.getFollowingIds(currentUserId);
      }

      // 组合数据
      const result = followingList.map(f => {
        const user = users.find(u => u.id === f.followingId);
        if (!user) return null;

        return {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          school: user.school,
          grade: user.grade,
          className: user.className,
          followedAt: f.followedAt,
          isAdmin: isAdminUser(user),
          isFollowing: currentUserId ? currentUserFollowingIds.includes(user.id) : false
        };
      }).filter(Boolean);

      // 获取总数
      const total = await Follow.getFollowingCount(userId);

      res.json(generateSuccessResponse({
        list: result,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: skip + limit < total,
          hasPrev: page > 1
        }
      }));
    } catch (error) {
      logger.logError('获取关注列表失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户的粉丝列表
  async getFollowerList(req, res) {
    try {
      const userId = req.params.userId;
      const currentUserId = req.query.currentUserId; // 当前登录用户ID
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取粉丝列表
      const followerList = await Follow.getFollowerList(userId, limit, skip);

      // 获取用户详细信息
      const followerIds = followerList.map(f => f.followerId);
      const users = await User.find({ id: { $in: followerIds } });

      // 获取当前用户关注的人（用于判断关注状态）
      let currentUserFollowingIds = [];
      if (currentUserId) {
        currentUserFollowingIds = await Follow.getFollowingIds(currentUserId);
      }

      // 组合数据
      const result = followerList.map(f => {
        const user = users.find(u => u.id === f.followerId);
        if (!user) return null;

        return {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          school: user.school,
          grade: user.grade,
          className: user.className,
          followedAt: f.followedAt,
          isAdmin: isAdminUser(user),
          isFollowing: currentUserFollowingIds.includes(user.id)
        };
      }).filter(Boolean);

      // 获取总数
      const total = await Follow.getFollowerCount(userId);

      res.json(generateSuccessResponse({
        list: result,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: skip + limit < total,
          hasPrev: page > 1
        }
      }));
    } catch (error) {
      logger.logError('获取粉丝列表失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取关注的人的帖子（用于"我的关注"页面）
  async getFollowingPosts(req, res) {
    try {
      const userId = req.params.userId;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取关注的人的ID列表
      const followingIds = await Follow.getFollowingIds(userId);

      if (followingIds.length === 0) {
        return res.json(generateSuccessResponse({
          posts: [],
          pagination: {
            currentPage: page,
            totalPages: 0,
            total: 0,
            hasNext: false,
            hasPrev: false
          }
        }));
      }

      // 查询这些用户的帖子
      const posts = await Post.find({
        userId: { $in: followingIds },
        isDeleted: { $ne: true }
      })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

      // 获取用户头像信息
      const users = await User.find({ id: { $in: followingIds } });
      const userMap = {};
      users.forEach(u => {
        userMap[u.id] = u;
      });

      // 添加用户头像
      const postsWithAvatar = posts.map(post => {
        const user = userMap[post.userId];
        return {
          ...post.toObject(),
          userAvatar: user && user.avatar ? user.avatar : null
        };
      });

      // 获取总数
      const total = await Post.countDocuments({
        userId: { $in: followingIds },
        isDeleted: { $ne: true }
      });

      res.json(generateSuccessResponse({
        posts: postsWithAvatar,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: skip + limit < total,
          hasPrev: page > 1
        }
      }));
    } catch (error) {
      logger.logError('获取关注帖子失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取关注用户的新帖子数量（用于顶栏徽章）
  async getNewPostsCount(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取关注的人的ID列表
      const followingIds = await Follow.getFollowingIds(userId);

      if (followingIds.length === 0) {
        return res.json(generateSuccessResponse({
          count: 0
        }));
      }

      // 获取用户上次查看动态的时间
      const user = await User.findOne({ id: userId });
      const lastViewedAt = user && user.lastViewedFollowingAt;

      // 构建查询条件
      const query = {
        userId: { $in: followingIds },
        isDeleted: { $ne: true }
      };

      // 如果有上次查看时间，只统计这个时间之后的帖子
      if (lastViewedAt) {
        query.timestamp = { $gt: lastViewedAt.toISOString() };
      } else {
        // 如果没有上次查看时间，获取最近7天内的帖子数量
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        query.timestamp = { $gte: sevenDaysAgo.toISOString() };
      }

      const count = await Post.countDocuments(query);

      res.json(generateSuccessResponse({
        count
      }));
    } catch (error) {
      logger.logError('获取新帖子数量失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 标记用户查看了关注动态（更新查看时间）
  async markFollowingViewed(req, res) {
    try {
      // 身份只认 JWT：此前取 req.body.userId，可替任意用户清掉「新动态」提示
      const userId = req.user.id;

      // 更新用户的上次查看时间
      await User.findOneAndUpdate(
        { id: userId },
        { lastViewedFollowingAt: new Date() }
      );

      res.json(generateSuccessResponse({
        success: true
      }));
    } catch (error) {
      logger.logError('标记查看动态失败', { error: error.message, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = followController;
