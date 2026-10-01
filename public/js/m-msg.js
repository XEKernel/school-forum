/* 移动端消息页：通知列表（点赞/评论/关注/系统）+ 全部已读 */
(function () {
  'use strict';

  var state = { list: [], filter: '' };
  var $notes, $seg;

  function esc(s) { return mApp.escape(s); }

  function typeMeta(n) {
    switch (n.type) {
      case 'like': return { icon: 'fa-heart', name: '点赞' };
      case 'comment': return { icon: 'fa-comment', name: '评论' };
      case 'comment_reply': return { icon: 'fa-reply', name: '回复' };
      case 'follow': return { icon: 'fa-user-plus', name: '关注' };
      case 'system': return { icon: 'fa-bullhorn', name: '系统' };
      default: return { icon: 'fa-bell', name: '通知' };
    }
  }

  // 单条通知的正文与跳转目标
  function bodyOf(n) {
    var from = n.fromUsername ? esc(n.fromUsername) : '有人';
    switch (n.type) {
      case 'like':
        return from + ' 赞了你的帖子' +
          (n.postTitle ? '「' + esc(n.postTitle) + '」' : '');
      case 'comment':
        return from + ' 评论了你的帖子' +
          (n.postTitle ? '「' + esc(n.postTitle) + '」' : '') +
          (n.content ? '：' + esc(n.content) : '');
      case 'comment_reply':
        return from + ' 回复了你的评论' +
          (n.content ? '：' + esc(n.content) : '');
      case 'follow':
        return from + ' 关注了你';
      case 'system':
        return n.message ? esc(n.message) : (n.title ? esc(n.title) : '系统通知');
      default:
        return esc(n.content || n.message || n.title || '');
    }
  }

  function targetOf(n) {
    if (n.type === 'follow' && n.fromUserId) return 'm-user.html?id=' + encodeURIComponent(n.fromUserId);
    if (n.postId) return 'm-post.html?id=' + encodeURIComponent(n.postId);
    return '';
  }

  function render() {
    var list = state.list.filter(function (n) {
      if (!state.filter) return true;
      if (state.filter === 'comment') return n.type === 'comment' || n.type === 'comment_reply';
      return n.type === state.filter;
    });

    if (!list.length) {
      $notes.innerHTML = mApp.empty('fa-bell-slash', state.filter ? '这个分类下暂无消息' : '暂无消息');
      return;
    }

    $notes.innerHTML = list.map(function (n) {
      var meta = typeMeta(n);
      var body = bodyOf(n);
      var href = targetOf(n);
      return '<div class="m-note' + (n.read ? '' : ' unread') + '" data-id="' + esc(n.id) + '"' +
        (href ? ' data-href="' + esc(href) + '"' : '') + '>' +
        '<div class="m-note-ico"><i class="fas ' + meta.icon + '"></i></div>' +
        '<div class="m-note-main">' +
          '<div class="m-note-title">' + meta.name + '</div>' +
          '<div class="m-note-text">' + body + '</div>' +
          '<div class="m-note-time">' + mApp.timeAgo(n.timestamp) + '</div>' +
        '</div>' +
        (n.read ? '' : '<span class="m-note-dot"></span>') +
      '</div>';
    }).join('');
  }

  async function load() {
    if (!mApp.auth.isLoggedIn()) {
      $seg.style.display = 'none';
      $notes.innerHTML = '<div class="m-guest">' +
        '<i class="fas fa-bell-slash m-guest-ico"></i>' +
        '<h2>登录后查看消息</h2><p>点赞、评论、关注等动态都会在这里汇总</p>' +
        '<div class="m-btns"><button class="m-btn m-btn-primary" id="m-go-login">' +
        '<i class="fas fa-right-to-bracket"></i>去登录</button></div></div>';
      var btn = document.getElementById('m-go-login');
      if (btn) btn.addEventListener('click', function () { location.href = 'm-login.html'; });
      return;
    }

    $seg.style.display = 'flex';
    $notes.innerHTML = mApp.skeleton(3);
    try {
      var data = await mApp.api.get('/api/notifications', { silent: true });
      state.list = ((data && data.notifications) || []).sort(function (a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      render();
      mApp.refreshBadge();
    } catch (e) {
      $notes.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请稍后重试', true);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $notes = document.getElementById('m-notes');
    $seg = document.getElementById('m-seg');

    mApp.renderTabBar('messages');
    mApp.auth.init().then(load);

    // 分类切换
    $seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      $seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.filter = btn.getAttribute('data-type') || '';
      render();
    });

    // 点击消息：标记已读并跳转
    $notes.addEventListener('click', async function (e) {
      var item = e.target.closest('.m-note');
      if (!item) return;
      var id = item.dataset.id;
      var href = item.dataset.href;
      var isUnread = item.classList.contains('unread');

      if (isUnread && id) {
        item.classList.remove('unread');
        var dot = item.querySelector('.m-note-dot');
        if (dot) dot.remove();
        try { await mApp.api.post('/api/notifications/' + encodeURIComponent(id) + '/read', {}, { silent: true }); } catch (err) { /* 忽略 */ }
        mApp.refreshBadge();
      }
      if (href) location.href = href;
    });

    // 全部已读
    document.getElementById('m-readall-btn').addEventListener('click', async function () {
      if (!mApp.auth.require('请先登录')) return;
      var hasUnread = state.list.some(function (n) { return !n.read; });
      if (!hasUnread) { mApp.toast('没有未读消息', 'info'); return; }
      try {
        await mApp.api.post('/api/notifications/read-all', {});
        state.list.forEach(function (n) { n.read = true; });
        render();
        mApp.refreshBadge();
        mApp.toast('已全部标记为已读', 'success');
      } catch (e) { /* 已提示 */ }
    });
  });
})();