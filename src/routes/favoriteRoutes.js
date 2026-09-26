const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const { authenticateUser } = require('../middleware/jwtAuth');

// ============ 标签管理（放在前面，避免被通配路由捕获） ============

// 获取用户所有标签 — 需登录，仅本人或管理员可见（2026-08-10 渗透测试修复：IDOR）
router.get('/favorites/tags/:userId', authenticateUser, favoriteController.getUserTags);

// 创建标签
router.post('/favorites/tags', authenticateUser, favoriteController.createTag);

// 更新标签
router.put('/favorites/tags/:tagId', authenticateUser, favoriteController.updateTag);

// 删除标签
router.delete('/favorites/tags/:tagId', authenticateUser, favoriteController.deleteTag);

// 更新标签排序
router.put('/favorites/tags/order', authenticateUser, favoriteController.updateTagOrder);

// ============ 批量操作（放在前面，避免被通配路由捕获） ============

// 批量删除收藏
router.post('/favorites/batch/delete', authenticateUser, favoriteController.batchRemoveFavorites);

// 批量移动收藏到标签
router.post('/favorites/batch/move', authenticateUser, favoriteController.batchMoveToTag);

// 获取用户收藏列表 — 需登录，仅本人或管理员可见（2026-08-10 渗透测试修复：IDOR）
router.get('/favorites/user/:userId', authenticateUser, favoriteController.getUserFavorites);

// 获取用户收藏数量 — 需登录，仅本人或管理员可见（2026-08-10 渗透测试修复：IDOR）
router.get('/favorites/user/:userId/count', authenticateUser, favoriteController.getFavoriteCount);

// ============ 收藏管理（带 postId 参数的路由放在最后） ============

// 收藏帖子
router.post('/favorites/:postId', authenticateUser, favoriteController.addFavorite);

// 取消收藏
router.delete('/favorites/:postId', authenticateUser, favoriteController.removeFavorite);

// 检查是否已收藏 — 需登录（此前用 query 里的 userId，未登录即可枚举任意用户的收藏关系）
router.get('/favorites/:postId/check', authenticateUser, favoriteController.checkFavorite);

// 更新收藏的标签
router.put('/favorites/:postId/tag', authenticateUser, favoriteController.updateFavoriteTag);

module.exports = router;
