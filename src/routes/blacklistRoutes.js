const express = require('express');
const router = express.Router();
const blacklistController = require('../controllers/blacklistController');
const { authenticateUser } = require('../middleware/jwtAuth');

// 拉黑用户
router.post('/block', authenticateUser, blacklistController.blockUser);

// 取消拉黑
router.post('/unblock', authenticateUser, blacklistController.unblockUser);

// 检查私信发送权限（chat.js 专用）
router.get('/check/:receiverId', authenticateUser, blacklistController.checkSendPermission);

// 检查拉黑状态（需登录：否则任何人可枚举「谁拉黑了谁」）
router.get('/block/status', authenticateUser, blacklistController.checkBlockStatus);

// 检查两个用户之间是否有拉黑关系（需登录，且必须涉及本人）
router.get('/block/relation', authenticateUser, blacklistController.checkBlockRelation);

// 获取用户拉黑的人列表（需登录，仅能查自己）
router.get('/blocked/:userId', authenticateUser, blacklistController.getBlockedList);

// 获取拉黑数量（需登录，仅能查自己）
router.get('/blocked/count/:userId', authenticateUser, blacklistController.getBlockedCount);

module.exports = router;
