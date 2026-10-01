// 工具函数模块
const utils = {
  // HTML 转义函数
  // 安全说明：原实现走 div.textContent → div.innerHTML，DOM 序列化只转义
  // & < > 与 NBSP，**不处理 " 和 '** —— 因此它只对"文本位置"安全，用在
  // alt="${...}" / onclick="...('${...}')" 这类**属性位置**时可被闭合属性注入
  // （例：上传文件名 originalname 里带引号、用户名里带引号）。
  // 这里补上引号转义，使它对文本与属性两种上下文都安全；文本位置使用不变
  // （&quot; / &#39; 在页面上渲染出来仍是 " 和 '）。
  escapeHtml: function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 检测并转换危险 HTML 内容为 Markdown 代码块
  // 只检测可能导致 XSS 或破坏页面布局的危险标签
  // 允许安全的内联 HTML 标签（如 u, b, i, strong, em, span, a, img 等）
  detectAndEscapeHtml: function(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }
    
    // 危险 HTML 标签列表（可能导致 XSS 或破坏页面布局）
    // 这些标签应该被转义处理
    const dangerousTags = [
      'script', 'style', 'iframe', 'object', 'embed', 
      'form', 'input', 'button', 'select', 'textarea',
      'link', 'meta', 'base', 
      'svg', 'canvas', 'template', 'noscript',
      'frame', 'frameset', 'applet', 
      'basefont', 'bgsound', 'keygen', 'listing', 'plaintext', 'xmp'
    ].join('|');
    
    const dangerousTagPattern = new RegExp(`<(${dangerousTags})\\b[^>]*>`, 'i');
    
    // 检测是否包含危险 HTML 标签
    if (dangerousTagPattern.test(content)) {
      // 检测是否已经是代码块中的内容（避免重复处理）
      const codeBlockPattern = /^```[\s\S]*```$/;
      const isAlreadyCodeBlock = codeBlockPattern.test(content.trim());
      
      if (!isAlreadyCodeBlock) {
        // 将整个内容用 Markdown 代码块包裹
        return '```html\n' + content + '\n```';
      }
    }
    
    return content;
  },

  // 消息通知函数
  showNotification: function(message, type = 'info') {
    const iconMap = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };

    const notification = document.createElement('div');
    notification.className = `notification-message ${type}`;

    notification.innerHTML = `
      <div class="notification-icon-circle">
        <i class="fas ${iconMap[type] || iconMap.info}"></i>
      </div>
      <div class="notification-body">
        <span>${message}</span>
      </div>
      <button class="notification-close" aria-label="关闭">
        <i class="fas fa-times"></i>
      </button>
      <div class="notification-progress"></div>
    `;

    // 每次调用时重新获取 notificationArea
    let notificationArea = document.getElementById('notificationArea');

    // 如果 notificationArea 不存在，创建一个
    if (!notificationArea) {
      notificationArea = document.createElement('div');
      notificationArea.id = 'notificationArea';
      notificationArea.className = 'notification-area';
      document.body.appendChild(notificationArea);
    }

    notificationArea.appendChild(notification);

    // 添加动画效果
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });

    // 关闭通知的函数
    const closeNotification = () => {
      notification.classList.remove('show');
      notification.classList.add('hide');
      // 停止进度条动画
      const progress = notification.querySelector('.notification-progress');
      if (progress) progress.style.animationPlayState = 'paused';
      setTimeout(() => {
        notification.remove();
      }, 350);
    };

    // 关闭按钮点击
    notification.querySelector('.notification-close').addEventListener('click', closeNotification);

    // 悬停时暂停进度条
    notification.addEventListener('mouseenter', () => {
      const progress = notification.querySelector('.notification-progress');
      if (progress) progress.style.animationPlayState = 'paused';
    });

    notification.addEventListener('mouseleave', () => {
      const progress = notification.querySelector('.notification-progress');
      if (progress) progress.style.animationPlayState = 'running';
    });

    // 自动移除通知
    setTimeout(() => {
      if (notification.parentNode) {
        closeNotification();
      }
    }, 3000);
  },

  // 日期格式化函数
  formatDate: function(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    
    // 如果是今天，显示时间
    if (date.toDateString() === now.toDateString()) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    
    // 如果是昨天
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    
    // 显示完整日期
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  },

  // 自动刷新
  startAutoRefresh: function() {
    setInterval(() => {
      if (typeof postsManager !== 'undefined' && postsManager.loadPosts) postsManager.loadPosts();
      if (typeof statsManager !== 'undefined' && statsManager.loadStats) statsManager.loadStats();
    }, 60000); // 每1分钟刷新一次
  },

  // 时间格式化（相对时间）
  timeAgo: function(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) {
      return '刚刚';
    }
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}分钟前`;
    }
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}小时前`;
    }
    
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}天前`;
    }
    
    const weeks = Math.floor(days / 7);
    if (weeks < 4) {
      return `${weeks}周前`;
    }

    const months = Math.floor(days / 30);
    if (months < 12) {
      return `${months}个月前`;
    }

    const years = Math.floor(days / 365);
    return `${years}年前`;
  },

  // 显示图片灯箱（统一使用）
  showImageLightbox: function(src) {
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.innerHTML = `
      <div class="lightbox-overlay"></div>
      <div class="lightbox-content">
        <img src="${this.escapeHtml(src)}" alt="大图">
        <button class="lightbox-close"><i class="fas fa-times"></i></button>
      </div>
    `;
    document.body.appendChild(lightbox);

    const close = () => {
      if (document.body.contains(lightbox)) {
        document.body.removeChild(lightbox);
      }
      document.removeEventListener('keydown', escHandler);
    };

    lightbox.querySelector('.lightbox-overlay').addEventListener('click', close);
    lightbox.querySelector('.lightbox-close').addEventListener('click', close);

    const escHandler = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);
  },

  // 图片压缩 / 规范化：保证输出一定是服务端接受的格式（jpg/png/gif/webp）+ 正确扩展名
  // 服务端对本地上传做「扩展名 + mimetype + 文件头」三重校验，HEIC/AVIF 或扩展名异常的
  // 文件会被 400 静默拒绝，这里统一转成 JPEG（GIF 保留以免丢帧）
  compressImage: function(file, maxWidth = 1920, quality = 0.8) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return Promise.resolve(file);
    }

    const EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
    const fixName = (n, ext) => {
      n = String(n || 'image');
      return new RegExp('\\' + ext + '$', 'i').test(n) ? n : n.replace(/\.[^.\/]+$/, '') + ext;
    };
    const withName = (blob, name, type) => new File([blob], name, { type: type, lastModified: Date.now() });

    const ext = EXT[file.type];
    if (ext && fixName(file.name, ext) === file.name && file.size < 500 * 1024) {
      return Promise.resolve(file);
    }
    if (file.type === 'image/gif') {
      return Promise.resolve(withName(file, fixName(file.name, '.gif'), 'image/gif'));
    }

    const outType = ext || 'image/jpeg';
    const outName = fixName(file.name, ext || '.jpg');

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(function(blob) {
            resolve(withName(blob || file, outName, blob ? outType : 'image/jpeg'));
          }, outType, quality);
        };
        img.onerror = function() { resolve(file); };
        img.src = e.target.result;
      };
      reader.onerror = function() { resolve(file); };
      reader.readAsDataURL(file);
    });
  },

  // Emoji 列表（常用表情）
  emojiList: ['😀','😂','🤣','😊','😍','🥰','😎','🤔','😅','😢','😡','👍','👎','👏','🙌','💪','🤝','❤️','🔥','⭐','🎉','💯','✅','❌','🎵','📚','💡','🎓','🏫','☕','🍕','✨','🙏','🤗','😇','💀','👀','🫡','🤯','💩'],

  // 打开 Emoji 面板
  openEmojiPicker: function(targetInput, buttonEl) {
    // 切换：已打开则关闭
    const existing = document.querySelector('.emoji-picker-popup');
    if (existing) { existing.remove(); return; }

    const popup = document.createElement('div');
    popup.className = 'emoji-picker-popup';
    popup.innerHTML = this.emojiList.map(e =>
      `<button class="emoji-item" data-emoji="${e}" title="${e}">${e}</button>`
    ).join('');

    // 定位在按钮附近
    const rect = buttonEl.getBoundingClientRect();
    popup.style.cssText = `position:fixed;top:${rect.top - 280}px;left:${rect.left}px;z-index:9999;`;

    popup.addEventListener('click', (e) => {
      const btn = e.target.closest('.emoji-item');
      if (!btn) return;
      const emoji = btn.dataset.emoji;
      const start = targetInput.selectionStart;
      const end = targetInput.selectionEnd;
      targetInput.value = targetInput.value.substring(0, start) + emoji + targetInput.value.substring(end);
      targetInput.focus();
      targetInput.selectionStart = targetInput.selectionEnd = start + emoji.length;
      popup.remove();
      targetInput.dispatchEvent(new Event('input'));
    });

    document.body.appendChild(popup);
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!popup.contains(e.target) && e.target !== buttonEl) {
          popup.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 100);
  },

  // ============ CSP 改造：[data-action] 事件委托派发器 ============
  // 背景：内联事件属性（onclick="…"）需要 CSP 的 script-src-attr 'unsafe-inline' 才执行；
  // 为彻底移除该放行项，全站内联属性改写为 data-* 声明，由本派发器统一委托执行。
  // 属性约定：
  //   data-action="命名空间.方法名" —— 自 window 逐级解析（如 showSection、adminManager.closeModal、utils.navigate）
  //   data-on="click|change|keyup|input|error" —— 触发事件类型，缺省 click；error 用于资源加载失败（不冒泡）
  //   data-arg / data-arg2 —— 静态字符串参数（与原来 fn('a','b') 一一对应）
  //   data-arg-from / data-arg2-from —— 从元素属性实时取值；token "this"=元素自身、"event"=事件对象
  // 调用语义：以「方法所属对象」为 this（adminManager.closeModal → this=adminManager），
  // 与原内联调用 fn('x') 的作用域一致。监听用捕获阶段：与原内联处理器（目标阶段）等效，
  // 不会因页面里常见的冒泡期 stopPropagation 而静默失效。未匹配到动作时告警而不抛错。
  resolveAction: function(path) {
    const parts = String(path || '').split('.');
    let owner = window;
    for (let i = 0; i < parts.length - 1 && owner != null; i++) {
      owner = owner[parts[i]];
    }
    const fn = owner == null ? undefined : owner[parts[parts.length - 1]];
    return typeof fn === 'function' ? { fn: fn, owner: owner } : null;
  },

  readActionArgs: function(el, event) {
    const pick = (fromAttr, valueAttr) => {
      const from = el.getAttribute(fromAttr);
      if (from !== null) {
        if (from === 'this') return el;
        if (from === 'event') return event;
        return el.getAttribute(from);
      }
      return el.hasAttribute(valueAttr) ? el.getAttribute(valueAttr) : undefined;
    };
    return [pick('data-arg-from', 'data-arg'), pick('data-arg2-from', 'data-arg2')];
  },

  handleActionEvent: function(event) {
    const target = event.target;
    const el = target && target.closest ? target.closest('[data-action]') : null;
    if (!el) return;
    if ((el.getAttribute('data-on') || 'click') !== event.type) return;
    const action = el.getAttribute('data-action');
    const resolved = this.resolveAction(action);
    if (!resolved) {
      console.warn('[data-action] 未找到可调用的动作:', action, el);
      return;
    }
    const args = this.readActionArgs(el, event);
    if (args[0] === undefined) resolved.fn.call(resolved.owner);
    else if (args[1] === undefined) resolved.fn.call(resolved.owner, args[0]);
    else resolved.fn.call(resolved.owner, args[0], args[1]);
  },

  initActionDispatcher: function() {
    if (this._actionDispatcherReady) return;
    this._actionDispatcherReady = true;
    const handler = (event) => this.handleActionEvent(event);
    ['click', 'change', 'input', 'keyup'].forEach(type => document.addEventListener(type, handler, true));
    // 资源加载失败（如 img onerror）不冒泡，同样用捕获阶段委托
    document.addEventListener('error', handler, true);
  },

  // ---- 供 data-action 引用的通用小动作（替代原先只能写在内联属性里的表达式）----
  navigate: function(url) {
    if (url) window.location.href = url;
  },

  goBack: function() {
    window.history.back();
  },

  reloadPage: function() {
    window.location.reload();
  },

  removeClosest: function(el, selector) {
    const node = el && el.closest ? el.closest(selector) : null;
    if (node) node.remove();
  },

  hideSelf: function(el) {
    if (el) el.style.display = 'none';
  },

  setSessionFlag: function(key) {
    if (!key) return;
    try {
      sessionStorage.setItem(key, 'true');
    } catch (e) { /* 隐私模式下不可写，忽略 */ }
  }
};

// 确保 utils 对象在全局作用域中可用
window.utils = utils;

// [data-action] 事件委托初始化：defer 脚本执行时 DOM 已解析，直接绑定；否则等 DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => utils.initActionDispatcher());
} else {
  utils.initActionDispatcher();
}

// 注册 Service Worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 立即向服务器检查 sw.js 是否更新（配合 server.js 对 sw.js 的 no-cache 头，
      // 保证发版后第一次访问就能检测到新版本，避免旧 SW 长期控制页面）
      reg.update();
      // 检测到新 SW 安装完成 → 刷新页面，让新版本立即生效
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // installed + 页面已被旧 SW 控制 → 新版本已就绪，刷新加载最新代码
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {});
  });
}

console.log('utils.js 加载完成，utils 对象:', utils);
console.log('window.utils:', window.utils);