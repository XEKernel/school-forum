const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * 栏目模型（论坛版块）
 * 帖子属于某个栏目，用户可以只看某个栏目的帖子
 */
const CategorySchema = new Schema({
  // 唯一ID
  id: {
    type: String,
    required: true,
    unique: true
  },

  // 栏目名称
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30
  },

  // 栏目描述
  description: {
    type: String,
    default: '',
    maxlength: 200
  },

  // 图标（FontAwesome 类名）
  icon: {
    type: String,
    default: 'fa-folder'
  },

  // 颜色（十六进制）
  color: {
    type: String,
    default: '#2b6cb0',
    validate: {
      validator: function(v) {
        return /^#[0-9A-Fa-f]{6}$/.test(v);
      },
      message: '颜色格式无效'
    }
  },

  // 排序权重（数字越小越靠前）
  order: {
    type: Number,
    default: 0
  },

  // 是否启用（管理员可禁用）
  isActive: {
    type: Boolean,
    default: true
  },

  // 帖子数（方便快速查询）
  postCount: {
    type: Number,
    default: 0
  },

  // 创建者（管理员ID）
  createdBy: {
    type: String,
    required: true
  },

  // 创建时间
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'categories'
});

// 静态方法：获取所有已启用栏目（按 order 排序）
CategorySchema.statics.getActiveCategories = function() {
  return this.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
};

// 静态方法：根据 ID 获取栏目
CategorySchema.statics.getById = function(id) {
  return this.findOne({ id });
};

const Category = mongoose.model('Category', CategorySchema);

module.exports = Category;
