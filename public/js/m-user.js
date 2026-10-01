/* 移动端用户资料页：查看他人 / 自己的资料 */
(function () {
  'use strict';

  var uid = new URLSearchParams(location.search).get('id') || '';
  var state = { data: null, isBlocked: false };
  var $host;

  function esc(s) { return mApp.escape(s); }

  function heroHtml(d) {
    var u = d.user || {};
    var name = esc(u.username || '用户');
    var avatar = u.avatar
      ? '<div class="m-avatar" style="background-image:url(\'' + esc(u.avatar) + '\')"></div>'
      : '<div class="m-avatar">' + esc(name.slice(0, 1)) + '</div>';
    var sub = [u.school, u.grade, u.className].filter(Boolean).join(' · ');
    var sig = u.settings && u.settings.signature ? u.settings.signature : '';
    var st = d.stats || {};

    return '<section class="m-hero">' +
      '<div class="m-hero-top">' + avatar +
        '<div style="min-width:0">' +
          '<div class="m-hero-name">' + name +
            (u.isAdmin ? ' <span class="m-tag">管理员</span>' : '') + '</div>' +
          '<div class="m-hero-sub">' + esc(sub || '校园论坛用户') + '</div>' +
        '</div>' +
      '</div>' +
      (sig ? '<div style="margin-top:10px;font-size:12.5px;opacity:.9">' + esc(sig) + '</div>' : '') +
      '<div class="m-hero-stats">' +
        '<div class="m-hero-stat"><b>' + (st.postCount || 0) + '</b><span>发帖</span></div>' +
        '<div class="m-hero-stat"><b>' + (st.commentCount || 0) + '</b><span>评论</span></div>' +
        '<div class="m-hero-stat"><b>' + (st.totalLikes || 0) + '</b><span>获赞</span></div>' +
        '<div class="m-hero-stat"><b>' + (st.totalViews || 0) + '</b><span>浏览</span></div>' +
      '</div>' +
    '</section>';
  }

  function actionsHtml(d) {
    if (d.isSelf) {
      return '<div class="m-btns" style="margin-top:10px">' +
        '<a class="m-btn m-btn-primary" href="m-settings.html"><i class="fas fa-pen"></i>编辑资料</a>' +
        '</div>';
    }
    var following = !!d.isFollower;
    return '<div class="m-btns" style="margin-top:10px">' +
      '<button class="m-btn ' + (following ? 'm-btn-ghost' : 'm-btn-primary') + '" id="m-follow">' +
        '<i class="fas ' + (following ? 'fa-user-check' : 'fa-user-plus') + '"></i>' +
        (following ? '已关注' : '关注') + '</button>' +
      '<a class="m-btn m-btn-ghost" href="m-chat.html?to=' + encodeURIComponent(uid) + '&name=' +
        encodeURIComponent((d.user && d.user.username) || '') + '"><i class="fas fa-envelope"></i>私信</a>' +
    '</div>';
  }

  function infoHtml(d) {
    var u = d.user || {};
    var rows = [];
    var st = d.stats || {};
    if (u.gender) rows.push(['性别', u.gender === 'male' ? '男' : (u.gender === 'female' ? '女' : u.gender)]);
    if (u.birthday) rows.push(['生日', u.birthday]);
    if (u.school) rows.push(['学校', u.school]);
    if (u.enrollmentYear) rows.push(['入学年份', u.enrollmentYear + ' 年']);
    if (st.joinDate) rows.push(['加入时间', new Date(st.joinDate).toLocaleDateString('zh-CN')]);
    if (d.isSelf && st.lastLogin) rows.push(['最近登录', new Date(st.lastLogin).toLocaleString('zh-CN')]);

    if (!rows.length) return '';
    return '<div class="m-list" style="margin-top:10px">' + rows.map(function (r) {
      return '<div class="m-row"><span class="m-row-label">' + esc(r[0]) +
        '</span><span class="m-row-value">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  // 拉黑/解除拉黑（仅查看他人时显示）
  function blockRowHtml() {
    var blocked = !!state.isBlocked;
    return '<div class="m-list" style="margin-top:10px">' +
      '<button class="m-row' + (blocked ? '' : ' m-danger') + '" id="m-block">' +
        '<i class="fas ' + (blocked ? 'fa-user-check' : 'fa-user-slash') + ' m-row-ico"></i>' +
        '<span class="m-row-label">' + (blocked ? '解除拉黑' : '拉黑该用户') + '</span>' +
        '<i class="fas fa-chevron-right m-chev"></i>' +
      '</button></div>';
  }

  function bindBlock() {
    var btn = document.getElementById('m-block');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      if (!mApp.auth.require('请先登录后再操作')) return;
      var blocked = !!state.isBlocked;
      if (!blocked && !confirm('拉黑后对方无法关注你、给你发私信，其帖子对你隐藏。确定拉黑？')) return;
      btn.disabled = true;
      try {
        await mApp.api.post(blocked ? '/api/unblock' : '/api/block', { blockedId: uid });
        state.isBlocked = !blocked;
        mApp.toast(blocked ? '已解除拉黑' : '已拉黑', 'success');
        setTimeout(function () { location.reload(); }, 600);
      } catch (e) { btn.disabled = false; }
    });
  }

  async function load() {
    if (!uid) {
      $host.innerHTML = mApp.empty('fa-circle-question', '缺少用户参数', true);
      return;
    }
    $host.innerHTML = mApp.skeleton(2);
    try {
      var d = await mApp.api.get('/api/user/profile/' + encodeURIComponent(uid), { silent: true });
      state.data = d;
      var posts = (d && d.recentPosts) || [];

      // 拉黑状态（仅他人资料）
      if (!d.isSelf && mApp.auth.isLoggedIn()) {
        try {
          var bs = await mApp.api.get('/api/block/status?blockerId=' +
            encodeURIComponent(mApp.auth.user.id) + '&blockedId=' + encodeURIComponent(uid), { silent: true });
          state.isBlocked = !!(bs && bs.data && bs.data.isBlocked);
        } catch (e) { /* 状态获取失败不阻塞 */ }
      }

      $host.innerHTML = heroHtml(d) + actionsHtml(d) + infoHtml(d) +
        (d.isSelf ? '' : blockRowHtml()) +
        '<div class="m-section-title" style="margin-top:16px">' +
          '<span><i class="fas fa-file-lines"></i>' +
          (d.isSelf ? '我的帖子' : 'TA 的帖子') + '</span></div>' +
        (posts.length
          ? posts.map(function (p) { return mApp.renderPostCard(p, { truncate: 160 }); }).join('')
          : mApp.empty('fa-inbox', '还没有帖子'));

      document.title = ((d.user && d.user.username) || '用户') + ' - 校园论坛';
      if (!d.isSelf) bindBlock();

      // 关注按钮
      var btn = document.getElementById('m-follow');
      if (btn) {
        btn.addEventListener('click', async function () {
          if (!mApp.auth.require('请先登录后再关注')) return;
          var following = !!state.data.isFollower;
          btn.disabled = true;
          try {
            if (following) await mApp.api.post('/api/unfollow', { followingId: uid });
            else await mApp.api.post('/api/follow', { followingId: uid });
            mApp.toast(following ? '已取消关注' : '已关注', 'success');
            setTimeout(function () { location.reload(); }, 600);
          } catch (e) {
            btn.disabled = false;
          }
        });
      }

      if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([$host]).catch(function () {});
    } catch (e) {
      $host.innerHTML = mApp.empty('fa-triangle-exclamation',
        (e && e.status === 404) ? '用户不存在' : '加载失败，请稍后重试', true);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $host = document.getElementById('m-host');
    mApp.auth.init().then(function (u) {
      if (!u) {
        mApp.toast('请先登录后查看资料', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-user.html' + location.search);
        }, 800);
        return;
      }
      load();
    });

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-index.html';
    });
  });
})();