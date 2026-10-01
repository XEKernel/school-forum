/* 移动端首页：帖子流 + 栏目筛选 + 排序 + 搜索 */
(function () {
  'use strict';

  var state = {
    page: 1,
    limit: 10,
    sortBy: 'recommended',
    categoryId: '',
    keyword: '',
    favorites: new Set(),
    hasNext: false,
    loading: false
  };

  var $list, $more, $cats, $announce;

  function esc(s) { return mApp.escape(s); }

  // ---------- 列表渲染 ----------
  function cardsHtml(posts) {
    return posts.map(function (p) {
      return mApp.renderPostCard(p, { truncate: 260, favSet: state.favorites });
    }).join('');
  }

  async function loadFavorites() {
    state.favorites = new Set();
    if (!mApp.auth.isLoggedIn()) return;
    try {
      var uid = mApp.auth.user.id;
      var data = await mApp.api.get('/api/favorites/user/' + encodeURIComponent(uid), { silent: true });
      var list = (data && (data.favorites || data.posts)) || [];
      list.forEach(function (f) {
        var pid = f.postId || (f.post && f.post.id) || f.id;
        if (pid) state.favorites.add(pid);
      });
    } catch (e) { /* 未登录或接口异常时忽略 */ }
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.page = 1;
      $list.innerHTML = mApp.skeleton(3);
      $more.style.display = 'none';
    }

    var q = [
      'page=' + state.page,
      'limit=' + state.limit,
      'sortBy=' + encodeURIComponent(state.sortBy)
    ];
    if (state.categoryId) q.push('categoryId=' + encodeURIComponent(state.categoryId));
    if (state.keyword) q.push('search=' + encodeURIComponent(state.keyword));

    try {
      var data = await mApp.api.get('/api/posts?' + q.join('&'), { silent: true });
      var posts = (data && data.posts) || [];

      if (reset) $list.innerHTML = '';

      if (!posts.length) {
        if (reset) {
          $list.innerHTML = state.keyword
            ? mApp.empty('fa-magnifying-glass', '没有找到相关帖子')
            : mApp.empty('fa-inbox', '暂时没有帖子，来发第一帖吧');
        }
        $more.style.display = 'none';
      } else {
        $list.insertAdjacentHTML('beforeend', cardsHtml(posts));
        var pg = (data && data.pagination) || {};
        state.hasNext = !!pg.hasNext;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
        if (!state.hasNext) $more.textContent = '已经到底啦';
      }
    } catch (e) {
      if (reset) $list.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请下拉重试', true);
    } finally {
      state.loading = false;
      if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise([$list]).catch(function () {});
      }
    }
  }

  // 下一页（滚动到底自动加载）
  async function loadMore() {
    if (!state.hasNext || state.loading) return;
    state.page += 1;
    await load(false);
  }

  // ---------- 栏目 chips ----------
  async function loadCategories() {
    try {
      var data = await mApp.api.get('/api/categories', { silent: true });
      var cats = (data && data.categories) || [];
      var html = '<button class="m-chip active" data-cat="">全部</button>';
      html += cats.filter(function (c) { return c.isActive !== false; }).map(function (c) {
        var icon = c.icon ? '<i class="fas ' + esc(c.icon) + '"></i>' : '';
        return '<button class="m-chip" data-cat="' + esc(c.id) + '">' + icon + esc(c.name) + '</button>';
      }).join('');
      $cats.innerHTML = html;
    } catch (e) {
      $cats.innerHTML = '<button class="m-chip active" data-cat="">全部</button>';
    }
  }

  // ---------- 公告 ----------
  async function loadAnnounce() {
    try {
      var data = await mApp.api.get('/api/announcements/active', { silent: true });
      var list = (data && data.announcements) || [];
      if (!list.length) { $announce.innerHTML = ''; return; }
      var a = list[0];
      $announce.innerHTML = '<div class="m-announce"><i class="fas fa-bullhorn"></i><div>' +
        '<b>' + esc(a.title || '公告') + '</b>' + esc(a.content || a.message || '') + '</div></div>';
    } catch (e) { $announce.innerHTML = ''; }
  }

  // ---------- 搜索 ----------
  var $search, $searchInput, $searchBody;

  function openSearch() {
    $search.classList.add('open');
    setTimeout(function () { $searchInput.focus(); }, 60);
  }
  function closeSearch() {
    $search.classList.remove('open');
    $searchInput.value = '';
    $searchBody.innerHTML = '';
    state.keyword = '';
  }
  async function runSearch() {
    var kw = $searchInput.value.trim();
    if (!kw) return;
    state.keyword = kw;
    $searchBody.innerHTML = mApp.skeleton(3);
    try {
      var data = await mApp.api.get('/api/posts?search=' + encodeURIComponent(kw) + '&limit=20', { silent: true });
      var posts = (data && data.posts) || [];
      $searchBody.innerHTML = posts.length
        ? posts.map(function (p) { return mApp.renderPostCard(p, { truncate: 160, favSet: state.favorites }); }).join('')
        : mApp.empty('fa-magnifying-glass', '没有找到「' + kw + '」相关的帖子');
    } catch (e) {
      $searchBody.innerHTML = mApp.empty('fa-triangle-exclamation', '搜索失败，请重试', true);
    }
  }

  // ---------- 初始化 ----------
  document.addEventListener('DOMContentLoaded', async function () {
    $list = document.getElementById('m-list');
    $more = document.getElementById('m-more');
    $cats = document.getElementById('m-cats');
    $announce = document.getElementById('m-announce-host');
    $search = document.getElementById('m-search');
    $searchInput = document.getElementById('m-search-input');
    $searchBody = document.getElementById('m-search-body');

    mApp.renderTabBar('home');
    mApp.bindPostActions($list);
    mApp.bindPostActions($searchBody);
    mApp.auth.init().then(function () {
      if (mApp.auth.isLoggedIn()) mApp.refreshBadge();
    });

    await Promise.all([loadCategories(), loadAnnounce(), loadFavorites()]);
    load(true);

    // 栏目切换
    $cats.addEventListener('click', function (e) {
      var chip = e.target.closest('.m-chip');
      if (!chip) return;
      $cats.querySelectorAll('.m-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.categoryId = chip.getAttribute('data-cat') || '';
      load(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 排序切换
    document.getElementById('m-sorts').addEventListener('click', function (e) {
      var chip = e.target.closest('.m-chip');
      if (!chip) return;
      document.querySelectorAll('#m-sorts .m-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.sortBy = chip.getAttribute('data-sort');
      load(true);
    });

    // 搜索
    document.getElementById('m-search-btn').addEventListener('click', openSearch);
    document.getElementById('m-search-cancel').addEventListener('click', closeSearch);
    $searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });
    $searchBody.addEventListener('click', function (e) {
      var card = e.target.closest('.m-post');
      if (card && !e.target.closest('[data-act]') && !e.target.closest('[data-view]')) {
        closeSearch();
      }
    });

    // 滚动到底自动加载
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) loadMore();
      });
    }, { passive: true });
  });
})();