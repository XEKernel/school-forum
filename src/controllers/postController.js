const { v4: uuidv4 } = require('uuid');
const {
  getPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getUsers,
  getUserById,
  updateUser,
  Post,
  cleanupPostRelations
} = require('../utils/dataUtils');
const {
  validatePostContent,
  validateCommentContent
} = require('../utils/authUtils');
const { sanitizeHtml } = require('../utils/sanitize');
const {
  userExists,
  isUserActive,
  postExists,
  commentExists,
  canDeleteComment,
  generateErrorResponse,
  generateSuccessResponse
} = require('../utils/validationUtils');
const { processUploadedFiles } = require('../middleware/uploadMiddleware');
const { getPaginationConfig, getContentLimits } = require('../config/constants');
const logger = require('../utils/logger');
const notificationController = require('./notificationController');
const { postCache, postCounters, userCache, hotPostsCache } = require('../utils/redisUtils');
const Favorite = require('../models/Favorite');
const Blacklist = require('../models/Blacklist');
const User = require('../models/User');

/**
 * 评论/回复嵌套深度上限（评论为第1层，回复最多到第6层）
 * 两端一致：服务端 addReply 拒绝超限，安卓端渲染按 6 层截断
 */
const MAX_REPLY_DEPTH = 6;

/**
 * 计数兜底修正：likes / dislikes 原子递减后若为负则归零
 * 背景：旧实现是读-改-写且带 Math.max(0, ...)，历史丢更新可能造成
 * 「计数已为 0 但数组里仍有记录」；原子 $pull + $inc -1 在这种情况下会减成 -1。
 * 这里用带条件的更新把负数拉回 0，保持与旧行为一致（计数永不为负）。
 * 注意不要与请求内的读取混用：调用后需重新取文档才能拿到修正值。
 */
async function clampPostCounters(postId) {
  await Post.updateOne({ id: postId, likes: { $lt: 0 } }, { $set: { likes: 0 } });
  await Post.updateOne({ id: postId, dislikes: { $lt: 0 } }, { $set: { dislikes: 0 } });
}

/**
 * 原子调整用户评论数（评论与回复共用同一个计数器）
 * 原实现是「读出当前值 → 加 1 → 整体覆盖写」，并发评论会丢更新；
 * 而删除评论/回复的路径此前完全没有扣减，只涨不跌。
 * 扣减时附一次条件归零，兜住历史漂移造成的负数。
 * @param {string} userId - 被调整的用户（评论/回复的作者，而非操作者）
 * @param {number} delta - +1 或 -1
 */
async function adjustUserCommentCount(userId, delta) {
  if (!userId) return;
  await updateUser(userId, { $inc: { commentCount: delta } });
  if (delta < 0) {
    await User.updateOne({ id: userId, commentCount: { $lt: 0 } }, { $set: { commentCount: 0 } });
  }
  await userCache.delete(userId);
}

/**
 * 评论/回复富化：实时补全 userAvatar 与 replyToUsername
 * - userAvatar：评论/回复存储时未快照头像（addComment/addReply 不写该字段），
 *   这里按 userId 批量查 User 表实时补全，头像修改后无需迁移旧数据
 * - replyToUsername：服务端只在"回复回复"时存了 replyToUsername；这里根据
 *   replyToId 反查被回复者补齐，并对"回复评论"的第一层回复补上评论作者名，
 *   保证每条回复都能指出回复对象
 * - 超过 MAX_REPLY_DEPTH 层的部分不深入（防御旧数据/异常数据）
 */
async function enrichComments(comments) {
  if (!comments || !Array.isArray(comments) || comments.length === 0) return comments;

  const User = require('../models/User');

  // 深拷贝：后续可能折叠超深数据（item.replies = []），绝不能污染 postCache 缓存对象
  comments = JSON.parse(JSON.stringify(comments));

  // 1. 收集所有评论/回复的 userId（递归，限深）与节点
  const userIds = new Set();
  const allNodes = [];
  (function collect(items, depth) {
    if (!items || depth > MAX_REPLY_DEPTH) return;
    for (const item of items) {
      if (!item) continue;
      allNodes.push(item);
      if (item.userId) userIds.add(item.userId);
      if (item.replies && Array.isArray(item.replies)) collect(item.replies, depth + 1);
    }
  })(comments, 1);

  // 2. 批量查用户头像（id → avatar 映射）
  const avatarMap = {};
  if (userIds.size > 0) {
    const users = await User.find({ id: { $in: Array.from(userIds) } })
      .select('id avatar')
      .lean();
    for (const u of users) {
      avatarMap[u.id] = u.avatar || null;
    }
  }

  // 3. 节点索引（replyToId → username 反查）
  const nodeById = {};
  for (const node of allNodes) {
    if (node.id) nodeById[node.id] = node;
  }

  // 4. 递归补全（限深：超过 MAX_REPLY_DEPTH 的层折叠为 hasMoreReplies 标记）
  (function fill(items, parentUsername, depth) {
    if (!items) return;
    for (const item of items) {
      if (!item) continue;
      // 头像
      if (item.userId && avatarMap[item.userId] !== undefined) {
        item.userAvatar = avatarMap[item.userId];
      }
      // 回复目标：优先按 replyToId 反查；第一层回复（回复评论）用父节点名
      if (item.replyToId && nodeById[item.replyToId]) {
        item.replyToUsername = nodeById[item.replyToId].username || '用户';
      } else if (!item.replyToId && parentUsername) {
        item.replyToUsername = parentUsername;
      }
      // 递归（父节点名取匿名处理后的用户名）；超过上限的层折叠
      if (item.replies && Array.isArray(item.replies)) {
        if (depth >= MAX_REPLY_DEPTH) {
          // 超过嵌套上限：标记折叠并截断，防止超深数据无界返回
          if (item.replies.length > 0) item.hasMoreReplies = true;
          item.replies = [];
        } else {
          fill(item.replies, item.anonymous ? '匿名同学' : (item.username || null), depth + 1);
        }
      }
    }
  })(comments, null, 1);

  return comments;
}

const postController = {
  // 获取帖子列表（支持分页、搜索和排序）— DB 级查询重构版
  async getPosts(req, res) {
    try {
      const paginationConfig = getPaginationConfig();
      const { page: _page = paginationConfig.defaultPage, limit: _limit = paginationConfig.defaultLimit, search = '', sortBy = 'latest', categoryId } = req.query;
      const page = Math.max(1, parseInt(_page, 10) || paginationConfig.defaultPage);
      const limit = Math.min(100, Math.max(1, parseInt(_limit, 10) || paginationConfig.defaultLimit));
      // 查看者身份必须来自认证中间件（optionalAuth），绝不信任客户端 query 参数
      const viewerId = req.user?.id || null;
      const Follow = require('../models/Follow');
      const Category = require('../models/Category');
      const User = require('../models/User');

      logger.logInfo('获取帖子列表', {
        page, limit, search: search || '无', sortBy,
        viewerId: viewerId || '未登录', ip: req.ip
      });

      // ============ 1. 查询条件下推到 MongoDB（不再全量加载帖子/用户） ============
      const query = { isDeleted: false };
      if (categoryId) query.categoryId = categoryId;

      // 搜索：正则子串匹配（DB 内过滤，仅返回匹配结果）
      if (search) {
        const esc = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { content: { $regex: esc, $options: 'i' } },
          { username: { $regex: esc, $options: 'i' } }
        ];
      }

      // 可见性 + 黑名单过滤（基于查看者身份）
      let followingIds = [];
      if (viewerId) {
        const followingDocs = await Follow.find({ followerId: viewerId }).select('followingId -_id').lean();
        followingIds = followingDocs.map(doc => doc.followingId);

        const viewer = await getUserById(viewerId);
        query.$and = [{
          $or: [
            { visibility: 'public' },
            { userId: viewerId },
            { visibility: 'followers', userId: { $in: followingIds } }
          ]
        }];
        if (viewer && viewer.settings && viewer.settings.privacy && viewer.settings.privacy.hideBlockedPosts) {
          const blockedIds = await Blacklist.getBlockedIds(viewerId);
          if (blockedIds.length > 0) query.$and.push({ userId: { $nin: blockedIds } });
        }
      } else {
        query.visibility = 'public'; // 未登录用户只能看到公开帖子
      }

      // ============ 2. 排序与分页 ============
      // 需要内存精算的排序（推荐/相关/收藏/评论）与可直接下推 DB 的排序（最新/点赞/浏览）
      const memorySortable = ['relevance', 'favorites', 'comments', 'recommended'];
      const total = await Post.countDocuments(query);
      let posts;

      if (!memorySortable.includes(sortBy)) {
        // DB 排序 + DB 分页
        const sort =
          sortBy === 'likes' ? { likes: -1, timestamp: -1 } :
          sortBy === 'views' ? { viewCount: -1, timestamp: -1 } :
          { timestamp: -1 };
        posts = await Post.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean();
      } else {
        // 内存精排：取过滤后按时间倒序的候选集（上限取自配置 pagination.maxCandidates，默认 1000）再精排分页
        const MAX_CANDIDATES = getPaginationConfig().maxCandidates || 1000;

        // 资源放大防护（审查报告 🟡22）：匿名 + 无搜索/栏目筛选的 relevance 结果是
        // 全站共享且短时间内稳定的，用 hotPostsCache（5 分钟 TTL，发帖/删帖/编辑时已清）
        // 缓存「已排序的帖子 id 列表」，命中时跳过 1000 条候选读取与 Favorite 聚合。
        const relevanceCacheable = sortBy === 'relevance' && !viewerId && !search && !categoryId;
        const cacheKeyPrefix = 'anonymous-public';
        let cachedIds = null;
        if (relevanceCacheable) {
          const cached = await hotPostsCache.get();
          if (cached && cached.scope === cacheKeyPrefix && Array.isArray(cached.ids)) {
            cachedIds = cached.ids;
          }
        }

        if (cachedIds) {
          const pageIds = cachedIds.slice((page - 1) * limit, (page - 1) * limit + limit);
          const fromDb = await Post.find({ id: { $in: pageIds } }).lean();
          const byId = new Map(fromDb.map(d => [d.id, d]));
          posts = pageIds.map(id => byId.get(id)).filter(Boolean);
          logger.logInfo('命中热门缓存，跳过内存精排', { sortBy, page, limit, cached: cachedIds.length });
        } else {
        const candidates = await Post.find(query).sort({ timestamp: -1 }).limit(MAX_CANDIDATES).lean();

        let favoriteMap = {};
        if (sortBy === 'relevance' || sortBy === 'favorites') {
          const postIds = candidates.map(p => p.id);
          if (postIds.length > 0) {
            const favoriteCounts = await Favorite.aggregate([
              { $match: { postId: { $in: postIds } } },
              { $group: { _id: '$postId', count: { $sum: 1 } } }
            ]);
            favoriteMap = {};
            favoriteCounts.forEach(item => { favoriteMap[item._id] = item.count; });
          }
        }

        const withFav = candidates.map(post => ({ ...post, favoriteCount: favoriteMap[post.id] || 0 }));

        // 计算热度分数（用于综合排序）
        const calculateHotScore = (post) => {
          const likes = post.likes || 0;
          const favorites = post.favoriteCount || 0;
          const views = post.viewCount || 0;
          const comments = post.comments ? post.comments.length : 0;
          const postDate = new Date(post.timestamp);
          const now = new Date();
          const daysSincePost = Math.max(0, (now - postDate) / (1000 * 60 * 60 * 24));
          const timeDecay = Math.exp(-daysSincePost / 7);
          return (likes * 3 + favorites * 4 + comments * 5 + views * 0.1) * timeDecay;
        };

        const sortFunctions = {
          // 综合：结合点赞、收藏、浏览、评论的综合热度排序
          relevance: (a, b) => calculateHotScore(b) - calculateHotScore(a),
          // 最新发布：按时间排序
          latest: (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
          // 点赞数排序（降序）
          likes: (a, b) => (b.likes || 0) - (a.likes || 0),
          // 收藏数排序（降序）
          favorites: (a, b) => (b.favoriteCount || 0) - (a.favoriteCount || 0),
          // 浏览量排序（降序）
          views: (a, b) => (b.viewCount || 0) - (a.viewCount || 0),
          // 评论数排序（降序）
          comments: (a, b) => ((b.comments ? b.comments.length : 0) - (a.comments ? a.comments.length : 0)),
          // 推荐：防信息茧房混合算法（40% 热门 + 25% 关注 + 20% 新鲜 + 15% 随机）
          recommended: (a, b) => {
            const scoreA = calculateHotScore(a);
            const scoreB = calculateHotScore(b);
            const now = new Date();
            const ageA = (now - new Date(a.timestamp)) / (1000 * 60 * 60);
            const ageB = (now - new Date(b.timestamp)) / (1000 * 60 * 60);
            const freshScoreA = ageA <= 48 ? (48 - ageA) / 48 : 0;
            const freshScoreB = ageB <= 48 ? (48 - ageB) / 48 : 0;
            const followWeightA = followingIds.includes(a.userId) ? 1.5 : 1.0;
            const followWeightB = followingIds.includes(b.userId) ? 1.5 : 1.0;
            const finalA = scoreA * 0.5 * followWeightA + freshScoreA * 100 * 0.3;
            const finalB = scoreB * 0.5 * followWeightB + freshScoreB * 100 * 0.3;
            return finalB - finalA;
          }
        };

        withFav.sort(sortFunctions[sortBy] || sortFunctions.latest);
        posts = withFav.slice((page - 1) * limit, (page - 1) * limit + limit);

        // 回填缓存：只缓存前 200 条的 id 顺序（够翻若干页，避免缓存体积随候选集膨胀）
        if (relevanceCacheable && withFav.length > 0) {
          await hotPostsCache.set({
            scope: cacheKeyPrefix,
            ids: withFav.slice(0, 200).map(p => p.id)
          });
        }
        }
      }

      // ============ 3. 用户头像 + 栏目（批量查询，不再全量加载用户） ============
      const postUserIds = [...new Set(posts.map(p => p.userId).filter(Boolean))];
      const userMap = new Map(
        postUserIds.length
          ? (await User.find({ id: { $in: postUserIds } }).select('id avatar').lean()).map(u => [u.id, u])
          : []
      );
      const allCategories = await Category.getActiveCategories();
      const categoryMap = {};
      allCategories.forEach(c => { categoryMap[c.id] = c; });

      const postsWithAvatar = posts.map(post => {
        const user = userMap.get(post.userId);
        const categoryInfo = post.categoryId && categoryMap[post.categoryId]
          ? { id: categoryMap[post.categoryId].id, name: categoryMap[post.categoryId].name, icon: categoryMap[post.categoryId].icon, color: categoryMap[post.categoryId].color }
          : null;
        return {
          ...post,
          userAvatar: user && user.avatar ? user.avatar : null,
          category: categoryInfo
        };
      });

      // PII 脱敏：未登录用户隐藏真实信息
      const safePosts = postsWithAvatar.map(post => {
        if (!viewerId) {
          return { ...post, school: '', grade: '', className: '', likedBy: [] };
        }
        return post;
      });

      res.json(generateSuccessResponse({
        posts: safePosts,
        categories: allCategories.map(c => ({
          id: c.id, name: c.name, description: c.description,
          icon: c.icon, color: c.color, postCount: c.postCount
        })),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalPosts: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }));
    } catch (error) {
      logger.logError('获取帖子列表失败', { error: error.message, query: req.query });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 获取单个帖子详情
  async getPostById(req, res) {
    try {
      const postId = req.params.id;
      // 查看者身份必须来自认证中间件（optionalAuth），绝不信任客户端 query 参数
      const viewerId = req.user?.id || null;
      const Follow = require('../models/Follow');

      // 记录访问帖子详情日志
      logger.logInfo('访问帖子详情', {
        postId,
        viewerId: viewerId || '未登录',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      // 尝试从Redis缓存获取帖子
      let post = await postCache.get(postId);
      
      if (!post) {
        // 缓存未命中，从数据库获取
        post = await getPostById(postId);

        if (!post || post.isDeleted) {
          return res.status(404).json(generateErrorResponse('帖子不存在'));
        }
        
        // 缓存帖子
        await postCache.set(postId, post);
      } else {
        // 检查缓存中的帖子是否已删除
        if (post.isDeleted) {
          return res.status(404).json(generateErrorResponse('帖子不存在'));
        }
      }

      // 黑名单检查：如果查看者被帖子作者拉黑，则不能查看帖子
      if (viewerId && post.userId) {
        const hasBlockRelation = await Blacklist.hasBlockRelation(viewerId, post.userId);
        if (hasBlockRelation) {
          return res.status(403).json(generateErrorResponse('无法查看该帖子'));
        }
      }

      // 帖子可见性检查
      const visibility = post.visibility || 'public';
      if (visibility !== 'public') {
        // 未登录用户无法查看非公开帖子
        if (!viewerId) {
          return res.status(403).json(generateErrorResponse('该帖子不对外公开'));
        }
        
        // 仅自己可见
        if (visibility === 'self') {
          if (post.userId !== viewerId) {
            return res.status(403).json(generateErrorResponse('该帖子仅作者可见'));
          }
        }
        
        // 仅粉丝可见
        if (visibility === 'followers') {
          if (post.userId !== viewerId) {
            const followDoc = await Follow.findOne({ followerId: viewerId, followingId: post.userId });
            if (!followDoc) {
              return res.status(403).json(generateErrorResponse('该帖子仅粉丝可见，请先关注作者'));
            }
          }
        }
      }

      // 获取用户头像信息
      const user = await getUserById(post.userId);

      // 过滤黑名单用户的评论（如果用户开启了该设置）
      let filteredPost = { ...post, userAvatar: user && user.avatar ? user.avatar : null };
      
      if (viewerId && post.comments && post.comments.length > 0) {
        const viewer = await getUserById(viewerId);
        if (viewer && viewer.settings && viewer.settings.privacy && viewer.settings.privacy.hideBlockedComments) {
          // 获取用户拉黑的人的ID列表
          const blockedIds = await Blacklist.getBlockedIds(viewerId);
          if (blockedIds.length > 0) {
            // 递归过滤评论和回复
            const filterComments = (comments) => {
              if (!comments) return [];
              return comments
                .filter(comment => !blockedIds.includes(comment.userId))
                .map(comment => ({
                  ...comment,
                  replies: filterComments(comment.replies)
                }));
            };
            
            filteredPost.comments = filterComments(post.comments);
            
            logger.logInfo('帖子评论黑名单过滤', {
              postId,
              viewerId,
              blockedCount: blockedIds.length,
              originalCommentCount: post.comments.length,
              filteredCommentCount: filteredPost.comments.length
            });
          }
        }
      }

      // 评论富化：实时补全评论/回复头像与回复目标（回复 @xxx）
      filteredPost.comments = await enrichComments(filteredPost.comments);

      res.json(generateSuccessResponse({
        post: filteredPost
      }));
    } catch (error) {
      logger.logError('获取帖子详情失败', { error: error.message, postId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 增加帖子浏览量
  async incrementViewCount(req, res) {
    try {
      const postId = req.params.id;

      logger.logInfo('增加帖子浏览量', {
        postId,
        ip: req.ip
      });

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        logger.logWarn('增加浏览量失败：帖子不存在', { postId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 使用Redis计数器增加浏览量
      const newViewCount = await postCounters.incrViews(postId);
      
      if (newViewCount !== null) {
        res.json(generateSuccessResponse({
          viewCount: newViewCount
        }));
        return;
      }

      // Redis不可用，回退到数据库操作
      const oldViewCount = post.viewCount || 0;
      await updatePost(postId, { viewCount: oldViewCount + 1 });

      logger.logInfo('浏览量已更新', {
        postId,
        oldViewCount,
        newViewCount: oldViewCount + 1
      });

      res.json(generateSuccessResponse({
        viewCount: oldViewCount + 1
      }));
    } catch (error) {
      logger.logError('增加浏览量失败', { error: error.message, postId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 发布新帖子
  async createPost(req, res) {
    try {
      // userId 必须来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { content, anonymous, visibility, deviceInfo, categoryId, commentsEnabled } = req.body;

      // 用户身份字段（用户名/学校/年级/班级）一律从数据库获取，不信任客户端 body：
      // 既防止伪造身份展示，也兼容客户端不传身份字段的调用（此前必填校验导致
      // 安卓端不传这些字段时发帖必失败，报"请填写所有必填字段"）
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }
      if (!user.isActive) {
        return res.status(403).json(generateErrorResponse('账号已被禁用，无法发帖'));
      }

      const username = user.username || '未知用户';
      const school = user.school || '';
      const grade = user.grade || '';
      const className = user.className || '';

      // 处理上传的图片
      const images = processUploadedFiles(req.files);
      
      // 验证逻辑：如果有图片，允许内容为空；如果没有图片，需要验证内容
      if (images.length === 0) {
        // 没有图片时，需要验证文本内容
        if (!content) {
          return res.status(400).json(generateErrorResponse('帖子内容不能为空'));
        }
        
        // 验证帖子内容
        const contentErrors = validatePostContent(content);
        if (contentErrors.length > 0) {
          return res.status(400).json(generateErrorResponse(contentErrors[0]));
        }
        
        // 检查内容是否只包含空白字符
        if (content.trim().length === 0) {
          return res.status(400).json(generateErrorResponse('帖子内容不能为空或只包含空白字符'));
        }
      } else {
        // 有图片时，如果提供了内容，验证内容长度
        if (content && content.length > 0) {
          const contentErrors = validatePostContent(content);
          if (contentErrors.length > 0) {
            return res.status(400).json(generateErrorResponse(contentErrors[0]));
          }
        }
      }
      
      // 验证可见性设置
      const validVisibility = ['public', 'followers', 'self'];
      const postVisibility = validVisibility.includes(visibility) ? visibility : 'public';

      // 验证栏目（如果指定了栏目ID，必须是已启用的栏目）
      let postCategoryId = null;
      if (categoryId) {
        const Category = require('../models/Category');
        const category = await Category.findOne({ id: categoryId, isActive: true });
        if (category) {
          postCategoryId = categoryId;
          // 增加栏目帖子数
          category.postCount = (category.postCount || 0) + 1;
          await category.save();
        }
      }

      // 创建新帖子
      const isAnonymous = anonymous === 'true';

      // 净化输入内容（防 XSS）
      const safeContent = sanitizeHtml(content || '');
      const safeSchool = sanitizeHtml(school || '');
      const safeGrade = sanitizeHtml(grade || '');
      const safeClassName = sanitizeHtml(className || '');

      const newPost = {
        id: uuidv4(),
        userId,
        username: isAnonymous ? '匿名用户' : username,
        school: isAnonymous ? '' : safeSchool,
        grade: isAnonymous ? '' : safeGrade,
        className: isAnonymous ? '' : safeClassName,
        content: safeContent,
        anonymous: isAnonymous,
        images: images,
        timestamp: new Date().toISOString(),
        likes: 0,
        likedBy: [],
        comments: [],
        viewCount: 0,
        isDeleted: false,
        visibility: postVisibility,
        deviceInfo: deviceInfo || '',
        categoryId: postCategoryId,
        commentsEnabled: commentsEnabled !== false
      };

      await createPost(newPost);

      // 更新用户发帖数（user 已在函数开头查询并校验，直接复用）
      if (user) {
        await updateUser(userId, { postCount: (user.postCount || 0) + 1 });
      }

      // 清除热门帖子缓存和用户缓存
      await hotPostsCache.clear();
      await userCache.delete(userId);

      // 记录发帖日志
      logger.logUserAction('发布帖子', userId, username, {
        postId: newPost.id,
        anonymous: isAnonymous,
        hasImages: images.length > 0,
        imageCount: images.length,
        contentLength: content ? content.length : 0,
        visibility: postVisibility
      });

      res.status(201).json(generateSuccessResponse({ post: newPost }, '帖子发布成功'));
    } catch (error) {
      logger.logError('发布帖子失败', { error: error.message, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 点赞帖子
  // 原子实现：原实现「读快照 → 内存算绝对值 → 整体覆盖写」，并发点赞会丢更新
  // （两个用户同时点赞只 +1），且 likedBy 数组与 likes 计数会长期不一致。
  // 现改为「条件过滤 + $addToSet/$pull + $inc」，每次变更都由单条 findOneAndUpdate 完成：
  // 过滤器同时承担「前置状态判断」的职责，因此不需要先读后写。
  async likePost(req, res) {
    try {
      const postId = req.params.id;
      // userId 来自已认证的 JWT，不信任客户端传值
      const userId = req.user.id;

      const baseFilter = { id: postId, isDeleted: { $ne: true } };
      // 只取响应与通知需要的字段（不回传 comments 等大数组）
      const after = { returnDocument: 'after', projection: { userId: 1, likes: 1, dislikes: 1 } };

      // 1) 顺带清掉可能存在的点踩（过滤器不命中即无副作用；赞与踩互斥）
      await Post.findOneAndUpdate(
        { ...baseFilter, dislikedBy: userId },
        { $pull: { dislikedBy: userId }, $inc: { dislikes: -1 } },
        after
      ).lean();

      // 2) 已点赞 → 取消点赞
      let post = await Post.findOneAndUpdate(
        { ...baseFilter, likedBy: userId },
        { $pull: { likedBy: userId }, $inc: { likes: -1 } },
        after
      ).lean();

      let liked;
      if (post) {
        liked = false;
        logger.logUserAction('取消点赞', userId, post.userId, { postId, currentLikes: post.likes });
      } else {
        // 3) 未点赞 → 加赞（$addToSet 保证不会重复加入，过滤器保证并发下不会重复计数）
        post = await Post.findOneAndUpdate(
          { ...baseFilter, likedBy: { $ne: userId } },
          { $addToSet: { likedBy: userId }, $inc: { likes: 1 } },
          after
        ).lean();
        liked = !!post;
        if (post) {
          logger.logUserAction('点赞帖子', userId, post.userId, { postId, currentLikes: post.likes });
        } else {
          // 并发下同一用户的两次点赞请求：两次都走到这里时后一次会因 $ne 过滤失配，
          // 此时不写入，以库内实际状态回应
          post = await Post.findOne(baseFilter).select('userId likes dislikes').lean();
        }
      }

      if (!post) {
        logger.logWarn('点赞失败：帖子不存在', { postId, userId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      await clampPostCounters(postId);

      // 清除帖子缓存
      await postCache.delete(postId);

      // 如果是点赞操作（不是取消点赞），创建通知
      if (liked) {
        notificationController.createLikeNotification(postId, userId, post.userId);
      }

      res.json(generateSuccessResponse({
        likes: Math.max(0, post.likes || 0),
        liked: liked,
        dislikes: Math.max(0, post.dislikes || 0),
        disliked: false
      }, liked ? '点赞成功' : '取消点赞成功'));
    } catch (error) {
      logger.logError('点赞操作失败', { error: error.message, postId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 点踩帖子
  async dislikePost(req, res) {
    try {
      const postId = req.params.id;
      // userId 来自已认证的 JWT，不信任客户端传值
      const userId = req.user.id;

      const baseFilter = { id: postId, isDeleted: { $ne: true } };
      const after = { returnDocument: 'after', projection: { userId: 1, likes: 1, dislikes: 1 } };

      // 1) 顺带清掉可能存在的点赞（过滤器不命中即无副作用；赞与踩互斥）
      await Post.findOneAndUpdate(
        { ...baseFilter, likedBy: userId },
        { $pull: { likedBy: userId }, $inc: { likes: -1 } },
        after
      ).lean();

      // 2) 已点踩 → 取消点踩
      let post = await Post.findOneAndUpdate(
        { ...baseFilter, dislikedBy: userId },
        { $pull: { dislikedBy: userId }, $inc: { dislikes: -1 } },
        after
      ).lean();

      let disliked;
      if (post) {
        disliked = false;
        logger.logUserAction('取消点踩', userId, post.userId, { postId, currentDislikes: post.dislikes });
      } else {
        // 3) 未点踩 → 点踩（$addToSet + 过滤器保证并发下不重复计数）
        post = await Post.findOneAndUpdate(
          { ...baseFilter, dislikedBy: { $ne: userId } },
          { $addToSet: { dislikedBy: userId }, $inc: { dislikes: 1 } },
          after
        ).lean();
        disliked = !!post;
        if (post) {
          logger.logUserAction('点踩帖子', userId, post.userId, { postId, currentDislikes: post.dislikes });
        } else {
          // 并发下同一用户的两次点踩请求：不写入，以库内实际状态回应
          post = await Post.findOne(baseFilter).select('userId likes dislikes').lean();
        }
      }

      if (!post) {
        logger.logWarn('点踩失败：帖子不存在', { postId, userId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      await clampPostCounters(postId);

      // 清除帖子缓存
      await postCache.delete(postId);

      res.json(generateSuccessResponse({
        dislikes: Math.max(0, post.dislikes || 0),
        disliked: disliked,
        likes: Math.max(0, post.likes || 0),
        liked: false
      }, disliked ? '点踩成功' : '取消点踩成功'));
    } catch (error) {
      logger.logError('点踩操作失败', { error: error.message, postId: req.params.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 添加评论
  async addComment(req, res) {
    try {
      const postId = req.params.id;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { content, anonymous } = req.body;
      
      // 从 JWT 获取用户名（不再信任客户端传入的 username）
      const username = req.user.username || '用户';

      // 允许纯图片评论（无文字），但至少要有图片或文字
      const hasImages = req.files && req.files.length > 0;
      if (!content && !hasImages) {
        logger.logWarn('添加评论失败：缺少内容或图片', { postId, userId });
        return res.status(400).json(generateErrorResponse('评论内容和图片不能同时为空'));
      }

      // 有文字内容时验证
      if (content) {
        const contentErrors = validateCommentContent(content);
        if (contentErrors.length > 0) {
          logger.logWarn('添加评论失败：内容验证失败', { postId, userId, error: contentErrors[0] });
          return res.status(400).json(generateErrorResponse(contentErrors[0]));
        }
      }

      // 验证用户是否存在且活跃
      if (!await userExists(userId)) {
        logger.logWarn('添加评论失败：用户不存在', { userId });
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      if (!await isUserActive(userId)) {
        logger.logSecurityEvent('封禁用户尝试评论', { userId, postId });
        return res.status(403).json(generateErrorResponse('账号已被封禁，无法评论'));
      }

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        logger.logWarn('添加评论失败：帖子不存在', { postId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 检查评论是否已关闭
      if (post.commentsEnabled === false) {
        return res.status(403).json(generateErrorResponse('评论区已关闭'));
      }

      const isAnonymous = anonymous === true || anonymous === 'true';

      // 处理上传的图片
      const commentImages = [];
      if (hasImages) {
        for (const file of req.files) {
          commentImages.push({
            id: uuidv4(),
            url: `/images/${file.filename}`,
            filename: file.filename,
            size: file.size
          });
        }
      }

      const newComment = {
        id: uuidv4(),
        userId,
        username: isAnonymous ? '匿名同学' : username,
        content: sanitizeHtml(content || ''),
        anonymous: isAnonymous,
        images: commentImages,
        timestamp: new Date().toISOString()
      };

      // 原子前插：$push + $position:0。
      // 原实现是「读全量 comments → unshift → 整体覆盖写」，两个用户同时评论会互相覆盖（丢评论）。
      // $position:0 与旧行为的顺序一致（新评论在最前）；最后再用一次条件更新兜住「读取后被删帖」的竞态。
      const appended = await Post.findOneAndUpdate(
        { id: postId, isDeleted: { $ne: true } },
        { $push: { comments: { $each: [newComment], $position: 0 } } },
        { returnDocument: 'after', projection: { id: 1 } }
      ).lean();

      if (!appended) {
        logger.logWarn('添加评论失败：帖子已被删除', { postId, userId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 清除帖子缓存
      await postCache.delete(postId);

      // 更新用户评论数（原子自增，见 adjustUserCommentCount）
      await adjustUserCommentCount(userId, 1);

      // 记录添加评论日志
      logger.logUserAction('添加评论', userId, username, {
        postId,
        commentId: newComment.id,
        anonymous: isAnonymous,
        contentLength: (content || '').length,
        imageCount: commentImages.length
      });
      
      // 创建评论通知
      notificationController.createCommentNotification(postId, userId, content || '[图片]', post.userId);
      
      res.status(201).json(generateSuccessResponse({ comment: newComment }, '评论添加成功'));
    } catch (error) {
      logger.logError('评论操作失败', { error: error.message, postId: req.params.id, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 删除评论
  async deleteComment(req, res) {
    try {
      const { id: postId, commentId } = req.params;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { replyId, nestedReplyId } = req.body;
      
      const post = await getPostById(postId);
      
      if (!post || post.isDeleted) {
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }
      
      const comments = post.comments || [];
      const commentIndex = comments.findIndex(c => c.id === commentId);
      
      if (commentIndex === -1) {
        return res.status(404).json(generateErrorResponse('评论不存在'));
      }
      
      const comment = comments[commentIndex];
      
      // 如果提供了 nestedReplyId，则删除嵌套回复（二级回复）
      if (nestedReplyId) {
        if (!replyId) {
          return res.status(400).json(generateErrorResponse('必须提供 replyId'));
        }
        
        if (!comment.replies || !Array.isArray(comment.replies)) {
          return res.status(404).json(generateErrorResponse('回复不存在'));
        }
        
        const parentReply = comment.replies.find(r => r.id === replyId);
        if (!parentReply) {
          return res.status(404).json(generateErrorResponse('回复不存在'));
        }
        
        if (!parentReply.replies || !Array.isArray(parentReply.replies)) {
          return res.status(404).json(generateErrorResponse('嵌套回复不存在'));
        }
        
        const nestedReplyIndex = parentReply.replies.findIndex(r => r.id === nestedReplyId);
        if (nestedReplyIndex === -1) {
          return res.status(404).json(generateErrorResponse('嵌套回复不存在'));
        }
        
        const nestedReply = parentReply.replies[nestedReplyIndex];
        
        // 检查权限：只有嵌套回复作者或帖子作者可以删除
        if (nestedReply.userId !== userId && post.userId !== userId) {
          return res.status(403).json(generateErrorResponse('无权限删除此回复'));
        }
        
        parentReply.replies.splice(nestedReplyIndex, 1);
        await updatePost(postId, { comments });
        
        // 清除帖子缓存
        await postCache.delete(postId);

        // 递减被删回复作者的评论数（回复在 addReply 里会 +1，此前删除侧从不扣减）
        await adjustUserCommentCount(nestedReply.userId, -1);

        // 清理该回复附带的图片文件（记录已删，文件不该留在 public/images 当垃圾）
        const { removeImageFiles } = require('../middleware/uploadMiddleware');
        await removeImageFiles(nestedReply.images || []);

        return res.json(generateSuccessResponse({}, '嵌套回复删除成功'));
      }
      
      // 如果提供了 replyId，则删除回复（一级回复）
      if (replyId) {
        if (!comment.replies || !Array.isArray(comment.replies)) {
          return res.status(404).json(generateErrorResponse('回复不存在'));
        }
        
        const replyIndex = comment.replies.findIndex(r => r.id === replyId);
        if (replyIndex === -1) {
          return res.status(404).json(generateErrorResponse('回复不存在'));
        }
        
        const reply = comment.replies[replyIndex];
        
        // 检查权限：只有回复作者或帖子作者可以删除回复
        if (reply.userId !== userId && post.userId !== userId) {
          return res.status(403).json(generateErrorResponse('无权限删除此回复'));
        }

        // 级联删除：该回复下的嵌套回复一并删除（此前只删父级，子回复会成为永远读不到的孤儿数据）
        const orphanNested = Array.isArray(reply.replies) ? reply.replies.slice() : [];

        comment.replies.splice(replyIndex, 1);
        await updatePost(postId, { comments });
        
        // 清除帖子缓存
        await postCache.delete(postId);

        // 递减被删回复作者的评论数
        await adjustUserCommentCount(reply.userId, -1);
        for (const orphan of orphanNested) {
          await adjustUserCommentCount(orphan.userId, -1);
        }
        if (orphanNested.length > 0) {
          logger.logInfo('删除回复时级联清理嵌套回复', { postId, replyId, cascaded: orphanNested.length });
        }

        // 清理被删回复及其嵌套回复的图片文件
        const { removeImageFiles } = require('../middleware/uploadMiddleware');
        await removeImageFiles([
          ...(reply.images || []),
          ...orphanNested.flatMap(o => o.images || [])
        ]);

        return res.json(generateSuccessResponse({}, '回复删除成功'));
      }
      
      // 否则删除评论
      // 检查权限：只有评论作者或帖子作者可以删除评论
      if (!canDeleteComment(comment, post, userId)) {
        return res.status(403).json(generateErrorResponse('无权限删除此评论'));
      }

      // 级联删除：该评论下的所有回复与嵌套回复一并删除（否则成为永远读不到的孤儿数据）
      const cascadedAuthors = [];
      const cascadedImages = [];
      for (const r of (Array.isArray(comment.replies) ? comment.replies : [])) {
        cascadedAuthors.push(r.userId);
        if (Array.isArray(r.images)) cascadedImages.push(...r.images);
        for (const n of (Array.isArray(r.replies) ? r.replies : [])) {
          cascadedAuthors.push(n.userId);
          if (Array.isArray(n.images)) cascadedImages.push(...n.images);
        }
      }

      comments.splice(commentIndex, 1);
      await updatePost(postId, { comments });
      
      // 清除帖子缓存
      await postCache.delete(postId);

      // 递减被删评论作者的评论数（此前只增不减，commentCount 会持续虚高）
      await adjustUserCommentCount(comment.userId, -1);
      for (const uid of cascadedAuthors) {
        await adjustUserCommentCount(uid, -1);
      }
      if (cascadedAuthors.length > 0) {
        logger.logInfo('删除评论时级联清理回复', { postId, commentId, cascaded: cascadedAuthors.length });
      }

      // 清理被删评论及其级联回复的图片文件
      const { removeImageFiles } = require('../middleware/uploadMiddleware');
      await removeImageFiles([...(comment.images || []), ...cascadedImages]);

      res.json(generateSuccessResponse({}, '评论删除成功'));
    } catch (error) {
      logger.logError('删除评论失败', { error: error.message, postId: req.params.id, commentId: req.params.commentId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 用户删除自己的帖子
  async deletePost(req, res) {
    try {
      // 支持两种方式：DELETE /posts/:id 或 POST /posts/delete (body: {postId})
      const postId = req.params.id || req.body.postId;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;

      const post = await getPostById(postId, true);

      if (!post || post.isDeleted) {
        logger.logWarn('删除帖子失败：帖子不存在', { postId, userId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 检查权限：只有帖子作者可以删除自己的帖子
      if (post.userId !== userId) {
        logger.logSecurityEvent('删除帖子失败：权限不足', {
          postId,
          postUserId: post.userId,
          requestUserId: userId
        });
        return res.status(403).json(generateErrorResponse('无权限删除此帖子'));
      }
      
      // 标记帖子为已删除（软删除）
      await deletePost(postId, userId, '用户自行删除');

      // 清除帖子缓存、计数器缓存和热门帖子缓存
      await postCache.delete(postId);
      await postCounters.clearPostCounters(postId);
      await hotPostsCache.clear();

      // 清理关联数据：收藏与通知指向已不可见的帖子（举报记录保留作为治理凭据，见 cleanupPostRelations）
      const relationCleanup = await cleanupPostRelations(postId);

      // 更新栏目帖子数
      if (post.categoryId) {
        const Category = require('../models/Category');
        const category = await Category.findOne({ id: post.categoryId });
        if (category && category.postCount > 0) {
          category.postCount = Math.max(0, category.postCount - 1);
          await category.save();
        }
      }

      // 更新用户发帖数
      const user = await getUserById(userId);
      if (user) {
        await updateUser(userId, { postCount: Math.max(0, (user.postCount || 0) - 1) });
        // 清除用户缓存
        await userCache.delete(userId);
      }

      // 记录删除帖子日志
      logger.logUserAction('删除帖子', userId, post.username, {
        postId,
        postAuthor: post.username,
        deleteReason: '用户自行删除',
        favoritesCleared: relationCleanup.favorites,
        notificationsCleared: relationCleanup.notifications
      });
      
      res.json(generateSuccessResponse({}, '帖子删除成功'));
    } catch (error) {
      console.error('删除帖子错误:', error);
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 用户编辑自己的帖子
  async updatePost(req, res) {
    try {
      const postId = req.params.id;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { content, deletedImages, visibility, commentsEnabled } = req.body;

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        logger.logWarn('编辑帖子失败：帖子不存在', { postId, userId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 检查权限：只有帖子作者可以编辑自己的帖子
      if (post.userId !== userId) {
        logger.logSecurityEvent('编辑帖子失败：权限不足', {
          postId,
          postUserId: post.userId,
          requestUserId: userId
        });
        return res.status(403).json(generateErrorResponse('无权限编辑此帖子'));
      }

      // 处理上传的新图片
      const newImages = processUploadedFiles(req.files);

      // 处理要删除的图片
      let currentImages = post.images || [];
      if (deletedImages) {
        try {
          const deletedImagesList = JSON.parse(deletedImages);
          currentImages = currentImages.filter(img => !deletedImagesList.includes(img.url));
        } catch (e) {
          logger.logError('解析删除图片列表失败', { error: e.message });
        }
      }

      // 合并图片
      const allImages = [...currentImages, ...newImages];

      // 验证内容
      if (allImages.length === 0) {
        if (!content || content.trim().length === 0) {
          return res.status(400).json(generateErrorResponse('帖子内容不能为空'));
        }
      }

      if (content && content.length > getContentLimits().post) {
        return res.status(400).json(generateErrorResponse(`帖子内容过长，最多${getContentLimits().post}个字符`));
      }

      // 验证可见性设置
      const validVisibility = ['public', 'followers', 'self'];
      const postVisibility = validVisibility.includes(visibility) ? visibility : (post.visibility || 'public');

      // 更新帖子
      const updateData = {
        content: content || post.content,
        images: allImages,
        updatedAt: new Date().toISOString(),
        visibility: postVisibility,
        commentsEnabled: typeof commentsEnabled === 'boolean' ? commentsEnabled : (post.commentsEnabled !== false)
      };

      const updatedPost = await updatePost(postId, updateData);

      // 清除帖子缓存和热门帖子缓存
      await postCache.delete(postId);
      await hotPostsCache.clear();

      // 记录编辑帖子日志
      logger.logUserAction('编辑帖子', userId, post.username, {
        postId,
        contentLength: content ? content.length : 0,
        newImageCount: newImages.length,
        totalImageCount: allImages.length,
        visibility: postVisibility
      });

      res.json(generateSuccessResponse({ post: updatedPost }, '帖子编辑成功'));
    } catch (error) {
      logger.logError('编辑帖子失败', { error: error.message, postId: req.params.id, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 回复评论
  async replyComment(req, res) {
    try {
      const { id: postId, commentId } = req.params;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;
      const { content, anonymous, replyToId } = req.body;

      // 从 JWT 获取用户名
      const username = req.user.username || '用户';

      // 允许纯图片回复（无文字），但至少要有图片或文字
      const hasImages = req.files && req.files.length > 0;
      if (!content && !hasImages) {
        logger.logWarn('回复评论失败：缺少内容或图片', { postId, commentId, userId });
        return res.status(400).json(generateErrorResponse('回复内容和图片不能同时为空'));
      }

      // 有文字内容时验证
      if (content) {
        const contentErrors = validateCommentContent(content);
        if (contentErrors.length > 0) {
          logger.logWarn('回复评论失败：内容验证失败', { postId, commentId, userId, error: contentErrors[0] });
          return res.status(400).json(generateErrorResponse(contentErrors[0]));
        }
      }

      // 验证用户是否存在且活跃
      if (!await userExists(userId)) {
        logger.logWarn('回复评论失败：用户不存在', { userId });
        return res.status(404).json(generateErrorResponse('用户不存在'));
      }

      if (!await isUserActive(userId)) {
        logger.logSecurityEvent('封禁用户尝试回复评论', { userId, postId, commentId });
        return res.status(403).json(generateErrorResponse('账号已被封禁，无法回复'));
      }

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        logger.logWarn('回复评论失败：帖子不存在', { postId });
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 检查评论是否已关闭
      if (post.commentsEnabled === false) {
        return res.status(403).json(generateErrorResponse('评论区已关闭'));
      }

      const comments = post.comments || [];
      const commentIndex = comments.findIndex(c => c.id === commentId);
      
      if (commentIndex === -1) {
        return res.status(404).json(generateErrorResponse('评论不存在'));
      }
      
      const comment = comments[commentIndex];
      const isAnonymous = anonymous === true || anonymous === 'true';
      
      // 处理上传的图片
      const replyImages = [];
      if (hasImages) {
        for (const file of req.files) {
          replyImages.push({
            id: uuidv4(),
            url: `/images/${file.filename}`,
            filename: file.filename,
            size: file.size
          });
        }
      }
      
      // 创建回复
      const newReply = {
        id: uuidv4(),
        userId,
        username: isAnonymous ? '匿名同学' : username,
        content: sanitizeHtml(content || ''),
        anonymous: isAnonymous,
        images: replyImages,
        replyTo: replyToId || null,
        timestamp: new Date().toISOString()
      };
      
      // 查找回复的辅助函数（返回 { node, depth }，评论为第1层、第一层回复为第2层…）
      const findReplyWithDepth = (replies, targetId, currentDepth) => {
        if (!replies || !Array.isArray(replies)) {
          return null;
        }
        
        for (let reply of replies) {
          if (reply.id === targetId) {
            return { node: reply, depth: currentDepth };
          }
          if (reply.replies && reply.replies.length > 0) {
            const found = findReplyWithDepth(reply.replies, targetId, currentDepth + 1);
            if (found) {
              return found;
            }
          }
        }
        
        return null;
      };
      
      let targetUserId = comment.userId; // 默认通知评论作者
      let replyToUsername = null;
      
      // 如果回复的是回复
      if (replyToId) {
        const found = findReplyWithDepth(comment.replies, replyToId, 2); // 第一层回复深度=2
        if (!found) {
          return res.status(404).json(generateErrorResponse('被回复的回复不存在'));
        }
        const targetReply = found.node;
        
        // 嵌套深度限制：新回复深度 = 目标深度 + 1，不得超过 MAX_REPLY_DEPTH
        if (found.depth + 1 > MAX_REPLY_DEPTH) {
          logger.logWarn('回复评论失败：超过嵌套深度限制', {
            postId, commentId, replyToId, depth: found.depth + 1, maxDepth: MAX_REPLY_DEPTH
          });
          return res.status(400).json(generateErrorResponse(`嵌套回复最多支持 ${MAX_REPLY_DEPTH} 层`));
        }
        
        targetUserId = targetReply.userId; // 通知被回复的回复作者
        replyToUsername = targetReply.username; // 设置被回复的用户名
        
        // 设置 replyToId 和 replyToUsername
        newReply.replyToId = replyToId;
        newReply.replyToUsername = replyToUsername;
        
        // 直接将新回复添加到被回复的回复的回复列表中
        if (!targetReply.replies) {
          targetReply.replies = [];
        }
        targetReply.replies.push(newReply);
      } else {
        // 回复评论，添加到评论的回复列表中（深度2，不会超限）
        if (!comment.replies) {
          comment.replies = [];
        }
        comment.replies.push(newReply);
      }
      
      await updatePost(postId, { comments });
      // 清除帖子缓存（缺了它，后续 GET 会命中旧缓存：新回复看不到、评论点赞态回退）
      await postCache.delete(postId);
      
      // 更新用户评论数（原子自增，见 adjustUserCommentCount）
      await adjustUserCommentCount(userId, 1);

      // 记录回复评论日志
      logger.logUserAction('回复评论', userId, username, {
        postId,
        commentId,
        replyToId,
        isAnonymous,
        contentLength: content.length
      });

      // 创建回复通知
      notificationController.createCommentReplyNotification(postId, commentId, userId, content, targetUserId);

      res.status(201).json(generateSuccessResponse({ reply: newReply }, '回复添加成功'));
    } catch (error) {
      logger.logError('回复评论失败', { error: error.message, postId: req.params.id, commentId: req.params.commentId, userId: req.user?.id });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 点赞评论
  async likeComment(req, res) {
    try {
      const { id: postId, commentId } = req.params;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

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

      const comments = post.comments || [];
      const targetComment = findCommentOrReply(comments, commentId);

      if (!targetComment) {
        return res.status(404).json(generateErrorResponse('评论不存在'));
      }

      const likedBy = targetComment.likedBy || [];
      const userIndex = likedBy.indexOf(userId);

      let newLikes, newLikedBy, liked;

      if (userIndex !== -1) {
        // 取消点赞
        newLikes = Math.max(0, (targetComment.likes || 0) - 1);
        newLikedBy = likedBy.filter(id => id !== userId);
        liked = false;
      } else {
        // 添加点赞
        newLikes = (targetComment.likes || 0) + 1;
        newLikedBy = [...likedBy, userId];
        liked = true;

        // 创建点赞通知
        if (targetComment.userId !== userId) {
          notificationController.createCommentLikeNotification(postId, commentId, userId, targetComment.userId);
        }
      }

      targetComment.likes = newLikes;
      targetComment.likedBy = newLikedBy;

      await updatePost(postId, { comments });

      // 清除帖子缓存（缺了它，后续 GET 会命中旧缓存：新回复看不到、评论点赞态回退）
      await postCache.delete(postId);

      logger.logUserAction(liked ? '点赞评论' : '取消点赞评论', userId, null, {
        postId,
        commentId,
        likes: newLikes
      });

      res.json(generateSuccessResponse({
        likes: newLikes,
        liked: liked
      }, liked ? '点赞成功' : '取消点赞成功'));
    } catch (error) {
      logger.logError('点赞评论失败', { error: error.message, postId: req.params.id, commentId: req.params.commentId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },

  // 点赞/取消点赞回复（嵌套回复任意层级）
  async likeReply(req, res) {
    try {
      const { id: postId, commentId, replyId } = req.params;
      // userId 来自已认证的 JWT，防止客户端伪造
      const userId = req.user.id;

      const post = await getPostById(postId);

      if (!post || post.isDeleted) {
        return res.status(404).json(generateErrorResponse('帖子不存在'));
      }

      // 在指定评论的回复树中递归查找回复
      const findReplyNode = (replies) => {
        if (!replies || !Array.isArray(replies)) return null;
        for (const r of replies) {
          if (r.id === replyId) return r;
          if (r.replies && r.replies.length > 0) {
            const found = findReplyNode(r.replies);
            if (found) return found;
          }
        }
        return null;
      };

      const comments = post.comments || [];
      const comment = comments.find(c => c.id === commentId);
      if (!comment) {
        return res.status(404).json(generateErrorResponse('评论不存在'));
      }

      const targetReply = findReplyNode(comment.replies);
      if (!targetReply) {
        return res.status(404).json(generateErrorResponse('回复不存在'));
      }

      const likedBy = targetReply.likedBy || [];
      const userIndex = likedBy.indexOf(userId);

      let newLikes, newLikedBy, liked;

      if (userIndex !== -1) {
        // 取消点赞
        newLikes = Math.max(0, (targetReply.likes || 0) - 1);
        newLikedBy = likedBy.filter(id => id !== userId);
        liked = false;
      } else {
        // 添加点赞
        newLikes = (targetReply.likes || 0) + 1;
        newLikedBy = [...likedBy, userId];
        liked = true;

        // 回复点赞通知（复用评论点赞通知，递归可定位到回复）
        if (targetReply.userId !== userId) {
          notificationController.createCommentLikeNotification(postId, replyId, userId, targetReply.userId);
        }
      }

      targetReply.likes = newLikes;
      targetReply.likedBy = newLikedBy;

      await updatePost(postId, { comments });

      // 清除帖子缓存（缺了它，后续 GET 会命中旧缓存：新回复看不到、评论点赞态回退）
      await postCache.delete(postId);

      logger.logUserAction(liked ? '点赞回复' : '取消点赞回复', userId, null, {
        postId,
        commentId,
        replyId,
        likes: newLikes
      });

      res.json(generateSuccessResponse({
        likes: newLikes,
        liked: liked
      }, liked ? '点赞成功' : '取消点赞成功'));
    } catch (error) {
      logger.logError('点赞回复失败', { error: error.message, postId: req.params.id, commentId: req.params.commentId, replyId: req.params.replyId });
      res.status(500).json(generateErrorResponse('服务器内部错误', 500));
    }
  },
};

module.exports = postController;
