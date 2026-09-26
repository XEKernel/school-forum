const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { upload, verifyImageMagicBytes } = require('../middleware/uploadMiddleware');
const { authenticateUser, optionalAuth } = require('../middleware/jwtAuth');

// 获取帖子列表（支持分页和搜索）— 可选认证（有 token 时按登录身份过滤可见性/黑名单）
router.get('/posts', optionalAuth, postController.getPosts);

// 获取单个帖子详情 — 可选认证（有 token 时按登录身份检查可见性/黑名单）
router.get('/posts/:id', optionalAuth, postController.getPostById);

// 增加帖子浏览量 — 公开接口，无需认证
router.post('/posts/:id/view', postController.incrementViewCount);

// 发布新帖子（支持图片上传）
router.post('/posts', authenticateUser, upload.array('images', 20), verifyImageMagicBytes, postController.createPost);

// 点赞帖子
router.post('/posts/:id/like', authenticateUser, postController.likePost);

// 点踩帖子
router.post('/posts/:id/dislike', authenticateUser, postController.dislikePost);

// 用户删除自己的帖子
router.delete('/posts/:id', authenticateUser, postController.deletePost);
// 兼容 Android 端的 POST 删除方式
router.post('/posts/delete', authenticateUser, postController.deletePost);

// 用户编辑自己的帖子
router.put('/posts/:id', authenticateUser, upload.array('images', 20), verifyImageMagicBytes, postController.updatePost);

// 添加评论（支持图片上传）
router.post('/posts/:id/comments', authenticateUser, upload.array('images', 5), verifyImageMagicBytes, postController.addComment);

// 回复评论（支持图片上传）
router.post('/posts/:id/comments/:commentId/replies', authenticateUser, upload.array('images', 5), verifyImageMagicBytes, postController.replyComment);
// 兼容前端使用 /reply（单数）路径
router.post('/posts/:id/comments/:commentId/reply', authenticateUser, upload.array('images', 5), verifyImageMagicBytes, postController.replyComment);

// 删除评论
router.delete('/posts/:id/comments/:commentId', authenticateUser, postController.deleteComment);

// 点赞评论
router.post('/posts/:id/comments/:commentId/like', authenticateUser, postController.likeComment);

// 点赞回复（嵌套任意层级）
router.post('/posts/:id/comments/:commentId/replies/:replyId/like', authenticateUser, postController.likeReply);

module.exports = router;