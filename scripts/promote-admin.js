#!/usr/bin/env node
/**
 * 管理员提权/撤销工具（运维在服务器本地执行，不暴露 HTTP 接口）
 *
 * 用法：
 *   node scripts/promote-admin.js <QQ | 用户名 | 邮箱 | 用户UUID>
 *   node scripts/promote-admin.js <QQ | 用户名 | 邮箱 | 用户UUID> --demote
 *
 * 安全背景：QQ 是注册者自填、可被 changeQQ 改绑的标识，不能作为管理员授权来源。
 * 因此首次部署不再预写 QQ 白名单，而是等目标账号注册后由运维在服务器上执行本脚本。
 */
'use strict';

require('dotenv').config();

const { connectDB, disconnectDB } = require('../src/models');
const { MONGODB_URI, MONGODB_OPTIONS } = require('../src/config/constants');
const User = require('../src/models/User');
const { addAdmin, removeAdmin } = require('../src/utils/configUtils');

function usage() {
  console.error('用法: node scripts/promote-admin.js <QQ|用户名|邮箱|用户UUID> [--demote]');
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--demote');
  const target = args[0];
  const demote = process.argv.includes('--demote');
  if (!target) {
    usage();
    return 2;
  }

  await connectDB(MONGODB_URI, MONGODB_OPTIONS);
  const normalized = String(target).trim();
  const user = await User.findOne({
    $or: [
      { id: normalized },
      { qq: normalized },
      { username: normalized },
      { email: normalized.toLowerCase() }
    ]
  }).lean();

  if (!user) {
    console.error(`未找到用户：${normalized}`);
    await disconnectDB();
    return 1;
  }

  if (demote) {
    await User.updateOne({ id: user.id }, { $set: { role: 'user' } });
    removeAdmin(user.id);
    console.log(`已撤销管理员：${user.username} (${user.id})`);
  } else {
    await User.updateOne({ id: user.id }, { $set: { role: 'admin', isActive: true } });
    addAdmin(user.id);
    console.log(`已提升为管理员：${user.username} (${user.id})`);
    console.log('提示：管理员需重新登录（或等待旧会话被 passwordChangedAt/角色校验拦截）后生效。');
  }

  await disconnectDB();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('执行失败:', error.message);
    process.exit(1);
  });
