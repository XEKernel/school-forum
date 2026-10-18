/**
 * 评论模型（独立集合）
 *
 * 背景：评论原先是 Post 的内嵌数组（`comments[i].replies` 可递归到 6 层），
 * MongoDB 的 positional operator 无法表达这种动态深度，导致所有写操作只能
 * 「读出整个数组 → 内存修改 → 整字段覆盖写」，并发时后写者会抹掉前者。
 * 已用 commentsVersion 做 CAS 兜住，但代价是高并发下大量 409。
 *
 * 拆成独立集合后：
 *   - 新增评论/回复 = insertOne，天然原子
 *   - 点赞 = $inc + $addToSet，天然原子
 *   - 删除 = 软删 + 递归标记
 * 读写都走 parentId 关联，API 响应时再组装回嵌套结构，
 * 前端与 Android 客户端**无需任何改动**。
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const CommentImageSchema = new Schema({
  id: { type: String, required: true },
  url: { type: String, required: true },
  filename: { type: String, required: true },
  size: { type: Number, default: 0 }
}, { _id: false });

const CommentSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // 所属帖子
  postId: {
    type: String,
    required: true,
    index: true
  },
  // 父节点 id：顶层评论为 null，回复指向被回复的评论/回复
  parentId: {
    type: String,
    default: null,
    index: true
  },
  // 层级：顶层评论为 1，最深 MAX_REPLY_DEPTH 层
  depth: {
    type: Number,
    default: 1
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  username: {
    type: String,
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  anonymous: {
    type: Boolean,
    default: false
  },
  likes: {
    type: Number,
    default: 0
  },
  likedBy: [{
    type: String
  }],
  images: [CommentImageSchema],
  // 回复某人时的展示信息（顶层评论为 null）
  replyToId: {
    type: String,
    default: null
  },
  replyToUsername: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  // 软删除：保留节点，避免整棵子树因为父节点消失而变成孤儿
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: false,
  collection: 'comments'
});

// 按帖子取全部评论（组装树用）：postId + 时间
CommentSchema.index({ postId: 1, timestamp: 1 });
// 按父节点取直接子回复
CommentSchema.index({ postId: 1, parentId: 1 });

module.exports = mongoose.models.Comment || mongoose.model('Comment', CommentSchema);
