// 帖子详情页管理器
const postDetailManager = {
  postId: null,
  post: null,
  md: null,
  hljs: null,
  tags: [],
  justFavorited: false,
  commentImages: [], // 评论图片列表

  // 初始化
  init: function() {
    // 从 URL 获取帖子 ID
    const urlParams = new URLSearchParams(window.location.search);
    this.postId = urlParams.get('id');

    if (!this.postId) {
      utils.showNotification('帖子 ID 无效', 'error');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      return;
    }

    // 初始化 markdown 渲染器
    this.initializeMarkdownRenderer();

    // 初始化用户管理
    if (typeof userManager !== 'undefined') {
      userManager.init();
      userManager.setupEventListeners();
    }

    // 设置事件监听器
    this.setupEventListeners();

    // 加载帖子详情
    this.loadPostDetail();
  },

  // 初始化 markdown 渲染器
  initializeMarkdownRenderer: function() {
    let markdownItGlobal = window.markdownit || window.markdownIt || window.markdown_it || window.MarkdownIt;
    
    if (!markdownItGlobal) {
      this.md = null;
      return;
    }

    try {
      let hljsGlobal = window.hljs;
      if (hljsGlobal) {
        this.hljs = hljsGlobal;
      } else {
        console.warn('highlight.js 未加载，代码高亮将不可用');
        this.hljs = null;
      }

      this.md = markdownItGlobal({
        html: false,
        linkify: true,
        typographer: true,
        highlight: this.hljs ? function(str, lang) {
          if (lang && hljsGlobal.getLanguage(lang)) {
            try {
              return hljsGlobal.highlight(str, { language: lang }).value;
            } catch (error) {
              console.error('代码高亮失败:', error);
            }
          }
          try {
            return hljsGlobal.highlightAuto(str).value;
          } catch (error) {
            console.error('代码高亮失败:', error);
            return '';
          }
        } : null
      });
    } catch (error) {
      console.error('初始化 markdown 渲染器失败:', error);
      this.md = null;
    }
  },

  // 加载帖子详情
  loadPostDetail: async function() {
    // 重置评论图片（避免跨帖子图片残留）
    this.clearCommentImages();
    
    const loading = document.getElementById('loading');
    const postDetail = document.getElementById('post-detail');
    const commentsSection = document.getElementById('comments-section');

    try {
      // 注意：不再通过 query 传 viewerId（服务端已改为从 JWT 取身份），
      // 改为携带 Authorization 头，服务端 optionalAuth 会自动识别登录用户
      const authHeaders = (userManager && userManager.getAuthHeaders) ? userManager.getAuthHeaders() : {};
      const url = `/api/posts/${this.postId}`;
      
      const response = await fetch(url, { headers: authHeaders });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `加载失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        this.post = data.post;
        await this.renderPostDetail();
        this.renderComments();

        // 处理评论开关
        const commentInputContainer = document.getElementById('comment-input-container');
        if (this.post.commentsEnabled === false) {
          if (commentInputContainer) commentInputContainer.style.display = 'none';
          // 在评论头部添加关闭提示
          const commentsHeader = document.querySelector('.comments-header h3');
          if (commentsHeader) {
            commentsHeader.innerHTML = `评论 (<span id="comment-count">${this.post.comments ? this.post.comments.length : 0}</span>) <span class="comments-closed-badge">已关闭</span>`;
          }
        }

        // 增加浏览量
        this.incrementViewCount();
        
        // 显示内容，隐藏加载状态
        loading.style.display = 'none';
        postDetail.style.display = 'block';
        commentsSection.style.display = 'block';

        // 代码高亮和添加复制按钮
        this.highlightCodeBlocks();
        
        // 渲染 LaTeX 公式
        this.renderMathJax();
      } else {
        throw new Error(data.message || '加载帖子失败');
      }
    } catch (error) {
      console.error('加载帖子详情失败:', error);
      loading.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message || '加载失败'}`;
      utils.showNotification(error.message || '加载帖子失败', 'error');
    }
  },

  // 渲染帖子详情
  renderPostDetail: async function() {
    const container = document.getElementById('post-detail');
    const currentUser = userManager.state.currentUser;
    const userLiked = currentUser && this.post.likedBy && this.post.likedBy.includes(currentUser.id);
    // 转义防 XSS
    const escapeHtml = (s) => utils.escapeHtml(s);
    const displayUsername = this.post.anonymous ? '匿名用户' : escapeHtml(this.post.username || '未知用户');
    const displaySchool = escapeHtml(this.post.school || '');
    const displayGrade = escapeHtml(this.post.grade || '');
    const displayClassName = escapeHtml(this.post.className || '');
    const displayUserAvatar = this.post.userAvatar ? escapeHtml(this.post.userAvatar) : null;

    // 检查收藏状态
    let isFavorited = false;
    if (currentUser) {
      isFavorited = await this.checkFavoriteStatus();
    }

    container.innerHTML = `
      <div class="post-detail-header">
        <div class="post-detail-user">
          <div class="post-detail-avatar ${this.post.anonymous ? 'anonymous-avatar' : ''}" 
               ${!this.post.anonymous ? `data-user-id="${this.post.userId}"` : ''}
               ${!this.post.anonymous && displayUserAvatar ? `style="background-image: url('${displayUserAvatar}'); background-size: cover; background-position: center;"` : ''}>
            ${this.post.anonymous ? '匿' : (!displayUserAvatar ? (displayClassName ? displayClassName.slice(0,1) : '?') : '')}
          </div>
          <div class="post-detail-user-info">
            <div class="post-detail-username">${displayUsername}</div>
            ${this.post.anonymous ? '' : 
              `<div class="post-detail-class">${displaySchool} | ${displayGrade} ${displayClassName}</div>`
            }
          </div>
          <div class="post-detail-time">
            <i class="far fa-clock"></i> ${utils.formatDate(this.post.timestamp)}
          </div>
        </div>
      </div>
      
      <div class="post-detail-body">
        <div class="post-detail-content-text">
          ${this.renderMarkdownContent(this.post.content)}
        </div>
        ${this.post.images && this.post.images.length > 0 ? this.renderPostImages(this.post.images) : ''}
      </div>
      
      <div class="post-detail-footer">
        <button class="post-detail-action-btn like-btn ${userLiked ? 'active' : ''}" data-id="${this.post.id}">
          <i class="fas fa-heart ${userLiked ? 'active' : ''}"></i> 点赞 <span>${this.post.likes || 0}</span>
        </button>
        <button class="post-detail-action-btn dislike-btn ${currentUser && this.post.dislikedBy && this.post.dislikedBy.includes(currentUser.id) ? 'active' : ''}" data-id="${this.post.id}">
          <i class="fas fa-thumbs-down ${currentUser && this.post.dislikedBy && this.post.dislikedBy.includes(currentUser.id) ? 'active' : ''}"></i> 点踩 <span>${this.post.dislikes || 0}</span>
        </button>
        <button class="post-detail-action-btn favorite-btn ${isFavorited ? 'active' : ''}" data-id="${this.post.id}">
          <i class="fas fa-star ${isFavorited ? 'active' : ''}"></i> 收藏
        </button>
        <div class="post-detail-action-btn">
          <i class="fas fa-comment"></i> 评论 <span>${this.post.comments ? this.post.comments.length : 0}</span>
        </div>
        <div class="post-detail-action-btn post-detail-view-count">
          <i class="fas fa-eye"></i> 浏览量 <span>${this.post.viewCount || 0}</span>
        </div>
        ${currentUser && currentUser.id === this.post.userId ?
          `<button class="post-detail-action-btn edit-btn" data-id="${this.post.id}">
            <i class="fas fa-edit"></i> 编辑
          </button>
          <button class="post-detail-action-btn visibility-btn" data-id="${this.post.id}">
            <i class="fas fa-eye"></i> 可见性
          </button>
          <button class="post-detail-action-btn delete-btn" data-id="${this.post.id}">
            <i class="fas fa-trash"></i> 删除
          </button>` : 
          currentUser ? 
          `<button class="post-detail-action-btn report-post-btn" data-id="${this.post.id}" data-type="post">
            <i class="fas fa-flag"></i> 举报
          </button>` : ''
        }
      </div>
    `;
  },

  // 检查收藏状态
  checkFavoriteStatus: async function() {
    try {
      const currentUser = userManager.state.currentUser;
      if (!currentUser) return false;

      // 路由是 GET /api/favorites/:postId/check（此前写成 /api/favorites/check/:postId → 永远 404，
      // 收藏按钮状态因此从来没被正确回填过）
      const response = await fetch(`/api/favorites/${this.postId}/check`, {
        headers: userManager.getAuthHeaders()
      });
      const data = await response.json();
      
      if (data.success) {
        this.post.favoriteCount = data.favoriteCount;
        return data.favorited;
      }
      return false;
    } catch (error) {
      console.error('检查收藏状态失败:', error);
      return false;
    }
  },

  // 切换收藏状态
  toggleFavorite: async function() {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再收藏', 'error');
      window.location.href = 'login.html';
      return;
    }

    const favoriteBtn = document.querySelector('.favorite-btn');
    if (favoriteBtn.classList.contains('processing')) {
      return;
    }

    favoriteBtn.classList.add('processing');

    try {
      const isFavorited = favoriteBtn.classList.contains('active');
      const method = isFavorited ? 'DELETE' : 'POST';

      const response = await fetch(`/api/favorites/${this.postId}`, {
        method: method,
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }

      const data = await response.json();
      if (data.success) {
        const starIcon = favoriteBtn.querySelector('i.fa-star');
        const countSpan = favoriteBtn.querySelector('span');

        if (data.favorited) {
          favoriteBtn.classList.add('active');
          if (starIcon) starIcon.classList.add('active');
          utils.showNotification('收藏成功', 'success');
          // 更新收藏数
          if (countSpan && data.favoriteCount !== undefined) {
            countSpan.textContent = data.favoriteCount;
          }
          // 收藏成功后加载标签并显示选择弹窗
          await this.loadTags();
          if (this.tags.length > 0) {
            this.showFavoriteTagModal();
          }
        } else {
          favoriteBtn.classList.remove('active');
          if (starIcon) starIcon.classList.remove('active');
          utils.showNotification('取消收藏成功', 'success');
          // 更新收藏数
          if (countSpan && data.favoriteCount !== undefined) {
            countSpan.textContent = data.favoriteCount;
          }
        }
      }
    } catch (error) {
      console.error('收藏操作失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      favoriteBtn.classList.remove('processing');
    }
  },

  // 加载用户标签
  loadTags: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/tags/${currentUser.id}`);
      const data = await response.json();

      if (data.success) {
        this.tags = data.tags;
      }
    } catch (error) {
      console.error('加载标签失败:', error);
    }
  },

  // 显示收藏标签选择弹窗
  showFavoriteTagModal: function() {
    // 移除已存在的弹窗
    const existingModal = document.getElementById('favorite-tag-modal');
    if (existingModal) existingModal.remove();

    let tagsHtml = `
      <div class="tag-select-item no-tag selected" data-tag-id="">
        <i class="fas fa-times-circle"></i>
        <span>不选择分类</span>
      </div>
    `;

    this.tags.forEach(tag => {
      tagsHtml += `
        <div class="tag-select-item" data-tag-id="${tag._id}">
          <div class="tag-color-dot" style="background: ${tag.color}"></div>
          <span>${this.escapeHtml(tag.name)}</span>
        </div>
      `;
    });

    const modalHtml = `
      <div id="favorite-tag-modal" class="favorite-tag-modal">
        <div class="favorite-tag-modal-content">
          <div class="favorite-tag-modal-header">
            <h3><i class="fas fa-folder"></i> 选择收藏分类</h3>
            <button class="favorite-tag-modal-close" id="favorite-tag-modal-close">&times;</button>
          </div>
          <div class="favorite-tag-modal-body">
            <p class="favorite-tag-hint">收藏成功！可选择分类整理收藏内容</p>
            <div class="tag-select-list" id="favorite-tag-select-list">
              ${tagsHtml}
            </div>
          </div>
          <div class="favorite-tag-modal-footer">
            <button class="btn-skip" id="skip-tag-btn">跳过</button>
            <button class="btn-save-tag" id="save-tag-btn">保存</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.selectedTagId = null;

    // 绑定事件
    const modal = document.getElementById('favorite-tag-modal');
    const closeBtn = document.getElementById('favorite-tag-modal-close');
    const skipBtn = document.getElementById('skip-tag-btn');
    const saveBtn = document.getElementById('save-tag-btn');
    const tagList = document.getElementById('favorite-tag-select-list');

    closeBtn.onclick = () => modal.remove();
    skipBtn.onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    tagList.onclick = (e) => {
      const item = e.target.closest('.tag-select-item');
      if (item) {
        tagList.querySelectorAll('.tag-select-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedTagId = item.dataset.tagId || null;
      }
    };

    saveBtn.onclick = async () => {
      if (this.selectedTagId !== undefined && this.selectedTagId !== null) {
        await this.updateFavoriteTag(this.selectedTagId);
      }
      modal.remove();
    };
  },

  // 更新收藏标签
  updateFavoriteTag: async function(tagId) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/${this.postId}/tag`, {
        method: 'PUT',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          tagId: tagId || null
        })
      });

      const data = await response.json();
      if (data.success) {
        const tag = this.tags.find(t => t._id === tagId);
        if (tag) {
          utils.showNotification(`已添加到「${tag.name}」分类`, 'success');
        }
      }
    } catch (error) {
      console.error('更新收藏标签失败:', error);
    }
  },

  // 渲染 markdown 内容
  renderMarkdownContent: function(text) {
    if (!text) return '';
    
    if (!this.md) {
      return '<p>' + this.escapeHtml(text) + '</p>';
    }
    
    try {
      // 保护公式不被 markdown 处理
      const { protectedText, placeholders } = this.protectMathFormulas(text);
      
      const html = this.md.render(protectedText);
      
      // 恢复公式
      return this.restoreMathFormulas(html, placeholders);
    } catch (error) {
      console.error('Markdown 渲染失败:', error);
      return '<p>' + this.escapeHtml(text) + '</p>';
    }
  },

  // 保护数学公式不被 markdown 处理
  protectMathFormulas: function(text) {
    const placeholders = [];
    let index = 0;
    
    // 替换函数
    const replaceWithPlaceholder = (match) => {
      const placeholder = `MATHJAXPH${index}PH`;
      placeholders.push({ placeholder, formula: match });
      index++;
      return placeholder;
    };
    
    // 按顺序处理各种公式格式
    // 1. 独立公式块 $$...$$ (先处理长的，避免被 $...$ 部分匹配)
    let protectedText = text.replace(/\$\$[\s\S]*?\$\$/g, replaceWithPlaceholder);
    // 2. 独立公式块 \[...\]
    protectedText = protectedText.replace(/\\[[\s\S]*?\\]/g, replaceWithPlaceholder);
    // 3. 行内公式 $...$ (非贪婪，排除 $$)
    protectedText = protectedText.replace(/\$(?!\$)([^\$\n]+?)\$/g, replaceWithPlaceholder);
    // 4. 行内公式 \(...\)
    protectedText = protectedText.replace(/\\\([\s\S]*?\\\)/g, replaceWithPlaceholder);
    
    return { protectedText, placeholders };
  },

  // 恢复数学公式
  restoreMathFormulas: function(html, placeholders) {
    let result = html;
    placeholders.forEach(({ placeholder, formula }) => {
      // 安全恢复：公式原文是用户输入，必须 HTML 转义后插入（防注入），
      // 且用函数式替换避免 replacement 字符串中的 $ 序列被展开
      const safeFormula = this.escapeHtml(formula);
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedPlaceholder, 'g'), () => safeFormula);
    });
    return result;
  },

  // 渲染帖子中的图片
  renderPostImages: function(images) {
    if (!images || images.length === 0) return '';
    
    let imagesHTML = '<div class="post-detail-images">';
    
    images.forEach(image => {
      // XSS 防护：URL 转义 HTML 属性 + 通过 data-url 传递（onclick 不再拼接用户数据）
      const safeUrl = this.escapeHtml(image.url);
      imagesHTML += `
        <img src="${safeUrl}" alt="${this.escapeHtml(image.originalname)}" 
             class="post-detail-image" data-url="${safeUrl}" onclick="postDetailManager.showImageModal(this.dataset.url)">
      `;
    });
    
    imagesHTML += '</div>';
    return imagesHTML;
  },

  // 渲染评论
  renderComments: function() {
    const container = document.getElementById('comments-list');
    const countSpan = document.getElementById('comment-count');

    if (!this.post.comments || this.post.comments.length === 0) {
      container.innerHTML = `
        <div class="empty-comments">
          <i class="fas fa-comments"></i>
          <p>暂无评论，快来发表第一条评论吧！</p>
        </div>
      `;
      countSpan.textContent = '0';
      return;
    }

    countSpan.textContent = this.post.comments.length;

    let commentsHTML = '';
    
    this.post.comments.forEach(comment => {
      const commentUsername = comment.anonymous ? '匿名同学' : (comment.username || '用户');
      const isCurrentUser = userManager.state.currentUser && 
                           userManager.state.currentUser.id === comment.userId;
      const isPostOwner = userManager.state.currentUser && 
                         userManager.state.currentUser.id === this.post.userId;
      const replyCount = comment.replies ? comment.replies.length : 0;

      commentsHTML += `
        <div class="comment-item" data-comment-id="${comment.id}">
          <div class="comment-header">
            <div class="comment-user">${this.escapeHtml(commentUsername)}</div>
            <div class="comment-time">${utils.formatDate(comment.timestamp)}</div>
          </div>
          <div class="comment-body">
            ${this.renderMarkdownContent(comment.content)}
            ${this.renderCommentImages(comment.images)}
          </div>
          <div class="comment-footer">
            <span class="comment-action like-comment-btn ${userManager.state.currentUser && comment.likedBy && comment.likedBy.includes(userManager.state.currentUser.id) ? 'liked' : ''}" data-comment-id="${comment.id}">
              <i class="fas fa-thumbs-up"></i> ${comment.likes || 0}
            </span>
            <span class="comment-action reply-btn" data-comment-id="${comment.id}">
              <i class="fas fa-reply"></i> 回复 ${replyCount > 0 ? `(${replyCount})` : ''}
            </span>
            ${isCurrentUser ? `
              <span class="comment-action delete-comment" data-comment-id="${comment.id}">
                <i class="fas fa-trash"></i> 删除
              </span>
            ` : ''}
            ${(!isCurrentUser && isPostOwner) ? `
              <span class="comment-action delete-comment" data-comment-id="${comment.id}">
                <i class="fas fa-trash"></i> 删除
              </span>
              <span class="comment-action report-comment-btn" data-comment-id="${comment.id}" data-type="comment">
                <i class="fas fa-flag"></i> 举报
              </span>
            ` : ''}
            ${(!isCurrentUser && !isPostOwner && userManager.state.currentUser) ? `
              <span class="comment-action report-comment-btn" data-comment-id="${comment.id}" data-type="comment">
                <i class="fas fa-flag"></i> 举报
              </span>
            ` : ''}
          </div>
          
          <!-- 回复输入框（默认隐藏） -->
          <div class="reply-input-container" id="reply-input-${comment.id}" style="display: none;">
            <textarea class="reply-textarea" rows="2" placeholder="回复 ${this.escapeHtml(commentUsername)}..."></textarea>
            <div class="reply-input-actions">
              <label class="anonymous-checkbox">
                <input type="checkbox" class="reply-anonymous-checkbox">
                <span>匿名</span>
              </label>
              <button class="btn-primary btn-small submit-reply-btn" data-comment-id="${comment.id}">
                <i class="fas fa-paper-plane"></i> 回复
              </button>
            </div>
          </div>
          
          <!-- 回复列表 -->
          ${comment.replies && comment.replies.length > 0 ? `
            <div class="replies-list">
              ${this.renderReplies(comment.replies, comment.id, 2)}
            </div>
          ` : ''}
        </div>
      `;
    });

    container.innerHTML = commentsHTML;
  },

  // 递归渲染回复（带层级限制）
  renderReplies: function(replies, commentId, level) {
    if (!replies || replies.length === 0) {
      return '';
    }

    return replies.map(reply => {
      const replyUsername = reply.anonymous ? '匿名同学' : (reply.username || '用户');
      const isReplyCurrentUser = userManager.state.currentUser && 
                                 userManager.state.currentUser.id === reply.userId;
      const isReplyPostOwner = userManager.state.currentUser && 
                               userManager.state.currentUser.id === this.post.userId;
      const nestedReplyCount = reply.replies ? reply.replies.length : 0;
      
      // 如果回复了其他回复，显示被回复的用户名
      let replyToInfo = '';
      if (reply.replyTo) {
        const parentReply = this.findReplyById(replies, reply.replyTo);
        if (parentReply) {
          const parentUsername = parentReply.anonymous ? '匿名同学' : (parentReply.username || '用户');
          replyToInfo = `<span class="reply-to-tag">回复 ${this.escapeHtml(parentUsername)}</span> `;
        }
      }
      
      // 递归渲染嵌套回复
      let nestedRepliesHTML = '';
      if (reply.replies && reply.replies.length > 0) {
        nestedRepliesHTML = `
          <div class="${level >= 3 ? 'nested-replies-list' : 'replies-list'}">
            ${this.renderReplies(reply.replies, commentId, level + 1)}
          </div>
        `;
      }
      
      return `
        <div class="${level >= 3 ? 'nested-reply-item' : 'reply-item'}" data-reply-id="${reply.id}">
          <div class="${level >= 3 ? 'nested-reply-header' : 'reply-header'}">
            <div class="${level >= 3 ? 'nested-reply-user' : 'reply-user'}">${this.escapeHtml(replyUsername)}</div>
            <div class="${level >= 3 ? 'nested-reply-time' : 'reply-time'}">${utils.formatDate(reply.timestamp)}</div>
          </div>
          <div class="${level >= 3 ? 'nested-reply-body' : 'reply-body'}">
            ${replyToInfo}${this.renderMarkdownContent(reply.content)}
            ${this.renderCommentImages(reply.images)}
          </div>
          <div class="reply-footer">
            <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} like-comment-btn ${userManager.state.currentUser && reply.likedBy && reply.likedBy.includes(userManager.state.currentUser.id) ? 'liked' : ''}" data-comment-id="${reply.id}">
              <i class="fas fa-thumbs-up"></i> ${reply.likes || 0}
            </span>
            <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} reply-reply-btn" data-comment-id="${commentId}" data-reply-id="${reply.id}" data-reply-username="${replyUsername}">
              <i class="fas fa-reply"></i> 回复 ${nestedReplyCount > 0 ? `(${nestedReplyCount})` : ''}
            </span>
            ${isReplyCurrentUser ? `
              <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} delete-reply" data-comment-id="${commentId}" data-reply-id="${reply.id}">
                <i class="fas fa-trash"></i> 删除
              </span>
            ` : ''}
            ${(!isReplyCurrentUser && isReplyPostOwner) ? `
              <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} delete-reply" data-comment-id="${commentId}" data-reply-id="${reply.id}">
                <i class="fas fa-trash"></i> 删除
              </span>
              <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} report-comment-btn" data-comment-id="${reply.id}" data-type="comment">
                <i class="fas fa-flag"></i> 举报
              </span>
            ` : ''}
            ${(!isReplyCurrentUser && !isReplyPostOwner && userManager.state.currentUser) ? `
              <span class="${level >= 3 ? 'nested-reply-action' : 'reply-action'} report-comment-btn" data-comment-id="${reply.id}" data-type="comment">
                <i class="fas fa-flag"></i> 举报
              </span>
            ` : ''}
          </div>
          
          <!-- 嵌套回复输入框（默认隐藏） -->
          <div class="${level >= 2 ? 'nested-reply-input' : 'reply-input-container'}" id="nested-reply-input-${reply.id}" style="display: none;">
            <textarea class="reply-textarea" rows="2" placeholder="回复 ${this.escapeHtml(replyUsername)}..."></textarea>
            <div class="reply-input-actions">
              <label class="anonymous-checkbox">
                <input type="checkbox" class="reply-anonymous-checkbox">
                <span>匿名</span>
              </label>
              <button class="btn-primary btn-small submit-nested-reply-btn" data-comment-id="${commentId}" data-reply-id="${reply.id}">
                <i class="fas fa-paper-plane"></i> 回复
              </button>
            </div>
          </div>
          
          ${nestedRepliesHTML}
        </div>
      `;
    }).join('');
  },

  // 在回复列表中查找指定ID的回复
  findReplyById: function(replies, replyId) {
    for (let reply of replies) {
      if (reply.id === replyId) {
        return reply;
      }
      if (reply.replies && reply.replies.length > 0) {
        const found = this.findReplyById(reply.replies, replyId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  },

  // 代码高亮和添加复制按钮
  highlightCodeBlocks: function() {
    // 获取所有代码块
    const codeBlocks = document.querySelectorAll('.post-detail-content-text pre, .comment-body pre');
    
    codeBlocks.forEach((pre, index) => {
      // 确保代码块没有被处理过
      if (pre.dataset.highlighted) return;
      pre.dataset.highlighted = 'true';
      
      const code = pre.querySelector('code');
      
      // 使用 highlight.js 高亮代码
      if (window.hljs && code) {
        // 如果 markdown-it 没有高亮，手动高亮
        if (!code.classList.contains('hljs')) {
          hljs.highlightElement(code);
        }
      }
      
      // 创建包装容器
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      
      // 添加复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制';
      copyBtn.title = '复制代码';
      
      copyBtn.addEventListener('click', async () => {
        const codeText = code ? code.textContent : pre.textContent;
        
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
          copyBtn.classList.add('copied');
          
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          // 降级方案：使用传统复制方法
          const textarea = document.createElement('textarea');
          textarea.value = codeText;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          
          try {
            document.execCommand('copy');
            copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
            copyBtn.classList.add('copied');
            
            setTimeout(() => {
              copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制';
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch (e) {
            copyBtn.innerHTML = '<i class="fas fa-times"></i> 失败';
            setTimeout(() => {
              copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制';
            }, 2000);
          }
          
          document.body.removeChild(textarea);
        }
      });
      
      wrapper.appendChild(copyBtn);
    });
  },

  // 渲染 LaTeX 公式
  renderMathJax: function() {
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      console.log('开始渲染 MathJax 公式...');
      MathJax.typesetPromise().then(() => {
        console.log('MathJax 公式渲染完成');
      }).catch((err) => console.error('MathJax typeset failed:', err));
    }
  },

  // 显示图片预览模态框
  showImageModal: function(imageUrl) {
    // 创建模态框（如果不存在）
    let modal = document.getElementById('image-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'image-modal';
      modal.className = 'image-modal';
      modal.innerHTML = `
        <div class="image-modal-content">
          <img src="" alt="预览图片">
        </div>
        <div class="image-modal-close">&times;</div>
      `;
      document.body.appendChild(modal);

      // 添加关闭事件
      modal.querySelector('.image-modal-close').addEventListener('click', () => {
        modal.style.display = 'none';
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    }

    modal.querySelector('.image-modal-content img').src = imageUrl;
    modal.style.display = 'flex';
  },

  // 提交评论
  submitComment: async function() {
    const contentInput = document.getElementById('new-comment-content');
    const anonymousCheckbox = document.getElementById('new-comment-anonymous');
    const submitBtn = document.getElementById('submit-comment-btn');

    const content = contentInput.value.trim();
    const isAnonymous = anonymousCheckbox.checked;
    const hasImages = this.commentImages && this.commentImages.length > 0;

    if (!content && !hasImages) {
      utils.showNotification('请输入评论内容或添加图片', 'warning');
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再评论', 'error');
      window.location.href = 'login.html';
      return;
    }

    // 检测并转换 HTML 内容为 Markdown 代码块
    const processedContent = content ? (typeof utils !== 'undefined' && utils.detectAndEscapeHtml 
      ? utils.detectAndEscapeHtml(content) 
      : content) : '';

    // 禁用提交按钮
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发表中...';

    try {
      // 使用 FormData 支持图片上传
      const formData = new FormData();
      if (processedContent) {
        formData.append('content', processedContent);
      }
      formData.append('anonymous', isAnonymous);
      if (hasImages) {
        for (const file of this.commentImages) {
          formData.append('images', file);
        }
      }

      const response = await fetch(`/api/posts/${this.postId}/comments`, {
        method: 'POST',
        headers: userManager.getAuthHeaders(true), // 不设置 Content-Type
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '发表评论失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('评论发表成功', 'success');
        contentInput.value = '';
        anonymousCheckbox.checked = false;
        this.clearCommentImages();
        
        // 重新加载帖子详情
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('发表评论失败:', error);
      utils.showNotification(error.message || '发表评论失败', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发表评论';
    }
  },

  // 删除评论
  deleteComment: async function(commentId) {
    if (!confirm('确定要删除这条评论吗？')) {
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再操作', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/posts/${this.postId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除评论失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('评论删除成功', 'success');
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('删除评论失败:', error);
      utils.showNotification(error.message || '删除评论失败', 'error');
    }
  },

  // 显示回复输入框
  showReplyInput: function(commentId) {
    const replyInput = document.getElementById(`reply-input-${commentId}`);
    if (replyInput) {
      replyInput.style.display = replyInput.style.display === 'none' ? 'block' : 'none';
      if (replyInput.style.display === 'block') {
        replyInput.querySelector('textarea').focus();
      }
    }
  },

  // 提交回复
  submitReply: async function(commentId) {
    const replyInput = document.getElementById(`reply-input-${commentId}`);
    const textarea = replyInput.querySelector('.reply-textarea');
    const anonymousCheckbox = replyInput.querySelector('.reply-anonymous-checkbox');
    const submitBtn = replyInput.querySelector('.submit-reply-btn');

    const content = textarea.value.trim();
    const isAnonymous = anonymousCheckbox.checked;

    if (!content) {
      utils.showNotification('请输入回复内容', 'warning');
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再回复', 'error');
      window.location.href = 'login.html';
      return;
    }

    // 检测并转换 HTML 内容为 Markdown 代码块
    const processedContent = typeof utils !== 'undefined' && utils.detectAndEscapeHtml
      ? utils.detectAndEscapeHtml(content)
      : content;

    // 禁用提交按钮
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 回复中...';

    try {
      const response = await fetch(`/api/posts/${this.postId}/comments/${commentId}/reply`, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          content: processedContent,
          anonymous: isAnonymous
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '回复失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('回复成功', 'success');
        textarea.value = '';
        anonymousCheckbox.checked = false;
        replyInput.style.display = 'none';
        
        // 重新加载帖子详情
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('回复失败:', error);
      utils.showNotification(error.message || '回复失败', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 回复';
    }
  },

  // 显示嵌套回复输入框
  showNestedReplyInput: function(replyId) {
    const replyInput = document.getElementById(`nested-reply-input-${replyId}`);
    if (replyInput) {
      replyInput.style.display = replyInput.style.display === 'none' ? 'block' : 'none';
      if (replyInput.style.display === 'block') {
        replyInput.querySelector('textarea').focus();
      }
    }
  },

  // 提交嵌套回复
  submitNestedReply: async function(commentId, replyId) {
    const replyInput = document.getElementById(`nested-reply-input-${replyId}`);
    const textarea = replyInput.querySelector('.reply-textarea');
    const anonymousCheckbox = replyInput.querySelector('.reply-anonymous-checkbox');
    const submitBtn = replyInput.querySelector('.submit-nested-reply-btn');

    const content = textarea.value.trim();
    const isAnonymous = anonymousCheckbox.checked;

    if (!content) {
      utils.showNotification('请输入回复内容', 'warning');
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再回复', 'error');
      window.location.href = 'login.html';
      return;
    }

    // 检测并转换 HTML 内容为 Markdown 代码块
    const processedContent = typeof utils !== 'undefined' && utils.detectAndEscapeHtml 
      ? utils.detectAndEscapeHtml(content) 
      : content;

    // 禁用提交按钮
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 回复中...';

    try {
      const response = await fetch(`/api/posts/${this.postId}/comments/${commentId}/reply`, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          content: processedContent,
          anonymous: isAnonymous,
          replyToId: replyId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '回复失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('回复成功', 'success');
        textarea.value = '';
        anonymousCheckbox.checked = false;
        replyInput.style.display = 'none';
        
        // 重新加载帖子详情
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('回复失败:', error);
      utils.showNotification(error.message || '回复失败', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 回复';
    }
  },

  // 删除回复
  deleteReply: async function(commentId, replyId) {
    if (!confirm('确定要删除这条回复吗？')) {
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再操作', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/posts/${this.postId}/comments/${replyId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除回复失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('回复删除成功', 'success');
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('删除回复失败:', error);
      utils.showNotification(error.message || '删除回复失败', 'error');
    }
  },

  // 删除嵌套回复
  deleteNestedReply: async function(commentId, replyId, nestedReplyId) {
    if (!confirm('确定要删除这条回复吗？')) {
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再操作', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/posts/${this.postId}/comments/${nestedReplyId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除回复失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('回复删除成功', 'success');
        this.loadPostDetail();
      }
    } catch (error) {
      console.error('删除回复失败:', error);
      utils.showNotification(error.message || '删除回复失败', 'error');
    }
  },

  // 增加浏览量
  incrementViewCount: async function() {
    try {
      const response = await fetch(`/api/posts/${this.postId}/view`, {
        method: 'POST',
        headers: userManager.getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // 更新本地浏览量显示
          this.post.viewCount = data.viewCount;
          const viewCountElement = document.querySelector('.post-detail-view-count span');
          if (viewCountElement) {
            viewCountElement.textContent = data.viewCount;
          }
        }
      }
    } catch (error) {
      console.error('增加浏览量失败:', error);
      // 浏览量更新失败不影响用户体验，不显示错误提示
    }
  },

  // 点赞/取消点赞
  toggleLike: async function() {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再点赞', 'error');
      window.location.href = 'login.html';
      return;
    }

    const likeBtn = document.querySelector('.like-btn');
    if (likeBtn.classList.contains('processing')) {
      return;
    }

    likeBtn.classList.add('processing');

    try {
      const response = await fetch(`/api/posts/${this.postId}/like`, {
        method: 'POST',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }

      const data = await response.json();
      if (data.success) {
        const likesSpan = likeBtn.querySelector('span');
        const heartIcon = likeBtn.querySelector('i.fa-heart');

        if (likesSpan) {
          likesSpan.textContent = data.likes;
        }

        if (data.liked) {
          likeBtn.classList.add('active');
          if (heartIcon) heartIcon.classList.add('active');
        } else {
          likeBtn.classList.remove('active');
          if (heartIcon) heartIcon.classList.remove('active');
        }

        // 更新本地帖子数据
        this.post.likes = data.likes;
        if (data.liked) {
          if (!this.post.likedBy) this.post.likedBy = [];
          if (!this.post.likedBy.includes(userManager.state.currentUser.id)) {
            this.post.likedBy.push(userManager.state.currentUser.id);
          }
        } else {
          this.post.likedBy = (this.post.likedBy || []).filter(id => id !== userManager.state.currentUser.id);
        }

        // 如果点赞时取消了点踩，更新点踩状态
        if (data.dislikes !== undefined) {
          const dislikeBtn = document.querySelector('.dislike-btn');
          if (dislikeBtn) {
            const dislikesSpan = dislikeBtn.querySelector('span');
            const thumbsDownIcon = dislikeBtn.querySelector('i.fa-thumbs-down');
            
            if (dislikesSpan) {
              dislikesSpan.textContent = data.dislikes;
            }
            
            if (data.disliked) {
              dislikeBtn.classList.add('active');
              if (thumbsDownIcon) thumbsDownIcon.classList.add('active');
            } else {
              dislikeBtn.classList.remove('active');
              if (thumbsDownIcon) thumbsDownIcon.classList.remove('active');
            }
          }
          this.post.dislikes = data.dislikes;
          this.post.dislikedBy = (this.post.dislikedBy || []).filter(id => id !== userManager.state.currentUser.id);
        }
      }
    } catch (error) {
      console.error('点赞失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      likeBtn.classList.remove('processing');
    }
  },

  // 点赞/取消点赞评论
  toggleCommentLike: async function(commentId) {
    console.log('toggleCommentLike called, commentId:', commentId, 'postId:', this.postId);
    
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再点赞', 'error');
      window.location.href = 'login.html';
      return;
    }
    
    // 验证用户ID
    const userId = userManager.state.currentUser.id;
    if (!userId) {
      console.error('toggleCommentLike: 用户ID为空');
      utils.showNotification('用户信息错误，请重新登录', 'error');
      return;
    }
    
    // 验证帖子ID
    if (!this.postId) {
      console.error('toggleCommentLike: 帖子ID为空');
      utils.showNotification('帖子信息错误', 'error');
      return;
    }
    
    // 验证评论ID
    if (!commentId) {
      console.error('toggleCommentLike: 评论ID为空');
      utils.showNotification('评论信息错误', 'error');
      return;
    }

    const likeBtn = document.querySelector(`.like-comment-btn[data-comment-id="${commentId}"]`);
    if (!likeBtn) {
      console.error('toggleCommentLike: 未找到点赞按钮, commentId:', commentId);
      return;
    }

    if (likeBtn.classList.contains('processing')) {
      return;
    }

    likeBtn.classList.add('processing');

    try {
      console.log('发送评论点赞请求:', { postId: this.postId, commentId, userId });
      
      const response = await fetch(`/api/posts/${this.postId}/comments/${commentId}/like`, {
        method: 'POST',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }

      const data = await response.json();
      if (data.success) {
        // 更新按钮显示
        likeBtn.innerHTML = `<i class="fas fa-thumbs-up"></i> ${data.likes}`;

        if (data.liked) {
          likeBtn.classList.add('liked');
        } else {
          likeBtn.classList.remove('liked');
        }

        utils.showNotification(data.message || '操作成功', 'success');
      }
    } catch (error) {
      console.error('点赞评论失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      likeBtn.classList.remove('processing');
    }
  },

  // 点踩/取消点踩
  toggleDislike: async function() {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再点踩', 'error');
      window.location.href = 'login.html';
      return;
    }

    const dislikeBtn = document.querySelector('.dislike-btn');
    if (dislikeBtn.classList.contains('processing')) {
      return;
    }

    dislikeBtn.classList.add('processing');

    try {
      const response = await fetch(`/api/posts/${this.postId}/dislike`, {
        method: 'POST',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }

      const data = await response.json();
      if (data.success) {
        const dislikesSpan = dislikeBtn.querySelector('span');
        const thumbsDownIcon = dislikeBtn.querySelector('i.fa-thumbs-down');

        if (dislikesSpan) {
          dislikesSpan.textContent = data.dislikes;
        }

        if (data.disliked) {
          dislikeBtn.classList.add('active');
          if (thumbsDownIcon) thumbsDownIcon.classList.add('active');
        } else {
          dislikeBtn.classList.remove('active');
          if (thumbsDownIcon) thumbsDownIcon.classList.remove('active');
        }

        // 更新本地帖子数据
        this.post.dislikes = data.dislikes;
        if (data.disliked) {
          if (!this.post.dislikedBy) this.post.dislikedBy = [];
          if (!this.post.dislikedBy.includes(userManager.state.currentUser.id)) {
            this.post.dislikedBy.push(userManager.state.currentUser.id);
          }
        } else {
          this.post.dislikedBy = (this.post.dislikedBy || []).filter(id => id !== userManager.state.currentUser.id);
        }

        // 如果点踩时取消了点赞，更新点赞状态
        if (data.likes !== undefined) {
          const likeBtn = document.querySelector('.like-btn');
          if (likeBtn) {
            const likesSpan = likeBtn.querySelector('span');
            const heartIcon = likeBtn.querySelector('i.fa-heart');
            
            if (likesSpan) {
              likesSpan.textContent = data.likes;
            }
            
            if (data.liked) {
              likeBtn.classList.add('active');
              if (heartIcon) heartIcon.classList.add('active');
            } else {
              likeBtn.classList.remove('active');
              if (heartIcon) heartIcon.classList.remove('active');
            }
          }
          this.post.likes = data.likes;
          this.post.likedBy = (this.post.likedBy || []).filter(id => id !== userManager.state.currentUser.id);
        }
      }
    } catch (error) {
      console.error('点踩失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      dislikeBtn.classList.remove('processing');
    }
  },

  // 删除帖子
  deletePost: async function() {
    if (!confirm('确定要删除这个帖子吗？此操作不可撤销。')) {
      return;
    }

    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再操作', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/posts/${this.postId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '删除失败');
      }

      const data = await response.json();
      if (data.success) {
        utils.showNotification('帖子删除成功', 'success');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1000);
      }
    } catch (error) {
      console.error('删除帖子失败:', error);
      utils.showNotification(error.message || '删除失败', 'error');
    }
  },

  // 设置事件监听器
  setupEventListeners: function() {
    // 返回按钮
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    }

    // 全局点击事件
    document.addEventListener('click', async (e) => {
      // 点赞按钮
      if (e.target.closest('.like-btn')) {
        this.toggleLike();
      }

      // 点踩按钮
      if (e.target.closest('.dislike-btn')) {
        this.toggleDislike();
      }

      // 收藏按钮
      if (e.target.closest('.favorite-btn')) {
        this.toggleFavorite();
      }

      // 提交评论按钮
      if (e.target.closest('#submit-comment-btn')) {
        this.submitComment();
      }

      // 删除帖子按钮
      if (e.target.closest('.delete-btn')) {
        this.deletePost();
      }

      // 编辑帖子按钮
      if (e.target.closest('.edit-btn')) {
        const btn = e.target.closest('.edit-btn');
        const postId = btn.dataset.id;
        window.location.href = `edit-simple.html?edit=${postId}`;
      }

      // 可见性设置按钮
      if (e.target.closest('.visibility-btn')) {
        this.showVisibilityModal();
      }

      // 举报帖子按钮
      if (e.target.closest('.report-post-btn')) {
        const btn = e.target.closest('.report-post-btn');
        const postId = btn.dataset.id;
        const targetType = btn.dataset.type || 'post';
        this.showReportModal(postId, targetType);
      }

      // 删除评论按钮
      if (e.target.closest('.delete-comment')) {
        const btn = e.target.closest('.delete-comment');
        const commentId = btn.dataset.commentId;
        this.deleteComment(commentId);
      }

      // 点赞评论按钮
      if (e.target.closest('.like-comment-btn')) {
        e.stopPropagation(); // 防止事件冒泡
        const btn = e.target.closest('.like-comment-btn');
        const commentId = btn.dataset.commentId;
        this.toggleCommentLike(commentId);
      }

      // 举报评论按钮
      if (e.target.closest('.report-comment-btn')) {
        e.stopPropagation(); // 防止事件冒泡
        const btn = e.target.closest('.report-comment-btn');
        const commentId = btn.dataset.commentId;
        const targetType = btn.dataset.type || 'comment';
        this.showReportModal(commentId, targetType);
      }

      // 回复按钮
      if (e.target.closest('.reply-btn')) {
        const btn = e.target.closest('.reply-btn');
        const commentId = btn.dataset.commentId;
        this.showReplyInput(commentId);
      }

      // 提交回复按钮
      if (e.target.closest('.submit-reply-btn')) {
        const btn = e.target.closest('.submit-reply-btn');
        const commentId = btn.dataset.commentId;
        this.submitReply(commentId);
      }

      // 删除回复按钮
      if (e.target.closest('.delete-reply')) {
        const btn = e.target.closest('.delete-reply');
        const commentId = btn.dataset.commentId;
        const replyId = btn.dataset.replyId;
        this.deleteReply(commentId, replyId);
      }

      // 回复回复按钮
      if (e.target.closest('.reply-reply-btn')) {
        const btn = e.target.closest('.reply-reply-btn');
        console.log('回复回复按钮被点击:', btn.dataset);
        const commentId = btn.dataset.commentId;
        const replyId = btn.dataset.replyId;
        this.showNestedReplyInput(replyId);
      }

      // 提交嵌套回复按钮
      if (e.target.closest('.submit-nested-reply-btn')) {
        const btn = e.target.closest('.submit-nested-reply-btn');
        const commentId = btn.dataset.commentId;
        const replyId = btn.dataset.replyId;
        this.submitNestedReply(commentId, replyId);
      }

      // 删除嵌套回复按钮
      if (e.target.closest('.delete-nested-reply')) {
        const btn = e.target.closest('.delete-nested-reply');
        const commentId = btn.dataset.commentId;
        const replyId = btn.dataset.replyId;
        const nestedReplyId = btn.dataset.nestedReplyId;
        this.deleteNestedReply(commentId, replyId, nestedReplyId);
      }

      // 头像点击（跳转到个人主页）
      if (e.target.closest('.post-detail-avatar') && !e.target.closest('.post-detail-avatar.anonymous-avatar')) {
        const avatar = e.target.closest('.post-detail-avatar');
        const userId = avatar.dataset.userId;
        if (userId) {
          window.location.href = `profile.html?id=${userId}`;
        }
      }

      // 评论图片上传按钮
      if (e.target.closest('#comment-image-upload-btn')) {
        const imageInput = document.getElementById('comment-image-input');
        if (imageInput) imageInput.click();
      }

      // 移除评论预览图片
      if (e.target.closest('.remove-comment-image')) {
        const btn = e.target.closest('.remove-comment-image');
        const index = parseInt(btn.dataset.index, 10);
        this.removeCommentImage(index);
      }

      // 评论图片放大查看
      if (e.target.closest('.comment-img')) {
        const img = e.target.closest('.comment-img');
        this.showImageLightbox(img.src || img.dataset.src);
      }

      // Emoji 按钮
      if (e.target.closest('#comment-emoji-btn')) {
        const btn = e.target.closest('#comment-emoji-btn');
        const textarea = document.getElementById('new-comment-content');
        if (textarea && utils && utils.openEmojiPicker) {
          utils.openEmojiPicker(textarea, btn);
        }
      }
    });

    // 评论图片文件选择
    const commentImageInput = document.getElementById('comment-image-input');
    if (commentImageInput) {
      commentImageInput.addEventListener('change', (e) => this.handleCommentImageSelect(e));
    }

    // 粘贴图片到评论
    document.addEventListener('paste', async (e) => {
      const textarea = document.getElementById('new-comment-content');
      if (!textarea || document.activeElement !== textarea) return;

      const items = e.clipboardData.files;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            const compressed = await utils.compressImage(items[i]);
            this.commentImages.push(compressed);
            this.renderCommentImagePreview();
            return;
          }
        }
      }
    });
  },

  // HTML 转义函数
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 显示可见性设置弹窗
  showVisibilityModal: function() {
    const currentVisibility = this.post.visibility || 'public';
    
    // 移除已存在的弹窗
    const existingModal = document.getElementById('visibility-modal');
    if (existingModal) existingModal.remove();
    
    const modalHtml = `
      <div id="visibility-modal" class="visibility-modal">
        <div class="visibility-modal-content">
          <div class="visibility-modal-header">
            <h3><i class="fas fa-eye"></i> 设置帖子可见性</h3>
            <button class="visibility-modal-close" id="visibility-modal-close">&times;</button>
          </div>
          <div class="visibility-modal-body">
            <div class="visibility-options">
              <label class="visibility-option ${currentVisibility === 'public' ? 'selected' : ''}">
                <input type="radio" name="post-visibility" value="public" ${currentVisibility === 'public' ? 'checked' : ''}>
                <div class="visibility-radio"></div>
                <div class="visibility-info">
                  <span class="visibility-title"><i class="fas fa-globe"></i> 公开</span>
                  <span class="visibility-desc">所有人可见</span>
                </div>
              </label>
              <label class="visibility-option ${currentVisibility === 'followers' ? 'selected' : ''}">
                <input type="radio" name="post-visibility" value="followers" ${currentVisibility === 'followers' ? 'checked' : ''}>
                <div class="visibility-radio"></div>
                <div class="visibility-info">
                  <span class="visibility-title"><i class="fas fa-users"></i> 仅粉丝可见</span>
                  <span class="visibility-desc">只有关注你的粉丝可以看到</span>
                </div>
              </label>
              <label class="visibility-option ${currentVisibility === 'self' ? 'selected' : ''}">
                <input type="radio" name="post-visibility" value="self" ${currentVisibility === 'self' ? 'checked' : ''}>
                <div class="visibility-radio"></div>
                <div class="visibility-info">
                  <span class="visibility-title"><i class="fas fa-lock"></i> 仅自己可见</span>
                  <span class="visibility-desc">只有自己可以看到（私密帖子）</span>
                </div>
              </label>
            </div>
          </div>
          <div class="visibility-modal-footer">
            <button class="btn-cancel" id="visibility-cancel-btn">取消</button>
            <button class="btn-save" id="visibility-save-btn">保存</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('visibility-modal');
    const closeBtn = document.getElementById('visibility-modal-close');
    const cancelBtn = document.getElementById('visibility-cancel-btn');
    const saveBtn = document.getElementById('visibility-save-btn');

    // 关闭弹窗
    const closeModal = () => modal.remove();
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // 选项点击效果
    modal.querySelectorAll('.visibility-option').forEach(option => {
      option.addEventListener('click', () => {
        modal.querySelectorAll('.visibility-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
      });
    });

    // 保存可见性设置
    saveBtn.onclick = async () => {
      const selectedOption = modal.querySelector('input[name="post-visibility"]:checked');
      if (!selectedOption) return;

      const newVisibility = selectedOption.value;
      
      if (newVisibility === currentVisibility) {
        closeModal();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      try {
        const response = await fetch(`/api/posts/${this.postId}`, {
          method: 'PUT',
          headers: userManager.getAuthHeaders(),
          body: JSON.stringify({
            visibility: newVisibility
          })
        });

        const data = await response.json();

        if (data.success) {
          this.post.visibility = newVisibility;
          const visibilityText = newVisibility === 'public' ? '公开' : 
            newVisibility === 'followers' ? '仅粉丝可见' : '仅自己可见';
          utils.showNotification(`帖子可见性已更改为：${visibilityText}`, 'success');
          closeModal();
        } else {
          utils.showNotification(data.message || '保存失败', 'error');
        }
      } catch (error) {
        console.error('保存可见性设置失败:', error);
        utils.showNotification('保存失败，请稍后重试', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    };
  },

  // 显示举报模态框
  showReportModal: function(targetId, targetType) {
    console.log('showReportModal called, targetId:', targetId, 'targetType:', targetType);
    
    // 验证用户登录状态
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再举报', 'error');
      return;
    }
    
    // 验证用户ID
    const userId = userManager.state.currentUser.id;
    if (!userId) {
      console.error('showReportModal: 用户ID为空');
      utils.showNotification('用户信息错误，请重新登录', 'error');
      return;
    }
    
    // 验证目标ID
    if (!targetId) {
      console.error('showReportModal: 目标ID为空');
      utils.showNotification('举报目标信息错误', 'error');
      return;
    }
    
    // 移除已存在的模态框
    const existingModal = document.getElementById('report-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modalHTML = `
      <div id="report-modal" class="report-modal">
        <div class="report-modal-content">
          <div class="report-modal-header">
            <h3><i class="fas fa-flag"></i> 举报${targetType === 'post' ? '帖子' : '评论'}</h3>
            <button class="report-modal-close">&times;</button>
          </div>
          <div class="report-modal-body">
            <div class="report-reason-list">
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="SPAM">
                <span class="reason-icon">📢</span>
                <span class="reason-text">垃圾广告</span>
              </label>
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="HARASSMENT">
                <span class="reason-icon">😤</span>
                <span class="reason-text">骚扰辱骂</span>
              </label>
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="INAPPROPRIATE">
                <span class="reason-icon">🚫</span>
                <span class="reason-text">不当内容</span>
              </label>
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="FALSE_INFO">
                <span class="reason-icon">❌</span>
                <span class="reason-text">虚假信息</span>
              </label>
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="COPYRIGHT">
                <span class="reason-icon">©️</span>
                <span class="reason-text">侵权内容</span>
              </label>
              <label class="report-reason-item">
                <input type="radio" name="report-reason" value="OTHER">
                <span class="reason-icon">📝</span>
                <span class="reason-text">其他</span>
              </label>
            </div>
            <div class="report-description">
              <label for="report-description">补充说明（可选）</label>
              <textarea id="report-description" placeholder="请详细描述举报原因..." rows="3" maxlength="200"></textarea>
            </div>
          </div>
          <div class="report-modal-footer">
            <button class="report-btn-cancel">取消</button>
            <button class="report-btn-submit" data-id="${targetId}" data-type="${targetType}">提交举报</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('report-modal');
    const closeBtn = modal.querySelector('.report-modal-close');
    const cancelBtn = modal.querySelector('.report-btn-cancel');
    const submitBtn = modal.querySelector('.report-btn-submit');
    
    // 关闭模态框
    const closeModal = () => modal.remove();
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    
    // 提交举报
    submitBtn.addEventListener('click', async () => {
      const selectedReason = modal.querySelector('input[name="report-reason"]:checked');
      
      if (!selectedReason) {
        utils.showNotification('请选择举报原因', 'error');
        return;
      }
      
      const description = modal.querySelector('#report-description').value.trim();
      
      try {
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中...';
        
        console.log('发送举报请求:', { targetId, targetType, reason: selectedReason.value, reporterId: userId });
        
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: userManager.getAuthHeaders(),
          body: JSON.stringify({
            reporterId: userId,
            targetType: targetType,
            targetId: targetId,
            reason: selectedReason.value,
            description: description
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          utils.showNotification('举报已提交，我们会尽快处理', 'success');
          closeModal();
        } else {
          utils.showNotification(data.message || '举报失败', 'error');
        }
      } catch (error) {
        console.error('提交举报失败:', error);
        utils.showNotification('提交举报失败，请稍后重试', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交举报';
      }
    });
  },

  // 处理评论图片选择
  handleCommentImageSelect: async function(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxCount = 5;

    for (const file of files) {
      if (this.commentImages.length >= maxCount) {
        utils.showNotification(`最多只能添加 ${maxCount} 张图片`, 'warning');
        break;
      }
      if (!allowedTypes.includes(file.type)) {
        utils.showNotification('只支持 JPG、PNG、GIF、WebP 格式的图片', 'error');
        continue;
      }
      const compressed = await utils.compressImage(file);
      this.commentImages.push(compressed);
    }

    this.renderCommentImagePreview();
    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  },

  // 移除评论图片
  removeCommentImage: function(index) {
    this.commentImages.splice(index, 1);
    this.renderCommentImagePreview();
  },

  // 清空评论图片
  clearCommentImages: function() {
    this.commentImages = [];
    this.renderCommentImagePreview();
  },

  // 渲染评论图片预览
  renderCommentImagePreview: function() {
    const previewContainer = document.getElementById('comment-image-preview');
    const previewList = document.getElementById('comment-image-preview-list');
    if (!previewContainer || !previewList) return;

    if (this.commentImages.length === 0) {
      previewContainer.style.display = 'none';
      previewList.innerHTML = '';
      return;
    }

    previewContainer.style.display = 'block';
    previewList.innerHTML = '';

    this.commentImages.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const item = document.createElement('div');
        item.className = 'comment-image-preview-item';
        item.innerHTML = `
          <img src="${evt.target.result}" alt="预览">
          <button class="remove-comment-image" data-index="${index}" title="移除">
            <i class="fas fa-times"></i>
          </button>
        `;
        previewList.appendChild(item);
      };
      reader.readAsDataURL(file);
    });
  },

  // 显示图片灯箱（委托给 utils）
  showImageLightbox: function(src) {
    if (utils && utils.showImageLightbox) {
      utils.showImageLightbox(src);
    }
  },

  // 渲染评论图片HTML
  renderCommentImages: function(images) {
    if (!images || images.length === 0) return '';
    return `<div class="comment-images">${
      images.map(img => `<img class="comment-img" src="${this.escapeHtml(img.url)}" alt="评论图片" loading="lazy">`).join('')
    }</div>`;
  }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  postDetailManager.init();
});

// 暴露到全局：[data-action] 事件委托派发器据此解析 postDetailManager.xxx 动作（CSP 内联事件重构）
window.postDetailManager = postDetailManager;