/* 移动端黑名单页 */
(function () {
  'use strict';

  var state = { page: 1, limit: 20, hasNext: false, loading: false };
  var $list, $more, $count;

  function esc(s) { return mApp.escape(s); }

  function rowHtml(u) {
    var name = esc(u.username || '用户');
    var sub = [u.school, u.grade, u.className].filter(Boolean).join(' · ');
    var avatar = u.avatar
      ? '<div class="m-avatar" style="background-image:url(\'' + esc(u.avatar) + '\')"></div>'
      : '<div class="m-avatar">' + esc(name.slice(0, 1)) + '</div>';
    return '<div class="m-user-row" data-uid="' + esc(u.id) + '">' + avatar +
      '<div class="m-user-main">' +
        '<div class="m-user-name">' + name + '</div>' +
        (sub ? '<div class="m-user-sub">' + esc(sub) + '</div>' : '') +
        '<div class="m-user-sub">拉黑于 ' + mApp.timeAgo(u.blockedAt) + '</div>' +
      '</div>' +
      '<button class="m-follow-btn" data-unblock="' + esc(u.id) + '">解除</button>' +
    '</div>';
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
      var d = await mApp.api.get('/api/blocked/' + encodeURIComponent(uid) +
        '?page=' + state.page + '&limit=' + state.limit, { silent: true });
      var payload = (d && d.data) || d || {};
      var list = payload.list || [];
      var pg = payload.pagination || {};

      if (reset) $list.innerHTML = '';

      if (!list.length && state.page === 1) {
        $list.innerHTML = mApp.empty('fa-user-shield', '黑名单是空的');
      } else {
        $list.insertAdjacentHTML('beforeend', list.map(rowHtml).join(''));
        state.hasNext = !!pg.hasNext;
        $more.style.display = state.hasNext ? 'block' : 'none';
        $more.textContent = state.hasNext ? '上拉加载更多' : '已经到底啦';
        if (reset && typeof pg.total === 'number') $count.textContent = '共 ' + pg.total + ' 人';
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
    $count = document.getElementById('m-count');

    mApp.watchBottom(function () {
      if (state.hasNext) { state.page += 1; load(false); }
    });

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-settings.html';
    });

    // 解除拉黑
    $list.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-unblock]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        var uid = btn.getAttribute('data-unblock');
        btn.disabled = true;
        try {
          await mApp.api.post('/api/unblock', { blockedId: uid });
          var row = btn.closest('.m-user-row');
          if (row) row.remove();
          mApp.toast('已解除拉黑', 'success');
          if (!$list.querySelector('.m-user-row')) {
            $list.innerHTML = mApp.empty('fa-user-shield', '黑名单是空的');
          }
        } catch (err) { btn.disabled = false; }
        return;
      }
      var row2 = e.target.closest('.m-user-row');
      if (row2) location.href = 'm-user.html?id=' + encodeURIComponent(row2.getAttribute('data-uid'));
    });

    mApp.auth.init().then(function () {
      if (!mApp.auth.isLoggedIn()) {
        mApp.toast('请先登录后查看黑名单', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-blacklist.html');
        }, 800);
        return;
      }
      load(true);
    });
  });
})();