/* 移动端栏目帖子列表页 */
(function () {
  'use strict';

  var cid = new URLSearchParams(location.search).get('id') || '';
  var state = { page: 1, limit: 10, hasNext: false, loading: false, favSet: new Set() };
  var $list, $more, $title, $sub;

  async function loadFavorites() {
    if (!mApp.auth.isLoggedIn()) return;
    try {
      var d = await mApp.api.get('/api/favorites/user/' + encodeURIComponent(mApp.auth.user.id), { silent: true });
      ((d && d.posts) || []).forEach(function (p) { if (p && p.id) state.favSet.add(p.id); });
    } catch (e) { /* 忽略 */ }
  }

  async function load(reset) {
    if (!cid || state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      $list.innerHTML = mApp.skeleton(3);
      $more.style.display = 'none';
    }

    try {
      var d = await mApp.api.get('/api/categories/' + encodeURIComponent(cid) + '/posts?page=' +
        state.page + '&limit=' + state.limit, { silent: true });
      var posts = (d && d.posts) || [];
      var cat = d && d.category;
      var pg = (d && d.pagination) || {};

      if (cat) {
        $title.firstChild.nodeValue = cat.name || '栏目';
        document.title = (cat.name || '栏目') + ' - 校园论坛';
        $sub.textContent = cat.description || '';
      }

      if (reset) $list.innerHTML = '';

      if (!posts.length && state.page === 1) {
        $list.innerHTML = mApp.empty('fa-inbox', '这个栏目还没有帖子');
      } else {
        $list.insertAdjacentHTML('beforeend', posts.map(function (p) {
          return mApp.renderPostCard(p, { truncate: 260, favSet: state.favSet });
        }).join(''));
        var totalPages = pg.totalPages || 0;
        state.hasNext = state.page < totalPages;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
        if (reset && typeof pg.total === 'number' && totalPages > 0) {
          $sub.textContent = ($sub.textContent ? $sub.textContent + ' · ' : '') + '共 ' + pg.total + ' 帖';
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
    $title = document.getElementById('m-title');
    $sub = document.getElementById('m-sub');

    mApp.renderTabBar('categories');
    mApp.bindPostActions($list);
    mApp.watchBottom(function () {
      if (state.hasNext) { state.page += 1; load(false); }
    });

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-categories.html';
    });

    if (!cid) {
      $list.innerHTML = mApp.empty('fa-circle-question', '缺少栏目参数', true);
      return;
    }

    mApp.auth.init().then(function () {
      if (mApp.auth.isLoggedIn()) mApp.refreshBadge();
      return loadFavorites();
    }).then(function () { load(true); });
  });
})();