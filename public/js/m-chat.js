/* 移动端私信页：会话列表 + 聊天窗口 */
(function () {
  'use strict';

  var state = { other: null, msgs: [], refreshing: null };
  var $convs, $msgs, $input, $send, $title;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return mApp.escape(s); }

  // ---------- 会话列表 ----------
  function convHtml(c) {
    var u = c.otherUser || {};
    var name = esc(u.username || '用户');
    var avatar = u.avatar
      ? '<div class="m-avatar" style="background-image:url(\'' + esc(u.avatar) + '\')"></div>'
      : '<div class="m-avatar">' + esc(name.slice(0, 1)) + '</div>';
    var last = c.lastMessage || {};
    var lastText = last.content || (last.type === 'image' ? '[图片]' : '');
    var badge = c.unreadCount > 0
      ? '<span class="m-conv-badge">' + (c.unreadCount > 99 ? '99+' : c.unreadCount) + '</span>' : '';

    return '<div class="m-conv" data-uid="' + esc(u.id) + '" data-name="' + esc(u.username || '') + '">' +
      avatar +
      '<div class="m-conv-main">' +
        '<div class="m-conv-top"><span class="m-conv-name">' + name + '</span>' +
        '<span class="m-conv-time">' + mApp.timeAgo(c.updatedAt) + '</span></div>' +
        '<div class="m-conv-last">' + esc(lastText || '暂无消息') + '</div>' +
      '</div>' + badge + '</div>';
  }

  async function loadConversations() {
    $convs.innerHTML = mApp.skeleton(3);
    try {
      var d = await mApp.api.get('/api/conversations', { silent: true });
      var list = (d && d.conversations) || [];
      $convs.innerHTML = list.length
        ? list.map(convHtml).join('')
        : mApp.empty('fa-envelope-open', '还没有私信，点击右上角发起');
    } catch (e) {
      $convs.innerHTML = mApp.empty('fa-triangle-exclamation', '加载失败，请稍后重试', true);
    }
  }

  // ---------- 聊天窗口 ----------
  function msgHtml(m) {
    var me = mApp.auth.user.id;
    var mine = m.senderId === me;
    var body = '';
    if (m.imageUrl) body += '<img src="' + esc(m.imageUrl) + '" alt="图片" data-view="' + esc(m.imageUrl) + '">';
    if (m.content) body += '<div>' + esc(m.content) + '</div>';
    return '<div class="m-msg ' + (mine ? 'me' : 'other') + '">' + (body || '[空消息]') +
      '<div class="m-msg-time">' + mApp.timeAgo(m.createdAt || m.timestamp) + '</div></div>';
  }

  function renderMsgs() {
    $msgs.innerHTML = state.msgs.length
      ? state.msgs.map(msgHtml).join('')
      : mApp.empty('fa-comment-dots', '还没有消息，打个招呼吧');
    window.scrollTo(0, document.body.scrollHeight);
  }

  async function openChat(uid, name) {
    state.other = { id: uid, name: name || '聊天' };
    $('m-list-view').style.display = 'none';
    $('bar-list').style.display = 'none';
    $('bar-chat').style.display = '';
    $('m-chat-view').style.display = '';
    $('m-sendbar').style.display = '';
    $title.textContent = name || '聊天';
    $('m-chat-profile').setAttribute('href', 'm-user.html?id=' + encodeURIComponent(uid));
    $msgs.innerHTML = mApp.skeleton(2);

    // 地址栏补参数，便于刷新/分享
    history.replaceState(null, '', 'm-chat.html?to=' + encodeURIComponent(uid) +
      (name ? '&name=' + encodeURIComponent(name) : ''));

    await loadMessages();
    // 轮询新消息（页面隐藏时暂停）
    if (state.refreshing) clearInterval(state.refreshing);
    state.refreshing = setInterval(function () {
      if (!document.hidden) loadMessages(true);
    }, 8000);
  }

  function closeChat() {
    if (state.refreshing) { clearInterval(state.refreshing); state.refreshing = null; }
    state.other = null;
    $('m-chat-view').style.display = 'none';
    $('m-sendbar').style.display = 'none';
    $('bar-chat').style.display = 'none';
    $('m-list-view').style.display = '';
    $('bar-list').style.display = '';
    history.replaceState(null, '', 'm-chat.html');
    loadConversations();
  }

  async function loadMessages(silentUpdate) {
    if (!state.other) return;
    try {
      var d = await mApp.api.get('/api/messages?otherUserId=' + encodeURIComponent(state.other.id) + '&limit=50',
        { silent: true });
      var list = (d && d.messages) || [];
      // 后端按时间倒序返回，前端正序展示
      state.msgs = list.slice().sort(function (a, b) {
        return new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp);
      });
      if (silentUpdate && $msgs.children.length === state.msgs.length) return;
      renderMsgs();
    } catch (e) {
      if (!silentUpdate) $msgs.innerHTML = mApp.empty('fa-triangle-exclamation', '消息加载失败', true);
    }
  }

  async function send(text, file) {
    if (!state.other) return;
    var content = (text || '').trim();
    if (!content && !file) { mApp.toast('请输入内容', 'warning'); return; }

    $send.disabled = true;
    try {
      var fd = new FormData();
      fd.append('receiverId', state.other.id);
      fd.append('content', content);
      if (file) fd.append('image', file);
      var d = await mApp.api.post('/api/messages', fd);
      if (d && d.message) state.msgs.push(d.message);
      else await loadMessages();
      renderMsgs();
      $input.value = '';
      $input.style.height = '';
    } catch (e) { /* 已提示 */ }
    $send.disabled = false;
  }

  // ---------- 新建会话：选择联系人 ----------
  async function pickContact() {
    var s = mApp.sheet('选择联系人', mApp.skeleton(2));
    try {
      var d = await mApp.api.get('/api/messages/contactable-users?userId=' +
        encodeURIComponent(mApp.auth.user.id), { silent: true });
      var users = (d && d.users) || [];
      if (!users.length) {
        s.body.innerHTML = mApp.empty('fa-user-group', '暂无可私信的联系人（互相关注后即可私信）');
        return;
      }
      s.body.innerHTML = users.map(function (u) {
        var name = esc(u.username || '用户');
        var avatar = u.avatar
          ? '<div class="m-avatar" style="background-image:url(\'' + esc(u.avatar) + '\')"></div>'
          : '<div class="m-avatar">' + esc(name.slice(0, 1)) + '</div>';
        return '<div class="m-conv" data-pick="' + esc(u.id) + '" data-name="' + esc(u.username || '') + '">' +
          avatar + '<div class="m-conv-main"><div class="m-conv-top">' +
          '<span class="m-conv-name">' + name + '</span></div>' +
          (u.school ? '<div class="m-conv-last">' + esc(u.school) + '</div>' : '') +
          '</div></div>';
      }).join('');

      s.body.addEventListener('click', function (e) {
        var conv = e.target.closest('[data-pick]');
        if (!conv) return;
        s.close();
        openChat(conv.getAttribute('data-pick'), conv.getAttribute('data-name'));
      });
    } catch (e) {
      s.body.innerHTML = mApp.empty('fa-triangle-exclamation', '联系人加载失败', true);
    }
  }

  // ---------- 初始化 ----------
  document.addEventListener('DOMContentLoaded', function () {
    $convs = $('m-convs');
    $msgs = $('m-msgs');
    $input = $('m-msg-input');
    $send = $('m-msg-send');
    $title = $('m-chat-title');

    mApp.auth.init().then(function () {
      if (!mApp.auth.isLoggedIn()) {
        mApp.toast('请先登录后查看私信', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-chat.html');
        }, 800);
        return;
      }
      var qs = new URLSearchParams(location.search);
      var to = qs.get('to');
      if (to) openChat(to, qs.get('name') || '');
      else loadConversations();
    });

    $('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-profile.html';
    });
    $('m-chat-back').addEventListener('click', closeChat);
    $('m-new').addEventListener('click', pickContact);

    // 会话点击（弹层内的联系人由 pickContact 自己处理）
    document.addEventListener('click', function (e) {
      var conv = e.target.closest('.m-conv');
      if (!conv) return;
      if (conv.closest('.m-sheet-mask')) return;
      var uid = conv.getAttribute('data-uid');
      if (!uid) return;
      openChat(uid, conv.getAttribute('data-name') || '');
    });

    // 图片查看
    $msgs.addEventListener('click', function (e) {
      var img = e.target.closest('[data-view]');
      if (img) mApp.openImage(img.getAttribute('data-view'));
    });

    // 发送
    $send.addEventListener('click', function () { send($input.value); });
    $input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send($input.value);
      }
    });
    $input.addEventListener('input', function () {
      $input.style.height = 'auto';
      $input.style.height = Math.min($input.scrollHeight, 108) + 'px';
    });

    // 发送图片
    $('m-img-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) send('', f);
    });
  });
})();