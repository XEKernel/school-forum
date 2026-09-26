const mongoose = require('mongoose');
const { Schema } = mongoose;

const NotificationSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    index: true
    // 非必填：广播通知（target='all'）不绑定具体用户，全体用户可见
  },
  // 通知目标：'user' 个人通知 / 'all' 广播通知（全体用户可见）
  target: {
    type: String,
    enum: ['user', 'all'],
    default: 'user'
  },
  type: {
    type: String,
    required: true,
    enum: ['like', 'comment', 'comment_reply', 'system', 'follow'],
    index: true
  },
  // 群发消息标题（systemType='broadcast' 时使用）
  title: {
    type: String,
    default: null
  },
  // 点赞相关
  postId: {
    type: String,
    default: null
  },
  fromUserId: {
    type: String,
    default: null
  },
  fromUsername: {
    type: String,
    default: null
  },
  // 评论相关
  commentId: {
    type: String,
    default: null
  },
  content: {
    type: String,
    default: null
  },
  // 系统通知相关
  systemType: {
    type: String,
    default: null
  },
  isApproved: {
    type: Boolean,
    default: null
  },
  isViolation: {
    type: Boolean,
    default: null
  },
  reason: {
    type: String,
    default: null
  },
  targetUsername: {
    type: String,
    default: null
  },
  targetType: {
    type: String,
    default: null
  },
  banDays: {
    type: Number,
    default: null
  },
  note: {
    type: String,
    default: null
  },
  message: {
    type: String,
    default: null
  },
  // 通用字段
  timestamp: {
    type: Date,
    default: Date.now
    // 不再在字段上声明 index：与下面的 schema 级 timestamp: -1 会并存成两个索引，
    // 查询实际按倒序，保留倒序那个即可（审查报告 🔵46）
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  // 广播通知（target='all'）已读用户列表：广播通知是全体共享文档，
  // 已读状态必须按用户记录（readBy），不能用全局 read 字段
  readBy: {
    type: Array,
    default: []
  }
}, {
  timestamps: false,
  collection: 'notifications'
});

// 创建索引
NotificationSchema.index({ userId: 1, read: 1 });
NotificationSchema.index({ timestamp: -1 });

// 静态方法：获取用户未读通知
NotificationSchema.statics.findUnreadByUserId = function(userId) {
  return this.find({ userId, read: false }).sort({ timestamp: -1 });
};

// 静态方法：获取用户所有通知
NotificationSchema.statics.findByUserId = function(userId, limit = 50) {
  return this.find({ userId }).sort({ timestamp: -1 }).limit(limit);
};

module.exports = mongoose.model('Notification', NotificationSchema);
