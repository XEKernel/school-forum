const mongoose = require('mongoose');
const { Schema } = mongoose;

// 图片子文档
const PostImageSchema = new Schema({
  id: {
    type: String,
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalname: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// 嵌套回复子文档
const ReplySchema = new Schema({
  id: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  anonymous: {
    type: Boolean,
    default: false
  },
  replyTo: {
    type: String,
    default: null
  },
  images: [{
    id: { type: String, required: true },
    url: { type: String, required: true },
    filename: { type: String, required: true },
    size: { type: Number, default: 0 }
  }],
  timestamp: {
    type: Date,
    default: Date.now
  },
  replies: [this] // 递归定义嵌套回复
}, { _id: false });

// 评论子文档
const CommentSchema = new Schema({
  id: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  anonymous: {
    type: Boolean,
    default: false
  },
  // 评论点赞（此前缺失导致 likeComment 写入被 mongoose 静默丢弃，评论点赞无效）
  likes: {
    type: Number,
    default: 0
  },
  likedBy: [{
    type: String
  }],
  images: [{
    id: { type: String, required: true },
    url: { type: String, required: true },
    filename: { type: String, required: true },
    size: { type: Number, default: 0 }
  }],
  timestamp: {
    type: Date,
    default: Date.now
  },
  replies: [ReplySchema]
}, { _id: false });

// 帖子主文档
const PostSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true
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
  school: {
    type: String,
    default: ''
  },
  grade: {
    type: String,
    default: ''
  },
  className: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    default: ''
  },
  anonymous: {
    type: Boolean,
    default: false
  },
  images: [PostImageSchema],
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  likes: {
    type: Number,
    default: 0
  },
  likedBy: [{
    type: String
  }],
  dislikes: {
    type: Number,
    default: 0
  },
  dislikedBy: [{
    type: String
  }],
  comments: [CommentSchema],
  // 评论数组的并发控制版本号：每次评论写入 +1，用于 CAS。
  // 不能靠 $size 检测 —— 回复挂在 comments[i].replies 里，顶层长度不变。
  commentsVersion: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: String,
    default: null
  },
  updatedAt: {
    type: Date,
    default: null
  },
  // 帖子可见性设置
  visibility: {
    type: String,
    enum: ['public', 'followers', 'self'],
    default: 'public'
  },
  // 设备信息
  deviceInfo: {
    type: String,
    default: ''
  },
  // 所属栏目ID（可选，不填表示无栏目归属）
  categoryId: {
    type: String,
    default: null,
    index: true
  },
  // 评论区开关
  commentsEnabled: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: false,
  collection: 'posts'
});

// 静态方法：获取未删除的帖子
PostSchema.statics.findActive = function() {
  return this.find({ isDeleted: false });
};

// 静态方法：根据 ID 查找活跃帖子
PostSchema.statics.findActiveById = function(id) {
  return this.findOne({ id, isDeleted: false });
};

// 静态方法：根据用户 ID 查找帖子
PostSchema.statics.findByUserId = function(userId, includeDeleted = false) {
  const query = { userId };
  if (!includeDeleted) {
    query.isDeleted = false;
  }
  return this.find(query).sort({ timestamp: -1 });
};

module.exports = mongoose.model('Post', PostSchema);