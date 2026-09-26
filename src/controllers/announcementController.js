const Announcement = require('../models/Announcement');
const logger = require('../utils/logger');

/**
 * 公告控制器
 * 处理公告的增删改查操作
 */

// 获取所有公告（管理员）
exports.getAllAnnouncements = async (req, res) => {
  try {
    const { page = 1, limit = 20, isActive } = req.query;
    
    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;
    
    const [announcements, total] = await Promise.all([
      Announcement.find(query)
        .sort({ isPinned: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Announcement.countDocuments(query)
    ]);
    
    // 获取创建者用户名
    const { getUserById } = require('../utils/dataUtils');
    const announcementsWithCreator = await Promise.all(announcements.map(async (a) => {
      const announcementObj = a.toObject();
      try {
        const user = await getUserById(a.createdBy);
        announcementObj.createdBy = user ? { username: user.username } : { username: '未知' };
      } catch (e) {
        announcementObj.createdBy = { username: '未知' };
      }
      return announcementObj;
    }));
    
    res.json({
      success: true,
      announcements: announcementsWithCreator,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.logError('获取公告列表失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取公告列表失败'
    });
  }
};

// 获取有效公告（公开接口，用户端）
exports.getActiveAnnouncements = async (req, res) => {
  try {
    const { position } = req.query;
    
    const now = new Date();
    
    const query = {
      isActive: true,
      $or: [
        { startTime: null },
        { startTime: { $lte: now } }
      ]
    };
    
    // 添加结束时间条件
    query.$and = [
      {
        $or: [
          { endTime: null },
          { endTime: { $gte: now } }
        ]
      }
    ];
    
    if (position) {
      query.displayPosition = position;
    }
    
    const announcements = await Announcement.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(10); // 最多返回10条
    
    // 获取创建者用户名
    const { getUserById } = require('../utils/dataUtils');
    const announcementsWithCreator = await Promise.all(announcements.map(async (a) => {
      const announcementObj = a.toObject();
      try {
        const user = await getUserById(a.createdBy);
        announcementObj.createdBy = user ? { username: user.username } : { username: '未知' };
      } catch (e) {
        announcementObj.createdBy = { username: '未知' };
      }
      return announcementObj;
    }));
    
    res.json({
      success: true,
      announcements: announcementsWithCreator
    });
  } catch (error) {
    logger.logError('获取有效公告失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取公告失败'
    });
  }
};

// 获取单个公告详情
exports.getAnnouncementById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const announcement = await Announcement.findById(id);
    
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: '公告不存在'
      });
    }
    
    // 增加浏览次数（防刷：同一 IP 30 秒内只计一次；Redis 不可用时直接计）
    try {
      const { getRedisClient } = require('../utils/redisUtils');
      const redis = getRedisClient();
      const viewKey = `announcement:view:${id}:${req.ip}`;
      const firstView = await redis.set(viewKey, '1', 'EX', 30, 'NX');
      if (firstView) {
        announcement.viewCount += 1;
        await announcement.save();
      }
    } catch (e) {
      announcement.viewCount += 1;
      await announcement.save();
    }
    
    // 获取创建者用户名
    const { getUserById } = require('../utils/dataUtils');
    const announcementObj = announcement.toObject();
    try {
      const user = await getUserById(announcement.createdBy);
      announcementObj.createdBy = user ? { username: user.username } : { username: '未知' };
    } catch (e) {
      announcementObj.createdBy = { username: '未知' };
    }
    
    res.json({
      success: true,
      announcement: announcementObj
    });
  } catch (error) {
    logger.logError('获取公告详情失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取公告详情失败'
    });
  }
};

// 创建公告（管理员）
exports.createAnnouncement = async (req, res) => {
  try {
    const {
      title,
      content,
      type = 'info',
      isActive = true,
      isPinned = false,
      displayPosition = 'top',
      startTime,
      endTime
    } = req.body;
    
    logger.logInfo('创建公告请求:', { title, type, displayPosition, isActive, isPinned });
    
    // 验证必填字段
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: '公告标题和内容不能为空'
      });
    }
    
    // 获取管理员ID - 来自 JWT 认证中间件（req.admin 由 requireAdmin 设置）
    const createdBy = req.admin?.id;
    
    logger.logInfo('创建者ID:', { createdBy });
    
    if (!createdBy) {
      return res.status(401).json({
        success: false,
        message: '需要管理员权限'
      });
    }
    
    const announcementData = {
      title,
      content,
      type,
      isActive,
      isPinned,
      displayPosition,
      createdBy
    };
    
    // 只有在有时间值时才添加时间字段
    if (startTime) {
      announcementData.startTime = new Date(startTime);
    }
    if (endTime) {
      announcementData.endTime = new Date(endTime);
    }
    
    logger.logInfo('准备创建公告:', announcementData);
    
    const announcement = new Announcement(announcementData);
    
    const savedAnnouncement = await announcement.save();
    
    logger.logInfo(`公告已创建: ${title} (ID: ${savedAnnouncement._id})`);
    
    res.status(201).json({
      success: true,
      message: '公告创建成功',
      announcement: savedAnnouncement
    });
  } catch (error) {
    logger.logError('创建公告失败:', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: '创建公告失败: ' + error.message
    });
  }
};

// 更新公告（管理员）
exports.updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      content,
      type,
      isActive,
      isPinned,
      displayPosition,
      startTime,
      endTime
    } = req.body;
    
    const announcement = await Announcement.findById(id);
    
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: '公告不存在'
      });
    }
    
    // 更新字段
    if (title !== undefined) announcement.title = title;
    if (content !== undefined) announcement.content = content;
    if (type !== undefined) announcement.type = type;
    if (isActive !== undefined) announcement.isActive = isActive;
    if (isPinned !== undefined) announcement.isPinned = isPinned;
    if (displayPosition !== undefined) announcement.displayPosition = displayPosition;
    if (startTime !== undefined) announcement.startTime = startTime ? new Date(startTime) : undefined;
    if (endTime !== undefined) announcement.endTime = endTime ? new Date(endTime) : undefined;
    
    await announcement.save();
    
    logger.logInfo(`公告已更新: ${announcement.title} (ID: ${id})`);
    
    res.json({
      success: true,
      message: '公告更新成功',
      announcement
    });
  } catch (error) {
    logger.logError('更新公告失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '更新公告失败'
    });
  }
};

// 删除公告（管理员）
exports.deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    
    const announcement = await Announcement.findByIdAndDelete(id);
    
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: '公告不存在'
      });
    }
    
    logger.logInfo(`公告已删除: ${announcement.title} (ID: ${id})`);
    
    res.json({
      success: true,
      message: '公告删除成功'
    });
  } catch (error) {
    logger.logError('删除公告失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '删除公告失败'
    });
  }
};

// 批量更新公告状态（管理员）
exports.batchUpdateStatus = async (req, res) => {
  try {
    const { ids, isActive } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的公告ID列表'
      });
    }
    
    await Announcement.updateMany(
      { _id: { $in: ids } },
      { isActive }
    );
    
    logger.logInfo(`批量更新公告状态: ${ids.length} 条公告 -> ${isActive ? '启用' : '禁用'}`);
    
    res.json({
      success: true,
      message: `已${isActive ? '启用' : '禁用'} ${ids.length} 条公告`
    });
  } catch (error) {
    logger.logError('批量更新公告状态失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '批量更新失败'
    });
  }
};

// 切换公告启用状态（管理员）
exports.toggleAnnouncementStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const announcement = await Announcement.findById(id);
    
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: '公告不存在'
      });
    }
    
    announcement.isActive = !announcement.isActive;
    await announcement.save();
    
    logger.logInfo(`公告状态已切换: ${announcement.title} -> ${announcement.isActive ? '启用' : '禁用'}`);
    
    res.json({
      success: true,
      message: `公告已${announcement.isActive ? '启用' : '禁用'}`,
      isActive: announcement.isActive
    });
  } catch (error) {
    logger.logError('切换公告状态失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '切换公告状态失败'
    });
  }
};

// 切换公告置顶状态（管理员）
exports.toggleAnnouncementPinned = async (req, res) => {
  try {
    const { id } = req.params;
    
    const announcement = await Announcement.findById(id);
    
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: '公告不存在'
      });
    }
    
    announcement.isPinned = !announcement.isPinned;
    await announcement.save();
    
    logger.logInfo(`公告置顶状态已切换: ${announcement.title} -> ${announcement.isPinned ? '置顶' : '取消置顶'}`);
    
    res.json({
      success: true,
      message: `公告已${announcement.isPinned ? '置顶' : '取消置顶'}`,
      isPinned: announcement.isPinned
    });
  } catch (error) {
    logger.logError('切换公告置顶状态失败:', { error: error.message });
    res.status(500).json({
      success: false,
      message: '切换置顶状态失败'
    });
  }
};