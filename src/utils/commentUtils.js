/**
 * 评论树工具：扁平文档 ↔ 嵌套结构互转、子树收集、旧数据拍平。
 *
 * 设计要点：
 *   - 读：一次查出该帖全部评论，内存按 parentId 建树，**输出结构与原来的内嵌数组完全一致**
 *     （顶层按时间倒序、回复按时间正序），这样前端与 Android 客户端无需改动。
 *   - 写：全部是单文档原子操作（insertOne / updateOne），不再有「整字段覆盖」。
 */
const Comment = require('../models/Comment');

// 与 postController 的 MAX_REPLY_DEPTH 保持一致
const MAX_REPLY_DEPTH = 6;

/**
 * 取某帖的完整评论树（嵌套数组，结构与旧 Post.comments 相同）。
 * @param {string} postId
 * @returns {Promise<Array>}
 */
async function loadCommentTree(postId) {
  if (!postId) return [];

  const docs = await Comment.find({ postId, isDeleted: { $ne: true } })
    .sort({ timestamp: 1 })
    .lean();

  return buildTree(docs);
}

/**
 * 批量组装多个帖子的评论树（列表接口用）。
 * 一次查询取出本页所有帖子的评论，避免按帖子逐个查造成 N+1。
 *
 * @param {string[]} postIds
 * @returns {Promise<Map<string, Array>>} postId → 评论树
 */
async function loadCommentTrees(postIds) {
  const result = new Map();
  if (!Array.isArray(postIds) || postIds.length === 0) return result;

  const docs = await Comment.find({ postId: { $in: postIds }, isDeleted: { $ne: true } })
    .sort({ timestamp: 1 })
    .lean();

  const grouped = new Map();
  for (const d of docs) {
    if (!grouped.has(d.postId)) grouped.set(d.postId, []);
    grouped.get(d.postId).push(d);
  }

  for (const pid of postIds) {
    result.set(pid, buildTree(grouped.get(pid) || []));
  }
  return result;
}

/**
 * 递归统计树中的节点总数（评论 + 所有层级回复）。
 */
function countTreeNodes(tree) {
  if (!Array.isArray(tree)) return 0;
  let n = 0;
  for (const node of tree) {
    n += 1;
    if (node && Array.isArray(node.replies)) n += countTreeNodes(node.replies);
  }
  return n;
}

/**
 * 由扁平文档列表构建嵌套树。
 * 输出结构与旧的内嵌数组逐字段一致：顶层按时间倒序、回复按时间正序。
 */
function buildTree(docs) {
  if (!docs || !docs.length) return [];

  const map = new Map();
  for (const d of docs) {
    map.set(d.id, {
      id: d.id,
      userId: d.userId,
      username: d.username,
      content: d.content,
      anonymous: !!d.anonymous,
      likes: d.likes || 0,
      likedBy: d.likedBy || [],
      images: d.images || [],
      timestamp: d.timestamp,
      replyToId: d.replyToId || null,
      replyToUsername: d.replyToUsername || null,
      replies: []
    });
  }

  const roots = [];
  for (const d of docs) {
    const node = map.get(d.id);
    if (!d.parentId) {
      roots.push(node);
      continue;
    }
    const parent = map.get(d.parentId);
    if (parent) {
      parent.replies.push(node);
    } else {
      // 父节点已不存在（历史脏数据）：提升为顶层，避免整棵子树凭空消失
      roots.push(node);
    }
  }

  // 顶层：新的在前（与原先 $position:0 一致）；回复：旧的在前（与原先 push 一致）
  roots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  for (const r of roots) sortRepliesAsc(r);

  return roots;
}

function sortRepliesAsc(node) {
  if (!node.replies || !node.replies.length) return;
  node.replies.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const child of node.replies) sortRepliesAsc(child);
}

/**
 * 收集某节点及其全部后代的 id（用于级联软删）。
 * @param {string} postId
 * @param {string} rootCommentId
 * @returns {Promise<string[]>}
 */
async function collectSubtreeIds(postId, rootCommentId) {
  const docs = await Comment.find({ postId }).select('id parentId').lean();
  const childrenMap = new Map();
  for (const d of docs) {
    const key = d.parentId || '__root__';
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key).push(d.id);
  }

  const result = [];
  const stack = [rootCommentId];
  while (stack.length) {
    const cur = stack.pop();
    result.push(cur);
    const children = childrenMap.get(cur) || [];
    for (const c of children) stack.push(c);
  }
  return result;
}

/**
 * 统计某帖的有效评论数（含所有层级回复）。
 * @param {string} postId
 * @returns {Promise<number>}
 */
async function countComments(postId) {
  return Comment.countDocuments({ postId, isDeleted: { $ne: true } });
}

/**
 * 把旧的嵌套评论数组拍平成文档列表（迁移用）。
 * 兼容两种命名：Comment 用 replyToId/replyToUsername，Reply 用 replyTo。
 *
 * @param {string} postId
 * @param {Array} comments 旧结构 Post.comments
 * @returns {Array} 可直接 insertMany 的文档数组
 */
function flattenLegacyComments(postId, comments) {
  const out = [];

  const walk = (list, parentId, depth) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (!c || !c.id) continue;
      out.push({
        id: c.id,
        postId,
        parentId: parentId || null,
        depth,
        userId: c.userId || '',
        username: c.username || '',
        content: c.content || '',
        anonymous: !!c.anonymous,
        likes: c.likes || 0,
        likedBy: Array.isArray(c.likedBy) ? c.likedBy : [],
        images: Array.isArray(c.images) ? c.images.map(i => ({
          id: i.id || '',
          url: i.url || '',
          filename: i.filename || '',
          size: i.size || 0
        })) : [],
        replyToId: c.replyToId || c.replyTo || null,
        replyToUsername: c.replyToUsername || null,
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
        isDeleted: false
      });
      walk(c.replies, c.id, depth + 1);
    }
  };

  walk(comments, null, 1);
  return out;
}

module.exports = {
  MAX_REPLY_DEPTH,
  loadCommentTree,
  loadCommentTrees,
  countTreeNodes,
  collectSubtreeIds,
  countComments,
  flattenLegacyComments
};
