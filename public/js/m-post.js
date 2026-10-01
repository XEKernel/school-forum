/* 移动端帖子详情页：正文 + 评论 + 回复 */
(function () {
  'use strict';

  var postId = new URLSearchParams(location.search).get('id') || '';
  var state = { post: null, replyTo: null, favorites: new Set(), liked: false };
  var $host, $cmtHost, $cmtTitle, $cmtCount, $input, $send;

  function esc(s) { return mApp.escape(s); }

  // ---------- 帖子正文 ----------
  function detailHtml(post) {
    var me = mApp.auth.user;
    var name = post.anonymous ? '匿名用户' : (post.username || '未知用户');
    var klass = [post.school, post.grade, post.className].filter(Boolean).join(' · ');
    var liked = !!(me && post.likedBy && post.likedBy.indexOf(me.id) > -1);
    var disliked = !!(me && post.dislikedBy && post.dislikedBy.indexOf(me.id) > -1);
    var faved = state.favorites.has(post.id);
    state.liked = liked;

    var avatar = post.anonymous
      ? '<div class="m-avatar m-anon">匿</div>'
      : '<div class="m-avatar"' + (post.userAvatar
          ? ' style="background-image:url(\'' + esc(post.userAvatar) + '\')"'
          : '') + '>' + (post.userAvatar ? '' : esc((post.className || '?').slice(0, 1))) + '</div>';

    return '<article class="m-detail" data-id="' + esc(post.id) + '">' +
      '<div class="m-post-head">' + avatar +
        '<div class="m-post-who">' +
          '<div class="m-post-name">' + esc(name) + '</div>' +
          (klass ? '<div class="m-post-meta">' + esc(klass) + '</div>' : '') +
        '</div>' +
        '<time class="m-post-time">' + mApp.timeAgo(post.timestamp) + '</time>' +
      '</div>' +
      '<div class="m-post-body">' + mApp.renderMarkdown(post.content || '') + '</div>' +
      mApp.renderImages(post.images) +
      '<div class="m-post-actions">' +
        '<button class="m-act m-like' + (liked ? ' on' : '') + '" data-act="like" data-id="' + esc(post.id) +
          '"><i class="fas fa-heart"></i><span>' + (post.likes || 0) + '</span></button>' +
        '<button class="m-act m-dislike' + (disliked ? ' on' : '') + '" data-act="dislike" data-id="' + esc(post.id) +
          '"><i class="fas fa-thumbs-down"></i><span>' + (post.dislikes || 0) + '</span></button>' +
        '<button class="m-act m-fav' + (faved ? ' on' : '') + '" data-act="fav" data-id="' + esc(post.id) +
          '"><i class="fas fa-star"></i><span>' + (post.favoriteCount || 0) + '</span></button>' +
        '<button class="m-act" data-act="noop"><i class="fas fa-eye"></i><span>' + (post.viewCount || 0) + '</span></button>' +
      '</div>' +
    '</article>';
  }

  // ---------- 评论 ----------
  function commentHtml(c, depth) {
    var me = mApp.auth.user;
    var name = c.anonymous ? '匿名同学' : (c.username || '用户');
    var liked = !!(me && c.likedBy && c.likedBy.indexOf(me.id) > -1);
    var avatar = c.anonymous
      ? '<div class="m-avatar m-anon">匿</div>'
      : '<div class="m-avatar"' + (c.userAvatar
          ? ' style="background-image:url(\'' + esc(c.userAvatar) + '\')"'
          : '') + '>' + (c.userAvatar ? '' : esc(name.slice(0, 1))) + '</div>';

    var replies = (c.replies || []).map(function (r) { return commentHtml(r, depth + 1); }).join('');

    return '<div class="m-cmt" data-cid="' + esc(c.id) + '">' + avatar +
      '<div class="m-cmt-main">' +
        '<div class="m-cmt-head">' +
          '<span class="m-cmt-name">' + esc(name) + '</span>' +
          '<span class="m-cmt-time">' + mApp.timeAgo(c.timestamp) + '</span>' +
        '</div>' +
        '<div class="m-cmt-text">' + mApp.renderMarkdown(c.content || '') + '</div>' +
        (replies ? '<div class="m-cmt-replies">' + replies + '</div>' : '') +
        '<div class="m-cmt-acts">' +
          '<span class="' + (liked ? 'on' : '') + '" data-act="clike" data-cid="' + esc(c.id) + '">' +
            '<i class="fas fa-thumbs-up"></i>' + (c.likes || 0) + '</span>' +
          '<span data-act="creply" data-cid="' + esc(c.id) + '" data-name="' + esc(name) + '">' +
            '<i class="fas fa-reply"></i>回复</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderComments(post) {
    var comments = post.comments || [];
    $cmtTitle.style.display = comments.length ? 'flex' : 'none';
    $cmtCount.textContent = comments.length;
    $cmtHost.innerHTML = comments.length
      ? comments.map(function (c) { return commentHtml(c, 0); }).join('')
      : mApp.empty('fa-comment-dots', '还没有评论，来说两句吧');

    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([$host, $cmtHost]).catch(function () {});
    }
  }

  // ---------- 数据加载 ----------
  async function loadFavorites() {
    if (!mApp.auth.isLoggedIn()) return;
    try {
      var data = await mApp.api.get('/api/favorites/user/' + encodeURIComponent(mApp.auth.user.id), { silent: true });
      var list = (data && (data.favorites || data.posts)) || [];
      list.forEach(function (f) {
        var pid = f.postId || (f.post && f.post.id) || f.id;
        if (pid) state.favorites.add(pid);
      });
    } catch (e) { /* 忽略 */ }
  }

  async function load() {
    if (!postId) {
      $host.innerHTML = mApp.empty('fa-circle-question', '缺少帖子参数', true);
      return;
    }
    $host.innerHTML = mApp.skeleton(2);
    try {
      var data = await mApp.api.get('/api/posts/' + encodeURIComponent(postId), { silent: true });
      var post = data && data.post;
      if (!post) throw new Error('帖子不存在');
      state.post = post;

      document.title = (post.anonymous ? '匿名帖子' : (post.username || '帖子')) + ' - 校园论坛';
      $host.innerHTML = detailHtml(post);
      renderComments(post);

      // 浏览量 +1（不阻塞）
      mApp.api.post('/api/posts/' + encodeURIComponent(postId) + '/view', {}, { silent: true }).catch(function () {});
    } catch (e) {
      $host.innerHTML = mApp.empty('fa-triangle-exclamation',
        (e && e.status === 404) ? '帖子不存在或已被删除' : '加载失败，请稍后重试', true);
      $cmtTitle.style.display = 'none';
    }
  }

  // 重新拉取并渲染（用于点赞/收藏/评论后的局部刷新）
  async function refresh() {
    try {
      var data = await mApp.api.get('/api/posts/' + encodeURIComponent(postId), { silent: true });
      if (data && data.post) {
        state.post = data.post;
        $host.innerHTML = detailHtml(data.post);
        renderComments(data.post);
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 交互 ----------
  document.addEventListener('DOMContentLoaded', async function () {
    $host = document.getElementById('m-post-host');
    $cmtHost = document.getElementById('m-cmt-host');
    $cmtTitle = document.getElementById('m-cmt-title');
    $cmtCount = document.getElementById('m-cmt-count');
    $input = document.getElementById('m-cmt-input');
    $send = document.getElementById('m-cmt-send');

    mApp.auth.init().then(loadFavorites).then(load);

    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-index.html';
    });
    document.getElementById('m-share').addEventListener('click', async function () {
      var url = location.href;
      var title = state.post ? ((state.post.anonymous ? '匿名帖子' : state.post.username) + '的帖子') : '校园论坛';
      try {
        if (navigator.share) { await navigator.share({ title: title, url: url }); return; }
        await navigator.clipboard.writeText(url);
        mApp.toast('链接已复制', 'success');
      } catch (e) {
        mApp.toast('分享失败，可手动复制地址栏链接', 'warning');
      }
    });

    // 帖子与评论的点赞/收藏/回复
    document.getElementById('m-content').addEventListener('click', async function (e) {
      var img = e.target.closest('[data-view]');
      if (img) { mApp.openImage(img.getAttribute('data-view')); return; }

      var actEl = e.target.closest('[data-act]');
      if (!actEl) return;
      var act = actEl.getAttribute('data-act');

      if (act === 'noop') return;

      if (act === 'creply') {
        if (!mApp.auth.require('请先登录后再回复')) return;
        state.replyTo = { id: actEl.getAttribute('data-cid'), name: actEl.getAttribute('data-name') };
        $input.placeholder = '回复 @' + state.replyTo.name + '：';
        $input.focus();
        return;
      }

      if (act === 'clike') {
        if (!mApp.auth.require('请先登录后再操作')) return;
        var cid = actEl.getAttribute('data-cid');
        try {
          await mApp.api.post('/api/posts/' + encodeURIComponent(postId) + '/comments/' +
            encodeURIComponent(cid) + '/like', {});
          var num = parseInt(actEl.textContent.trim(), 10) || 0;
          var on = actEl.classList.toggle('on');
          actEl.innerHTML = '<i class="fas fa-thumbs-up"></i>' + (on ? num + 1 : Math.max(0, num - 1));
        } catch (err) { /* 已提示 */ }
        return;
      }

      if (act === 'like' || act === 'dislike') {
        if (!mApp.auth.require('请先登录后再操作')) return;
        try {
          await mApp.api.post('/api/posts/' + encodeURIComponent(postId) + '/' + act, {});
          await refresh();
        } catch (err) { /* 已提示 */ }
        return;
      }

      if (act === 'fav') {
        if (!mApp.auth.require('请先登录后再操作')) return;
        var on2 = actEl.classList.contains('on');
        try {
          if (on2) {
            await mApp.api.del('/api/favorites/' + encodeURIComponent(postId));
            state.favorites.delete(postId);
          } else {
            await mApp.api.post('/api/favorites/' + encodeURIComponent(postId), {});
            state.favorites.add(postId);
          }
          actEl.classList.toggle('on');
          var s = actEl.querySelector('span');
          var cur = parseInt(s.textContent, 10) || 0;
          s.textContent = Math.max(0, cur + (on2 ? -1 : 1));
          mApp.toast(on2 ? '已取消收藏' : '已加入收藏', 'success');
        } catch (err) { /* 已提示 */ }
        return;
      }
    });

    // 发送评论 / 回复
    async function send() {
      if (!mApp.auth.require('请先登录后再评论')) return;
      var text = $input.value.trim();
      if (!text) { mApp.toast('请输入内容', 'warning'); return; }

      $send.disabled = true;
      try {
        if (state.replyTo) {
          await mApp.api.post('/api/posts/' + encodeURIComponent(postId) + '/comments/' +
            encodeURIComponent(state.replyTo.id) + '/replies',
            { content: text, anonymous: false });
          mApp.toast('回复已发布', 'success');
        } else {
          await mApp.api.post('/api/posts/' + encodeURIComponent(postId) + '/comments',
            { content: text, anonymous: false });
          mApp.toast('评论已发布', 'success');
        }
        $input.value = '';
        $input.style.height = '';
        state.replyTo = null;
        $input.placeholder = '说点什么…';
        await refresh();
      } catch (e) { /* 已提示 */ }
      finally { $send.disabled = false; }
    }

    $send.addEventListener('click', send);

    // textarea 自适应高度 + Enter 发送
    $input.addEventListener('input', function () {
      $input.style.height = 'auto';
      $input.style.height = Math.min($input.scrollHeight, 108) + 'px';
    });
    $input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
  });
})();