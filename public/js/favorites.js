// 收藏页面管理器
const favoritesManager = {
  currentPage: 1,
  totalPages: 1,
  isLoading: false,
  tags: [],
  currentTagId: null,
  editingTagId: null,
  // 管理模式相关
  isManageMode: false,
  selectedPostIds: new Set(),
  allPosts: [],

  // 初始化
  init: function() {
    // 检查 localStorage 中是否有用户数据
    const savedUser = localStorage.getItem('forumUser');
    
    if (!savedUser) {
      this.showLoginPrompt();
      return;
    }
    
    // 等待 userManager 完成用户验证
    this.waitForUserManager();
  },

  // 等待 userManager 初始化完成
  waitForUserManager: function() {
    let attempts = 0;
    const maxAttempts = 100; // 最多等待5秒
    
    const checkInterval = setInterval(() => {
      attempts++;
      
      // 检查 userManager 是否已设置用户状态
      if (userManager.state.currentUser) {
        clearInterval(checkInterval);
        this.loadTags();
        this.loadFavorites();
        this.setupEventListeners();
      } else if (attempts >= maxAttempts) {
        // 超时，可能是服务器验证失败
        clearInterval(checkInterval);
        this.showLoginPrompt();
      }
    }, 50);
  },

  // 显示登录提示
  showLoginPrompt: function() {
    const container = document.getElementById('favorites-posts-container');
    const countEl = document.getElementById('favorites-count');
    const noFavoritesEl = document.getElementById('no-favorites-message');
    const loadingEl = document.getElementById('loading');
    const tagsSection = document.querySelector('.tags-section');
    
    if (container) {
      container.innerHTML = `
        <div class="login-prompt">
          <i class="fas fa-star"></i>
          <h2>请先登录</h2>
          <p>登录后即可查看您的收藏帖子</p>
          <a href="login.html" class="login-prompt-btn">
            <i class="fas fa-sign-in-alt"></i> 立即登录
          </a>
        </div>
      `;
    }
    
    if (countEl) countEl.style.display = 'none';
    if (noFavoritesEl) noFavoritesEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (tagsSection) tagsSection.style.display = 'none';
  },

  // ============ 标签管理 ============

  // 加载标签列表
  loadTags: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/tags/${currentUser.id}`);
      const data = await response.json();

      if (data.success) {
        this.tags = data.tags;
        this.renderTags();
      }
    } catch (error) {
      console.error('加载标签失败:', error);
    }
  },

  // 渲染标签列表
  renderTags: function() {
    const container = document.getElementById('tags-list');
    if (!container) return;

    let html = `
      <div class="tag-item all-tags ${this.currentTagId === null ? 'active' : ''}" data-tag-id="">
        <i class="fas fa-list"></i>
        <span class="tag-name">全部</span>
      </div>
    `;

    this.tags.forEach(tag => {
      const isActive = this.currentTagId === tag._id;
      html += `
        <div class="tag-item ${isActive ? 'active' : ''}" data-tag-id="${tag._id}" style="--tag-color: ${tag.color}">
          <div class="tag-color-dot" style="background: ${tag.color}"></div>
          <span class="tag-name">${this.escapeHtml(tag.name)}</span>
          <span class="tag-count">${tag.favoriteCount || 0}</span>
          <div class="tag-actions">
            <button class="tag-action-btn edit" title="编辑标签" data-tag-id="${tag._id}">
              <i class="fas fa-pen"></i>
            </button>
            <button class="tag-action-btn delete" title="删除标签" data-tag-id="${tag._id}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  // 创建标签
  createTag: async function(name, color) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch('/api/favorites/tags', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          userId: currentUser.id,
          name: name,
          color: color
        })
      });

      const data = await response.json();
      if (data.success) {
        this.tags.push(data.tag);
        this.renderTags();
        utils.showNotification('标签创建成功', 'success');
        return true;
      } else {
        utils.showNotification(data.message || '创建失败', 'error');
        return false;
      }
    } catch (error) {
      console.error('创建标签失败:', error);
      utils.showNotification('创建标签失败', 'error');
      return false;
    }
  },

  // 更新标签
  updateTag: async function(tagId, name, color) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/tags/${tagId}`, {
        method: 'PUT',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          userId: currentUser.id,
          name: name,
          color: color
        })
      });

      const data = await response.json();
      if (data.success) {
        const index = this.tags.findIndex(t => t._id === tagId);
        if (index !== -1) {
          this.tags[index] = data.tag;
        }
        this.renderTags();
        this.loadFavorites();
        utils.showNotification('标签更新成功', 'success');
        return true;
      } else {
        utils.showNotification(data.message || '更新失败', 'error');
        return false;
      }
    } catch (error) {
      console.error('更新标签失败:', error);
      utils.showNotification('更新标签失败', 'error');
      return false;
    }
  },

  // 删除标签
  deleteTag: async function(tagId) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/tags/${tagId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      const data = await response.json();
      if (data.success) {
        this.tags = this.tags.filter(t => t._id !== tagId);
        if (this.currentTagId === tagId) {
          this.currentTagId = null;
        }
        this.renderTags();
        this.loadFavorites();
        utils.showNotification('标签已删除', 'success');
        return true;
      } else {
        utils.showNotification(data.message || '删除失败', 'error');
        return false;
      }
    } catch (error) {
      console.error('删除标签失败:', error);
      utils.showNotification('删除标签失败', 'error');
      return false;
    }
  },

  // 更新收藏的标签
  updateFavoriteTag: async function(postId, tagId) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/${postId}/tag`, {
        method: 'PUT',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          tagId: tagId
        })
      });

      const data = await response.json();
      if (data.success) {
        this.loadTags();
        this.loadFavorites();
        utils.showNotification('已移动到新分类', 'success');
        return true;
      } else {
        utils.showNotification(data.message || '操作失败', 'error');
        return false;
      }
    } catch (error) {
      console.error('更新收藏标签失败:', error);
      utils.showNotification('操作失败', 'error');
      return false;
    }
  },

  // 显示标签编辑模态框
  showTagModal: function(tag = null) {
    const modal = document.getElementById('tag-modal');
    const title = document.getElementById('tag-modal-title');
    const nameInput = document.getElementById('tag-name');
    const colorInput = document.getElementById('tag-color');

    if (tag) {
      title.innerHTML = '<i class="fas fa-edit"></i> 编辑标签';
      nameInput.value = tag.name;
      colorInput.value = tag.color;
      this.editingTagId = tag._id;
    } else {
      title.innerHTML = '<i class="fas fa-tag"></i> 新建标签';
      nameInput.value = '';
      colorInput.value = '#2b6cb0';
      this.editingTagId = null;
    }

    // 更新颜色选择
    document.querySelectorAll('.color-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.color === colorInput.value);
    });

    modal.classList.add('show');
    nameInput.focus();
  },

  // 隐藏标签编辑模态框
  hideTagModal: function() {
    const modal = document.getElementById('tag-modal');
    modal.classList.remove('show');
    this.editingTagId = null;
  },

  // 显示收藏项标签选择模态框
  showFavoriteTagModal: function(postId, currentTagId) {
    const modal = document.getElementById('favorite-tag-modal');
    const list = document.getElementById('tag-select-list');
    const selectedPostId = document.getElementById('selected-post-id');

    selectedPostId.value = postId;

    let html = `
      <div class="tag-select-item no-tag ${currentTagId === null ? 'selected' : ''}" data-tag-id="">
        <i class="fas fa-times-circle"></i>
        <span>无分类</span>
      </div>
    `;

    this.tags.forEach(tag => {
      const isSelected = currentTagId === tag._id;
      html += `
        <div class="tag-select-item ${isSelected ? 'selected' : ''}" data-tag-id="${tag._id}">
          <div class="tag-color-dot" style="background: ${tag.color}"></div>
          <span>${this.escapeHtml(tag.name)}</span>
        </div>
      `;
    });

    list.innerHTML = html;
    modal.classList.add('show');
  },

  // 隐藏收藏项标签选择模态框
  hideFavoriteTagModal: function() {
    const modal = document.getElementById('favorite-tag-modal');
    modal.classList.remove('show');
  },

  // ============ 管理模式 ============

  // 切换管理模式
  toggleManageMode: function() {
    this.isManageMode = !this.isManageMode;
    
    if (!this.isManageMode) {
      this.selectedPostIds.clear();
    }

    // 更新 UI
    this.updateManageBar();
    this.loadFavorites();

    // 更新按钮状态
    const manageBtn = document.getElementById('manage-btn');
    if (manageBtn) {
      manageBtn.innerHTML = this.isManageMode 
        ? '<i class="fas fa-times"></i> 取消管理' 
        : '<i class="fas fa-tasks"></i> 管理';
    }
  },

  // 更新管理栏
  updateManageBar: function() {
    const manageBar = document.getElementById('manage-bar');
    const selectedCount = document.getElementById('selected-count');

    if (!manageBar) return;

    if (this.isManageMode && this.selectedPostIds.size > 0) {
      manageBar.style.display = 'flex';
      if (selectedCount) selectedCount.textContent = this.selectedPostIds.size;
    } else {
      manageBar.style.display = 'none';
    }
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const container = document.getElementById('favorites-posts-container');
    if (!container) return;
    
    const postCards = container.querySelectorAll('.post-card');

    if (this.selectedPostIds.size === postCards.length) {
      // 已全选，取消全选
      this.selectedPostIds.clear();
    } else {
      // 全选
      postCards.forEach(card => {
        const postId = card.dataset.postId;
        if (postId) {
          this.selectedPostIds.add(postId);
        }
      });
    }

    this.updatePostCardSelection();
    this.updateManageBar();
  },

  // 更新帖子卡片选中状态
  updatePostCardSelection: function() {
    const container = document.getElementById('favorites-posts-container');
    if (!container) return;
    
    const postCards = container.querySelectorAll('.post-card');

    postCards.forEach(card => {
      const postId = card.dataset.postId;
      const checkbox = card.querySelector('.post-card-checkbox i');
      
      if (this.selectedPostIds.has(postId)) {
        card.classList.add('selected');
        if (checkbox) {
          checkbox.classList.remove('fa-square');
          checkbox.classList.add('fa-check-square');
        }
      } else {
        card.classList.remove('selected');
        if (checkbox) {
          checkbox.classList.remove('fa-check-square');
          checkbox.classList.add('fa-square');
        }
      }
    });
  },

  // 切换单个帖子选中
  togglePostSelection: function(postId) {
    if (this.selectedPostIds.has(postId)) {
      this.selectedPostIds.delete(postId);
    } else {
      this.selectedPostIds.add(postId);
    }

    this.updatePostCardSelection();
    this.updateManageBar();
  },

  // 批量删除收藏
  batchDelete: async function() {
    if (this.selectedPostIds.size === 0) {
      utils.showNotification('请先选择要删除的收藏', 'error');
      return;
    }

    if (!confirm(`确定要删除选中的 ${this.selectedPostIds.size} 个收藏吗？`)) {
      return;
    }

    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch('/api/favorites/batch/delete', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          postIds: Array.from(this.selectedPostIds)
        })
      });

      const data = await response.json();
      if (data.success) {
        utils.showNotification(`成功删除 ${data.deletedCount} 个收藏`, 'success');
        this.selectedPostIds.clear();
        this.loadTags();
        this.loadFavorites();
      } else {
        utils.showNotification(data.message || '删除失败', 'error');
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      utils.showNotification('删除失败', 'error');
    }
  },

  // 显示批量移动模态框
  showBatchMoveModal: function() {
    if (this.selectedPostIds.size === 0) {
      utils.showNotification('请先选择要移动的收藏', 'error');
      return;
    }

    // 移除已存在的弹窗
    const existingModal = document.getElementById('batch-move-modal');
    if (existingModal) existingModal.remove();

    let tagsHtml = `
      <div class="tag-select-item no-tag selected" data-tag-id="">
        <i class="fas fa-times-circle"></i>
        <span>无分类</span>
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
      <div id="batch-move-modal" class="tag-modal show">
        <div class="tag-modal-content">
          <div class="tag-modal-header">
            <h3><i class="fas fa-folder"></i> 移动到分类</h3>
            <button class="tag-modal-close" id="batch-move-close">&times;</button>
          </div>
          <div class="tag-modal-body">
            <p class="batch-move-hint">将选中的 ${this.selectedPostIds.size} 个收藏移动到：</p>
            <div class="tag-select-list" id="batch-tag-select-list">
              ${tagsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.selectedBatchTagId = null;

    // 绑定事件
    const modal = document.getElementById('batch-move-modal');
    const closeBtn = document.getElementById('batch-move-close');
    const tagList = document.getElementById('batch-tag-select-list');
    const self = this;

    closeBtn.onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    tagList.onclick = async function(e) {
      const item = e.target.closest('.tag-select-item');
      if (item) {
        const tagId = item.dataset.tagId || null;
        await self.batchMove(tagId);
        modal.remove();
      }
    };
  },

  // 批量移动收藏
  batchMove: async function(tagId) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch('/api/favorites/batch/move', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          postIds: Array.from(this.selectedPostIds),
          tagId: tagId || null
        })
      });

      const data = await response.json();
      if (data.success) {
        const tag = this.tags.find(t => t._id === tagId);
        const tagName = tag ? tag.name : '无分类';
        utils.showNotification(`已将 ${data.modifiedCount} 个收藏移动到「${tagName}」`, 'success');
        this.selectedPostIds.clear();
        this.loadTags();
        this.loadFavorites();
      } else {
        utils.showNotification(data.message || '移动失败', 'error');
      }
    } catch (error) {
      console.error('批量移动失败:', error);
      utils.showNotification('移动失败', 'error');
    }
  },

  // 移除单个已删除帖子
  removeDeletedPost: async function(postId) {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(`/api/favorites/${postId}`, {
        method: 'DELETE',
        headers: userManager.getAuthHeaders()
      });

      const data = await response.json();
      if (data.success) {
        utils.showNotification('已移除', 'success');
        this.loadTags();
        this.loadFavorites();
      } else {
        utils.showNotification(data.message || '操作失败', 'error');
      }
    } catch (error) {
      console.error('移除失败:', error);
      utils.showNotification('操作失败', 'error');
    }
  },

  // ============ 收藏列表管理 ============

  // 加载收藏列表
  loadFavorites: async function(page = 1) {
    if (this.isLoading) return;

    this.isLoading = true;
    const currentUser = userManager.state.currentUser;

    if (!currentUser) {
      this.showLoginPrompt();
      return;
    }

    const loadingEl = document.getElementById('loading');
    const container = document.getElementById('favorites-posts-container');
    const noFavoritesEl = document.getElementById('no-favorites-message');

    if (page === 1) {
      if (loadingEl) loadingEl.style.display = 'block';
      if (container) container.innerHTML = '';
      this.allPosts = [];
    }

    try {
      let url = `/api/favorites/user/${currentUser.id}?page=${page}&limit=10`;
      if (this.currentTagId) {
        url += `&tagId=${this.currentTagId}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        this.currentPage = data.pagination.currentPage;
        this.totalPages = data.pagination.totalPages;

        // 更新收藏数量
        const countEl = document.getElementById('favorites-count');
        if (countEl) {
          const span = countEl.querySelector('span');
          if (span) span.textContent = data.pagination.totalPosts;
          countEl.style.display = 'block';
        }

        if (data.posts.length === 0 && page === 1) {
          if (loadingEl) loadingEl.style.display = 'none';
          if (noFavoritesEl) noFavoritesEl.style.display = 'flex';
          return;
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (noFavoritesEl) noFavoritesEl.style.display = 'none';

        this.renderPosts(data.posts, page === 1);
        this.updateLoadMoreButton();
      } else {
        throw new Error(data.message || '加载失败');
      }
    } catch (error) {
      console.error('加载收藏列表失败:', error);
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div class="error-state">
            <i class="fas fa-exclamation-circle"></i>
            <p>加载失败，请稍后重试</p>
          </div>
        `;
      }
    } finally {
      this.isLoading = false;
    }
  },

  // 渲染帖子列表
  renderPosts: function(posts, clearContainer = false) {
    const container = document.getElementById('favorites-posts-container');

    if (!container) return;

    if (clearContainer) {
      container.innerHTML = '';
      this.allPosts = [];
    }

    if (posts.length === 0) return;

    // 保存所有帖子数据
    this.allPosts = this.allPosts.concat(posts);

    let postsHTML = '';
    const self = this;
    
    posts.forEach(post => {
      const favoriteTime = post.favoriteAt ? utils.formatDate(post.favoriteAt) : '';
      const isSelected = this.selectedPostIds.has(post.id);
      const selectedClass = isSelected ? 'selected' : '';
      const manageClass = this.isManageMode ? 'manage-mode' : '';

      // 处理已删除的帖子
      if (post.isDeleted) {
        const tag = post.tagId ? this.tags.find(t => t._id === post.tagId) : null;
        const tagHtml = tag ? `
          <span class="post-card-tag" style="background: ${tag.color}20; color: ${tag.color}">
            <span class="post-card-tag-dot" style="background: ${tag.color}"></span>
            ${this.escapeHtml(tag.name)}
          </span>
        ` : '';

        postsHTML += `
          <div class="post-card deleted-post ${manageClass} ${selectedClass}" data-post-id="${post.id}" data-deleted="true">
            ${this.isManageMode ? `
              <div class="post-card-checkbox">
                <i class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
              </div>
            ` : ''}
            <div class="deleted-post-content">
              <div class="deleted-post-icon">
                <i class="fas fa-trash-alt"></i>
              </div>
              <div class="deleted-post-info">
                <div class="deleted-post-title">帖子已被删除</div>
                <div class="deleted-post-hint">该帖子作者已删除，您可以移除此收藏记录</div>
              </div>
            </div>
            <div class="post-card-footer">
              <div class="post-card-favorite-time">
                <i class="fas fa-star"></i> 收藏于 ${favoriteTime}
              </div>
              <div class="post-card-actions">
                ${tagHtml}
                <button class="post-card-remove" data-post-id="${post.id}">
                  <i class="fas fa-times"></i> 移除
                </button>
              </div>
            </div>
          </div>
        `;
        return;
      }

      // 正常帖子（转义防 XSS；修正编码损坏的"未知用户"）
      const displayUsername = post.anonymous ? '匿名用户' : this.escapeHtml(post.username || '未知用户');
      const esc = (s) => this.escapeHtml(s);
      const preview = this.escapeHtml(this.getPostPreview(post.content, 150));
      
      // 获取标签信息
      const tag = post.tagId ? this.tags.find(t => t._id === post.tagId) : null;
      const tagHtml = tag ? `
        <span class="post-card-tag" style="background: ${tag.color}20; color: ${tag.color}">
          <span class="post-card-tag-dot" style="background: ${tag.color}"></span>
          ${this.escapeHtml(tag.name)}
        </span>
      ` : '';

      postsHTML += `
        <div class="post-card ${manageClass} ${selectedClass}" data-post-id="${post.id}" data-tag-id="${post.tagId || ''}">
          ${this.isManageMode ? `
            <div class="post-card-checkbox">
              <i class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
            </div>
          ` : ''}
          <div class="post-card-content">
            <div class="post-card-header">
              <div class="post-card-avatar ${post.anonymous ? 'anonymous-avatar' : ''}" 
                   ${!post.anonymous ? `data-user-id="${post.userId}"` : ''}
                   ${!post.anonymous && post.userAvatar ? `style="background-image: url('${esc(post.userAvatar)}'); background-size: cover; background-position: center;"` : ''}>
                ${post.anonymous ? '匿' : (!post.userAvatar ? (post.className ? esc(post.className).slice(0,1) : '?') : '')}
              </div>
              <div class="post-card-user-info">
                <div class="post-card-username">${displayUsername}</div>
                ${!post.anonymous ? 
                  `<div class="post-card-class">${esc(post.school || '')} | ${esc(post.grade || '')} ${esc(post.className || '')}</div>` : ''
                }
              </div>
              <div class="post-card-stats">
                <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                <span><i class="fas fa-comment"></i> ${post.comments ? post.comments.length : 0}</span>
                <span><i class="fas fa-eye"></i> ${post.viewCount || 0}</span>
              </div>
            </div>
            <div class="post-card-body">
              <p class="post-card-preview">${preview}</p>
            </div>
            <div class="post-card-footer">
              <div class="post-card-time">
                <i class="far fa-clock"></i> ${utils.formatDate(post.timestamp)}
              </div>
              <div class="post-card-actions">
                ${tagHtml}
                ${!this.isManageMode ? `
                  <button class="post-card-move-tag" data-post-id="${post.id}" data-current-tag="${post.tagId || ''}">
                    <i class="fas fa-folder"></i> 移动分类
                  </button>
                ` : ''}
                ${favoriteTime ? `
                  <div class="post-card-favorite-time">
                    <i class="fas fa-star"></i> 收藏于 ${favoriteTime}
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    });

    container.insertAdjacentHTML('beforeend', postsHTML);
    this.updateManageBar();
  },

  // 获取帖子预览内容
  getPostPreview: function(content, maxLength = 150) {
    if (!content) return '';
    
    // 移除Markdown标记
    let text = content
      .replace(/```[\s\S]*?```/g, '') // 移除代码块
      .replace(/`[^`]+`/g, '') // 移除行内代码
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除链接
      .replace(/[#*_~>`-]/g, '') // 移除常见Markdown符号
      .replace(/\n/g, ' ') // 换行符替换为空格
      .replace(/\s+/g, ' ') // 多个空格合并
      .trim();

    if (text.length > maxLength) {
      return text.substring(0, maxLength) + '...';
    }
    return text;
  },

  // 更新加载更多按钮
  updateLoadMoreButton: function() {
    const loadMoreContainer = document.getElementById('load-more-container');

    if (!loadMoreContainer) return;

    if (this.currentPage < this.totalPages) {
      loadMoreContainer.style.display = 'flex';
    } else {
      loadMoreContainer.style.display = 'none';
    }
  },

  // HTML转义
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 设置事件监听器
  setupEventListeners: function() {
    const self = this;

    // 加载更多按钮
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function() {
        if (!self.isLoading && self.currentPage < self.totalPages) {
          self.loadFavorites(self.currentPage + 1);
        }
      });
    }

    // 新建标签按钮
    const addTagBtn = document.getElementById('add-tag-btn');
    if (addTagBtn) {
      addTagBtn.addEventListener('click', function() {
        self.showTagModal();
      });
    }

    // 管理按钮
    const manageBtn = document.getElementById('manage-btn');
    if (manageBtn) {
      manageBtn.addEventListener('click', function() {
        self.toggleManageMode();
      });
    }

    // 全选按钮
    const selectAllBtn = document.getElementById('select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function() {
        self.toggleSelectAll();
      });
    }

    // 批量删除按钮
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    if (batchDeleteBtn) {
      batchDeleteBtn.addEventListener('click', function() {
        self.batchDelete();
      });
    }

    // 批量移动按钮
    const batchMoveBtn = document.getElementById('batch-move-btn');
    if (batchMoveBtn) {
      batchMoveBtn.addEventListener('click', function() {
        self.showBatchMoveModal();
      });
    }

    // 标签模态框关闭按钮
    const tagModalClose = document.getElementById('tag-modal-close');
    const tagCancelBtn = document.getElementById('tag-cancel-btn');
    
    if (tagModalClose) {
      tagModalClose.addEventListener('click', function() {
        self.hideTagModal();
      });
    }
    
    if (tagCancelBtn) {
      tagCancelBtn.addEventListener('click', function() {
        self.hideTagModal();
      });
    }

    // 保存标签按钮
    const tagSaveBtn = document.getElementById('tag-save-btn');
    if (tagSaveBtn) {
      tagSaveBtn.addEventListener('click', async function() {
        const name = document.getElementById('tag-name').value.trim();
        const color = document.getElementById('tag-color').value;

        if (!name) {
          utils.showNotification('请输入标签名称', 'error');
          return;
        }

        if (self.editingTagId) {
          await self.updateTag(self.editingTagId, name, color);
        } else {
          await self.createTag(name, color);
        }
        self.hideTagModal();
      });
    }

    // 颜色选择
    document.querySelectorAll('.color-option').forEach(opt => {
      opt.addEventListener('click', function() {
        document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
        document.getElementById('tag-color').value = this.dataset.color;
      });
    });

    // 收藏项标签选择模态框关闭
    const favoriteTagModalClose = document.getElementById('favorite-tag-modal-close');
    if (favoriteTagModalClose) {
      favoriteTagModalClose.addEventListener('click', function() {
        self.hideFavoriteTagModal();
      });
    }

    // 标签选择
    document.getElementById('tag-select-list')?.addEventListener('click', async function(e) {
      const item = e.target.closest('.tag-select-item');
      if (item) {
        const tagId = item.dataset.tagId || null;
        const postId = document.getElementById('selected-post-id').value;
        await self.updateFavoriteTag(postId, tagId);
        self.hideFavoriteTagModal();
      }
    });

    // 点击标签模态框背景关闭
    document.getElementById('tag-modal')?.addEventListener('click', function(e) {
      if (e.target === this) {
        self.hideTagModal();
      }
    });

    document.getElementById('favorite-tag-modal')?.addEventListener('click', function(e) {
      if (e.target === this) {
        self.hideFavoriteTagModal();
      }
    });

    // 全局点击事件
    document.addEventListener('click', function(e) {
      // 管理模式下点击帖子卡片
      if (self.isManageMode) {
        const postCard = e.target.closest('.post-card');
        if (postCard) {
          const postId = postCard.dataset.postId;
          if (postId) {
            self.togglePostSelection(postId);
          }
          return;
        }
      }

      // 非管理模式下点击帖子卡片
      const postCard = e.target.closest('.post-card:not(.deleted-post)');
      if (postCard && !e.target.closest('.post-card-move-tag') && !e.target.closest('.post-card-remove')) {
        const postId = postCard.dataset.postId;
        if (postId) {
          window.location.href = `post-detail.html?id=${postId}`;
        }
      }

      // 点击已删除帖子的移除按钮
      const removeBtn = e.target.closest('.post-card-remove');
      if (removeBtn) {
        e.stopPropagation();
        const postId = removeBtn.dataset.postId;
        self.removeDeletedPost(postId);
        return;
      }

      // 点击头像跳转到个人主页
      const avatar = e.target.closest('.post-card-avatar:not(.anonymous-avatar)');
      if (avatar && !e.target.closest('.post-card')) {
        e.stopPropagation();
        const userId = avatar.dataset.userId;
        if (userId) {
          window.location.href = `profile.html?id=${userId}`;
        }
      }

      // 点击标签筛选
      const tagItem = e.target.closest('.tag-item');
      if (tagItem && !e.target.closest('.tag-action-btn')) {
        const tagId = tagItem.dataset.tagId || null;
        self.currentTagId = tagId;
        self.renderTags();
        self.loadFavorites();
      }

      // 编辑标签按钮
      const editBtn = e.target.closest('.tag-action-btn.edit');
      if (editBtn) {
        e.stopPropagation();
        const tagId = editBtn.dataset.tagId;
        const tag = self.tags.find(t => t._id === tagId);
        if (tag) {
          self.showTagModal(tag);
        }
      }

      // 删除标签按钮
      const deleteBtn = e.target.closest('.tag-action-btn.delete');
      if (deleteBtn) {
        e.stopPropagation();
        const tagId = deleteBtn.dataset.tagId;
        if (confirm('确定要删除这个标签吗？标签下的收藏将移动到"无分类"')) {
          self.deleteTag(tagId);
        }
      }

      // 移动分类按钮
      const moveTagBtn = e.target.closest('.post-card-move-tag');
      if (moveTagBtn) {
        e.stopPropagation();
        const postId = moveTagBtn.dataset.postId;
        const currentTag = moveTagBtn.dataset.currentTag || null;
        self.showFavoriteTagModal(postId, currentTag);
      }
    });

    // 回车键保存标签
    document.getElementById('tag-name')?.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        document.getElementById('tag-save-btn').click();
      }
    });
  }
};

// 将 favoritesManager 挂载到 window（const 声明不会自动挂到 window）
window.favoritesManager = favoritesManager;
