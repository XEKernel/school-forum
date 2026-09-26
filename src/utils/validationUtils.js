/**
 * 验证工具函数
 * 提供用户验证和响应生成的辅助函数
 */

const {
  isQQRegistered: checkQQRegistered,
  isUsernameExists: checkUsernameExists,
  userExists: checkUserExists,
  isUserActive: checkUserActive
} = require('./dataUtils');

/**
 * 检查QQ号是否已注册
 * @param {string} qq - QQ号
 * @returns {Promise<boolean>}
 */
async function isQQRegistered(qq) {
  return await checkQQRegistered(qq);
}

/**
 * 检查用户名是否已存在
 * @param {string} username - 用户名
 * @returns {Promise<boolean>}
 */
async function isUsernameExists(username) {
  return await checkUsernameExists(username);
}

/**
 * 检查用户是否存在
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function userExists(userId) {
  return await checkUserExists(userId);
}

/**
 * 检查用户是否活跃
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function isUserActive(userId) {
  return await checkUserActive(userId);
}

/**
 * 生成错误响应
 * @param {string} message - 错误消息
 * @param {number} code - 错误代码
 * @returns {Object}
 */
function generateErrorResponse(message, code = 400) {
  return {
    success: false,
    message: message,
    code: code
  };
}

/**
 * 生成成功响应
 * @param {Object} data - 响应数据
 * @param {string} message - 成功消息
 * @returns {Object}
 */
function generateSuccessResponse(data = {}, message = '操作成功') {
  return {
    success: true,
    message: message,
    ...data
  };
}

/**
 * 验证用户ID格式
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
function isValidUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    return false;
  }
  // UUID 格式验证
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(userId);
}

/**
 * 验证帖子ID格式
 * @param {string} postId - 帖子ID
 * @returns {boolean}
 */
function isValidPostId(postId) {
  if (!postId || typeof postId !== 'string') {
    return false;
  }
  // UUID 格式验证
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(postId);
}

/**
 * 验证QQ号格式
 * @param {string} qq - QQ号
 * @returns {boolean}
 */
function isValidQQ(qq) {
  if (!qq || typeof qq !== 'string') {
    return false;
  }
  // QQ号：5-12位数字
  const qqRegex = /^\d{5,12}$/;
  return qqRegex.test(qq);
}

/**
 * 验证用户名格式
 * @param {string} username - 用户名
 * @returns {boolean}
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }
  // 用户名：2-20个字符，支持中文、英文、数字、下划线
  const usernameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_]{2,20}$/;
  return usernameRegex.test(username);
}

/**
 * 结构化短字段校验（学校 / 班级等）
 * 禁止 HTML/JS 危险字符并限制最大长度。
 * 目的：即使前端某处漏转义，也无法构造标签或从内联属性 / JS 字符串中逃逸。
 * @param {string} value - 待校验文本
 * @param {number} maxLength - 最大长度
 * @returns {boolean}
 */
function isSafeStructuredText(value, maxLength) {
  if (typeof value !== 'string') {
    return false;
  }
  // 危险字符：标签边界 < >、属性引号 " '、JS 字符串转义 ` \、路径与协议分隔 / :、控制字符
  if (/[<>"'`\\/:\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

/**
 * 验证学校名称（2-50 字符，禁止 HTML/JS 危险字符）
 * @param {string} school - 学校名称
 * @returns {boolean}
 */
function isValidSchoolName(school) {
  return isSafeStructuredText(school, 50);
}

/**
 * 验证班级名称（1-30 字符，禁止 HTML/JS 危险字符）
 * @param {string} className - 班级名称
 * @returns {boolean}
 */
function isValidClassName(className) {
  return isSafeStructuredText(className, 30);
}

/**
 * 验证个性签名（最长 100 字符，允许换行，禁止 < >）
 * @param {string} signature - 个性签名
 * @returns {boolean}
 */
function isValidSignature(signature) {
  if (typeof signature !== 'string') {
    return false;
  }
  if (signature.length > 100) {
    return false;
  }
  return !/[<>]/.test(signature);
}

/**
 * 验证密码强度
 * @param {string} password - 密码
 * @returns {Object} - { valid: boolean, message: string }
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: '密码不能为空' };
  }
  
  if (password.length < 6) {
    return { valid: false, message: '密码长度至少6位' };
  }
  
  if (password.length > 50) {
    return { valid: false, message: '密码长度不能超过50位' };
  }
  
  return { valid: true, message: '' };
}

/**
 * 管理员判定（全项目唯一入口）
 * 判据：role === 'admin'，或用户 id 命中 config.adminUsers（UUID 白名单）
 * ⚠ 绝不再用 qq 判据：qq 是注册时自填、且可被 changeQQ 改绑的字段。
 *   为「尚未注册的 QQ」预授权，等于把后台权限交给任何先抢占该 QQ 的人（纳新窗口期即漏洞）。
 * @param {Object} user - 用户对象（需含 id；role 缺省视为普通用户）
 * @returns {boolean}
 */
function isAdminUser(user) {
  if (!user || !user.id) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  const { getAdminUsers } = require('../config/constants');
  return getAdminUsers().includes(user.id);
}

/**
 * 验证管理员权限
 * @param {string} adminId - 管理员用户ID
 * @returns {Promise<Object>} - { valid: boolean, message: string, user?: Object }
 */
async function validateAdminPermission(adminId) {
  const { getUserById } = require('./dataUtils');
  
  if (!adminId) {
    return { valid: false, message: '管理员ID不能为空' };
  }
  
  try {
    const user = await getUserById(adminId);
    
    if (!user) {
      return { valid: false, message: '用户不存在' };
    }
    
    // 检查用户是否被禁用
    if (user.isActive === false) {
      return { valid: false, message: '该账号已被禁用' };
    }
    
    // 检查是否是管理员（role 优先，其次 UUID 白名单；不再使用 qq 判据）
    if (!isAdminUser(user)) {
      return { valid: false, message: '无管理员权限' };
    }
    
    return { valid: true, message: '验证通过', user };
  } catch (error) {
    console.error('验证管理员权限失败:', error);
    return { valid: false, message: '验证失败' };
  }
}

/**
 * 检查帖子是否存在
 * @param {string} postId - 帖子ID
 * @returns {Promise<boolean>}
 */
async function postExists(postId) {
  const { getPostById } = require('./dataUtils');
  const post = await getPostById(postId);
  return !!post && !post.isDeleted;
}

/**
 * 检查评论是否存在
 * @param {string} postId - 帖子ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<boolean>}
 */
async function commentExists(postId, commentId) {
  const { getPostById } = require('./dataUtils');
  const post = await getPostById(postId);
  if (!post || !post.comments) return false;
  return post.comments.some(c => c.id === commentId);
}

/**
 * 检查用户是否有权限删除评论
 * @param {Object} comment - 评论对象
 * @param {Object} post - 帖子对象
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
function canDeleteComment(comment, post, userId) {
  // 评论作者可以删除自己的评论
  if (comment.userId === userId) {
    return true;
  }
  // 帖子作者可以删除帖子下的评论
  if (post.userId === userId) {
    return true;
  }
  return false;
}

module.exports = {
  isQQRegistered,
  isUsernameExists,
  userExists,
  isUserActive,
  generateErrorResponse,
  generateSuccessResponse,
  isValidUserId,
  isValidPostId,
  isValidQQ,
  isValidUsername,
  isValidSchoolName,
  isValidClassName,
  isValidSignature,
  validatePassword,
  isAdminUser,
  validateAdminPermission,
  postExists,
  commentExists,
  canDeleteComment
};