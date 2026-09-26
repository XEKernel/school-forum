const Favorite = require('../models/Favorite');
const FavoriteTag = require('../models/FavoriteTag');
const Post = require('../models/Post');
const User = require('../models/User');
const { getPostById } = require('../utils/dataUtils');
const { generateErrorResponse, generateSuccessResponse } = require('../utils/validationUtils');
const { favoriteCache, postCache } = require('../utils/redisUtils');
const logger = require('../utils/logger');

const favoriteController = {
  // 收藏帖子
  async addFavorite(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { tagId } = req.body;
      const postId = req.params.postId;

      if (!postId) {
        return res.status(400).json(generateErrorResponse('帖子ID不能为空'));
      }

      // 检查帖子是否存在
      const post = await getPostById(postId);
      if (!post || post.isDeleted) {
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 如果指定了标签，验证标签是否属于该用户
      if (tagId) {
        const tag = await FavoriteTag.findById(tagId);
        if (!tag || tag.userId !== userId) {
          return res.status(400).json(generateErrorResponse('标签不存在或不属于当前用户'));
        }
      }

      // 添加收藏
      const result = await Favorite.addFavorite(userId, postId, tagId || null);
      
      if (!result.success) {
        return res.status(400).json(generateErrorResponse(result.message));
      }

      // 增加Redis中的收藏计数（incr 会返回新值；Redis 不可用时返回 null）
      const cachedCount = await favoriteCache.incrPostFavoriteCount(postId);

      // 校准分支必须可达：incr 之后 get 一般非 null，旧写法让这段永远不会执行，
      // 计数一旦漂移就没有任何回填路径。这里改为「Redis 不可用 或 计数异常(<=0)」时
      // 以数据库为准重算并回填缓存。
      let favoriteCount = cachedCount;
      if (favoriteCount === null || favoriteCount <= 0) {
        favoriteCount = await Favorite.getFavoriteCount(postId);
        await favoriteCache.setPostFavoriteCount(postId, favoriteCount);
      }

      logger.logUserAction('收藏帖子', userId, '', { postId, tagId });

      res.json(generateSuccessResponse({ favorited: true, favorite: result.favorite, favoriteCount }, '收藏成功'));
    } catch (error) {
      logger.logError('收藏帖子失败', { error: error.message, postId: req.params.postId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 取消收藏
  async removeFavorite(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const postId = req.params.postId;

      const removed = await Favorite.removeFavorite(userId, postId);
      
      if (!removed) {
        return res.status(400).json(generateErrorResponse('未收藏该帖子'));
      }

      // 减少Redis中的收藏计数
      const cachedCount = await favoriteCache.decrPostFavoriteCount(postId);

      // 同上：计数为负说明缓存与库已经不一致，以数据库为准回填
      let favoriteCount = cachedCount;
      if (favoriteCount === null || favoriteCount < 0) {
        favoriteCount = await Favorite.getFavoriteCount(postId);
        await favoriteCache.setPostFavoriteCount(postId, favoriteCount);
      }

      logger.logUserAction('取消收藏', userId, '', { postId });

      res.json(generateSuccessResponse({ favorited: false, favoriteCount }, '取消收藏成功'));
    } catch (error) {
      logger.logError('取消收藏失败', { error: error.message, postId: req.params.postId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 检查是否已收藏
  async checkFavorite(req, res) {
    try {
      // 身份只认 JWT：此前从 query 取 userId，未登录也能查任意用户的收藏关系（关系枚举）
      const userId = req.user.id;
      const postId = req.params.postId;

      const favorite = await Favorite.findOne({ userId, postId });
      
      // 优先从Redis缓存获取收藏数
      let favoriteCount = await favoriteCache.getPostFavoriteCount(postId);
      if (favoriteCount === null) {
        favoriteCount = await Favorite.getFavoriteCount(postId);
        await favoriteCache.setPostFavoriteCount(postId, favoriteCount);
      }

      res.json(generateSuccessResponse({ 
        favorited: !!favorite, 
        favoriteCount,
        tagId: favorite ? favorite.tagId : null
      }));
    } catch (error) {
      logger.logError('检查收藏状态失败', { error: error.message, postId: req.params.postId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户收藏列表
  async getUserFavorites(req, res) {
    try {
      const userId = req.params.userId;
      const { page = 1, limit = 10, tagId } = req.query;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 分页钳制（与 postController 一致）：page ≥ 1，limit ∈ [1,100]
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

      // 归属校验（2026-08-10 渗透测试修复：IDOR）——只能查看自己或管理员查看任意用户
      const viewer = await User.findOne({ id: req.user.id }).select('isAdmin').lean();
      if (req.user.id !== userId && !(viewer && viewer.isAdmin)) {
        return res.status(403).json(generateErrorResponse('无权查看该用户的收藏'));
      }

      // 获取用户的收藏记录（按收藏时间倒序）
      const favorites = await Favorite.getUserFavorites(userId, tagId || null);
      const favPostIds = favorites.map(f => f.postId);

      // 批量查询被收藏的帖子与作者（避免 getPosts()+getUsers() 全量加载）
      const postMap = {};
      const userMap = {};
      if (favPostIds.length > 0) {
        const foundPosts = await Post.find({ id: { $in: favPostIds } }).lean();
        foundPosts.forEach(p => { postMap[p.id] = p; });
        const authorIds = [...new Set(foundPosts.map(p => p.userId).filter(Boolean))];
        if (authorIds.length > 0) {
          const authors = await User.find({ id: { $in: authorIds } }).lean();
          authors.forEach(u => { userMap[u.id] = u; });
        }
      }

      const favoritePosts = favorites
        .map(fav => {
          const post = postMap[fav.postId];

          // 帖子已被删除
          if (!post || post.isDeleted) {
            return {
              id: fav.postId,
              isDeleted: true,
              favoriteAt: fav.createdAt,
              tagId: fav.tagId
            };
          }

          const user = userMap[post.userId];
          return {
            ...post,
            isDeleted: false,
            userAvatar: user && user.avatar ? user.avatar : null,
            favoriteAt: fav.createdAt,
            tagId: fav.tagId
          };
        });

      // 分页
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedPosts = favoritePosts.slice(startIndex, endIndex);

      res.json(generateSuccessResponse({
        posts: paginatedPosts,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(favoritePosts.length / limitNum),
          totalPosts: favoritePosts.length,
          hasNext: endIndex < favoritePosts.length,
          hasPrev: startIndex > 0
        }
      }));
    } catch (error) {
      logger.logError('获取收藏列表失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取用户收藏数量
  async getFavoriteCount(req, res) {
    try {
      const userId = req.params.userId;
      
      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 归属校验（2026-08-10 渗透测试修复：IDOR）
      const viewer = await User.findOne({ id: req.user.id }).select('isAdmin').lean();
      if (req.user.id !== userId && !(viewer && viewer.isAdmin)) {
        return res.status(403).json(generateErrorResponse('无权查看该用户的收藏'));
      }

      const count = await Favorite.countDocuments({ userId });
      
      res.json(generateSuccessResponse({ count }));
    } catch (error) {
      logger.logError('获取收藏数量失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新收藏的标签
  async updateFavoriteTag(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { tagId } = req.body;
      const postId = req.params.postId;

      // 如果指定了标签，验证标签是否属于该用户
      if (tagId) {
        const tag = await FavoriteTag.findById(tagId);
        if (!tag || tag.userId !== userId) {
          return res.status(400).json(generateErrorResponse('标签不存在或不属于当前用户'));
        }
      }

      const result = await Favorite.updateFavoriteTag(userId, postId, tagId || null);
      
      if (!result) {
        return res.status(404).json(generateErrorResponse('收藏记录不存在'));
      }

      logger.logUserAction('更新收藏标签', userId, '', { postId, tagId });

      res.json(generateSuccessResponse({ favorite: result }, '标签更新成功'));
    } catch (error) {
      logger.logError('更新收藏标签失败', { error: error.message, postId: req.params.postId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // ============ 标签管理 API ============

  // 获取用户所有标签
  async getUserTags(req, res) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        return res.status(400).json(generateErrorResponse('用户ID不能为空'));
      }

      // 归属校验（2026-08-10 渗透测试修复：IDOR）——收藏标签为隐私信息，仅本人或管理员可见
      const viewer = await User.findOne({ id: req.user.id }).select('isAdmin').lean();
      if (req.user.id !== userId && !(viewer && viewer.isAdmin)) {
        return res.status(403).json(generateErrorResponse('无权查看该用户的收藏标签'));
      }

      const tags = await FavoriteTag.getUserTags(userId);
      
      // 获取每个标签下的收藏数量
      const tagsWithCount = await Promise.all(tags.map(async (tag) => {
        const count = await Favorite.countDocuments({ userId, tagId: tag._id.toString() });
        return {
          ...tag.toObject(),
          favoriteCount: count
        };
      }));

      res.json(generateSuccessResponse({ tags: tagsWithCount }));
    } catch (error) {
      logger.logError('获取标签列表失败', { error: error.message, userId: req.params.userId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 创建标签
  async createTag(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { name, color } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json(generateErrorResponse('标签名不能为空'));
      }

      const result = await FavoriteTag.createTag(userId, name.trim(), color || '#4361ee');
      
      if (!result.success) {
        return res.status(400).json(generateErrorResponse(result.message));
      }

      logger.logUserAction('创建收藏标签', userId, '', { tagName: name, tagId: result.tag._id });

      res.json(generateSuccessResponse({ tag: result.tag }, '标签创建成功'));
    } catch (error) {
      logger.logError('创建标签失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新标签
  async updateTag(req, res) {
    try {
      const tagId = req.params.tagId;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { name, color } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (color !== undefined) updates.color = color;

      const result = await FavoriteTag.updateTag(tagId, userId, updates);
      
      if (!result) {
        return res.status(404).json(generateErrorResponse('标签不存在'));
      }

      logger.logUserAction('更新收藏标签', userId, '', { tagId, updates });

      res.json(generateSuccessResponse({ tag: result }, '标签更新成功'));
    } catch (error) {
      logger.logError('更新标签失败', { error: error.message, tagId: req.params.tagId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 删除标签
  async deleteTag(req, res) {
    try {
      const tagId = req.params.tagId;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;

      // 先清除该标签下所有收藏的标签引用
      await Favorite.clearTagFromFavorites(userId, tagId);

      const deleted = await FavoriteTag.deleteTag(tagId, userId);
      
      if (!deleted) {
        return res.status(404).json(generateErrorResponse('标签不存在'));
      }

      logger.logUserAction('删除收藏标签', userId, '', { tagId });

      res.json(generateSuccessResponse({}, '标签删除成功'));
    } catch (error) {
      logger.logError('删除标签失败', { error: error.message, tagId: req.params.tagId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 更新标签排序
  async updateTagOrder(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { tagOrders } = req.body;

      if (!Array.isArray(tagOrders)) {
        return res.status(400).json(generateErrorResponse('排序数据格式错误'));
      }

      await FavoriteTag.updateTagOrder(userId, tagOrders);

      res.json(generateSuccessResponse({}, '排序更新成功'));
    } catch (error) {
      logger.logError('更新标签排序失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 批量删除收藏
  async batchRemoveFavorites(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { postIds } = req.body;

      if (!Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json(generateErrorResponse('帖子ID列表不能为空'));
      }

      const result = await Favorite.batchRemoveFavorites(userId, postIds);

      logger.logUserAction('批量删除收藏', userId, '', { count: result.deletedCount, postIds });

      res.json(generateSuccessResponse({ deletedCount: result.deletedCount }, `成功删除 ${result.deletedCount} 个收藏`));
    } catch (error) {
      logger.logError('批量删除收藏失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 批量移动收藏到标签
  async batchMoveToTag(req, res) {
    try {
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { postIds, tagId } = req.body;

      if (!Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json(generateErrorResponse('帖子ID列表不能为空'));
      }

      // 如果指定了标签，验证标签是否属于该用户
      if (tagId) {
        const tag = await FavoriteTag.findById(tagId);
        if (!tag || tag.userId !== userId) {
          return res.status(400).json(generateErrorResponse('标签不存在或不属于当前用户'));
        }
      }

      const result = await Favorite.batchMoveToTag(userId, postIds, tagId || null);

      logger.logUserAction('批量移动收藏', userId, '', { count: result.modifiedCount, tagId });

      res.json(generateSuccessResponse({ modifiedCount: result.modifiedCount }, `成功移动 ${result.modifiedCount} 个收藏`));
    } catch (error) {
      logger.logError('批量移动收藏失败', { error: error.message });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  }
};

module.exports = favoriteController;
