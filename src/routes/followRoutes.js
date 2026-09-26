const express = require('express');
const router = express.Router();
const followController = require('../controllers/followController');
const { authenticateUser } = require('../middleware/jwtAuth');

// 关注用户
router.post('/follow', authenticateUser, followController.followUser);

// 取消关注 - 支持两种方式
router.post('/unfollow', authenticateUser, followController.unfollowUser);
router.delete('/follow', authenticateUser, followController.unfollowUser);

// 检查关注状态（需登录：该接口回答"A 是否关注 B"，未鉴权时可被成对探测整张关系图）
router.get('/follow/status', authenticateUser, followController.checkFollowStatus);

// 获取用户的关注数和粉丝数（聚合计数，保持公开）
router.get('/follow/stats/:userId', followController.getFollowStats);

// 获取关注用户的新帖子数量（用于顶栏徽章，需登录）
router.get('/follow/new-posts/:userId', authenticateUser, followController.getNewPostsCount);

// 标记用户查看了关注动态
router.post('/follow/mark-viewed', authenticateUser, followController.markFollowingViewed);

// 获取关注的人的帖子（必须在 /following/:userId 之前）
// 以下三个接口都会返回他人的社交关系/关注流（含用户名、学校、班级），未鉴权时可被匿名枚举
router.get('/following/posts/:userId', authenticateUser, followController.getFollowingPosts);

// 获取用户关注的人列表
router.get('/following/:userId', authenticateUser, followController.getFollowingList);

// 获取用户的粉丝列表
router.get('/followers/:userId', authenticateUser, followController.getFollowerList);

module.exports = router;
