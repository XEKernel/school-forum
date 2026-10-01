/* 移动端「我的」页：用户卡 + 数据 + 功能入口 */
(function () {
  'use strict';

  var $host;
  function esc(s) { return mApp.escape(s); }

  function row(icon, label, href, extra) {
    var inner = '<i class="fas ' + icon + ' m-row-ico"></i>' +
      '<span class="m-row-label">' + label + '</span>' +
      (extra ? '<span class="m-row-value">' + extra + '</span>' : '') +
      '<i class="fas fa-chevron-right m-chev"></i>';
    if (href) return '<a class="m-row" href="' + href + '">' + inner + '</a>';
    return '<button class="m-row" data-role="btn">' + inner + '</button>';
  }

  function hero(user, stats) {
    var name = esc(user.username || '用户');
    var sub = esc(mApp.auth.classText() || '校园论坛用户');
    var avatar = user.avatar
      ? '<div class="m-avatar" style="background-image:url(\'' + esc(user.avatar) + '\')"></div>'
      : '<div class="m-avatar">' + esc(name.slice(0, 1)) + '</div>';

    return '<section class="m-hero">' +
      '<div class="m-hero-top">' + avatar +
        '<div><div class="m-hero-name">' + name + '</div>' +
        '<div class="m-hero-sub">' + sub + '</div></div>' +
      '</div>' +
      '<div class="m-hero-stats">' +
        '<div class="m-hero-stat"><b>' + (stats.posts || 0) + '</b><span>发帖</span></div>' +
        '<div class="m-hero-stat"><b>' + (stats.following || 0) + '</b><span>关注</span></div>' +
        '<div class="m-hero-stat"><b>' + (stats.followers || 0) + '</b><span>粉丝</span></div>' +
        '<div class="m-hero-stat"><b>' + (stats.favorites || 0) + '</b><span>收藏</span></div>' +
      '</div>' +
    '</section>';
  }

  function guestView() {
    return '<div class="m-guest">' +
      '<i class="fas fa-user-circle m-guest-ico"></i>' +
      '<h2>尚未登录</h2>' +
      '<p>登录后可发帖、评论、收藏和接收消息</p>' +
      '<div class="m-btns">' +
        '<button class="m-btn m-btn-primary" id="m-login"><i class="fas fa-right-to-bracket"></i>登录</button>' +
        '<button class="m-btn m-btn-ghost" id="m-register"><i class="fas fa-user-plus"></i>注册</button>' +
      '</div></div>';
  }

  function userView(user, stats) {
    var menu =
      '<div class="m-list">' +
        row('fa-user', '个人资料', 'm-user.html?id=' + encodeURIComponent(user.id)) +
        row('fa-star', '我的收藏', 'm-favorites.html') +
        row('fa-users', '我的关注', 'm-following.html') +
        row('fa-user-group', '关注/粉丝', 'm-follow-list.html') +
        row('fa-envelope', '私信', 'm-chat.html') +
        row('fa-bell', '消息通知', 'm-messages.html') +
        row('fa-ban', '黑名单', 'm-blacklist.html') +
      '</div>' +
      '<div class="m-list">' +
        row('fa-gear', '设置', 'm-settings.html') +
        (mApp.auth.isAdmin() ? row('fa-shield-halved', '管理后台', '/admin.html') : '') +
      '</div>' +
      '<div class="m-list">' +
        row('fa-right-from-bracket', '退出登录', null) +
      '</div>';

    return hero(user, stats) + menu;
  }

  async function fetchStats(user) {
    var out = { posts: user.postCount || 0, following: 0, followers: 0, favorites: 0 };
    await Promise.all([
      mApp.api.get('/api/follow/stats/' + encodeURIComponent(user.id), { silent: true })
        .then(function (d) {
          if (d) {
            out.following = d.followingCount || 0;
            out.followers = d.followerCount || 0;
          }
        }).catch(function () {}),
      mApp.api.get('/api/favorites/user/' + encodeURIComponent(user.id) + '/count', { silent: true })
        .then(function (d) { if (d) out.favorites = d.count || 0; })
        .catch(function () {})
    ]);
    return out;
  }

  async function render() {
    if (!mApp.auth.isLoggedIn()) {
      $host.innerHTML = guestView();
      var l = document.getElementById('m-login');
      var r = document.getElementById('m-register');
      if (l) l.addEventListener('click', function () { location.href = 'm-login.html'; });
      if (r) r.addEventListener('click', function () { location.href = 'm-login.html?register=true'; });
      return;
    }

    var user = mApp.auth.user;
    $host.innerHTML = userView(user, { posts: user.postCount || 0 }) +
      '<div class="m-loadmore" id="m-stats-loading">统计加载中…</div>';

    var stats = await fetchStats(user);
    var loading = document.getElementById('m-stats-loading');
    if (loading) loading.remove();
    $host.innerHTML = userView(user, stats);

    var logoutBtn = $host.querySelector('.m-row[data-role="btn"]');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        await mApp.auth.logout();
        mApp.toast('已退出登录', 'success');
        setTimeout(render, 500);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $host = document.getElementById('m-profile-host');
    mApp.renderTabBar('profile');
    mApp.auth.init().then(render);
  });
})();