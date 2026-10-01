/* 移动端栏目页：栏目网格 + 申请入口 */
(function () {
  'use strict';

  var $host;

  function esc(s) { return mApp.escape(s); }

  function catCard(c) {
    var icon = c.icon ? esc(c.icon) : 'fa-folder';
    return '<a class="m-cat" href="m-category.html?id=' + esc(c.id) + '">' +
      '<div class="m-cat-ico"><i class="fas ' + icon + '"></i></div>' +
      '<div class="m-cat-name">' + esc(c.name) + '</div>' +
      (c.description ? '<div class="m-cat-desc">' + esc(c.description) + '</div>' : '') +
      '<div class="m-cat-count">' + (c.postCount || 0) + ' 篇帖子</div>' +
      '</a>';
  }

  function gridSkeleton() {
    var one = '<div class="m-cat"><div class="m-skel-line w40"></div>' +
      '<div class="m-skel-line w95"></div><div class="m-skel-line w70"></div></div>';
    return '<div class="m-cat-grid">' + new Array(7).join(one) + '</div>';
  }

  async function load() {
    $host.innerHTML = gridSkeleton();
    try {
      var data = await mApp.api.get('/api/categories', { silent: true });
      var cats = ((data && data.categories) || []).filter(function (c) { return c.isActive !== false; });
      $host.innerHTML = cats.length
        ? '<div class="m-cat-grid">' + cats.map(catCard).join('') + '</div>'
        : mApp.empty('fa-folder-open', '暂无栏目');
    } catch (e) {
      $host.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请稍后重试', true);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $host = document.getElementById('m-cat-host');
    mApp.renderTabBar('categories');
    mApp.auth.init().then(function () {
      if (mApp.auth.isLoggedIn()) mApp.refreshBadge();
    });
    load();
  });
})();