/* 移动端「关注 / 粉丝」列表页 */
(function () {
  'use strict';

  var state = { type: 'following', page: 1, limit: 20, hasNext: false, loading: false };
  var $list, $more, $seg;

  function rowHtml(u) {
    var name = mApp.escape(u.username || '用户');
    var sub = [u.school, u.grade, u.className].filter(Boolean).join(' · ');
    var avatar = u.avatar
      ? '<div class="m-avatar" style="background-image:url(\'' + mApp.escape(u.avatar) + '\')"></div>'
      : '<div class="m-avatar">' + mApp.escape(name.slice(0, 1)) + '</div>';
    var isMe = mApp.auth.user && u.id === mApp.auth.user.id;
    var btn = isMe ? '' :
      '<button class="m-follow-btn' + (u.isFollowing ? ' on' : '') + '" data-uid="' +
      mApp.escape(u.id) + '" data-on="' + (u.isFollowing ? '1' : '0') + '">' +
      (u.isFollowing ? '已关注' : '关注') + '</button>';

    return '<div class="m-user-row" data-uid="' + mApp.escape(u.id) + '">' + avatar +
      '<div class="m-user-main">' +
        '<div class="m-user-name">' + name +
          (u.isAdmin ? ' <span class="m-tag">管理员</span>' : '') + '</div>' +
        (sub ? '<div class="m-user-sub">' + mApp.escape(sub) + '</div>' : '') +
      '</div>' + btn + '</div>';
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      $list.innerHTML = mApp.skeleton(3);
      $more.style.display = 'none';
    }

    var me = mApp.auth.user.id;
    var url = state.type === 'following'
      ? '/api/following/' + encodeURIComponent(me)
      : '/api/followers/' + encodeURIComponent(me);
    url += '?page=' + state.page + '&limit=' + state.limit + '&currentUserId=' + encodeURIComponent(me);

    try {
      var d = await mApp.api.get(url, { silent: true });
      var list = (d && d.list) || [];
      var pg = (d && d.pagination) || {};

      if (reset) $list.innerHTML = '';

      if (!list.length && state.page === 1) {
        $list.innerHTML = state.type === 'following'
          ? mApp.empty('fa-user-plus', '还没有关注任何人')
          : mApp.empty('fa-user-group', '还没有粉丝');
      } else {
        $list.insertAdjacentHTML('beforeend', list.map(rowHtml).join(''));
        state.hasNext = !!pg.hasNext;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
      }
    } catch (e) {
      if (reset) $list.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请稍后重试', true);
    } finally {
      state.loading = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $list = document.getElementById('m-list');
    $more = document.getElementById('m-more');
    $seg = document.getElementById('m-seg');

    mApp.renderTabBar('profile');
    mApp.watchBottom(function () {
      if (state.hasNext) { state.page += 1; load(false); }
    });

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-profile.html';
    });

    // 切换 关注/粉丝
    $seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      $seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.type = btn.getAttribute('data-type');
      load(true);
    });

    // 点击用户 → 打开资料页；点击按钮 → 关注/取关
    $list.addEventListener('click', async function (e) {
      var btn = e.target.closest('.m-follow-btn');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        var uid = btn.getAttribute('data-uid');
        var on = btn.getAttribute('data-on') === '1';
        btn.disabled = true;
        try {
          if (on) await mApp.api.post('/api/unfollow', { followingId: uid });
          else await mApp.api.post('/api/follow', { followingId: uid });
          btn.setAttribute('data-on', on ? '0' : '1');
          btn.classList.toggle('on', !on);
          btn.textContent = on ? '关注' : '已关注';
          mApp.toast(on ? '已取消关注' : '已关注', 'success');
        } catch (err) { /* 已提示 */ }
        btn.disabled = false;
        return;
      }
      var row = e.target.closest('.m-user-row');
      if (row) {
        location.href = 'm-user.html?id=' + encodeURIComponent(row.getAttribute('data-uid'));
      }
    });

    mApp.auth.init().then(function () {
      if (!mApp.auth.isLoggedIn()) {
        mApp.toast('请先登录后查看', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-follow-list.html');
        }, 800);
        return;
      }
      load(true);
    });
  });
})();