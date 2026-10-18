#!/usr/bin/env node
/**
 * 评论数据迁移：Post.comments（内嵌嵌套）→ comments 集合（扁平 + parentId）
 *
 * 用法：
 *   node scripts/migrate-comments.js            # dry-run，只统计
 *   node scripts/migrate-comments.js --apply    # 实际写入
 *
 * 特性：
 *   - 幂等：该帖子在 comments 集合已有记录则跳过
 *   - 不删原数据：Post.comments 保留作备份，确认稳定后再单独清理
 */
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env') });

const mongoose = require(path.join(root, 'node_modules/mongoose'));
const { flattenLegacyComments } = require(path.join(root, 'src/utils/commentUtils'));

const APPLY = process.argv.includes('--apply');

(async () => {
  const u = encodeURIComponent(process.env.MONGODB_USERNAME || '');
  const p = encodeURIComponent(process.env.MONGODB_PASSWORD || '');
  const authdb = process.env.MONGODB_AUTHSOURCE || 'admin';
  const dbName = (process.env.MONGODB_URI.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'school-forum';
  const uri = `mongodb://${u}:${p}@127.0.0.1:27017/${dbName}?authSource=${authdb}`;

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const posts = db.collection('posts');
  const comments = db.collection('comments');

  console.log('库:', dbName, '| 模式:', APPLY ? '实际写入' : 'DRY-RUN');

  const all = await posts.find({}, { projection: { id: 1, comments: 1 } }).toArray();
  let postWithComments = 0, totalFlat = 0, skipped = 0, maxDepth = 0;

  for (const post of all) {
    if (!Array.isArray(post.comments) || post.comments.length === 0) continue;
    postWithComments++;

    const existing = await comments.countDocuments({ postId: post.id });
    if (existing > 0) {
      skipped++;
      continue;
    }

    const docs = flattenLegacyComments(post.id, post.comments);
    totalFlat += docs.length;
    for (const d of docs) maxDepth = Math.max(maxDepth, d.depth);

    if (APPLY && docs.length) {
      try {
        await comments.insertMany(docs, { ordered: false });
      } catch (e) {
        // 唯一索引冲突说明并发迁移，忽略
        if (e.code !== 11000) throw e;
      }
    }
  }

  console.log('\n含评论的帖子:', postWithComments);
  console.log('待/已迁移评论条数:', totalFlat);
  console.log('跳过（已迁移）:', skipped);
  console.log('最大层级:', maxDepth);

  const finalCount = await comments.countDocuments({});
  console.log('comments 集合当前总数:', finalCount);

  if (!APPLY) console.log('\n[DRY-RUN] 未写入。加 --apply 执行。');
  else console.log('\n迁移完成。Post.comments 保留作备份，未删除。');

  await mongoose.disconnect();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
