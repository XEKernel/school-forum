const {
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { readConfig, addAdmin, removeAdmin, updateConfig } = require('../utils/configUtils');
const logger = require('../utils/logger');
const { getAdminUsers } = require('../config/constants');

const configController = {
  // 获取配置
  getConfig(req, res) {
    try {
      const config = readConfig();
      
      // 返回配置（不包含敏感信息）
      const safeConfig = {
        adminUsers: config.adminUsers,
        upload: config.upload,
        pagination: config.pagination,
        contentLimits: config.contentLimits,
        schools: config.schools || [],
        security: config.security || {}
      };
      
      logger.logInfo('管理员获取配置', { adminId: req.query.adminId, ip: req.ip });
      
      res.json(generateSuccessResponse({ config: safeConfig }));
    } catch (error) {
      logger.logError('获取配置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取学校配置（公开API）
  getSchools(req, res) {
    try {
      const config = readConfig();
      const schools = config.schools || [];
      
      res.json(generateSuccessResponse({ schools }));
    } catch (error) {
      logger.logError('获取学校配置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取公开配置（无需管理员权限）
  getPublicConfig(req, res) {
    try {
      const config = readConfig();
      
      // 只返回前端需要的非敏感配置
      const publicConfig = {
        contentLimits: config.contentLimits,
        upload: {
          maxFiles: config.upload?.maxFiles,
          maxFileSize: config.upload?.maxFileSize,
          allowedTypes: config.upload?.allowedTypes
        }
      };
      
      res.json(generateSuccessResponse({ config: publicConfig }));
    } catch (error) {
      logger.logError('获取公开配置失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新配置
  updateConfig(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { updates } = req.body;

      if (!updates || typeof updates !== 'object') {
        return res.status(400).json(generateErrorResponse('配置更新数据无效'));
      }

      logger.logSecurityEvent('管理员更新配置', { adminId, updates, ip: req.ip });

      const success = updateConfig(updates);
      
      if (success) {
        logger.logSystemEvent('配置已更新', { adminId });
        res.json(generateSuccessResponse({}, '配置已更新'));
      } else {
        res.status(500).json(generateErrorResponse('更新配置失败'));
      }
    } catch (error) {
      logger.logError('更新配置失败', { error: error.message, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 添加管理员
  async addAdmin(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { newAdminId } = req.body;

      if (!newAdminId) {
        return res.status(400).json(generateErrorResponse('新管理员ID不能为空'));
      }

      // 目标必须是已注册用户（可用用户ID或QQ号指定）：
      // 权限来源已改为 role + UUID 白名单，不再对「尚未注册的 QQ」预授权 ——
      // 否则任何人先改绑该 QQ 即可拿到后台权限，正是本次修复关闭的纳新窗口期。
      const User = require('../models/User');
      const target = await User.findOne({ $or: [{ id: newAdminId }, { qq: newAdminId }] })
        .select('id username qq role').lean();
      if (!target) {
        return res.status(400).json(generateErrorResponse(
          '该账号尚未注册，无法授予管理员权限（请让对方先注册，再用其用户ID添加）'
        ));
      }

      logger.logSecurityEvent('管理员添加管理员', { adminId, newAdminId, targetUserId: target.id, ip: req.ip });

      // 授予角色（管理员判定的主要来源）
      if (target.role !== 'admin') {
        await User.updateOne({ id: target.id }, { $set: { role: 'admin' } });
      }
      // 白名单同步为 UUID（后台管理员列表展示读取的是 config.adminUsers）
      const added = addAdmin(target.id);

      logger.logSystemEvent('管理员已添加', { adminId, targetUserId: target.id });
      res.json(generateSuccessResponse({
        newAdminId: target.id,
        username: target.username,
        alreadyAdmin: !added
      }, added ? '管理员已添加' : '该用户已是管理员'));
    } catch (error) {
      logger.logError('添加管理员失败', { error: error.message, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 删除管理员
  async removeAdmin(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { targetAdminId } = req.body;

      if (!targetAdminId) {
        return res.status(400).json(generateErrorResponse('目标管理员ID不能为空'));
      }

      // 确保不能删除自己
      if (adminId === targetAdminId) {
        return res.status(400).json(generateErrorResponse('不能删除自己'));
      }

      logger.logSecurityEvent('管理员删除管理员', { adminId, targetAdminId, ip: req.ip });

      // 目标用户（白名单条目可能是 UUID，也可能是遗留的 QQ）
      const User = require('../models/User');
      const target = await User.findOne({ $or: [{ id: targetAdminId }, { qq: targetAdminId }] })
        .select('id role').lean();

      let success = removeAdmin(targetAdminId);
      if (!success && target) {
        success = removeAdmin(target.id);
      }

      if (success) {
        // 真正撤销权限：role 是主要判据，仅把条目移出白名单并不足以撤权
        if (target && target.role === 'admin') {
          await User.updateOne({ id: target.id }, { $set: { role: 'user' } });
        }
        logger.logSystemEvent('管理员已删除', { adminId, targetAdminId, targetUserId: target?.id });
        res.json(generateSuccessResponse({ targetAdminId }, '管理员已删除'));
      } else if (getAdminUsers().length <= 1) {
        // 先检查是否是唯一管理员，避免误报"管理员不存在"
        const admins = getAdminUsers();
        const exists = admins.some(a => a === targetAdminId) || !!target;
        if (exists) {
          res.status(400).json(generateErrorResponse('不能删除最后一个管理员'));
        } else {
          res.status(404).json(generateErrorResponse('管理员不存在'));
        }
      } else {
        res.status(404).json(generateErrorResponse('管理员不存在'));
      }
    } catch (error) {
      logger.logError('删除管理员失败', { error: error.message, adminId: req.admin?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取管理员列表
  async getAdmins(req, res) {
    try {
      const config = readConfig();
      const User = require('../models/User');
      const adminIds = config.adminUsers || [];

      // 批量查询管理员用户信息（替代 getUsers() 全量加载）
      const users = adminIds.length > 0
        ? await User.find({ $or: [{ id: { $in: adminIds } }, { qq: { $in: adminIds } }] }).lean()
        : [];
      const userMap = {};
      users.forEach(u => {
        userMap[u.id] = u;
        if (u.qq) userMap[u.qq] = u;
      });

      // 获取管理员详细信息
      const admins = adminIds.map(adminId => {
        const user = userMap[adminId];
        return {
          id: adminId,
          username: user?.username || adminId,
          qq: user?.qq || null,
          createdAt: user?.createdAt || null
        };
      });
      
      logger.logInfo('管理员获取管理员列表', { adminId: req.query.adminId, count: admins.length, ip: req.ip });
      
      res.json(generateSuccessResponse({ admins }));
    } catch (error) {
      logger.logError('获取管理员列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = configController;