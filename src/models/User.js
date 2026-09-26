const mongoose = require('mongoose');
const { Schema } = mongoose;

// 可见性枚举
const visibilityOptions = ['public', 'followers', 'self'];

// 通知偏好设置
const NotificationPreferencesSchema = new Schema({
  // 帖子点赞通知
  like: {
    type: Boolean,
    default: true
  },
  // 帖子评论通知
  comment: {
    type: Boolean,
    default: true
  },
  // 评论回复通知
  commentReply: {
    type: Boolean,
    default: true
  },
  // 评论点赞通知
  commentLike: {
    type: Boolean,
    default: true
  },
  // 关注通知
  follow: {
    type: Boolean,
    default: true
  },
  // 系统通知（不可关闭）
  system: {
    type: Boolean,
    default: true,
    immutable: true
  }
}, { _id: false });

// 个人信息可见性设置
const ProfileVisibilitySchema = new Schema({
  // 性别可见性
  gender: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  },
  // 生日可见性
  birthday: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  },
  // 学校/班级可见性
  school: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  },
  // 签名可见性
  signature: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  },
  // 加入时间可见性
  joinDate: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  },
  // 最后登录可见性
  lastLogin: {
    type: String,
    enum: visibilityOptions,
    default: 'public'
  }
}, { _id: false });

const UserSettingsSchema = new Schema({
  theme: {
    type: String,
    default: 'light',
    enum: ['light', 'dark', 'auto']
  },
  signature: {
    type: String,
    default: ''
  },
  // 通知偏好设置
  notifications: {
    type: NotificationPreferencesSchema,
    default: () => ({})
  },
  privacy: {
    hideBlockedPosts: {
      type: Boolean,
      default: false
    },
    hideBlockedComments: {
      type: Boolean,
      default: false
    },
    // 帖子时间范围展示设置
    postDisplayRange: {
      type: String,
      enum: ['all', '3days', '7days', '1month', '6months', '1year'],
      default: 'all'
    },
    // 个人信息可见性设置
    profileVisibility: {
      type: ProfileVisibilitySchema,
      default: () => ({})
    }
  }
}, { _id: false });

const UserSchema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  qq: {
    type: String,
    required: true,
    unique: true
  },
  // QQ 互联 openid：QQ 快捷登录用户的唯一标识（sparse 唯一：普通用户为 null 不冲突）
  qqOpenId: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  // 用户名唯一：此前只有普通索引，注册接口的「先查重再写入」在并发下会漏，能造出同名账号用于冒充
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  // 密码最后变更时间：用于使密码变更前的所有 JWT 令牌失效（安全）
  passwordChangedAt: {
    type: Date,
    default: null
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  school: {
    type: String,
    required: true
  },
  enrollmentYear: {
    type: Number,
    required: true
  },
  className: {
    type: String,
    required: true
  },
  grade: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: null
  },
  birthday: {
    type: String,
    default: null
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', ''],
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  },
  // 最近登录设备列表（新设备登录检测；最多保留 10 条，最新在前）
  // 每条：{ fingerprint, source, browser, os, device, ip, lastLoginAt, count }
  loginDevices: {
    type: Array,
    default: []
  },
  lastViewedFollowingAt: {
    type: Date,
    default: null
  },
  postCount: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // 角色：管理员权限的唯一权威来源（配合 config.adminUsers 的 UUID 白名单）
  // 说明：此前用「qq 是否命中 adminUsers」判定管理员，而 qq 是注册时自填、且可通过
  // changeQQ 修改的字段 —— 未注册的 QQ 一旦进入白名单，任何人都能改绑该 QQ 拿到后台权限。
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true
  },
  settings: {
    type: UserSettingsSchema,
    default: () => ({})
  }
}, {
  timestamps: false,
  collection: 'users'
});

// 转换为 JSON 时排除密码
UserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user._id;
  delete user.__v;
  return user;
};

// 静态方法：根据 QQ 查找用户
UserSchema.statics.findByQQ = function(qq) {
  return this.findOne({ qq });
};

// 静态方法：根据用户名查找用户
UserSchema.statics.findByUsername = function(username) {
  return this.findOne({ username });
};

// ⚠️ 覆盖 mongoose 内置 Model.findById：本项目 User 使用自定义 UUID `id` 字段
// （非 _id ObjectId），全项目约定 `User.findById(x)` 语义 = 按 `id` 字段查询。
// 切勿传入 MongoDB _id（ObjectId）调用此方法，会查不到数据。
// 如需按 _id 查询请显式使用 findOne({ _id })。
UserSchema.statics.findById = function(id) {
  return this.findOne({ id });
};

module.exports = mongoose.model('User', UserSchema);