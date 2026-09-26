const {
  getRunMode,
  setRunMode,
  RUN_MODES,
  SELF_DESTRUCT_LEVELS
} = require('../utils/configUtils');
const {
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
const { comparePassword } = require('../utils/authUtils');

// 导入模型
const Post = require('../models/Post');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const Favorite = require('../models/Favorite');
const Follow = require('../models/Follow');

// ==================== 自毁模式二次校验与备份 ====================
// 背景（审查报告 🟡32）：确认串硬编码在源码里、单一因素即可执行不可逆的
// 全库/全站删除；一旦管理员令牌泄漏（或经 XSS 借到会话）就能把库清空，
// 且没有任何自动备份。这里补两点：
//   1) 必须重输管理员登录密码（服务端用同一套 bcrypt 校验）
//   2) 破坏性操作前先落一份 JSON 快照，并把路径写进审计日志与响应

// 快照目录放在用户主目录而非项目内：一级自毁会删除项目里的 data/，
// 放在项目内等于把备份和现场一起销毁。
const BACKUP_DIR = path.join(os.homedir(), 'school-forum-backups');
// 单集合导出上限（避免超大集合把内存吃满；超出部分会被截断并记录）
const BACKUP_MAX_DOCS_PER_COLLECTION = 50000;

async function verifyAdminPassword(adminId, password) {
  if (!password || typeof password !== 'string') return false;
  const user = await User.findOne({ id: adminId }).lean();
  if (!user || !user.password) return false;
  try {
    return await comparePassword(password, user.password);
  } catch (error) {
    logger.logError('自毁模式：管理员密码校验异常', { error: error.message, adminId });
    return false;
  }
}

/**
 * 导出指定集合的快照（供自毁前备份；也可由运维手动调用）
 * @param {string[]} collectionNames - 要导出的集合名
 * @param {string} label - 文件名标签（如 level3）
 * @returns {Promise<{file:string, counts:object, truncated:string[]}>}
 */
async function createBackupSnapshot(collectionNames, label = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const db = mongoose.connection.db;
  const snapshot = { createdAt: new Date().toISOString(), label, collections: {} };
  const counts = {};
  const truncated = [];

  for (const name of collectionNames) {
    try {
      const docs = await db.collection(name)
        .find({})
        .limit(BACKUP_MAX_DOCS_PER_COLLECTION)
        .toArray();
      snapshot.collections[name] = docs;
      counts[name] = docs.length;
      const total = await db.collection(name).estimatedDocumentCount();
      if (total > docs.length) truncated.push(`${name}(${docs.length}/${total})`);
    } catch (error) {
      logger.logError('自毁模式：导出集合失败', { collection: name, error: error.message });
      counts[name] = 0;
    }
  }

  const file = path.join(BACKUP_DIR, `self-destruct-${label}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot), 'utf8');
  logger.logSecurityEvent('自毁模式：已生成数据快照', { file, counts, truncated });
  return { file, counts, truncated };
}

// 二级自毁会 drop 所有集合，快照前先列出当前集合名
async function listAllCollectionNames() {
  const collections = await mongoose.connection.db.listCollections().toArray();
  return collections.map(c => c.name);
}

const runModeController = {
  /**
   * 获取当前运行模式
   */
  async getMode(req, res) {
    try {
      const runMode = getRunMode();
      
      res.json(generateSuccessResponse({
        mode: runMode.current,
        maintenanceMessage: runMode.maintenanceMessage,
        selfDestructLevel: runMode.selfDestructLevel,
        lastModeChange: runMode.lastModeChange,
        changedBy: runMode.changedBy
      }));
    } catch (error) {
      logger.logError('获取运行模式失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 设置运行模式
   */
  async setMode(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { mode, maintenanceMessage } = req.body;
      
      if (!mode || !Object.values(RUN_MODES).includes(mode)) {
        return res.status(400).json(generateErrorResponse('无效的运行模式'));
      }
      
      // 不允许直接设置自毁模式，需要通过专门的接口
      if (mode === RUN_MODES.SELF_DESTRUCT) {
        return res.status(400).json(generateErrorResponse('请使用自毁模式专用接口'));
      }
      
      const options = {};
      if (maintenanceMessage && mode === RUN_MODES.MAINTENANCE) {
        options.maintenanceMessage = maintenanceMessage;
      }
      
      const success = setRunMode(mode, adminId, options);
      
      if (success) {
        logger.logSecurityEvent('运行模式变更', {
          adminId,
          newMode: mode,
          previousMode: getRunMode().current,
          ip: req.ip
        });
        
        res.json(generateSuccessResponse({
          mode,
          maintenanceMessage: options.maintenanceMessage
        }, `已切换到${mode === RUN_MODES.NORMAL ? '正常' : mode === RUN_MODES.DEBUG ? '调试' : '维护'}模式`));
      } else {
        res.status(500).json(generateErrorResponse('设置运行模式失败'));
      }
    } catch (error) {
      logger.logError('设置运行模式失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  /**
   * 获取维护模式消息
   */
  async getMaintenanceMessage(req, res) {
    try {
      const runMode = getRunMode();
      
      res.json(generateSuccessResponse({
        message: runMode.maintenanceMessage
      }));
    } catch (error) {
      res.json(generateSuccessResponse({
        message: '网站正在维护中，请稍后再试'
      }));
    }
  },

  /**
   * 自毁模式 - 三级：删除所有帖子、评论、私信
   */
  async selfDestructLevel3(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { confirmation, password } = req.body;

      // 验证确认字符串
      if (confirmation !== '确认删除所有内容') {
        return res.status(400).json(generateErrorResponse('确认字符串不正确'));
      }

      // 二次因子：必须重输本人登录密码（确认串在源码里公开，不能作为唯一凭据）
      if (!password) {
        return res.status(400).json(generateErrorResponse('请输入管理员密码以确认操作'));
      }
      if (!(await verifyAdminPassword(adminId, password))) {
        logger.logSecurityEvent('自毁模式三级：密码校验失败', { adminId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('管理员密码错误'));
      }

      logger.logSecurityEvent('自毁模式三级执行开始', {
        adminId,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      // 先落快照再删（误操作后至少有取证/恢复线索）
      const backup = await createBackupSnapshot(
        ['posts', 'messages', 'conversations', 'notifications', 'reports', 'favorites', 'follows'],
        'level3'
      );

      // 删除所有帖子
      const postsResult = await Post.deleteMany({});
      logger.logInfo('自毁三级：帖子删除完成', { count: postsResult.deletedCount });
      
      // 删除所有私信
      const messagesResult = await Message.deleteMany({});
      logger.logInfo('自毁三级：私信删除完成', { count: messagesResult.deletedCount });
      
      // 删除所有会话
      const conversationsResult = await Conversation.deleteMany({});
      logger.logInfo('自毁三级：会话删除完成', { count: conversationsResult.deletedCount });
      
      // 删除所有通知
      const notificationsResult = await Notification.deleteMany({});
      logger.logInfo('自毁三级：通知删除完成', { count: notificationsResult.deletedCount });
      
      // 删除所有举报
      const reportsResult = await Report.deleteMany({});
      logger.logInfo('自毁三级：举报删除完成', { count: reportsResult.deletedCount });
      
      // 删除所有收藏
      const favoritesResult = await Favorite.deleteMany({});
      logger.logInfo('自毁三级：收藏删除完成', { count: favoritesResult.deletedCount });
      
      // 删除所有关注
      const followsResult = await Follow.deleteMany({});
      logger.logInfo('自毁三级：关注删除完成', { count: followsResult.deletedCount });
      
      // 重置用户的发帖数和评论数
      await User.updateMany({}, { postCount: 0, commentCount: 0 });
      
      // 设置自毁模式
      setRunMode(RUN_MODES.SELF_DESTRUCT, adminId, { selfDestructLevel: SELF_DESTRUCT_LEVELS.LEVEL_3 });
      
      logger.logSecurityEvent('自毁模式三级执行完成', {
        adminId,
        ip: req.ip,
        backupFile: backup.file,
        results: {
          posts: postsResult.deletedCount,
          messages: messagesResult.deletedCount,
          conversations: conversationsResult.deletedCount,
          notifications: notificationsResult.deletedCount,
          reports: reportsResult.deletedCount,
          favorites: favoritesResult.deletedCount,
          follows: followsResult.deletedCount
        }
      });
      
      res.json(generateSuccessResponse({
        level: 3,
        backupFile: backup.file,
        backupCounts: backup.counts,
        results: {
          posts: postsResult.deletedCount,
          messages: messagesResult.deletedCount,
          conversations: conversationsResult.deletedCount,
          notifications: notificationsResult.deletedCount,
          reports: reportsResult.deletedCount,
          favorites: favoritesResult.deletedCount,
          follows: followsResult.deletedCount
        }
      }, '自毁模式三级执行完成：已删除所有帖子、评论、私信'));
      
    } catch (error) {
      logger.logError('自毁模式三级执行失败', { error: error.message, stack: error.stack });
      res.status(500).json(generateErrorResponse('执行失败: ' + error.message, 500));
    }
  },

  /**
   * 自毁模式 - 二级：清空数据库
   */
  async selfDestructLevel2(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { confirmation, password } = req.body;

      // 验证确认字符串
      if (confirmation !== '确认清空数据库') {
        return res.status(400).json(generateErrorResponse('确认字符串不正确'));
      }

      // 二次因子（同三级）：必须重输本人登录密码
      if (!password) {
        return res.status(400).json(generateErrorResponse('请输入管理员密码以确认操作'));
      }
      if (!(await verifyAdminPassword(adminId, password))) {
        logger.logSecurityEvent('自毁模式二级：密码校验失败', { adminId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('管理员密码错误'));
      }

      logger.logSecurityEvent('自毁模式二级执行开始', {
        adminId,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      // 打开快照：drop 之前先把所有集合导出（否则清空后无可追溯数据）
      const collectionNames = await listAllCollectionNames();
      const backup = await createBackupSnapshot(collectionNames, 'level2');

      let droppedCount = 0;
      
      // 删除所有集合
      for (const name of collectionNames) {
        try {
          await mongoose.connection.db.dropCollection(name);
          droppedCount++;
          logger.logInfo('自毁二级：删除集合', { collection: name });
        } catch (err) {
          logger.logError('自毁二级：删除集合失败', { collection: name, error: err.message });
        }
      }
      
      // 设置自毁模式
      setRunMode(RUN_MODES.SELF_DESTRUCT, adminId, { selfDestructLevel: SELF_DESTRUCT_LEVELS.LEVEL_2 });
      
      logger.logSecurityEvent('自毁模式二级执行完成', {
        adminId,
        ip: req.ip,
        backupFile: backup.file,
        droppedCollections: droppedCount
      });
      
      res.json(generateSuccessResponse({
        level: 2,
        backupFile: backup.file,
        droppedCollections: droppedCount
      }, '自毁模式二级执行完成：已清空数据库'));
      
    } catch (error) {
      logger.logError('自毁模式二级执行失败', { error: error.message, stack: error.stack });
      res.status(500).json(generateErrorResponse('执行失败: ' + error.message, 500));
    }
  },

  /**
   * 自毁模式 - 一级：删除论坛文件
   */
  async selfDestructLevel1(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { confirmation, password } = req.body;

      // 验证确认字符串
      if (confirmation !== '确认销毁论坛') {
        return res.status(400).json(generateErrorResponse('确认字符串不正确'));
      }

      // 二次因子（同二/三级）：必须重输本人登录密码
      if (!password) {
        return res.status(400).json(generateErrorResponse('请输入管理员密码以确认操作'));
      }
      if (!(await verifyAdminPassword(adminId, password))) {
        logger.logSecurityEvent('自毁模式一级：密码校验失败', { adminId, ip: req.ip });
        return res.status(401).json(generateErrorResponse('管理员密码错误'));
      }

      logger.logSecurityEvent('自毁模式一级执行开始', {
        adminId,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      // 一级会删掉项目里的 src/ 与 data/，快照必须先落到主目录（BACKUP_DIR）
      const allCollections = await listAllCollectionNames();
      const backup = await createBackupSnapshot(allCollections, 'level1');
      
      const deletedFiles = [];
      const errors = [];
      
      // 获取项目根目录
      const rootDir = path.join(__dirname, '../../');
      
      // 需要删除的目录和文件（保留必要的运行文件）
      const targetsToDelete = [
        'public/images/avatars',
        'public/images',
        'public/css',
        'public/js',
        'public/libs',
        'public/errors',
        'public/*.html',
        'src',
        'data'
      ];
      
      // 递归删除目录
      function deleteRecursive(dirPath) {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
              deleteRecursive(curPath);
            } else {
              try {
                fs.unlinkSync(curPath);
                deletedFiles.push(curPath);
              } catch (err) {
                errors.push({ file: curPath, error: err.message });
              }
            }
          });
          try {
            fs.rmdirSync(dirPath);
            deletedFiles.push(dirPath);
          } catch (err) {
            errors.push({ file: dirPath, error: err.message });
          }
        }
      }
      
      // 执行删除
      for (const target of targetsToDelete) {
        const fullPath = path.join(rootDir, target);
        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.lstatSync(fullPath);
            if (stat.isDirectory()) {
              deleteRecursive(fullPath);
            } else {
              fs.unlinkSync(fullPath);
              deletedFiles.push(fullPath);
            }
          }
        } catch (err) {
          errors.push({ target, error: err.message });
        }
      }
      
      // 设置自毁模式
      setRunMode(RUN_MODES.SELF_DESTRUCT, adminId, { selfDestructLevel: SELF_DESTRUCT_LEVELS.LEVEL_1 });
      
      logger.logSecurityEvent('自毁模式一级执行完成', {
        adminId,
        ip: req.ip,
        backupFile: backup.file,
        deletedCount: deletedFiles.length,
        errors: errors.length
      });
      
      res.json(generateSuccessResponse({
        level: 1,
        backupFile: backup.file,
        deletedCount: deletedFiles.length,
        errors: errors.length,
        errorDetails: errors.slice(0, 10) // 只返回前10个错误
      }, '自毁模式一级执行完成：已删除论坛文件'));
      
    } catch (error) {
      logger.logError('自毁模式一级执行失败', { error: error.message, stack: error.stack });
      res.status(500).json(generateErrorResponse('执行失败: ' + error.message, 500));
    }
  },

  // 导出给运维：手动生成一份全库快照（不做任何删除）
  createBackupSnapshot
};

module.exports = runModeController;
