const Blacklist = require('../models/Blacklist');
const User = require('../models/User');
const Follow = require('../models/Follow');
const {
  generateErrorResponse,
  generateSuccessResponse,
  userExists,
  isAdminUser
} = require('../utils/validationUtils');
const logger = require('../utils/logger');

const blacklistController = {
  // 拉黑用户
  async blockUser(req, res) {
    try {
      // blockerId 来自已认证的 JWT，防止客户端伪造
      const blockerId = req.user.id;
      const { blockedId } = req.body;

      if (!blockedId) {
        return res.status(400).json(generateErrorResponse('被拉黑用户ID不能为空'));
      }

      // 不能拉黑自己
      if (blockerId === blockedId) {
        return res.status(400).json(generateErrorResponse('不能拉黑自己'));
      }

      // 检查被拉黑的用户是否存在
      if (!await userExists(blockedId)) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      // 检查是否已拉黑
      const isBlocked = await Blacklist.isBlocked(blockerId, blockedId);
      if (isBlocked) {
        return res.status(400).json(generateErrorResponse('已经拉黑了该用户'));
      }

      // 创建拉黑关系
      await Blacklist.create({
        blockerId,
        blockedId,
        createdAt: new Date()
      });

      // 如果存在关注关系，自动取消关注
      const isFollowing = await Follow.isFollowing(blockerId, blockedId);
      if (isFollowing) {
        await Follow.findOneAndDelete({ followerId: blockerId, followingId: blockedId });
        logger.logUserAction('拉黑用户-自动取消关注', blockerId, '', { blockedId });
      }

      // 如果被拉黑者关注了拉黑者，也取消这个关注关系
      const isFollowedByBlocked = await Follow.isFollowing(blockedId, blockerId);
      if (isFollowedByBlocked) {
        await Follow.findOneAndDelete({ followerId: blockedId, followingId: blockerId });
        logger.logUserAction('拉黑用户-取消对方关注', blockerId, '', { blockedId });
      }

      logger.logUserAction('拉黑用户', blockerId, '', { blockedId });

      res.json({
        success: true,
        message: '拉黑成功',
        data: {
          blocked: true
        }
      });
    } catch (error) {
      logger.logError('拉黑用户失败', { error: error.message, body: req.body });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 取消拉黑
  async unblockUser(req, res) {
    try {
      // blockerId 来自已认证的 JWT，防止客户端伪造
      const blockerId = req.user.id;
      const { blockedId } = req.body;

      if (!blockedId) {
        return res.status(400).json(generateErrorResponse('被拉黑用户ID不能为空'));
      }

      // 删除拉黑关系
      const result = await Blacklist.findOneAndDelete({ blockerId, blockedId });

      if (!result) {
        return res.status(400).json(generateErrorResponse('未拉黑该用户'));
      }

      logger.logUserAction('取消拉黑', blockerId, '', { blockedId });

      res.json({
        success: true,
        message: '取消拉黑成功',
        data: {
          blocked: false
        }
      });
    } catch (error) {
      logger.logError('取消拉黑失败', { error: error.message, body: req.body });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 检查发送私信权限（chat.js 专用）
  async checkSendPermission(req, res) {
    try {
      const senderId = req.user?.id || req.query.senderId;
      const receiverId = req.params.receiverId;

      if (!senderId || !receiverId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 检查双向拉黑状态
      const isBlocked = await Blacklist.isBlocked(senderId, receiverId);
      const isBlockedBy = await Blacklist.isBlocked(receiverId, senderId);

      // 检查关注关系
      const isFollowing = await Follow.exists({ followerId: senderId, followingId: receiverId });
      const isFollower = await Follow.exists({ followerId: receiverId, followingId: senderId });

      // 判断是否可以发送
      let canSend = true;
      let reason = null;

      if (isBlocked) {
        canSend = false;
        reason = '你已拉黑对方，无法发送消息';
      } else if (isBlockedBy) {
        canSend = false;
        reason = '对方已将你拉黑，无法发送消息';
      }

      res.json({
        success: true,
        canSend,
        reason,
        relation: {
          isFollowing: !!isFollowing,
          isFollower: !!isFollower
        },
        blockStatus: {
          isBlocked,
          isBlockedBy
        }
      });
    } catch (error) {
      logger.logError('检查发送权限失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 检查拉黑状态
  async checkBlockStatus(req, res) {
    try {
      const { blockerId, blockedId } = req.query;

      if (!blockerId || !blockedId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      const isBlocked = await Blacklist.isBlocked(blockerId, blockedId);
      const isBlockedBy = await Blacklist.isBlocked(blockedId, blockerId);

      res.json({
        success: true,
        message: '操作成功',
        data: {
          isBlocked,
          isBlockedBy
        }
      });
    } catch (error) {
      logger.logError('检查拉黑状态失败', { error: error.message, query: req.query });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 检查两个用户之间是否有拉黑关系
  async checkBlockRelation(req, res) {
    try {
      const { userId1, userId2 } = req.query;

      if (!userId1 || !userId2) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      const hasBlockRelation = await Blacklist.hasBlockRelation(userId1, userId2);

      res.json({
        success: true,
        message: '操作成功',
        data: {
          hasBlockRelation
        }
      });
    } catch (error) {
      logger.logError('检查拉黑关系失败', { error: error.message, query: req.query });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户拉黑的人列表（仅限本人，身份来自 JWT，不信任 params 传入的 userId）
  async getBlockedList(req, res) {
    try {
      const userId = req.user.id;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取拉黑列表
      const blockedList = await Blacklist.getBlockedList(userId, limit, skip);

      // 获取用户详细信息
      const blockedIds = blockedList.map(b => b.blockedId);
      const users = await User.find({ id: { $in: blockedIds } });

      // 组合数据
      const result = blockedList.map(b => {
        const user = users.find(u => u.id === b.blockedId);
        if (!user) return null;

        return {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          school: user.school,
          grade: user.grade,
          className: user.className,
          blockedAt: b.blockedAt,
          isAdmin: isAdminUser(user)
        };
      }).filter(Boolean);

      // 获取总数
      const total = await Blacklist.getBlockedCount(userId);

      res.json({
        success: true,
        message: '操作成功',
        data: {
          list: result,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total,
            hasNext: skip + limit < total,
            hasPrev: page > 1
          }
        }
      });
    } catch (error) {
      logger.logError('获取拉黑列表失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取拉黑数量（仅限本人，身份来自 JWT）
  async getBlockedCount(req, res) {
    try {
      const userId = req.user.id;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      const count = await Blacklist.getBlockedCount(userId);

      res.json({
        success: true,
        message: '操作成功',
        data: {
          count
        }
      });
    } catch (error) {
      logger.logError('获取拉黑数量失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = blacklistController;
