const { v4: uuidv4 } = require('uuid');
const { 
  getNotifications,
  createNotification,
  markNotificationAsRead,
  markBroadcastAsRead,
  markAllNotificationsAsRead,
  getPosts,
  getUsers,
  getUserById,
  getPostById
} = require('../utils/dataUtils');
const { 
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { notificationCache } = require('../utils/redisUtils');
const logger = require('../utils/logger');
// Notification 模型：评论 / 评论回复 / 评论点赞 三类通知直接使用该模型做去重与更新。
// 此前这三处只在函数体内部 require 且写在了引用之后（或从 dataUtils 解构了一个
// 并不存在的导出），导致必然抛出 "Notification is not defined" 并被 catch 静默吞掉，
// 表现为"评论了但对方收不到通知"。改为模块级统一导入。
const Notification = require('../models/Notification');

// 检查用户是否启用了某类通知
async function isNotificationEnabled(userId, notificationType) {
  try {
    // 系统通知始终启用
    if (notificationType === 'system') {
      return true;
    }

    const user = await getUserById(userId);
    if (!user || !user.settings || !user.settings.notifications) {
      // 默认启用所有通知
      return true;
    }

    const notificationSettings = user.settings.notifications;
    
    // 映射通知类型到设置字段
    const typeMapping = {
      'like': 'like',
      'comment': 'comment',
      'comment_reply': 'commentReply',
      'comment_like': 'commentLike',
      'follow': 'follow'
    };

    const settingKey = typeMapping[notificationType];
    if (!settingKey) {
      return true;
    }

    // 如果设置不存在，默认启用
    return notificationSettings[settingKey] !== false;
  } catch (error) {
    logger.logError('检查通知偏好失败', { error: error.message, userId, notificationType });
    // 出错时默认启用
    return true;
  }
}

const notificationController = {
  // 获取用户的通知
  async getUserNotifications(req, res) {
    try {
      // userId 来自已认证的 JWT，防止获取他人通知
      const userId = req.user.id;
      
      const notifications = await getNotifications(userId);
      // 优化：只查询通知涉及到的帖子和用户，替代全量加载
      const postIds = [...new Set(notifications.map(n => n.postId).filter(Boolean))];
      const fromUserIds = [...new Set(notifications.map(n => n.fromUserId).filter(Boolean))];
      const Post = require('../models/Post');
      const User = require('../models/User');
      const [posts, users] = await Promise.all([
        postIds.length ? Post.find({ id: { $in: postIds } }).lean() : [],
        fromUserIds.length ? User.find({ id: { $in: fromUserIds } }).lean() : []
      ]);
      
      // 为通知添加帖子标题和用户信息（广播/系统通知不填 postTitle/fromUsername，
      // 避免安卓/网页端把系统消息误渲染成"帖子已被删除/未知用户"）
      const enrichedNotifications = notifications.map(notification => {
        const post = posts.find(p => p.id === notification.postId);
        const fromUser = users.find(u => u.id === notification.fromUserId);
        const isSystem = notification.type === 'system';
        
        return {
          ...notification,
          read: notification.target === 'all'
            ? (notification.readBy || []).includes(userId)
            : notification.read,
          postTitle: isSystem ? null : (post ? (post.content.length > 50 ? post.content.substring(0, 50) + '...' : post.content) : '帖子已被删除'),
          fromUsername: isSystem ? null : (fromUser ? fromUser.username : '未知用户'),
          postExists: !!post && !post.isDeleted
        };
      });
      
      res.json(generateSuccessResponse({ notifications: enrichedNotifications }));
    } catch (error) {
      logger.logError('获取通知失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },
  
  // 标记通知为已读
  async markAsRead(req, res) {
    try {
      const notificationId = req.params.id;
      // userId 来自已认证的 JWT，防止操作他人通知
      const userId = req.user.id;
      
      const notifications = await getNotifications(userId);
      // 广播通知（target='all'）userId 为 null，需按 target 放行
      const notification = notifications.find(n =>
        n.id === notificationId && (n.userId === userId || n.target === 'all'));

      if (!notification) {
        return res.status(404).json(generateErrorResponse('通知不存在'));
      }

      if (notification.target === 'all') {
        // 广播通知：按用户记录已读（readBy），不动全局 read 字段
        await markBroadcastAsRead(notificationId, userId);
      } else {
        await markNotificationAsRead(notificationId);
      }
      
      res.json(generateSuccessResponse({}, '通知已标记为已读'));
    } catch (error) {
      logger.logError('标记通知为已读失败', { error: error.message, notificationId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },
  
  // 标记所有通知为已读
  async markAllAsRead(req, res) {
    try {
      // userId 来自已认证的 JWT，防止操作他人通知
      const userId = req.user.id;
      
      const result = await markAllNotificationsAsRead(userId);
      
      // 清除Redis中的未读数缓存
      await notificationCache.clearUnreadCount(userId);
      
      res.json(generateSuccessResponse({ updatedCount: result.modifiedCount || 0 }, `已标记所有通知为已读`));
    } catch (error) {
      logger.logError('标记所有通知为已读失败', { error: error.message, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },
  
  // 创建点赞通知
  async createLikeNotification(postId, fromUserId, postOwnerId) {
    try {
      if (fromUserId === postOwnerId) {
        // 不给自己发通知
        return;
      }
      
      // 检查用户是否启用了点赞通知
      if (!await isNotificationEnabled(postOwnerId, 'like')) {
        return;
      }
      
      // 优化：直接按 ID 查询，替代全量加载所有帖子和用户
      const post = await getPostById(postId);
      const fromUser = await getUserById(fromUserId);
      
      if (!post || !fromUser) {
        return;
      }
      
      // 检查是否已存在相同的未读通知（直接查询而非加载全部）
      const Notification = require('../models/Notification');
      const existingNotification = await Notification.findOne({
        userId: postOwnerId,
        type: 'like',
        postId: postId,
        fromUserId: fromUserId,
        read: false
      });
      
      if (existingNotification) {
        // 如果已存在未读通知，更新时间戳
        await Notification.findOneAndUpdate(
          { id: existingNotification.id },
          { timestamp: new Date() }
        );
        return;
      }
      
      const newNotification = {
        id: uuidv4(),
        userId: postOwnerId,
        type: 'like',
        postId: postId,
        fromUserId: fromUserId,
        fromUsername: fromUser.username,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
      
      // 增加Redis中的未读通知数
      await notificationCache.incrUnreadCount(postOwnerId);
    } catch (error) {
      logger.logError('创建点赞通知失败', { error: error.message, postId, fromUserId, postOwnerId });
    }
  },
  
  // 创建评论通知
  async createCommentNotification(postId, fromUserId, commentContent, postOwnerId) {
    try {
      if (fromUserId === postOwnerId) {
        // 不给自己发通知
        return;
      }
      
      // 检查用户是否启用了评论通知
      if (!await isNotificationEnabled(postOwnerId, 'comment')) {
        return;
      }
      
      const post = await getPostById(postId);
      const fromUser = await getUserById(fromUserId);
      
      if (!post || !fromUser) {
        return;
      }
      
      // 检查是否已存在相同的未读通知
      const existingNotification = await Notification.findOne({
        userId: postOwnerId,
        type: 'comment',
        postId: postId,
        fromUserId: fromUserId,
        read: false
      });
      
      if (existingNotification) {
        // 如果已存在未读通知，更新时间戳和内容
        await Notification.findOneAndUpdate(
          { id: existingNotification.id },
          { timestamp: new Date(), content: commentContent }
        );
        return;
      }
      
      const newNotification = {
        id: uuidv4(),
        userId: postOwnerId,
        type: 'comment',
        postId: postId,
        fromUserId: fromUserId,
        fromUsername: fromUser.username,
        content: commentContent,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
      
      // 增加Redis中的未读通知数
      await notificationCache.incrUnreadCount(postOwnerId);
    } catch (error) {
      logger.logError('创建评论通知失败', { error: error.message, postId, fromUserId, postOwnerId });
    }
  },

  // 创建评论回复通知
  async createCommentReplyNotification(postId, commentId, fromUserId, replyContent, commentOwnerId) {
    try {
      if (fromUserId === commentOwnerId) {
        // 不给自己发通知
        return;
      }
      
      // 检查用户是否启用了回复通知
      if (!await isNotificationEnabled(commentOwnerId, 'comment_reply')) {
        return;
      }
      
      const post = await getPostById(postId);
      const fromUser = await getUserById(fromUserId);
      
      if (!post || !fromUser) {
        return;
      }
      
      // 查找被回复的评论
      const comment = post.comments && post.comments.find(c => c.id === commentId);
      if (!comment) {
        return;
      }
      
      // 检查是否已存在相同的未读通知（直接查询而非加载全部）
      const existingNotification = await Notification.findOne({
        userId: commentOwnerId,
        type: 'comment_reply',
        postId: postId,
        commentId: commentId,
        fromUserId: fromUserId,
        read: false
      });
      
      if (existingNotification) {
        // 如果已存在未读通知，更新时间戳和内容
        await Notification.findOneAndUpdate(
          { id: existingNotification.id },
          { timestamp: new Date(), content: replyContent }
        );
        return;
      }
      
      const newNotification = {
        id: uuidv4(),
        userId: commentOwnerId,
        type: 'comment_reply',
        postId: postId,
        commentId: commentId,
        fromUserId: fromUserId,
        fromUsername: fromUser.username,
        content: replyContent,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
      
      // 增加Redis中的未读通知数
      await notificationCache.incrUnreadCount(commentOwnerId);
    } catch (error) {
      logger.logError('创建评论回复通知失败', { error: error.message, postId, commentId, fromUserId, commentOwnerId });
    }
  },

  // 创建评论点赞通知
  async createCommentLikeNotification(postId, commentId, fromUserId, commentOwnerId) {
    try {
      if (fromUserId === commentOwnerId) {
        // 不给自己发通知
        return;
      }
      
      // 检查用户是否启用了评论点赞通知
      if (!await isNotificationEnabled(commentOwnerId, 'comment_like')) {
        return;
      }
      
      const post = await getPostById(postId);
      const fromUser = await getUserById(fromUserId);
      
      if (!post || !fromUser) {
        return;
      }
      
      // 查找评论
      const findComment = (comments, targetId) => {
        for (const comment of comments) {
          if (comment.id === targetId) return comment;
          if (comment.replies) {
            const found = findComment(comment.replies, targetId);
            if (found) return found;
          }
        }
        return null;
      };
      
      const comment = post.comments && findComment(post.comments, commentId);
      if (!comment) {
        return;
      }
      
      // 检查是否已存在相同的未读通知（直接查询而非加载全部）
      const existingNotification = await Notification.findOne({
        userId: commentOwnerId,
        type: 'comment_like',
        postId: postId,
        commentId: commentId,
        fromUserId: fromUserId,
        read: false
      });
      
      if (existingNotification) {
        // 如果已存在未读通知，更新时间戳
        await Notification.findOneAndUpdate(
          { id: existingNotification.id },
          { timestamp: new Date() }
        );
        return;
      }
      
      const newNotification = {
        id: uuidv4(),
        userId: commentOwnerId,
        type: 'comment_like',
        postId: postId,
        commentId: commentId,
        fromUserId: fromUserId,
        fromUsername: fromUser.username,
        content: comment.content ? (comment.content.length > 50 ? comment.content.substring(0, 50) + '...' : comment.content) : '',
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
      
      // 增加Redis中的未读通知数
      await notificationCache.incrUnreadCount(commentOwnerId);
    } catch (error) {
      logger.logError('创建评论点赞通知失败', { error: error.message, postId, commentId, fromUserId, commentOwnerId });
    }
  },

  // 创建帖子删除通知（系统消息）
  async createPostDeletedNotification(postId, postOwnerId, reason, adminId) {
    try {
      const post = await getPostById(postId, true);
      const admin = await getUserById(adminId);
      
      if (!post || !admin) {
        return;
      }
      
      const postTitle = post.content.length > 50 ? post.content.substring(0, 50) + '...' : post.content;
      
      const newNotification = {
        id: uuidv4(),
        userId: postOwnerId,
        type: 'system',
        systemType: 'post_deleted',
        postId: postId,
        postTitle: postTitle,
        reason: reason || '违反论坛规定',
        adminName: admin.username,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
    } catch (error) {
      logger.logError('创建帖子删除通知失败', { error: error.message, postId, postOwnerId, reason, adminId });
    }
  },

  // 创建评论删除通知（系统消息）
  async createCommentDeletedNotification(postId, commentId, commentOwnerId, reason, adminId) {
    try {
      const post = await getPostById(postId, true);
      const admin = await getUserById(adminId);
      
      if (!post || !admin) {
        return;
      }
      
      const postTitle = post.content.length > 50 ? post.content.substring(0, 50) + '...' : post.content;
      
      const newNotification = {
        id: uuidv4(),
        userId: commentOwnerId,
        type: 'system',
        systemType: 'comment_deleted',
        postId: postId,
        commentId: commentId,
        postTitle: postTitle,
        reason: reason || '违反论坛规定',
        adminName: admin.username,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
    } catch (error) {
      logger.logError('创建评论删除通知失败', { error: error.message, postId, commentId, commentOwnerId, adminId });
    }
  },

  // 创建账号封禁通知（系统消息）
  async createAccountBannedNotification(userId, reason, banEndTime, adminId) {
    try {
      const user = await getUserById(userId);
      const admin = await getUserById(adminId);
      
      if (!user || !admin) {
        return;
      }
      
      const newNotification = {
        id: uuidv4(),
        userId: userId,
        type: 'system',
        systemType: 'account_banned',
        reason: reason || '违反论坛规定',
        banEndTime: banEndTime,
        adminName: admin.username,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
    } catch (error) {
      logger.logError('创建账号封禁通知失败', { error: error.message, userId, reason, banEndTime, adminId });
    }
  },

  // 创建举报结果通知（给被举报用户）
  async createReportResultNotification(userId, isViolation, reason, banDays, targetType, targetContent) {
    try {
      const targetText = targetType === 'post' ? '帖子' : '评论';
      const contentPreview = targetContent ? (targetContent.length > 100 ? targetContent.substring(0, 100) + '...' : targetContent) : '';
      
      const newNotification = {
        id: uuidv4(),
        userId: userId,
        type: 'system',
        systemType: 'report_result',
        isViolation: isViolation,
        reason: reason,
        banDays: banDays,
        targetType: targetText,
        targetContent: contentPreview,
        message: isViolation 
          ? `您的${targetText}因"${reason}"被举报，经核实违规属实，已被封禁${banDays === 365 ? '永久' : banDays + '天'}`
          : `您的${targetText}被举报，经核实未发现违规`,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
    } catch (error) {
      logger.logError('创建举报结果通知失败', { error: error.message, userId, isViolation, reason });
    }
  },

  // 创建举报人结果通知（给举报人）
  async createReporterResultNotification(reporterId, isApproved, reason, targetUsername, banDays, targetType, targetContent, note) {
    try {
      const targetText = targetType === 'post' ? '帖子' : '评论';
      const contentPreview = targetContent ? (targetContent.length > 100 ? targetContent.substring(0, 100) + '...' : targetContent) : '';
      
      const newNotification = {
        id: uuidv4(),
        userId: reporterId,
        type: 'system',
        systemType: 'reporter_result',
        isApproved: isApproved,
        reason: reason,
        targetUsername: targetUsername || '用户',
        banDays: banDays,
        targetType: targetText,
        targetContent: contentPreview,
        note: note || '',
        message: isApproved 
          ? `您举报的用户"${targetUsername}"因"${reason}"违规属实，已被封禁${banDays === 365 ? '永久' : banDays + '天'}`
          : `您举报的内容经核实未发现违规${note ? '：' + note : ''}`,
        timestamp: new Date(),
        read: false
      };
      
      await createNotification(newNotification);
    } catch (error) {
      logger.logError('创建举报人结果通知失败', { error: error.message, reporterId, isApproved, reason });
    }
  }
};

module.exports = notificationController;
