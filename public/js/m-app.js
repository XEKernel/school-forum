/* ===========================================================
   校园论坛 · 移动端公共模块 (mApp)
   - 独立于桌面版：不依赖 style.css / posts.js，仅复用后端 API
   - 鉴权沿用 HttpOnly Cookie（与桌面版共享登录态，localStorage.forumUser 存用户资料）
   - 所有页面脚本依赖本文件先加载
   =========================================================== */
(function () {
  'use strict';

  var mApp = {
    // ---------- 基础工具 ----------
    escape: function (text) {
      if (text === null || text === undefined) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    // 相对时间：刚刚 / n分钟前 / n小时前 / n天前 / 日期
    timeAgo: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var s = Math.floor((Date.now() - d.getTime()) / 1000);
      if (s < 60) return '刚刚';
      if (s < 3600) return Math.floor(s / 60) + '分钟前';
      if (s < 86400) return Math.floor(s / 3600) + '小时前';
      if (s < 86400 * 7) return Math.floor(s / 86400) + '天前';
      var y = d.getFullYear();
      var now = new Date();
      var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      return y === now.getFullYear() ? md : y + '年' + md;
    },

    // ---------- 轻提示 ----------
    toast: function (message, type) {
      if (!message) return;
      var host = document.querySelector('.m-toasts');
      if (!host) {
        host = document.createElement('div');
        host.className = 'm-toasts';
        document.body.appendChild(host);
      }
      var icons = {
        success: 'fa-check-circle',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
      };
      var t = (type || 'info');
      var el = document.createElement('div');
      el.className = 'm-toast m-' + t;
      el.innerHTML = '<i class="fas ' + (icons[t] || icons.info) + '"></i><span>' +
        mApp.escape(message) + '</span>';
      host.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('show'); });
      setTimeout(function () {
        el.classList.remove('show');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
      }, 2600);
    },

    // ---------- API ----------
    // 统一封装：Cookie 鉴权（同源自动携带）、统一错误提示
    api: {
      request: async function (method, url, body, opts) {
        opts = opts || {};
        var init = {
          method: method,
          credentials: 'same-origin',
          headers: {}
        };
        if (body instanceof FormData) {
          init.body = body;
        } else if (body !== undefined && body !== null) {
          init.headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        var res = await fetch(url, init);
        var data = null;
        try { data = await res.json(); } catch (e) { data = null; }

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            // 令牌失效：清理本地登录态，交由调用方决定是否跳登录
            localStorage.removeItem('forumUser');
            mApp.auth.user = null;
          }
          var msg = (data && data.message) || ('请求失败(' + res.status + ')');
          if (!opts.silent) mApp.toast(msg, 'error');
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      },
      get: function (url, opts) { return mApp.api.request('GET', url, null, opts); },
      post: function (url, body, opts) { return mApp.api.request('POST', url, body === undefined ? {} : body, opts); },
      put: function (url, body, opts) { return mApp.api.request('PUT', url, body, opts); },
      del: function (url, opts) { return mApp.api.request('DELETE', url, null, opts); }
    },

    // ---------- 登录态 ----------
    auth: {
      user: null,
      ready: false,

      // 初始化：本地资料 + 服务端校验（令牌在 HttpOnly Cookie，JS 读不到）
      init: async function () {
        var raw = localStorage.getItem('forumUser');
        if (!raw) { this.user = null; this.ready = true; return null; }
        var local = null;
        try { local = JSON.parse(raw); } catch (e) {
          localStorage.removeItem('forumUser');
          this.user = null; this.ready = true; return null;
        }
        try {
          var r = await mApp.api.post('/api/auth/verify', {}, { silent: true });
          if (r && r.success && r.valid) {
            this.user = Object.assign({}, local, r.user || {}, {
              isAdmin: !!r.isAdmin,
              isBanned: !!r.isBanned
            });
            localStorage.setItem('forumUser', JSON.stringify(this.user));
          } else {
            localStorage.removeItem('forumUser');
            this.user = null;
          }
        } catch (e) {
          // 网络/限流异常：保持本地登录态，避免误登出（与桌面版策略一致）
          this.user = local;
        }
        this.ready = true;
        return this.user;
      },

      isLoggedIn: function () { return !!this.user; },
      isAdmin: function () { return !!(this.user && this.user.isAdmin); },

      // 未登录则跳登录页并返回 false
      require: function (tip) {
        if (this.user) return true;
        mApp.toast(tip || '请先登录', 'warning');
        var back = encodeURIComponent(location.pathname + location.search);
        setTimeout(function () { location.href = 'm-login.html?redirect=' + back; }, 700);
        return false;
      },

      logout: async function () {
        try { await mApp.api.post('/api/logout', {}, { silent: true }); } catch (e) { /* 忽略 */ }
        localStorage.removeItem('forumUser');
        this.user = null;
      },

      // 展示用信息
      displayName: function () { return (this.user && this.user.username) || '未登录'; },
      classText: function () {
        var u = this.user;
        if (!u) return '';
        var parts = [];
        if (u.school) parts.push(u.school);
        if (u.grade) parts.push(u.grade);
        if (u.className) parts.push(u.className);
        return parts.join(' · ');
      },
      initial: function () {
        var n = this.displayName();
        return n && n !== '未登录' ? n.slice(0, 1) : '?';
      },
      avatarStyle: function () {
        var u = this.user;
        if (u && u.avatar) {
          return ' style="background-image:url(\'' + mApp.escape(u.avatar) + '\')"';
        }
        return '';
      }
    },

    // ---------- Markdown ----------
    md: null,
    initMarkdown: function () {
      if (this.md || typeof window.markdownit !== 'function') return this.md;
      try {
        var inst = window.markdownit({
          html: false,
          linkify: true,
          breaks: true,
          highlight: function (str, lang) {
            if (lang && window.hljs && window.hljs.getLanguage && window.hljs.getLanguage(lang)) {
              try { return window.hljs.highlight(str, { language: lang }).value; } catch (e) { /* noop */ }
            }
            return '';
          }
        });
        this.md = inst;
      } catch (e) {
        this.md = null;
      }
      return this.md;
    },

    // 保护 $$...$$ / $...$ 等公式，避免被 markdown 破坏
    _protectMath: function (text) {
      var store = [];
      var protect = function (m) {
        var key = 'MJXPH' + store.length + 'PH';
        store.push(m);
        return key;
      };
      var out = text
        .replace(/\$\$[\s\S]*?\$\$/g, protect)
        .replace(/\\\[[\s\S]*?\\\]/g, protect)
        .replace(/\$(?!\$)([^$\n]+?)\$/g, protect)
        .replace(/\\\([\s\S]*?\\\)/g, protect);
      return { text: out, store: store };
    },
    _restoreMath: function (html, store) {
      return html.replace(/MJXPH(\d+)PH/g, function (_, i) { return store[+i] || ''; });
    },

    // 渲染 markdown 正文
    renderMarkdown: function (text) {
      if (!text) return '';
      var md = this.initMarkdown();
      if (!md) {
        return '<p>' + this.escape(text).replace(/\n/g, '<br>') + '</p>';
      }
      try {
        var p = this._protectMath(text);
        var html = md.render(p.text);
        return this._restoreMath(html, p.store);
      } catch (e) {
        return '<p>' + this.escape(text) + '</p>';
      }
    },

    // ---------- 帖子卡片 ----------
    truncate: function (text, max) {
      if (!text) return '';
      return text.length > max ? text.slice(0, max) : text;
    },

    renderImages: function (images) {
      if (!images || !images.length) return '';
      // 后端 images 为对象数组 [{ url, originalname }]，兼容纯字符串
      var list = images.map(function (im) {
        return typeof im === 'string' ? im : (im && im.url);
      }).filter(Boolean).slice(0, 9);
      var n = list.length;
      if (!n) return '';
      var cls = 'm-imgs n' + (n >= 4 ? 4 : n);
      return '<div class="' + cls + '">' + list.map(function (src) {
        return '<img src="' + mApp.escape(src) + '" alt="图片" loading="lazy" data-view="' +
          mApp.escape(src) + '">';
      }).join('') + '</div>';
    },

    /**
     * 生成帖子卡片 HTML
     * @param {object} post 后端返回的帖子对象
     * @param {object} opt  { truncate: 截断字数(0=全文), likedSet, favSet, clickable }
     */
    renderPostCard: function (post, opt) {
      opt = opt || {};
      var me = this.auth.user;
      var truncated = opt.truncate === 0 ? post.content : this.truncate(post.content, opt.truncate || 300);
      var isCut = truncated !== post.content;
      var liked = !!(me && post.likedBy && post.likedBy.indexOf(me.id) > -1);
      var disliked = !!(me && post.dislikedBy && post.dislikedBy.indexOf(me.id) > -1);
      var faved = !!(opt.favSet && opt.favSet.has(post.id));

      var name = post.anonymous ? '匿名用户' : (post.username || '未知用户');
      var klass = [post.school, post.grade, post.className].filter(Boolean).join(' · ');
      var avatar = post.anonymous
        ? '<div class="m-avatar m-anon">匿</div>'
        : '<div class="m-avatar"' + (post.userAvatar
            ? ' style="background-image:url(\'' + this.escape(post.userAvatar) + '\')"'
            : '') + '>' + (post.userAvatar ? '' : this.escape((post.className || '?').slice(0, 1))) + '</div>';

      var tags = post.anonymous
        ? '<span class="m-tag m-tag-anon">匿名</span>'
        : (post.grade ? '<span class="m-tag">' + this.escape(post.grade) + '</span>' : '') +
          (post.className ? '<span class="m-tag">' + this.escape(post.className) + '</span>' : '');

      return '' +
        '<article class="m-post" data-id="' + this.escape(post.id) + '">' +
          '<div class="m-post-head">' + avatar +
            '<div class="m-post-who">' +
              '<div class="m-post-name">' + this.escape(name) + '</div>' +
              (klass ? '<div class="m-post-meta">' + this.escape(klass) + '</div>' : '') +
            '</div>' +
            '<time class="m-post-time">' + this.timeAgo(post.timestamp) + '</time>' +
          '</div>' +
          '<div class="m-post-body">' + this.renderMarkdown(truncated) +
            (isCut ? '<div class="m-readmore">点击查看全文…</div>' : '') +
          '</div>' +
          (tags ? '<div class="m-tagrow">' + tags + '</div>' : '') +
          this.renderImages(post.images) +
          '<div class="m-post-actions">' +
            '<button class="m-act m-like' + (liked ? ' on' : '') + '" data-act="like" data-id="' +
              this.escape(post.id) + '"><i class="fas fa-heart"></i><span>' + (post.likes || 0) + '</span></button>' +
            '<button class="m-act m-dislike' + (disliked ? ' on' : '') + '" data-act="dislike" data-id="' +
              this.escape(post.id) + '"><i class="fas fa-thumbs-down"></i><span>' + (post.dislikes || 0) + '</span></button>' +
            '<button class="m-act m-open" data-act="open" data-id="' + this.escape(post.id) +
              '"><i class="fas fa-comment"></i><span>' + ((post.comments && post.comments.length) || 0) + '</span></button>' +
            '<button class="m-act m-fav' + (faved ? ' on' : '') + '" data-act="fav" data-id="' +
              this.escape(post.id) + '"><i class="fas fa-star"></i><span>' + (post.favoriteCount || 0) + '</span></button>' +
            '<button class="m-act m-open" data-act="open" data-id="' + this.escape(post.id) +
              '"><i class="fas fa-eye"></i><span>' + (post.viewCount || 0) + '</span></button>' +
          '</div>' +
        '</article>';
    },

    // 图片压缩（>500KB 且超宽才压，GIF 跳过以免丢帧）
    compressImage: function (file, maxWidth, quality) {
      maxWidth = maxWidth || 1920;
      quality = quality || 0.8;
      if (!file || !file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
      if (file.type === 'image/gif') return Promise.resolve(file);
      if (file.size < 500 * 1024) return Promise.resolve(file);

      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            var w = img.width, h = img.height;
            if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(function (blob) {
              if (!blob) return resolve(file);
              resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }));
            }, file.type, quality);
          };
          img.onerror = function () { resolve(file); };
          img.src = e.target.result;
        };
        reader.onerror = function () { resolve(file); };
        reader.readAsDataURL(file);
      });
    },

    // ---------- 图片查看器 ----------
    openImage: function (src) {
      var v = document.createElement('div');
      v.className = 'm-viewer';
      v.innerHTML = '<img src="' + this.escape(src) + '" alt="查看大图">' +
        '<button class="m-viewer-close" aria-label="关闭"><i class="fas fa-xmark"></i></button>';
      document.body.appendChild(v);
      requestAnimationFrame(function () { v.classList.add('show'); });
      var close = function () {
        v.classList.remove('show');
        setTimeout(function () { if (v.parentNode) v.parentNode.removeChild(v); }, 200);
      };
      v.addEventListener('click', close);
    },

    // ---------- 底部标签栏 ----------
    // tabs: home | categories | messages | profile
    renderTabBar: function (active) {
      if (document.querySelector('.m-tabbar')) return;
      var defs = [
        { key: 'home', href: 'm-index.html', icon: 'fa-house', label: '首页' },
        { key: 'categories', href: 'm-categories.html', icon: 'fa-border-all', label: '栏目' },
        { key: 'messages', href: 'm-messages.html', icon: 'fa-bell', label: '消息', badge: true },
        { key: 'profile', href: 'm-profile.html', icon: 'fa-user', label: '我的' }
      ];
      var html = defs.map(function (d, i) {
        var tab = '<a class="m-tab' + (active === d.key ? ' active' : '') + '" href="' + d.href +
          '"><i class="fas ' + d.icon + '"></i><span>' + d.label + '</span>' +
          (d.badge ? '<em class="m-badge" id="m-badge-msg" hidden></em>' : '') + '</a>';
        if (i === 1) {
          tab += '<div class="m-tab-fab-slot"><button class="m-tab-fab" id="m-fab" aria-label="发布">' +
            '<i class="fas fa-plus"></i></button></div>';
        }
        return tab;
      }).join('');

      var bar = document.createElement('nav');
      bar.className = 'm-tabbar';
      bar.innerHTML = html;
      document.body.appendChild(bar);

      var fab = document.getElementById('m-fab');
      if (fab) {
        fab.addEventListener('click', function () {
          if (!mApp.auth.require('请先登录后再发布帖子')) return;
          location.href = 'm-edit.html';
        });
      }
      this.refreshBadge();
    },

    // 刷新消息未读角标
    refreshBadge: async function () {
      var el = document.getElementById('m-badge-msg');
      if (!el) return;
      if (!this.auth.isLoggedIn()) { el.hidden = true; return; }
      try {
        var data = await this.api.get('/api/notifications', { silent: true });
        var list = (data && data.notifications) || [];
        var unread = list.filter(function (n) { return !n.read; }).length;
        if (unread > 0) {
          el.textContent = unread > 99 ? '99+' : unread;
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      } catch (e) { el.hidden = true; }
    },

    // ---------- 通用渲染辅助 ----------
    skeleton: function (n) {
      var one = '<div class="m-skel">' +
        '<div class="m-skel-line w40"></div>' +
        '<div class="m-skel-line w95"></div>' +
        '<div class="m-skel-line w70"></div></div>';
      return new Array((n || 3) + 1).join(one);
    },

    empty: function (icon, text, isError) {
      return '<div class="m-empty' + (isError ? ' m-error' : '') + '">' +
        '<i class="fas ' + (icon || 'fa-inbox') + '"></i>' + this.escape(text || '暂无内容') + '</div>';
    },

    // 滚动到底部时触发回调（节流）
    watchBottom: function (cb) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 320) cb();
        });
      }, { passive: true });
    },

    // 底部弹层（返回 { el, body, close }）
    sheet: function (title, html) {
      var mask = document.createElement('div');
      mask.className = 'm-sheet-mask';
      mask.innerHTML = '<div class="m-sheet">' +
        '<div class="m-sheet-head">' +
          '<div class="m-sheet-title">' + this.escape(title) + '</div>' +
          '<button class="m-iconbtn" data-sheet-close aria-label="关闭"><i class="fas fa-xmark"></i></button>' +
        '</div>' +
        '<div class="m-sheet-body">' + html + '</div>' +
      '</div>';
      document.body.appendChild(mask);

      var close = function () {
        mask.classList.remove('show');
        setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
      };
      mask.addEventListener('click', function (e) {
        if (e.target === mask || (e.target.closest && e.target.closest('[data-sheet-close]'))) close();
      });
      requestAnimationFrame(function () { mask.classList.add('show'); });

      return { el: mask, body: mask.querySelector('.m-sheet-body'), close: close };
    },

    // 帖子列表的点赞/点踩/收藏/打开 交互（事件委托，页面只需调用一次）
    bindPostActions: function (root, ctx) {
      ctx = ctx || {};
      root.addEventListener('click', async function (e) {
        var viewImg = e.target.closest('[data-view]');
        if (viewImg) { mApp.openImage(viewImg.getAttribute('data-view')); return; }

        var btn = e.target.closest('[data-act]');
        if (!btn) {
          // 点击卡片空白区域 → 打开详情
          var card = e.target.closest('.m-post');
          if (card && !e.target.closest('.m-post-actions')) {
            location.href = 'm-post.html?id=' + encodeURIComponent(card.dataset.id);
          }
          return;
        }
        var act = btn.getAttribute('data-act');
        var id = btn.getAttribute('data-id');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();

        if (act === 'open') { location.href = 'm-post.html?id=' + encodeURIComponent(id); return; }

        if (!mApp.auth.require('请先登录后再操作')) return;

        if (act === 'like' || act === 'dislike') {
          try {
            var r = await mApp.api.post('/api/posts/' + encodeURIComponent(id) + '/' + act, {});
            var post = r && r.post;
            var span = btn.querySelector('span');
            var cnt = btn.querySelector('i');
            if (post) {
              if (act === 'like') span.textContent = post.likes || 0;
              else span.textContent = post.dislikes || 0;
            }
            // 点赞/点踩互斥：另一侧取消高亮
            var row = btn.closest('.m-post-actions');
            if (row) {
              var other = row.querySelector(act === 'like' ? '.m-dislike' : '.m-like');
              if (other) other.classList.remove('on');
            }
            btn.classList.toggle('on');
            if (cnt) cnt.style.transform = 'scale(1.25)';
            setTimeout(function () { if (cnt) cnt.style.transform = ''; }, 160);
          } catch (err) { /* 已提示 */ }
          return;
        }

        if (act === 'fav') {
          var on = btn.classList.contains('on');
          try {
            if (on) await mApp.api.del('/api/favorites/' + encodeURIComponent(id));
            else await mApp.api.post('/api/favorites/' + encodeURIComponent(id), {});
            btn.classList.toggle('on');
            var s = btn.querySelector('span');
            var cur = parseInt(s.textContent, 10) || 0;
            s.textContent = Math.max(0, cur + (on ? -1 : 1));
            mApp.toast(on ? '已取消收藏' : '已加入收藏', 'success');
          } catch (err) { /* 已提示 */ }
          return;
        }
      });
    }
  };

  window.mApp = mApp;
})();
