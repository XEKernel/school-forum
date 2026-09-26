const { v4: uuidv4 } = require('uuid');
const Category = require('../models/Category');
const CategoryApplication = require('../models/CategoryApplication');
const { Post } = require('../models');
const { getUserById } = require('../utils/dataUtils');
const { generateSuccessResponse, generateErrorResponse } = require('../utils/validationUtils');
const logger = require('../utils/logger');

// ============ 公开接口 ============

// 获取所有已启用栏目
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.getActiveCategories();
    res.json(generateSuccessResponse({ categories }));
  } catch (error) {
    logger.logError('获取栏目列表失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('获取栏目列表失败'));
  }
};

// 获取单个栏目
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.getById(req.params.id);
    if (!category || !category.isActive) {
      return res.status(404).json(generateErrorResponse('栏目不存在'));
    }
    res.json(generateSuccessResponse({ category }));
  } catch (error) {
    logger.logError('获取栏目详情失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('获取栏目详情失败'));
  }
};

// 获取某栏目的帖子（支持分页）
exports.getCategoryPosts = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, sortBy = 'latest' } = req.query;
    // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]，防止超大 limit 拖垮查询
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;
    // 查看者身份必须来自认证中间件（optionalAuth），绝不信任客户端 query 参数
    const viewerId = req.user?.id || null;

    // 检查栏目是否存在
    const category = await Category.getById(id);
    if (!category || !category.isActive) {
      return res.status(404).json(generateErrorResponse('栏目不存在'));
    }

    // 查询该栏目的帖子
    const query = {
      isDeleted: false,
      categoryId: id
    };

    let sort = { timestamp: -1 };
    if (sortBy === 'hot') {
      sort = { likes: -1, timestamp: -1 };
    }

    const posts = await Post.find(query).sort(sort).skip(skip).limit(limitNum);

    // 可见性过滤：self 仅作者可见，followers 仅作者与粉丝可见，public 所有人可见
    let visiblePosts = posts;
    if (viewerId) {
      const Follow = require('../models/Follow');
      const visibleIds = [];
      for (const post of posts) {
        const visibility = post.visibility || 'public';
        if (visibility === 'public' || post.userId === viewerId) {
          visibleIds.push(post);
        } else if (visibility === 'followers') {
          const isFollowing = await Follow.isFollowing(viewerId, post.userId);
          if (isFollowing) visibleIds.push(post);
        }
      }
      visiblePosts = visibleIds;
    } else {
      // 未登录用户只能看到公开帖子
      visiblePosts = posts.filter(post => (post.visibility || 'public') === 'public');
    }

    const total = await Post.countDocuments(query);

    res.json(generateSuccessResponse({
      posts: visiblePosts,
      category: {
        id: category.id,
        name: category.name,
        description: category.description,
        icon: category.icon,
        color: category.color
      },
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }));
  } catch (error) {
    logger.logError('获取栏目帖子失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('获取栏目帖子失败'));
  }
};

// ============ 用户申请 ============

// 申请新建栏目
exports.createApplication = async (req, res) => {
  try {
    const { categoryName, description } = req.body;
    const userId = req.user.id;

    if (!categoryName || categoryName.trim().length === 0) {
      return res.status(400).json(generateErrorResponse('请输入栏目名称'));
    }

    if (categoryName.trim().length > 30) {
      return res.status(400).json(generateErrorResponse('栏目名称不能超过30个字符'));
    }

    if (description && description.length > 500) {
      return res.status(400).json(generateErrorResponse('申请理由不能超过500个字符'));
    }

    // 检查是否有待审核的申请
    const existing = await CategoryApplication.findOne({
      applicantId: userId,
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json(generateErrorResponse('您有待审核的申请，请等待处理'));
    }

    // 检查栏目名是否已存在
    const nameExists = await Category.findOne({ name: categoryName.trim() });
    if (nameExists) {
      return res.status(400).json(generateErrorResponse('该栏目名称已存在'));
    }

    const user = await getUserById(userId);

    const application = await CategoryApplication.create({
      id: uuidv4(),
      categoryName: categoryName.trim(),
      description: description || '',
      applicantId: userId,
      applicantUsername: user ? user.username : '未知',
      status: 'pending'
    });

    logger.logInfo('用户申请新建栏目', {
      applicantId: userId,
      categoryName,
      applicationId: application.id
    });

    res.json(generateSuccessResponse({ application }, '申请已提交，请等待管理员审核'));
  } catch (error) {
    logger.logError('申请栏目失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('申请提交失败'));
  }
};

// ============ 管理员接口 ============

// 获取所有栏目（含禁用的）
exports.getAllCategories = async (req, res) => {
  try {
    const { page = 1, limit = 50, isActive } = req.query;

    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [categories, total] = await Promise.all([
      Category.find(query).sort({ order: 1, createdAt: 1 }).skip(skip).limit(limitNum),
      Category.countDocuments(query)
    ]);

    res.json(generateSuccessResponse({
      categories,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }));
  } catch (error) {
    logger.logError('管理员获取栏目列表失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('获取栏目列表失败'));
  }
};

// 创建栏目
exports.createCategory = async (req, res) => {
  try {
    const { name, description, icon, color, order } = req.body;
    const adminId = req.admin.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json(generateErrorResponse('请输入栏目名称'));
    }

    // 检查是否重名
    const exists = await Category.findOne({ name: name.trim() });
    if (exists) {
      return res.status(400).json(generateErrorResponse('该栏目名称已存在'));
    }

    const category = await Category.create({
      id: uuidv4(),
      name: name.trim(),
      description: description || '',
      icon: icon || 'fa-folder',
      color: color || '#4361ee',
      order: parseInt(order) || 0,
      createdBy: adminId
    });

    logger.logInfo('管理员创建栏目', { adminId, categoryId: category.id, name });

    res.json(generateSuccessResponse({ category }, '栏目创建成功'));
  } catch (error) {
    logger.logError('创建栏目失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('创建栏目失败'));
  }
};

// 更新栏目
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, color, order, isActive } = req.body;

    const category = await Category.findOne({ id });
    if (!category) {
      return res.status(404).json(generateErrorResponse('栏目不存在'));
    }

    if (name !== undefined) category.name = name.trim();
    if (description !== undefined) category.description = description;
    if (icon !== undefined) category.icon = icon;
    if (color !== undefined) category.color = color;
    if (order !== undefined) category.order = parseInt(order);
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();

    logger.logInfo('管理员更新栏目', { categoryId: id, updatedBy: req.admin.id });

    res.json(generateSuccessResponse({ category }, '栏目更新成功'));
  } catch (error) {
    logger.logError('更新栏目失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('更新栏目失败'));
  }
};

// 删除栏目（仅管理员）
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findOneAndDelete({ id });
    if (!category) {
      return res.status(404).json(generateErrorResponse('栏目不存在'));
    }

    // 将该栏目的帖子移至无栏目状态（不删除帖子）
    await Post.updateMany({ categoryId: id }, { $unset: { categoryId: 1 } });

    logger.logInfo('管理员删除栏目', { categoryId: id, deletedBy: req.admin.id });

    res.json(generateSuccessResponse({}, '栏目已删除'));
  } catch (error) {
    logger.logError('删除栏目失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('删除栏目失败'));
  }
};

// 切换栏目启用状态
exports.toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findOne({ id });
    if (!category) {
      return res.status(404).json(generateErrorResponse('栏目不存在'));
    }

    category.isActive = !category.isActive;
    await category.save();

    logger.logInfo('管理员切换栏目状态', {
      categoryId: id,
      newStatus: category.isActive ? '启用' : '禁用',
      adminId: req.admin.id
    });

    res.json(generateSuccessResponse({
      category: {
        id: category.id,
        name: category.name,
        isActive: category.isActive
      }
    }, category.isActive ? '栏目已启用' : '栏目已禁用'));
  } catch (error) {
    logger.logError('切换栏目状态失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('操作失败'));
  }
};

// 获取所有申请（含已处理的）
exports.getAllApplications = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [applications, total] = await Promise.all([
      CategoryApplication.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      CategoryApplication.countDocuments(query)
    ]);

    res.json(generateSuccessResponse({
      applications,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }));
  } catch (error) {
    logger.logError('获取申请列表失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('获取申请列表失败'));
  }
};

// 批准栏目申请（同时创建栏目）
exports.approveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;
    const adminId = req.admin.id;

    const application = await CategoryApplication.findOne({ id });
    if (!application) {
      return res.status(404).json(generateErrorResponse('申请不存在'));
    }

    if (application.status !== 'pending') {
      return res.status(400).json(generateErrorResponse('该申请已处理'));
    }

    // 检查栏目名是否已被占用
    const nameExists = await Category.findOne({ name: application.categoryName });
    if (nameExists) {
      application.status = 'rejected';
      application.reviewedBy = adminId;
      application.reviewedAt = new Date();
      application.reviewNote = '栏目名称已被其他栏目占用';
      await application.save();
      return res.status(400).json(generateErrorResponse('栏目名称已被其他栏目占用'));
    }

    // 创建栏目
    const category = await Category.create({
      id: uuidv4(),
      name: application.categoryName,
      description: application.description,
      createdBy: adminId
    });

    // 更新申请状态
    application.status = 'approved';
    application.reviewedBy = adminId;
    application.reviewedAt = new Date();
    application.reviewNote = reviewNote || '';
    await application.save();

    logger.logInfo('管理员批准栏目申请', {
      applicationId: id,
      categoryId: category.id,
      adminId,
      categoryName: application.categoryName
    });

    res.json(generateSuccessResponse({
      category,
      application
    }, `栏目「${application.categoryName}」创建成功`));
  } catch (error) {
    logger.logError('批准申请失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('批准申请失败'));
  }
};

// 拒绝栏目申请
exports.rejectApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;
    const adminId = req.admin.id;

    const application = await CategoryApplication.findOne({ id });
    if (!application) {
      return res.status(404).json(generateErrorResponse('申请不存在'));
    }

    if (application.status !== 'pending') {
      return res.status(400).json(generateErrorResponse('该申请已处理'));
    }

    application.status = 'rejected';
    application.reviewedBy = adminId;
    application.reviewedAt = new Date();
    application.reviewNote = reviewNote || '';
    await application.save();

    logger.logInfo('管理员拒绝栏目申请', {
      applicationId: id,
      adminId,
      categoryName: application.categoryName
    });

    res.json(generateSuccessResponse({ application }, '已拒绝该申请'));
  } catch (error) {
    logger.logError('拒绝申请失败:', { error: error.message });
    res.status(500).json(generateErrorResponse('拒绝申请失败'));
  }
};
