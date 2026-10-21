const mongoose = require('mongoose');
const { Schema } = mongoose;

const ReportSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  reporterId: {
    type: String,
    required: true,
    index: true
  },
  targetType: {
    type: String,
    required: true,
    enum: ['post', 'comment', 'user']
  },
  targetId: {
    type: String,
    required: true
  },
  targetUserId: {
    type: String,
    default: null
  },
  targetUsername: {
    type: String,
    default: null
  },
  targetContent: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    required: true
  },
  reasonText: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  postId: {
    type: String,
    default: null
  },
  commentId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    // rejected 对应「举报被驳回」。此前 processReport 会写入该值，但不在 enum 内：
    // findOneAndUpdate 不跑 validator 所以能写进去，库里留下 schema 未定义的状态，
    // 之后任何 save()/validate() 都会失败，统计与筛选也建立在非法枚举上。
    // processing：已认领、正在执行（封禁/删内容/通知）。
    // 引入该中间态是为了避免「先结案后执行」导致的中途失败留下半成品：
    // 失败时可以把状态退回 pending 供管理员重试，而不是永久卡在已处理。
    enum: ['pending', 'processing', 'processed', 'rejected'],
    default: 'pending',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  // 认领时间：用于回收卡住的 processing（管理员处理中途断开/进程重启）
  processingAt: {
    type: Date,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  },
  processedBy: {
    type: String,
    default: null
  },
  result: {
    type: String,
    enum: ['violation_confirmed', 'no_violation', null],
    default: null
  },
  banDuration: {
    type: Number,
    default: null
  },
  note: {
    type: String,
    default: ''
  }
}, {
  timestamps: false,
  collection: 'reports'
});

// 复合索引
ReportSchema.index({ status: 1, createdAt: -1 });

// 静态方法：获取待处理的举报
ReportSchema.statics.findPending = function() {
  return this.find({ status: 'pending' }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Report', ReportSchema);