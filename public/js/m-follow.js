/* 移动端「关注动态」页 */
(function () {
  'use strict';

  var state = { page: 1, limit: 10, hasNext: false, loading: false, favSet: new Set() };
  var $list, $more;

  async function loadFavorites() {
    try {
      var d = await mApp.api.get('/api/favorites/user/' + encodeURIComponent(mApp.auth.user.id), { silent: true });
      ((d && d.posts) || []).forEach(function (p) { if (p && p.id) state.favSet.add(p.id); });
    } catch (e) { /* 忽略 */ }
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      $list.innerHTML = mApp.skeleton(3);
      $more.style.display = 'none';
    }

    var uid = mApp.auth.user.id;
    try {
      var d = await mApp.api.get('/api/following/posts/' + encodeURIComponent(uid) +
        '?page=' + state.page + '&limit=' + state.limit, { silent: true });
      var posts = (d && d.posts) || [];
      var pg = (d && d.pagination) || {};

      if (reset) $list.innerHTML = '';

      if (!posts.length && state.page === 1) {
        $list.innerHTML = '<div class="m-empty">' +
          '<i class="fas fa-user-group"></i>' +
          '你还没有关注任何人，或者关注的人还没发帖<br>' +
          '<a class="m-btn m-btn-primary" style="display:inline-flex;width:auto;padding:0 20px;margin-top:16px" href="m-follow-list.html">去关注同学</a>' +
          '</div>';
      } else {
        $list.insertAdjacentHTML('beforeend', posts.map(function (p) {
          return mApp.renderPostCard(p, { truncate: 260, favSet: state.favSet });
        }).join(''));
        state.hasNext = !!pg.hasNext;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
      }
    } catch (e) {
      if (reset) $list.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请稍后重试', true);
    } finally {
      state.loading = false;
      if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([$list]).catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $list = document.getElementById('m-list');
    $more = document.getElementById('m-more');

    mApp.renderTabBar('profile');
    mApp.bindPostActions($list);
    mApp.watchBottom(function () {
      if (state.hasNext) { state.page += 1; load(false); }
    });

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-profile.html';
    });

    mApp.auth.init().then(function () {
      if (!mApp.auth.isLoggedIn()) {
        mApp.toast('请先登录后查看动态', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-following.html');
        }, 800);
        return;
      }
      // 进入即标记已查看（清除"新动态"角标）
      mApp.api.post('/api/follow/mark-viewed', {}, { silent: true }).catch(function () {});
      loadFavorites().then(function () { load(true); });
    });
  });
})();