const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { upload, verifyImageMagicBytes } = require('../middleware/uploadMiddleware');
const { authenticateUser } = require('../middleware/jwtAuth');

// 注意：更具体的路由必须放在更通用的路由之前

// 获取未读消息总数（必须在 /messages 之前）
router.get('/messages/unread', authenticateUser, messageController.getUnreadCount);

// 检查是否可以发送消息（必须在 /messages 之前）
router.get('/messages/check-permission', authenticateUser, messageController.checkSendPermission);

// 获取可发私信的用户列表（必须在 /messages 之前）
router.get('/messages/contactable-users', authenticateUser, messageController.getContactableUsers);

// 发送私信（支持图片）
router.post('/messages', authenticateUser, upload.single('image'), verifyImageMagicBytes, messageController.sendMessage);

// 获取会话列表
router.get('/conversations', authenticateUser, messageController.getConversations);

// 获取与某用户的消息记录
router.get('/messages', authenticateUser, messageController.getMessages);

// 删除单条消息
router.delete('/messages/:messageId', authenticateUser, messageController.deleteMessage);

// 删除会话
router.delete('/conversations/:conversationId', authenticateUser, messageController.deleteConversation);

module.exports = router;