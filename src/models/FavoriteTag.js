const mongoose = require('mongoose');
const { Schema } = mongoose;

const FavoriteTagSchema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
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
  order: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'favoritetags'
});

// 复合索引，确保同一用户的标签名唯一
FavoriteTagSchema.index({ userId: 1, name: 1 }, { unique: true });

// 静态方法：创建标签
FavoriteTagSchema.statics.createTag = async function(userId, name, color = '#2b6cb0') {
  try {
    // 获取当前用户的最大 order 值
    const maxOrder = await this.findOne({ userId }).sort({ order: -1 }).select('order');
    const order = maxOrder ? maxOrder.order + 1 : 0;
    
    const tag = new this({ userId, name, color, order });
    await tag.save();
    return { success: true, tag };
  } catch (error) {
    if (error.code === 11000) {
      return { success: false, message: '标签名已存在' };
    }
    throw error;
  }
};

// 静态方法：获取用户所有标签
FavoriteTagSchema.statics.getUserTags = async function(userId) {
  return this.find({ userId }).sort({ order: 1, createdAt: 1 });
};

// 静态方法：更新标签
FavoriteTagSchema.statics.updateTag = async function(tagId, userId, updates) {
  const result = await this.findOneAndUpdate(
    { _id: tagId, userId },
    updates,
    { new: true }
  );
  return result;
};

// 静态方法：删除标签
FavoriteTagSchema.statics.deleteTag = async function(tagId, userId) {
  const result = await this.deleteOne({ _id: tagId, userId });
  return result.deletedCount > 0;
};

// 静态方法：更新标签排序
FavoriteTagSchema.statics.updateTagOrder = async function(userId, tagOrders) {
  const bulkOps = tagOrders.map(({ tagId, order }) => ({
    updateOne: {
      filter: { _id: tagId, userId },
      update: { order }
    }
  }));
  
  if (bulkOps.length > 0) {
    await this.bulkWrite(bulkOps);
  }
  return true;
};

// 静态方法：获取标签下的收藏数量
FavoriteTagSchema.statics.getTagFavoriteCount = async function(tagId, Favorite) {
  return Favorite.countDocuments({ tagId });
};

module.exports = mongoose.model('FavoriteTag', FavoriteTagSchema);
