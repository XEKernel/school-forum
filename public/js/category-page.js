// 栏目页面脚本
(function() {
  // 页面状态
  const categoryPageState = {
    categoryId: null,
    categoryName: '',
    page: 1,
    sortBy: 'latest',
    searchKeyword: '',
    hasMore: true,
    loading: false
  };

  // 获取 URL 参数
  function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  // HTML 转义：优先用 utils.escapeHtml；utils 未加载时也要转义，
  // 不能像旧代码那样回退原文（那是一个可被注入的降级分支）
  const fallbackEscape = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const esc = (value) => (window.utils ? window.utils.escapeHtml(value) : fallbackEscape(value));

  // 初始化
  async function initCategoryPage() {
    categoryPageState.categoryId = getUrlParam('id');
    if (!categoryPageState.categoryId) {
      window.location.href = '/';
      return;
    }

    // 初始化用户管理器（必须等待完成）
    if (typeof userManager !== 'undefined') {
      userManager.init();
      userManager.setupEventListeners();
      if (userManager.initAsync) {
        await userManager.initAsync();
      }
    }

    // 初始化栏目管理器
    await window.categoryManager.init();

    // 加载栏目信息
    await loadCategoryInfo();

    // 加载帖子
    await loadCategoryPosts();

    // 渲染侧边栏目列表
    await window.renderSidebarCategories();

    // 设置事件监听
    setupEventListeners();
  }

  // 加载栏目信息
  async function loadCategoryInfo() {
    const category = await window.categoryManager.getCategory(categoryPageState.categoryId);
    if (!category) {
      const nameEl = document.getElementById('category-name');
      if (nameEl) nameEl.textContent = '栏目不存在';
      return;
    }

    categoryPageState.categoryName = category.name;
    document.title = `${category.name} - 校园论坛`;
    const nameEl = document.getElementById('category-name');
    if (nameEl) nameEl.textContent = category.name;
    const descEl = document.getElementById('category-description');
    if (descEl) descEl.textContent = category.description || '';

    const iconEl = document.getElementById('category-icon');
    if (iconEl) {
      iconEl.innerHTML = `<i class="fas ${category.icon || 'fa-folder'}" style="color: ${category.color || '#2b6cb0'}"></i>`;
      iconEl.style.background = `${category.color || '#2b6cb0'}22`;
    }

    // 已登录用户显示申请按钮
    if (window.userManager && window.userManager.state.currentUser) {
      const applyBtn = document.getElementById('apply-category-btn');
      const sidebarBtn = document.getElementById('apply-sidebar-btn');
      if (applyBtn) applyBtn.style.display = 'inline-flex';
      if (sidebarBtn) sidebarBtn.style.display = 'block';
    }
  }

  // 加载栏目帖子
  async function loadCategoryPosts(append = false) {
    if (categoryPageState.loading) return;
    categoryPageState.loading = true;

    const container = document.getElementById('posts-container');
    if (!container) return;

    if (!append) {
      container.innerHTML = '<div class="loading-placeholder"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    }

    try {
      const params = new URLSearchParams({
        page: categoryPageState.page,
        limit: 20,
        sortBy: categoryPageState.sortBy,
        categoryId: categoryPageState.categoryId
      });

      if (categoryPageState.searchKeyword) {
        params.append('search', categoryPageState.searchKeyword);
      }

      const response = await fetch(`/api/posts?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || '加载失败');
      }

      const posts = data.posts || [];

      if (!append) {
        container.innerHTML = '';
      }

      const emptyState = document.getElementById('empty-state');
      const loadMoreContainer = document.getElementById('load-more-container');

      if (posts.length === 0 && !append) {
        if (emptyState) emptyState.style.display = 'block';
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      } else {
        if (emptyState) emptyState.style.display = 'none';

        // 渲染帖子
        posts.forEach(post => {
          const postEl = createPostElement(post);
          container.appendChild(postEl);
        });

        // 更新加载更多按钮状态
        categoryPageState.hasMore = posts.length >= 20;
        if (categoryPageState.hasMore) {
          if (loadMoreContainer) loadMoreContainer.style.display = 'block';
        } else {
          if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        }
      }

      // 类型设置
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([container]).catch(err => console.error('MathJax typeset failed:', err));
      }
    } catch (error) {
      console.error('加载帖子失败:', error);
      if (!append) {
        container.innerHTML = '<div class="error-placeholder">加载失败，请刷新页面重试</div>';
      }
      if (window.utils) window.utils.showNotification('加载帖子失败', 'error');
    } finally {
      categoryPageState.loading = false;
    }
  }

  // 创建帖子元素
  function createPostElement(post) {
    const currentUser = window.userManager ? window.userManager.state.currentUser : null;
    const postEl = document.createElement('div');
    postEl.className = 'post-item';
    postEl.dataset.id = post.id;

    // utils 未加载时的兜底转义见文件顶部 esc()
    const timeDisplay = window.utils ? window.utils.formatDate(post.timestamp) : post.timestamp;
    const isLiked = currentUser && post.likedBy && post.likedBy.includes(currentUser.id);
    const likesCount = post.likes || 0;
    const commentsCount = post.comments ? post.comments.length : 0;
    const displayUsername = post.anonymous ? '匿名用户' : esc(post.username);

    // 处理图片
    let imagesHtml = '';
    if (post.images && post.images.length > 0) {
      imagesHtml = `<div class="post-images">${post.images.map(img =>
        `<img src="${img.url}" alt="图片" class="post-image" data-full="${img.url}">`
      ).join('')}</div>`;
    }

    postEl.innerHTML = `
      <div class="post-header">
        <div class="post-user">
          ${post.anonymous ? '<i class="fas fa-user-circle anonymous-avatar"></i>' :
            `<a href="profile.html?id=${post.userId}">${post.userAvatar ? `<img src="${post.userAvatar}" class="post-avatar">` : '<i class="fas fa-user-circle"></i>'}</a>`}
          <div class="post-user-info">
            <span class="post-username">${displayUsername}</span>
            ${!post.anonymous ? `<span class="post-meta">${esc(post.school || '')} ${esc(post.grade || '')} ${esc(post.className || '')}</span>` : ''}
          </div>
        </div>
        <span class="post-time">${timeDisplay}</span>
      </div>
      <div class="post-content">
        ${esc(post.content || '')}
      </div>
      ${imagesHtml}
      <div class="post-actions">
        <button class="post-action like-btn ${isLiked ? 'liked' : ''}" data-id="${post.id}">
          <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
          <span>${likesCount}</span>
        </button>
        <a href="post-detail.html?id=${post.id}" class="post-action comment-btn">
          <i class="far fa-comment"></i>
          <span>${commentsCount}</span>
        </a>
      </div>
    `;

    // 点赞事件
    const likeBtn = postEl.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.addEventListener('click', async () => {
        if (!currentUser) {
          if (window.utils) window.utils.showNotification('请先登录', 'info');
          return;
        }
        await handleLike(post.id, likeBtn);
      });
    }

    // 图片点击预览
    postEl.querySelectorAll('.post-image').forEach(img => {
      img.addEventListener('click', () => openImageModal(img.dataset.full));
    });

    return postEl;
  }

  // 处理点赞
  async function handleLike(postId, btn) {
    if (!window.userManager || !window.userManager.state.currentUser) return;
    try {
      const response = await fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        headers: { ...window.userManager.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: window.userManager.state.currentUser.id })
      });
      const data = await response.json();
      if (data.success) {
        const icon = btn.querySelector('i');
        const countSpan = btn.querySelector('span');
        const isLiked = icon.classList.contains('fas');
        if (isLiked) {
          icon.classList.remove('fas');
          icon.classList.add('far');
          countSpan.textContent = Math.max(0, parseInt(countSpan.textContent) - 1);
          btn.classList.remove('liked');
        } else {
          icon.classList.remove('far');
          icon.classList.add('fas');
          countSpan.textContent = parseInt(countSpan.textContent) + 1;
          btn.classList.add('liked');
        }
      }
    } catch (error) {
      console.error('点赞失败:', error);
      if (window.utils) window.utils.showNotification('操作失败', 'error');
    }
  }

  // 图片预览
  function openImageModal(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('image-modal-img');
    if (img) img.src = src;
    if (modal) modal.style.display = 'flex';
  }

  // 渲染侧边栏目列表
  window.renderSidebarCategories = async function() {
    const container = document.getElementById('sidebar-category-list');
    const navBar = document.getElementById('category-nav-bar');
    await window.categoryManager.loadCategories();
    const categories = window.categoryManager.state.categories;

    if (!categories || categories.length === 0) {
      if (container) container.innerHTML = '<div class="no-categories">暂无栏目</div>';
      return;
    }

    // 侧边栏栏目列表
    const sidebarHtml = categories.map(cat => `
      <a href="category.html?id=${cat.id}" class="sidebar-category-item ${cat.id === categoryPageState.categoryId ? 'active' : ''}">
        <i class="fas ${cat.icon || 'fa-folder'}" style="color: ${cat.color || '#2b6cb0'}"></i>
        <span>${esc(cat.name)}</span>
        ${cat.postCount !== undefined ? `<span class="cat-count">${cat.postCount}</span>` : ''}
      </a>
    `).join('');

    // 顶部导航栏目列表
    const navHtml = categories.map(cat => `
      <a href="category.html?id=${cat.id}" class="category-nav-item ${cat.id === categoryPageState.categoryId ? 'active' : ''}">
        <i class="fas ${cat.icon || 'fa-folder'}" style="color: ${cat.color || '#2b6cb0'}"></i>
        <span>${esc(cat.name)}</span>
      </a>
    `).join('');

    if (container) container.innerHTML = sidebarHtml;
    if (navBar) navBar.innerHTML = `<a href="/" class="category-nav-item"><i class="fas fa-globe"></i> 全部</a>` + navHtml;
  };

  // 设置事件监听
  function setupEventListeners() {
    // 排序按钮
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        categoryPageState.sortBy = btn.dataset.sort;
        categoryPageState.page = 1;
        loadCategoryPosts(false);
      });
    });

    // 加载更多
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        categoryPageState.page++;
        loadCategoryPosts(true);
      });
    }

    // 搜索
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (searchInput) searchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') doSearch();
    });

    // 清除搜索
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        categoryPageState.searchKeyword = '';
        categoryPageState.page = 1;
        if (searchInput) searchInput.value = '';
        const searchInfo = document.getElementById('search-results-info');
        if (searchInfo) searchInfo.style.display = 'none';
        loadCategoryPosts(false);
      });
    }

    // 申请栏目按钮
    const applyCategoryBtn = document.getElementById('apply-category-btn');
    const applySidebarBtn = document.getElementById('apply-sidebar-btn');
    const submitApplyBtn = document.getElementById('submit-apply-btn');
    if (applyCategoryBtn) applyCategoryBtn.addEventListener('click', openApplyModal);
    if (applySidebarBtn) applySidebarBtn.addEventListener('click', openApplyModal);
    if (submitApplyBtn) submitApplyBtn.addEventListener('click', submitApplication);

    // 图片模态框
    const imageModal = document.getElementById('image-modal');
    if (imageModal) {
      imageModal.addEventListener('click', e => {
        if (e.target === imageModal) imageModal.style.display = 'none';
      });
      const closeBtn = imageModal.querySelector('.image-modal-close');
      if (closeBtn) closeBtn.addEventListener('click', () => {
        imageModal.style.display = 'none';
      });
    }
  }

  function doSearch() {
    const searchInput = document.getElementById('search-input');
    const keyword = searchInput ? searchInput.value.trim() : '';
    categoryPageState.searchKeyword = keyword;
    categoryPageState.page = 1;

    const searchInfo = document.getElementById('search-results-info');
    if (keyword) {
      const keywordEl = document.getElementById('search-keyword');
      if (searchInfo) searchInfo.style.display = 'flex';
      if (keywordEl) keywordEl.textContent = `搜索: "${window.utils ? window.utils.escapeHtml(keyword) : keyword}"`;
    } else {
      if (searchInfo) searchInfo.style.display = 'none';
    }
    loadCategoryPosts(false);
  }

  function openApplyModal() {
    const modal = document.getElementById('apply-category-modal');
    if (modal) modal.style.display = 'flex';
    const nameInput = document.getElementById('apply-category-name');
    const descInput = document.getElementById('apply-category-desc');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
  }

  window.closeApplyModal = function() {
    const modal = document.getElementById('apply-category-modal');
    if (modal) modal.style.display = 'none';
  };

  async function submitApplication() {
    const nameInput = document.getElementById('apply-category-name');
    const descInput = document.getElementById('apply-category-desc');
    const name = nameInput ? nameInput.value.trim() : '';
    const desc = descInput ? descInput.value.trim() : '';

    if (!name) {
      if (window.utils) window.utils.showNotification('请输入栏目名称', 'error');
      return;
    }

    const btn = document.getElementById('submit-apply-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...';
    }

    const result = await window.categoryManager.applyForCategory(name, desc);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> 提交申请';
    }

    if (result.success) {
      window.closeApplyModal();
    }
  }

  // 导出到全局
  window.categoryPageState = categoryPageState;

  document.addEventListener('DOMContentLoaded', initCategoryPage);
})();
