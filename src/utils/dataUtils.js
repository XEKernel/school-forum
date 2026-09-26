const fs = require('fs');
const path = require('path');
const { 
  DATA_DIR, 
  IMAGES_DIR 
} = require('../config/constants');

// 导入 Mongoose 模型
const { 
  User, 
  Post, 
  Notification, 
  Report, 
  BannedUser, 
  DeletedPost,
  Favorite
} = require('../models');

// ==================== 用户相关操作 ====================

// 获取所有用户
async function getUsers() {
  return await User.find().lean();
}

// 根据 ID 获取用户
async function getUserById(userId) {
  return await User.findOne({ id: userId }).lean();
}

// 根据 QQ 获取用户
async function getUserByQQ(qq) {
  return await User.findOne({ qq }).lean();
}

// 根据用户名获取用户
async function getUserByUsername(username) {
  return await User.findOne({ username }).lean();
}

// 根据邮箱获取用户（不区分大小写；email 均以小写存储，直接等值查询可用索引）
async function getUserByEmail(email) {
  return await User.findOne({
    email: String(email).toLowerCase()
  }).lean();
}

// 检查邮箱是否已被注册（不区分大小写）
async function isEmailRegistered(email) {
  const user = await getUserByEmail(email);
  return !!user;
}

// 创建用户
async function createUser(userData) {
  const user = new User(userData);
  return await user.save();
}

// 更新用户
async function updateUser(userId, updateData) {
  return await User.findOneAndUpdate(
    { id: userId },
    updateData,
    { returnDocument: 'after' }
  ).lean();
}

// 删除用户
async function deleteUser(userId) {
  return await User.findOneAndDelete({ id: userId });
}

// 检查 QQ 是否已注册
async function isQQRegistered(qq) {
  const user = await User.findOne({ qq });
  return !!user;
}

// 检查用户名是否存在
async function isUsernameExists(username) {
  const user = await User.findOne({ username });
  return !!user;
}

// 检查用户是否存在
async function userExists(userId) {
  const user = await User.findOne({ id: userId });
  return !!user;
}

// 检查用户是否活跃
async function isUserActive(userId) {
  const user = await User.findOne({ id: userId });
  return user && user.isActive;
}

// ==================== 帖子相关操作 ====================

// 获取所有帖子
async function getPosts(includeDeleted = false) {
  const query = includeDeleted ? {} : { isDeleted: false };
  return await Post.find(query).lean();
}

// 根据 ID 获取帖子
async function getPostById(postId, includeDeleted = false) {
  const query = { id: postId };
  if (!includeDeleted) {
    query.isDeleted = false;
  }
  return await Post.findOne(query).lean();
}

// 获取用户帖子
async function getPostsByUserId(userId, includeDeleted = false) {
  const query = { userId };
  if (!includeDeleted) {
    query.isDeleted = false;
  }
  return await Post.find(query).sort({ timestamp: -1 }).lean();
}

// 创建帖子
async function createPost(postData) {
  const post = new Post(postData);
  return await post.save();
}

// 更新帖子
async function updatePost(postId, updateData) {
  return await Post.findOneAndUpdate(
    { id: postId },
    updateData,
    { returnDocument: 'after' }
  ).lean();
}

// 删除帖子（软删除）
async function deletePost(postId, deletedBy, reason = '') {
  const post = await Post.findOne({ id: postId });
  if (!post) return null;
  
  post.isDeleted = true;
  post.deletedAt = new Date();
  post.deletedBy = deletedBy;
  
  // 保存到已删除帖子集合
  const deletedPost = new DeletedPost({
    ...post.toObject(),
    reason,
    permanentDelete: false
  });
  await deletedPost.save();
  
  return await post.save();
}

// 恢复帖子
async function restorePost(postId) {
  const post = await Post.findOne({ id: postId });
  if (!post) return null;
  
  post.isDeleted = false;
  post.deletedAt = null;
  post.deletedBy = null;
  
  // 从已删除帖子集合中移除
  await DeletedPost.deleteOne({ id: postId });
  
  return await post.save();
}

// ==================== 通知相关操作 ====================

// 获取用户通知（含全体广播通知 target='all'）
async function getNotifications(userId, limit = 50) {
  return await Notification.find({ $or: [{ userId }, { target: 'all' }] })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

// 获取未读通知（含全体广播通知）
async function getUnreadNotifications(userId) {
  return await Notification.find({ read: false, $or: [{ userId }, { target: 'all' }] })
    .sort({ timestamp: -1 })
    .lean();
}

// 创建通知
async function createNotification(notificationData) {
  const notification = new Notification(notificationData);
  return await notification.save();
}

// 标记通知为已读
async function markNotificationAsRead(notificationId) {
  return await Notification.findOneAndUpdate(
    { id: notificationId },
    { read: true },
    { returnDocument: 'after' }
  ).lean();
}

// 标记广播通知为已读（按用户记录到 readBy，不动全局 read 字段）
async function markBroadcastAsRead(notificationId, userId) {
  return await Notification.findOneAndUpdate(
    { id: notificationId, target: 'all' },
    { $addToSet: { readBy: userId } },
    { returnDocument: 'after' }
  ).lean();
}

// 标记所有通知为已读（个人通知 read=true；广播通知 readBy 追加当前用户）
async function markAllNotificationsAsRead(userId) {
  const personal = await Notification.updateMany(
    { userId, read: false },
    { read: true }
  );
  const broadcast = await Notification.updateMany(
    { target: 'all' },
    { $addToSet: { readBy: userId } }
  );
  // 返回真实影响条数：此前硬编码 { modifiedCount: 1 }，前端显示的"已更新 N 条"是假的
  return {
    modifiedCount: (personal.modifiedCount || 0) + (broadcast.modifiedCount || 0)
  };
}

// 获取未读通知数量（个人未读 + 当前用户未读的广播通知）
async function getUnreadNotificationCount(userId) {
  return await Notification.countDocuments({
    $or: [
      { userId, read: false },
      { target: 'all', readBy: { $ne: userId } }
    ]
  });
}

// ==================== 举报相关操作 ====================

// 获取所有举报
async function getReports(status = null) {
  const query = status ? { status } : {};
  return await Report.find(query).sort({ createdAt: -1 }).lean();
}

// 获取待处理的举报
async function getPendingReports() {
  return await Report.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
}

// 创建举报
async function createReport(reportData) {
  const report = new Report(reportData);
  return await report.save();
}

// 更新举报状态（幂等：只有当前状态等于 fromStatus 时才更新，否则返回 null）
// 过滤器带上 fromStatus，让「认领」这一步原子化，杜绝两个管理员同时处理同一条举报造成的重复封禁（TOCTOU）
async function updateReportStatus(reportId, fromStatus, updateData) {
  return await Report.findOneAndUpdate(
    { id: reportId, status: fromStatus },
    updateData,
    { returnDocument: 'after' }
  ).lean();
}

// ==================== 封禁用户相关操作 ====================

// 获取所有封禁记录
async function getBannedUsers(activeOnly = false) {
  const query = activeOnly ? { isActive: true } : {};
  return await BannedUser.find(query).sort({ bannedAt: -1 }).lean();
}

// 检查用户是否被封禁
async function isUserBanned(userId) {
  return await BannedUser.isUserBanned(userId);
}

// 封禁用户
async function banUser(banData) {
  const bannedUser = new BannedUser(banData);
  return await bannedUser.save();
}

// 解封用户
async function unbanUser(userId) {
  return await BannedUser.findOneAndUpdate(
    { userId, isActive: true },
    { isActive: false },
    { returnDocument: 'after' }
  ).lean();
}

// ==================== 已删除帖子相关操作 ====================

// 获取已删除帖子
async function getDeletedPosts() {
  return await DeletedPost.find().sort({ deletedAt: -1 }).lean();
}

// 永久删除帖子
async function permanentDeletePost(postId) {
  await Post.deleteOne({ id: postId });
  await DeletedPost.deleteOne({ id: postId });
}

/**
 * 清理帖子的关联数据（作者软删与管理员永久删共用）
 * 只清「指向已不可见内容」的引用：收藏与通知（收藏列表、通知中心此前会残留死链）。
 * 举报记录刻意**不删**：它包含被举报内容快照，是治理凭据，删掉等于抹掉追责线索。
 * @param {string} postId - 帖子ID
 * @returns {Promise<{favorites:number, notifications:number}>} 清理条数
 */
async function cleanupPostRelations(postId) {
  const [favResult, notifResult] = await Promise.all([
    Favorite.deleteMany({ postId }),
    Notification.deleteMany({ postId })
  ]);
  return {
    favorites: favResult.deletedCount || 0,
    notifications: notifResult.deletedCount || 0
  };
}

// ==================== 统计相关操作 ====================

// 获取统计数据
async function getStats() {
  const [userCount, postCount, commentCount, activeUserCount] = await Promise.all([
    User.countDocuments(),
    Post.countDocuments({ isDeleted: false }),
    Post.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: null, total: { $sum: { $size: '$comments' } } } }
    ]),
    User.countDocuments({ isActive: true })
  ]);

  return {
    userCount,
    postCount,
    commentCount: commentCount[0]?.total || 0,
    activeUserCount
  };
}

// ==================== 初始化函数（保持兼容性） ====================

// 初始化目录
function initializeDirectories() {
  const directories = [
    DATA_DIR,
    IMAGES_DIR
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`创建目录: ${dir}`);
    }
  });
}

// 初始化所有数据文件（空操作，保持兼容性）
function initializeAllDataFiles() {
  // MongoDB 不需要初始化文件
  console.log('使用 MongoDB 数据库，无需初始化数据文件');
}

// 迁移用户数据（空操作，保持兼容性）
function migrateUserData() {
  // MongoDB 不需要迁移
  console.log('使用 MongoDB 数据库，无需迁移用户数据');
}

// ==================== 数据迁移工具 ====================

/**
 * 确保 User 索引与 schema 一致（幂等，启动时执行）
 * 必需的原因：username 由「普通索引」改为「唯一索引」时，同名索引 username_1 已存在且规格不同，
 * MongoDB 会抛 IndexOptionsConflict 而**不会**自动改建 → unique 约束静默失效。
 * 这里显式删掉旧的非唯一索引，再用 syncIndexes 按 schema 重建。
 * @returns {Promise<Object>} { rebuilt: boolean }
 */
async function ensureUserIndexes() {
  const indexes = await User.collection.indexes();
  const usernameIndex = indexes.find(i => i.name === 'username_1');
  const rebuilt = !!(usernameIndex && !usernameIndex.unique);
  if (rebuilt) {
    await User.collection.dropIndex('username_1');
  }
  await User.syncIndexes();
  return { rebuilt };
}

/**
 * 管理员角色迁移（幂等，每次启动执行）
 * 背景：管理员判定由「qq 命中 adminUsers」改为「role === 'admin' 或 id 命中 adminUsers」。
 * 若直接去掉 qq 判据，现有管理员会立刻失去后台权限，因此先做数据迁移：
 *   1) 遍历 config.adminUsers
 *   2) 遗留 QQ 条目（非 UUID）→ 匹配已注册用户，置 role='admin'，并把条目改写为该用户 UUID
 *   3) UUID 条目 → 确保对应用户 role='admin'
 *   4) 未注册的 QQ 条目 → 原样保留并计入 unresolved（无法预授权未注册账号：
 *      任何人只要先改绑该 QQ 就能拿到后台权限，这正是本次修复要关闭的窗口）
 * @returns {Promise<Object>} { promoted, rewritten, unresolved }
 */
async function migrateAdminRoles() {
  const { getAdminUsers } = require('../config/constants');
  const { updateConfig } = require('./configUtils');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const entries = getAdminUsers();
  const nextList = [];
  const summary = { promoted: [], rewritten: [], unresolved: [] };

  for (const entry of entries) {
    if (!entry) continue;

    // 条目既可能是用户 UUID，也可能是遗留的 QQ 号
    const user = UUID_RE.test(entry)
      ? await User.findOne({ id: entry }).select('id role').lean()
      : await User.findOne({ qq: entry }).select('id role').lean();

    if (!user) {
      summary.unresolved.push(entry);
      nextList.push(entry);
      continue;
    }

    if (user.role !== 'admin') {
      await User.updateOne({ id: user.id }, { $set: { role: 'admin' } });
      summary.promoted.push(user.id);
    }
    if (entry !== user.id) {
      summary.rewritten.push(`${entry} → ${user.id}`);
    }
    nextList.push(user.id);
  }

  // 白名单统一落地为 UUID（去重且保持顺序）
  const deduped = [...new Set(nextList)];
  if (JSON.stringify(deduped) !== JSON.stringify(entries)) {
    updateConfig({ adminUsers: deduped });
    summary.listUpdated = true;
  }

  return summary;
}

// 从 JSON 文件迁移数据到 MongoDB
async function migrateFromJSON() {
  console.log('开始从 JSON 文件迁移数据到 MongoDB...');
  
  const jsonFiles = {
    users: path.join(DATA_DIR, 'users.json'),
    posts: path.join(DATA_DIR, 'posts.json'),
    notifications: path.join(DATA_DIR, 'notifications.json'),
    reports: path.join(DATA_DIR, 'reports.json'),
    banned_users: path.join(DATA_DIR, 'banned_users.json'),
    deleted_posts: path.join(DATA_DIR, 'deleted_posts.json')
  };
  
  // 迁移用户
  if (fs.existsSync(jsonFiles.users)) {
    const users = JSON.parse(fs.readFileSync(jsonFiles.users, 'utf8'));
    if (users.length > 0) {
      // 转换日期格式
      const convertedUsers = users.map(user => ({
        ...user,
        createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
        lastLogin: user.lastLogin ? new Date(user.lastLogin) : null
      }));
      await User.insertMany(convertedUsers, { ordered: false });
      console.log(`已迁移 ${users.length} 个用户`);
    }
  }
  
  // 迁移帖子
  if (fs.existsSync(jsonFiles.posts)) {
    const posts = JSON.parse(fs.readFileSync(jsonFiles.posts, 'utf8'));
    if (posts.length > 0) {
      // 转换日期格式
      const convertedPosts = posts.map(post => ({
        ...post,
        timestamp: post.timestamp ? new Date(post.timestamp) : new Date(),
        updatedAt: post.updatedAt ? new Date(post.updatedAt) : null,
        deletedAt: post.deletedAt ? new Date(post.deletedAt) : null
      }));
      await Post.insertMany(convertedPosts, { ordered: false });
      console.log(`已迁移 ${posts.length} 个帖子`);
    }
  }
  
  // 迁移通知
  if (fs.existsSync(jsonFiles.notifications)) {
    const notifications = JSON.parse(fs.readFileSync(jsonFiles.notifications, 'utf8'));
    if (notifications.length > 0) {
      const convertedNotifications = notifications.map(n => ({
        ...n,
        timestamp: n.timestamp ? new Date(n.timestamp) : new Date()
      }));
      await Notification.insertMany(convertedNotifications, { ordered: false });
      console.log(`已迁移 ${notifications.length} 条通知`);
    }
  }
  
  // 迁移举报
  if (fs.existsSync(jsonFiles.reports)) {
    const reports = JSON.parse(fs.readFileSync(jsonFiles.reports, 'utf8'));
    if (reports.length > 0) {
      const convertedReports = reports.map(r => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        processedAt: r.processedAt ? new Date(r.processedAt) : null
      }));
      await Report.insertMany(convertedReports, { ordered: false });
      console.log(`已迁移 ${reports.length} 条举报`);
    }
  }
  
  // 迁移封禁用户
  if (fs.existsSync(jsonFiles.banned_users)) {
    const bannedUsers = JSON.parse(fs.readFileSync(jsonFiles.banned_users, 'utf8'));
    if (bannedUsers && bannedUsers.length > 0) {
      const convertedBannedUsers = bannedUsers.map(b => ({
        ...b,
        bannedAt: b.bannedAt ? new Date(b.bannedAt) : new Date(),
        unbanAt: b.unbanAt ? new Date(b.unbanAt) : null
      }));
      await BannedUser.insertMany(convertedBannedUsers, { ordered: false });
      console.log(`已迁移 ${bannedUsers.length} 个封禁记录`);
    }
  }
  
  // 迁移已删除帖子
  if (fs.existsSync(jsonFiles.deleted_posts)) {
    const deletedPosts = JSON.parse(fs.readFileSync(jsonFiles.deleted_posts, 'utf8'));
    if (deletedPosts && deletedPosts.length > 0) {
      const convertedDeletedPosts = deletedPosts.map(p => ({
        ...p,
        timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
        deletedAt: p.deletedAt ? new Date(p.deletedAt) : new Date()
      }));
      await DeletedPost.insertMany(convertedDeletedPosts, { ordered: false });
      console.log(`已迁移 ${deletedPosts.length} 个已删除帖子`);
    }
  }
  
  console.log('数据迁移完成！');
}

module.exports = {
  // 用户操作
  getUsers,
  getUserById,
  getUserByQQ,
  getUserByUsername,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  isQQRegistered,
  isUsernameExists,
  isEmailRegistered,
  userExists,
  isUserActive,
  
  // 帖子操作
  getPosts,
  getPostById,
  getPostsByUserId,
  createPost,
  updatePost,
  deletePost,
  restorePost,
  
  // 通知操作
  getNotifications,
  getUnreadNotifications,
  createNotification,
  markNotificationAsRead,
  markBroadcastAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  
  // 举报操作
  getReports,
  getPendingReports,
  createReport,
  updateReportStatus,
  
  // 封禁操作
  getBannedUsers,
  isUserBanned,
  banUser,
  unbanUser,
  
  // 已删除帖子操作
  getDeletedPosts,
  permanentDeletePost,
  cleanupPostRelations,
  
  // 统计操作
  getStats,
  
  // 兼容性函数
  initializeDirectories,
  initializeAllDataFiles,
  migrateUserData,
  
  // 迁移工具
  migrateFromJSON,
  migrateAdminRoles,
  ensureUserIndexes,
  
  // 导出模型（供直接使用）
  User,
  Post,
  Notification,
  Report,
  BannedUser,
  DeletedPost
};
