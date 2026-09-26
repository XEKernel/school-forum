const { v4: uuidv4 } = require('uuid');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Follow = require('../models/Follow');
const User = require('../models/User');
const Blacklist = require('../models/Blacklist');
const BannedUser = require('../models/BannedUser');
const { generateErrorResponse, generateSuccessResponse } = require('../utils/validationUtils');
const logger = require('../utils/logger');

const messageController = {
  /**
   * 检查两个用户之间是否可以发送私信
   * 规则：
   * 1. 如果是互相关注（粉丝或关注的人），可以无限次发送
   * 2. 如果不是互关：
   *    - A 发消息给 B 后，必须等 B 回复才能继续发
   *    - B 回复后，A 和 B 可以无限次互发
   */
  async checkCanSendMessage(senderId, receiverId, conversationId) {
    // 不能给自己发消息
    if (senderId === receiverId) {
      return { canSend: false, reason: '不能给自己发送私信' };
    }

    // 检查发送者是否被封禁（仅活跃封禁记录；已解封/过期的记录不影响发消息）
    // 修复：此前不检查 isActive，解封后的用户因残留记录仍无法发私信
    const senderBanned = await BannedUser.isUserBanned(senderId);
    if (senderBanned) {
      return { canSend: false, reason: '您的账号已被封禁，无法发送私信' };
    }

    // 检查接收者是否存在
    const receiver = await User.findOne({ id: receiverId });
    if (!receiver) {
      return { canSend: false, reason: '接收者不存在' };
    }

    // 检查黑名单：如果接收者拉黑了发送者，则不能发送
    const isBlockedByReceiver = await Blacklist.isBlocked(receiverId, senderId);
    if (isBlockedByReceiver) {
      return { canSend: false, reason: '对方已开启私信限制' };
    }

    // 检查黑名单：如果发送者拉黑了接收者，也不能发送
    const hasBlockedReceiver = await Blacklist.isBlocked(senderId, receiverId);
    if (hasBlockedReceiver) {
      return { canSend: false, reason: '您已拉黑对方，请先解除拉黑' };
    }

    // 检查是否互相关注（双方都关注）
    const isFollowing = await Follow.isFollowing(senderId, receiverId);
    const isFollower = await Follow.isFollowing(receiverId, senderId);
    const isMutualFollow = isFollowing && isFollower;

    if (isMutualFollow) {
      // 互关用户可以无限发送
      return { canSend: true, reason: '互相关注用户' };
    }

    // 非互关用户，检查会话状态
    const conversation = await Conversation.findOne({ id: conversationId });
    
    if (!conversation) {
      // 新会话，A可以发起第一条消息
      return { canSend: true, reason: '首次发送消息', needInitiate: true };
    }

    // 检查 canInitiateFrom 字段
    if (conversation.canInitiateFrom === null) {
      // B已回复，双方可以无限发送
      return { canSend: true, reason: '对方已回复，可以继续发送' };
    }

    if (conversation.canInitiateFrom === senderId) {
      // A之前发过消息但B未回复，A不能继续发送
      return { canSend: false, reason: '请等待对方回复后再发送消息' };
    }

    // B可以回复A的消息
    return { canSend: true, reason: '可以回复消息' };
  },

  /**
   * 发送私信
   */
  async sendMessage(req, res) {
    try {
      const { receiverId, content } = req.body;
      // 从认证中间件注入的用户信息中获取 senderId，防止伪造
      const senderId = req.user?.id || req.body.senderId;

      // 验证必要参数
      if (!senderId || !receiverId) {
        return res.status(400).json(generateErrorResponse('缺少发送者或接收者ID'));
      }

      // 判断消息类型：图片消息或文本消息
      const isImageMessage = req.file != null;
      let messageContent = content || '';
      let messageType = 'text';
      let imageUrl = null;

      if (isImageMessage) {
        // 图片消息
        messageType = 'image';
        imageUrl = `/images/${req.file.filename}`;
        // 图片消息可以有可选的文本内容
        messageContent = content ? content.trim() : '';
      } else {
        // 文本消息
        if (!content || content.trim().length === 0) {
          return res.status(400).json(generateErrorResponse('消息内容不能为空'));
        }
        messageContent = content.trim();
      }

      if (messageContent.length > 2000) {
        return res.status(400).json(generateErrorResponse('消息内容不能超过2000字'));
      }

      // 生成会话ID
      const conversationId = Message.getConversationId(senderId, receiverId);

      // 检查是否可以发送消息
      const checkResult = await messageController.checkCanSendMessage(senderId, receiverId, conversationId);
      if (!checkResult.canSend) {
        return res.status(403).json(generateErrorResponse(checkResult.reason));
      }

      // 获取或创建会话
      let conversation = await Conversation.getOrCreateConversation(senderId, receiverId);

      // 创建消息
      const message = await Message.create({
        id: uuidv4(),
        conversationId,
        senderId,
        receiverId,
        content: messageContent,
        type: messageType,
        imageUrl: imageUrl,
        read: false
      });

      // 更新会话的最后消息信息
      const lastMessageContent = isImageMessage ? '[图片]' : messageContent;
      const updateData = {
        lastMessage: {
          content: lastMessageContent.substring(0, 50),
          senderId,
          type: messageType,
          createdAt: message.createdAt
        },
        updatedAt: new Date(),
        lastMessageRead: false
      };

      // 如果是新发起的会话（非互关），设置 canInitiateFrom
      if (checkResult.needInitiate && !conversation.canInitiateFrom) {
        updateData.canInitiateFrom = senderId;
      }
      // 如果接收者回复了，清除 canInitiateFrom
      else if (conversation.canInitiateFrom === receiverId) {
        updateData.canInitiateFrom = null;
      }

      await Conversation.findOneAndUpdate(
        { id: conversationId },
        updateData
      );

      // 获取发送者信息
      const sender = await User.findOne({ id: senderId });
      const receiver = await User.findOne({ id: receiverId });

      logger.logInfo('私信发送成功', {
        senderId,
        receiverId,
        messageId: message.id,
        type: messageType
      });

      res.json(generateSuccessResponse({
        message: {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          receiverId: message.receiverId,
          content: message.content,
          type: message.type,
          imageUrl: message.imageUrl,
          read: message.read,
          createdAt: message.createdAt,
          senderUsername: sender?.username || '未知用户',
          senderAvatar: sender?.avatar || null
        }
      }, '消息发送成功'));
    } catch (error) {
      logger.logError('发送私信失败', { error: error.message, stack: error.stack });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 获取会话列表
   */
  async getConversations(req, res) {
    try {
      // 会话列表必须使用认证身份，绝不信任客户端 query 参数
      const userId = req.user.id;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取用户的所有会话
      const conversations = await Conversation.getUserConversations(userId);

      // 获取每个会话的未读消息数和对方用户信息
      const enrichedConversations = await Promise.all(conversations.map(async (conv) => {
        // 获取对方用户ID
        const otherUserId = conv.participants.find(p => p !== userId);
        
        // 获取对方用户信息
        const otherUser = await User.findOne({ id: otherUserId }).lean();
        
        // 获取未读消息数
        const unreadCount = await Message.getUnreadCountFromUser(userId, otherUserId);

        return {
          id: conv.id,
          otherUser: otherUser ? {
            id: otherUser.id,
            username: otherUser.username,
            avatar: otherUser.avatar,
            school: otherUser.school
          } : { id: otherUserId, username: '未知用户', avatar: null },
          lastMessage: conv.lastMessage,
          updatedAt: conv.updatedAt,
          unreadCount
        };
      }));

      res.json(generateSuccessResponse({ conversations: enrichedConversations }));
    } catch (error) {
      logger.logError('获取会话列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 获取与某用户的消息记录
   */
  async getMessages(req, res) {
    try {
      const { otherUserId, limit = 50, before } = req.query;
      // 会话主体必须是当前认证用户，绝不信任客户端 query 参数
      const userId = req.user.id;

      if (!userId || !otherUserId) {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }

      const conversationId = Message.getConversationId(userId, otherUserId);

      // 构建查询条件
      let query = {
        conversationId,
        deletedBy: { $ne: userId }
      };

      if (before) {
        query.createdAt = { $lt: new Date(before) };
      }

      // 获取消息
      // 分页钳制（与 postController 一致）：limit ∈ [1,100]，防止超大 limit 一次拉走整个会话
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const messages = await Message.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .lean();

      // 标记消息为已读
      await Message.markAsRead(conversationId, userId);

      // 获取发送者信息
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const senders = await User.find({ id: { $in: senderIds } }).lean();
      const senderMap = new Map(senders.map(s => [s.id, s]));

      // 格式化消息
      const formattedMessages = messages.map(m => {
        const sender = senderMap.get(m.senderId);
        return {
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          receiverId: m.receiverId,
          content: m.content,
          type: m.type,
          imageUrl: m.imageUrl || null,
          read: m.read,
          createdAt: m.createdAt,
          senderUsername: sender?.username || '未知用户',
          senderAvatar: sender?.avatar || null
        };
      }).reverse(); // 按时间正序返回

      res.json(generateSuccessResponse({ messages: formattedMessages }));
    } catch (error) {
      logger.logError('获取消息记录失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 获取未读消息总数
   */
  async getUnreadCount(req, res) {
    try {
      // 未读数必须使用认证身份，绝不信任客户端 query 参数
      const userId = req.user.id;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      const unreadCount = await Message.getUnreadCount(userId);

      res.json(generateSuccessResponse({ unreadCount }));
    } catch (error) {
      logger.logError('获取未读消息数失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 检查是否可以发送消息（供前端调用）
   */
  async checkSendPermission(req, res) {
    try {
      const { senderId, receiverId } = req.query;

      if (!senderId || !receiverId) {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }

      // 只能以本人身份查询（接口会返回关注/拉黑关系，不能当关系枚举器用）
      if (senderId !== req.user.id) {
        return res.status(403).json(generateErrorResponse('无权查询他人的会话权限', 403));
      }

      const conversationId = Message.getConversationId(senderId, receiverId);
      const result = await messageController.checkCanSendMessage(senderId, receiverId, conversationId);

      // 检查关注关系
      const isFollowing = await Follow.isFollowing(senderId, receiverId);
      const isFollower = await Follow.isFollowing(receiverId, senderId);

      // 检查黑名单关系
      const isBlocked = await Blacklist.isBlocked(senderId, receiverId);
      const isBlockedBy = await Blacklist.isBlocked(receiverId, senderId);

      res.json(generateSuccessResponse({
        canSend: result.canSend,
        reason: result.reason,
        relation: {
          isFollowing,
          isFollower,
          isMutualFollow: isFollowing && isFollower
        },
        blockStatus: {
          isBlocked,
          isBlockedBy
        }
      }));
    } catch (error) {
      logger.logError('检查发送权限失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 删除单条消息（对自己不可见）
   */
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      const message = await Message.findOne({ id: messageId });
      if (!message) {
        return res.status(404).json(generateErrorResponse('消息不存在'));
      }

      // 检查是否是消息的参与者
      if (message.senderId !== userId && message.receiverId !== userId) {
        return res.status(403).json(generateErrorResponse('无权删除此消息'));
      }

      // 添加到删除列表
      if (!message.deletedBy.includes(userId)) {
        message.deletedBy.push(userId);
        await message.save();
      }

      res.json(generateSuccessResponse({}, '消息已删除'));
    } catch (error) {
      logger.logError('删除消息失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 删除会话（清空聊天记录）
   */
  async deleteConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 验证用户是否是会话参与者
      const conversation = await Conversation.findOne({ id: conversationId });
      if (!conversation) {
        return res.status(404).json(generateErrorResponse('会话不存在'));
      }

      if (!conversation.participants.includes(userId)) {
        return res.status(403).json(generateErrorResponse('无权删除此会话'));
      }

      // 标记所有消息为对当前用户删除
      await Message.updateMany(
        { conversationId },
        { $addToSet: { deletedBy: userId } }
      );

      res.json(generateSuccessResponse({}, '会话已清空'));
    } catch (error) {
      logger.logError('删除会话失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 获取可发私信的用户列表（关注的人或粉丝）
   */
  async getContactableUsers(req, res) {
    try {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 获取关注的人
      const following = await Follow.find({ followerId: userId }).lean();
      const followingIds = following.map(f => f.followingId);

      // 获取粉丝
      const followers = await Follow.find({ followingId: userId }).lean();
      const followerIds = followers.map(f => f.followerId);

      // 合并去重
      const contactableIds = [...new Set([...followingIds, ...followerIds])];

      // 获取用户信息
      const users = await User.find({ id: { $in: contactableIds } }).lean();

      const formattedUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        school: u.school,
        isFollowing: followingIds.includes(u.id),
        isFollower: followerIds.includes(u.id)
      }));

      res.json(generateSuccessResponse({ users: formattedUsers }));
    } catch (error) {
      logger.logError('获取可联系用户列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = messageController;
