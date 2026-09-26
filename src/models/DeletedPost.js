const mongoose = require('mongoose');
const { Schema } = mongoose;

// 图片子文档
const DeletedPostImageSchema = new Schema({
  id: String,
  filename: String,
  originalname: String,
  size: Number,
  mimetype: String,
  url: String,
  uploadedAt: Date
}, { _id: false });

// 评论子文档
const DeletedCommentSchema = new Schema({
  id: String,
  userId: String,
  username: String,
  content: String,
  anonymous: Boolean,
  timestamp: Date,
  replies: [Schema.Types.Mixed]
}, { _id: false });

const DeletedPostSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  school: String,
  grade: String,
  className: String,
  content: String,
  anonymous: {
    type: Boolean,
    default: false
  },
  images: [DeletedPostImageSchema],
  timestamp: Date,
  likes: {
    type: Number,
    default: 0
  },
  likedBy: [String],
  dislikes: {
    type: Number,
    default: 0
  },
  dislikedBy: [String],
  comments: [DeletedCommentSchema],
  viewCount: {
    type: Number,
    default: 0
  },
  isDeleted: {
    type: Boolean,
    default: true
  },
  deletedAt: {
    type: Date,
    default: Date.now
    // 同上：去重字段级 index，保留 schema 级 deletedAt: -1
  },
  deletedBy: {
    type: String,
    required: true
  },
  reason: {
    type: String,
    default: ''
  },
  permanentDelete: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: false,
  collection: 'deleted_posts'
});

// 创建索引
DeletedPostSchema.index({ deletedAt: -1 });
DeletedPostSchema.index({ userId: 1 });

module.exports = mongoose.model('DeletedPost', DeletedPostSchema);
