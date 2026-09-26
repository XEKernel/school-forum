const { v4: uuidv4 } = require('uuid');
const {
  getUserById,
  updateUser,
  updatePost,
  getReports,
  createReport,
  updateReportStatus,
  banUser: createBanRecord
} = require('../utils/dataUtils');
const {
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { getPaginationConfig } = require('../config/constants');
const logger = require('../utils/logger');
const notificationController = require('./notificationController');
const Post = require('../models/Post');
const User = require('../models/User');

// 举报类型
const REPORT_TYPES = {
  SPAM: '垃圾广告',
  HARASSMENT: '骚扰辱骂',
  INAPPROPRIATE: '不当内容',
  FALSE_INFO: '虚假信息',
  COPYRIGHT: '侵权内容',
  OTHER: '其他'
};

// 封禁时长映射（天数）
const BAN_DURATION_MAP = {
  SPAM: 3,
  HARASSMENT: 7,
  INAPPROPRIATE: 14,
  FALSE_INFO: 7,
  COPYRIGHT: 14,
  OTHER: 3
};

const reportController = {
  // 提交举报
  async submitReport(req, res) {
    try {
      // reporterId 来自已认证的 JWT，防止客户端伪造举报人身份
      const reporterId = req.user.id;
      const { targetType, targetId, reason, description } = req.body;

      // 验证必填字段
      if (!targetType || !targetId || !reason) {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }

      // 验证举报类型
      if (!['post', 'comment'].includes(targetType)) {
        return res.status(400).json(generateErrorResponse('无效的举报目标类型'));
      }

      // 验证举报原因
      if (!Object.keys(REPORT_TYPES).includes(reason)) {
        return res.status(400).json(generateErrorResponse('无效的举报原因'));
      }

      // 获取被举报内容信息
      const posts = await getPosts(true);
      let targetContent = null;
      let targetUserId = null;
      let targetUsername = null;
      let postId = null;
      let commentId = null;

      if (targetType === 'post') {
        const post = posts.find(p => p.id === targetId);
        if (!post) {
          return res.status(404).json(generateErrorResponse('帖子不存在'));
        }
        targetContent = post.content;
        targetUserId = post.userId;
        targetUsername = post.username;
        postId = targetId;
      } else if (targetType === 'comment') {
        // 递归查找评论或回复
        const findCommentOrReply = (comments, targetId) => {
          for (const comment of comments) {
            if (comment.id === targetId) {
              return comment;
            }
            if (comment.replies && comment.replies.length > 0) {
              const found = findCommentOrReply(comment.replies, targetId);
              if (found) return found;
            }
          }
          return null;
        };

        let foundComment = false;
        for (const post of posts) {
          if (post.comments) {
            const comment = findCommentOrReply(post.comments, targetId);
            if (comment) {
              targetContent = comment.content;
              targetUserId = comment.userId;
              targetUsername = comment.username || '匿名用户';
              postId = post.id;
              commentId = targetId;
              foundComment = true;
              break;
            }
          }
        }
        if (!foundComment) {
          return res.status(404).json(generateErrorResponse('评论不存在'));
        }
      }

      // 不能举报自己
      if (targetUserId === reporterId) {
        return res.status(400).json(generateErrorResponse('不能举报自己的内容'));
      }

      // 检查是否已举报过
      const reports = await getReports('pending');
      const existingReport = reports.find(r => 
        r.reporterId === reporterId && 
        r.targetId === targetId && 
        r.targetType === targetType
      );

      if (existingReport) {
        return res.status(400).json(generateErrorResponse('您已举报过此内容，请等待处理'));
      }

      // 创建举报记录
      const newReport = {
        id: uuidv4(),
        reporterId,
        targetType,
        targetId,
        targetUserId,
        targetUsername,
        targetContent: targetContent.substring(0, 500) + (targetContent.length > 500 ? '...' : ''),
        reason,
        reasonText: REPORT_TYPES[reason],
        description: description || '',
        postId,
        commentId,
        status: 'pending',
        createdAt: new Date(),
        processedAt: null,
        processedBy: null,
        result: null,
        banDuration: null
      };

      await createReport(newReport);

      logger.logUserAction('提交举报', reporterId, null, {
        reportId: newReport.id,
        targetType,
        targetId,
        reason: REPORT_TYPES[reason]
      });

      res.json(generateSuccessResponse({ report: newReport }, '举报已提交，我们会尽快处理'));
    } catch (error) {
      logger.logError('提交举报失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取举报列表（管理员）
  async getReportsList(req, res) {
    try {
      const paginationConfig = getPaginationConfig();
      const { page = paginationConfig.defaultPage, limit = paginationConfig.defaultLimit, status } = req.query;
      const reports = await getReports(status || null);

      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || paginationConfig.defaultPage);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || paginationConfig.defaultLimit));

      // 分页
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedReports = reports.slice(startIndex, endIndex);

      // 获取举报人信息（批量查询，替代 getUsers() 全量加载）
      const reporterIds = [...new Set(paginatedReports.map(r => r.reporterId).filter(Boolean))];
      const reporterMap = {};
      if (reporterIds.length > 0) {
        const reporters = await User.find({ id: { $in: reporterIds } }).lean();
        reporters.forEach(u => { reporterMap[u.id] = u; });
      }
      const reportsWithReporter = paginatedReports.map(report => {
        return {
          ...report,
          reporterUsername: reporterMap[report.reporterId] ? reporterMap[report.reporterId].username : '未知用户'
        };
      });

      res.json(generateSuccessResponse({
        reports: reportsWithReporter,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(reports.length / limitNum),
          totalReports: reports.length,
          hasNext: endIndex < reports.length,
          hasPrev: startIndex > 0
        }
      }));
    } catch (error) {
      logger.logError('获取举报列表失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取举报统计（管理员）
  async getReportStats(req, res) {
    try {
      const reports = await getReports();

      const stats = {
        total: reports.length,
        pending: reports.filter(r => r.status === 'pending').length,
        processed: reports.filter(r => r.status === 'processed').length,
        rejected: reports.filter(r => r.status === 'rejected').length,
        byReason: {},
        byType: {
          post: reports.filter(r => r.targetType === 'post').length,
          comment: reports.filter(r => r.targetType === 'comment').length
        }
      };

      // 按原因统计
      Object.keys(REPORT_TYPES).forEach(key => {
        stats.byReason[key] = {
          label: REPORT_TYPES[key],
          count: reports.filter(r => r.reason === key).length
        };
      });

      res.json(generateSuccessResponse({ stats }));
    } catch (error) {
      logger.logError('获取举报统计失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 处理举报（管理员）
  async processReport(req, res) {
    try {
      // adminId 来自 JWT 认证中间件（requireAdmin），不信任 req.body
      const adminId = req.admin.id;
      const { reportId } = req.params;
      const { action, banDuration, note } = req.body;

      if (!action) {
        return res.status(400).json(generateErrorResponse('缺少必要参数'));
      }

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json(generateErrorResponse('无效的处理操作'));
      }

      const reports = await getReports();
      const report = reports.find(r => r.id === reportId);

      if (!report) {
        return res.status(404).json(generateErrorResponse('举报记录不存在'));
      }

      if (report.status !== 'pending') {
        return res.status(400).json(generateErrorResponse('该举报已被处理'));
      }

      const banDays = action === 'approve' ? (banDuration || BAN_DURATION_MAP[report.reason]) : null;

      // 更新举报状态
      await updateReportStatus(reportId, {
        status: action === 'approve' ? 'processed' : 'rejected',
        processedAt: new Date(),
        processedBy: adminId,
        result: action === 'approve' ? 'violation_confirmed' : 'no_violation',
        note: note || '',
        banDuration: banDays
      });

      if (action === 'approve') {
        // 举报通过 - 封禁被举报用户
        const targetUser = await getUserById(report.targetUserId);
        
        if (targetUser) {
          const banEndTime = new Date();
          
          if (banDays === 365) {
            banEndTime.setFullYear(banEndTime.getFullYear() + 100);
          } else {
            banEndTime.setDate(banEndTime.getDate() + banDays);
          }

          // 更新用户状态
          await updateUser(report.targetUserId, {
            isActive: false,
            banStartTime: new Date().toISOString(),
            banEndTime: banEndTime.toISOString(),
            banReason: `因举报违规被封禁：${report.reasonText}`,
            bannedBy: adminId
          });

          // 记录封禁信息
          const admin = await getUserById(adminId);
          await createBanRecord({
            id: uuidv4(),
            userId: targetUser.id,
            username: targetUser.username,
            qq: targetUser.qq,
            reason: `因举报违规被封禁：${report.reasonText}`,
            bannedAt: new Date(),
            bannedBy: adminId,
            bannedByName: admin ? admin.username : '',
            banDuration: banDays,
            unbanAt: banEndTime,
            isActive: true
          });

          // 删除违规内容（updatePost/Post 已在文件顶部导入）
          if (report.targetType === 'post') {
            await updatePost(report.targetId, {
              isDeleted: true,
              deletedAt: new Date(),
              deletedBy: adminId,
              deleteReason: `举报违规：${report.reasonText}`
            });
          } else if (report.targetType === 'comment') {
            // 精确定位包含目标评论/回复的帖子（子文档点路径查询，替代 getPosts() 全量遍历）
            const posts = await Post.find({
              isDeleted: false,
              $or: [
                { 'comments.id': report.targetId },
                { 'comments.replies.id': report.targetId }
              ]
            }).lean();
            
            // 递归删除评论或回复
            const removeCommentOrReply = (comments, targetId) => {
              for (let i = 0; i < comments.length; i++) {
                if (comments[i].id === targetId) {
                  comments.splice(i, 1);
                  return true;
                }
                if (comments[i].replies && comments[i].replies.length > 0) {
                  if (removeCommentOrReply(comments[i].replies, targetId)) {
                    return true;
                  }
                }
              }
              return false;
            };

            for (const post of posts) {
              if (post.comments) {
                if (removeCommentOrReply(post.comments, report.targetId)) {
                  await updatePost(post.id, { comments: post.comments });
                  break;
                }
              }
            }
          }

          // 发送通知给被举报用户
          await notificationController.createReportResultNotification(
            report.targetUserId,
            true,
            report.reasonText,
            banDays,
            report.targetType,
            report.targetContent
          );
        }

        // 发送通知给举报人 - 举报成功
        await notificationController.createReporterResultNotification(
          report.reporterId,
          true,
          report.reasonText,
          report.targetUsername,
          banDays,
          report.targetType,
          report.targetContent
        );

        logger.logUserAction('处理举报-通过', adminId, null, {
          reportId,
          targetUserId: report.targetUserId,
          targetUsername: report.targetUsername,
          banDuration: banDays,
          reason: report.reasonText
        });
      } else {
        // 举报被驳回 - 发送通知给举报人
        await notificationController.createReporterResultNotification(
          report.reporterId,
          false,
          report.reasonText,
          report.targetUsername,
          0,
          report.targetType,
          report.targetContent,
          note
        );

        logger.logUserAction('处理举报-驳回', adminId, null, {
          reportId,
          reporterId: report.reporterId,
          reason: report.reasonText,
          note
        });
      }

      res.json(generateSuccessResponse({ report }, '举报已处理'));
    } catch (error) {
      logger.logError('处理举报失败', { error: error.message, reportId: req.params.reportId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户举报历史
  async getUserReports(req, res) {
    try {
      // 只允许查询自己的举报历史（userId 来自 JWT）
      const userId = req.user.id;
      const reports = await getReports();
      const userReports = reports.filter(r => r.reporterId === userId);

      res.json(generateSuccessResponse({ reports: userReports }));
    } catch (error) {
      logger.logError('获取用户举报历史失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取举报类型列表
  getReportTypes(req, res) {
    res.json(generateSuccessResponse({ types: REPORT_TYPES }));
  }
};

module.exports = reportController;