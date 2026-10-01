/* 移动端「我的收藏」页 */
(function () {
  'use strict';

  var state = { page: 1, limit: 10, hasNext: false, loading: false, ids: new Set() };
  var $list, $more, $count;

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      state.ids = new Set();
      $list.innerHTML = mApp.skeleton(3);
      $more.style.display = 'none';
    }

    var uid = mApp.auth.user.id;
    try {
      var d = await mApp.api.get('/api/favorites/user/' + encodeURIComponent(uid) +
        '?page=' + state.page + '&limit=' + state.limit, { silent: true });
      var posts = (d && d.posts) || [];
      var pg = (d && d.pagination) || {};

      if (reset) $list.innerHTML = '';

      if (!posts.length && state.page === 1) {
        $list.innerHTML = mApp.empty('fa-star', '还没有收藏的帖子，去收藏一些吧');
      } else {
        var html = posts.map(function (p) {
          if (p.isDeleted) {
            return '<div class="m-post" style="padding:14px;color:var(--m-text-3);font-size:13px">' +
              '<i class="fas fa-circle-info"></i> 该帖子已被删除</div>';
          }
          state.ids.add(p.id);
          return mApp.renderPostCard(p, { truncate: 200, favSet: state.ids });
        }).join('');
        $list.insertAdjacentHTML('beforeend', html);
        state.hasNext = !!pg.hasNext;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
        if (reset && typeof pg.totalPosts === 'number') {
          $count.textContent = '共 ' + pg.totalPosts + ' 条';
        }
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
    $count = document.getElementById('m-count');

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
        mApp.toast('请先登录后查看收藏', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-favorites.html');
        }, 800);
        return;
      }
      load(true);
    });
  });
})();