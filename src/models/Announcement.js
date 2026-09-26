const mongoose = require('mongoose');

/**
 * 公告模型
 * 用于存储论坛公告信息
 */
const announcementSchema = new mongoose.Schema({
  // 公告标题
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  
  // 公告内容
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  
  // 公告类型: info(普通), warning(警告), success(成功), danger(危险)
  type: {
    type: String,
    enum: ['info', 'warning', 'success', 'danger'],
    default: 'info'
  },
  
  // 是否启用
  isActive: {
    type: Boolean,
    default: true
  },
  
  // 是否置顶显示
  isPinned: {
    type: Boolean,
    default: false
  },
  
  // 显示位置: top(顶部横幅), popup(弹窗), list(列表)
  displayPosition: {
    type: String,
    enum: ['top', 'popup', 'list'],
    default: 'top'
  },
  
  // 开始显示时间
  startTime: {
    type: Date
  },
  
  // 结束显示时间
  endTime: {
    type: Date
  },
  
  // 创建者（管理员）
  createdBy: {
    type: String,
    required: true
  },
  
  // 创建时间
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // 更新时间
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  // 浏览次数
  viewCount: {
    type: Number,
    default: 0
  }
}, { 
  timestamps: { 
    createdAt: 'createdAt', 
    updatedAt: 'updatedAt' 
  } 
});

// 静态方法：获取当前有效的公告
announcementSchema.statics.getActiveAnnouncements = async function(position = null) {
  const now = new Date();
  
  const query = {
    isActive: true,
    // 两个时间条件必须放进 $and：在同一对象字面量里写两次 $or 时，
    // 后一个会静默覆盖前一个，导致 startTime 过滤失效、未生效的公告被提前展示
    $and: [
      { $or: [{ startTime: null }, { startTime: { $lte: now } }] },
      { $or: [{ endTime: null }, { endTime: { $gte: now } }] }
    ]
  };
  
  if (position) {
    query.displayPosition = position;
  }
  
  return this.find(query)
    .sort({ isPinned: -1, createdAt: -1 });
};

// 索引：活跃公告查询按 isActive + 有效期筛选，此前只有 _id 索引（审查报告 🔵46）
announcementSchema.index({ isActive: 1, startTime: 1, endTime: 1 });

// 实例方法：检查是否在有效期内
announcementSchema.methods.isValid = function() {
  const now = new Date();
  
  if (!this.isActive) return false;
  
  if (this.startTime && now < this.startTime) return false;
  
  if (this.endTime && now > this.endTime) return false;
  
  return true;
};

const Announcement = mongoose.model('Announcement', announcementSchema);

module.exports = Announcement;
