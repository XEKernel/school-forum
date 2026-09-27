// 帖子管理模块（使用 markdown-it 和 highlight.js）
const postsManager = {
  // HTML 转义（委托 utils.escapeHtml，带兜底；updateCategoryNavBar 等依赖此方法）
  escapeHtml: function(text) {
    if (typeof utils !== 'undefined' && utils.escapeHtml) {
      return utils.escapeHtml(text);
    }
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  // 全局状态
  state: {
    posts: [],
    currentPostId: null,
    md: null, // markdown-it 实例
    hljs: null, // highlight.js 实例
    initialized: false, // 防止重复初始化
    viewTimers: {}, // 帖子查看计时器 {postId: timerId}
    tags: [], // 用户收藏标签
    searchKeyword: '', // 搜索关键词
    searchHistory: [], // 搜索历史
    sortBy: 'recommended', // 排序方式：recommended(推荐), latest(最新), hot(热门), likes(点赞)
    currentCategoryId: null, // 当前选中的分类ID
    categories: [] // 分类列表
  },

  // 搜索历史存储键
  SEARCH_HISTORY_KEY: 'forum_search_history',
  MAX_HISTORY_ITEMS: 10,

  // DOM元素
  dom: {
    postsContainer: document.getElementById('posts-container')
  },

  // 初始化
  init: function() {
    // 防止重复初始化
    if (this.state.initialized) {
      console.log('postsManager 已经初始化，跳过重复初始化');
      return;
    }
    
    // 性能监控 - 使用时间戳
    const startTime = performance.now();
    
    // 测量markdown渲染器初始化时间
    const mdStart = performance.now();
    this.initializeMarkdownRenderer();
    console.log(`initializeMarkdownRenderer: ${(performance.now() - mdStart).toFixed(2)}ms`);
    
    // 检查 URL 参数中的搜索关键词和分类
    const urlParams = new URLSearchParams(window.location.search);
    const searchKeyword = urlParams.get('search');
    const sortBy = urlParams.get('sortBy');
    const categoryId = urlParams.get('categoryId');
    
    // 加载分类列表
    this.loadCategories();
    
    if (categoryId) {
      this.state.currentCategoryId = categoryId;
    }
    
    if (searchKeyword) {
      this.state.searchKeyword = searchKeyword.trim();
      // 更新搜索框显示
      const searchInput = document.getElementById('search-input');
      const clearBtn = document.getElementById('search-clear-btn');
      const sortOptionsEl = document.getElementById('sort-options');
      if (searchInput) searchInput.value = searchKeyword;
      if (clearBtn) clearBtn.style.display = 'flex';
      // 显示排序选项
      if (sortOptionsEl) sortOptionsEl.style.display = 'flex';
    }
    
    if (sortBy) {
      this.state.sortBy = sortBy;
      // 更新排序按钮状态
      const sortBtns = document.querySelectorAll('.sort-btn');
      sortBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === sortBy);
      });
    }
    
    // 更新标题
    this.updateSectionTitle();
    
    // 加载帖子（异步，测量内部时间）
    this.loadPosts();

    // 渲染栏目导航（categoryManager.init 已在 app.init 中调用）
    if (typeof categoryManager !== 'undefined') {
      categoryManager.renderCategoryNav('category-nav-bar');
      // 渲染侧边栏目列表
      const sidebarContainer = document.getElementById('sidebar-categories');
      if (sidebarContainer) {
        const cats = categoryManager.state.categories;
        if (!cats || cats.length === 0) {
          sidebarContainer.innerHTML = '<div class="category-sidebar-empty">暂无栏目</div>';
        } else {
          sidebarContainer.innerHTML = cats.slice(0, 8).map(cat => `
            <a href="category.html?id=${cat.id}" class="category-sidebar-item">
              <i class="fas ${cat.icon || 'fa-folder'}" style="color: ${cat.color || '#2b6cb0'}"></i>
              <span>${utils.escapeHtml(cat.name)}</span>
              ${cat.postCount !== undefined ? `<span class="category-sidebar-count">${cat.postCount}</span>` : ''}
            </a>
          `).join('');
        }
      }
    }

    this.setupEventListeners();
    
    // 标记为已初始化
    this.state.initialized = true;
    
    console.log(`postsManager.init: ${(performance.now() - startTime).toFixed(2)}ms`);
  },

  // 初始化 markdown 渲染器
  initializeMarkdownRenderer: function() {
    // 检查 markdown-it 是否已加载（支持多种可能的全局变量名）
    let markdownItGlobal = window.markdownit || window.markdownIt || window.markdown_it || window.MarkdownIt;
    
    if (!markdownItGlobal) {
      this.state.md = null;
      return;
    }

    try {
      // 使用之前检测到的markdown-it全局变量
      if (!markdownItGlobal) {
        throw new Error('markdown-it 全局变量未找到');
      }
      
      // 检查 highlight.js 是否已加载
      let hljsGlobal = window.hljs;
      if (hljsGlobal) {
        this.state.hljs = hljsGlobal;
      } else {
        console.warn('highlight.js 未加载，代码高亮将不可用');
        this.state.hljs = null;
      }
      
      // 创建 markdown-it 实例并配置
      this.state.md = markdownItGlobal({
        html: false, // 禁用原始 HTML 防 XSS（XSS 净化由服务端 sanitizeHtml 保证）
        linkify: true, // 自动将 URL 转换为链接
        typographer: true, // 启用 typographer 扩展
        // 配置代码高亮
        highlight: this.state.hljs ? function(str, lang) {
          if (lang && hljsGlobal.getLanguage(lang)) {
            try {
              return hljsGlobal.highlight(str, { language: lang }).value;
            } catch (error) {
              console.error('代码高亮失败:', error);
            }
          }
          // 如果语言未指定或不支持，使用自动检测
          try {
            return hljsGlobal.highlightAuto(str).value;
          } catch (error) {
            console.error('代码高亮失败:', error);
            return ''; // 使用默认转义
          }
        } : null
      });
    } catch (error) {
      console.error('初始化 markdown 渲染器失败:', error);
      this.state.md = null;
    }
  },

  // 加载帖子
  loadPosts: async function() {
    const container = this.dom.postsContainer;
    if (!container) return;

    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    
    // 性能监控 - 使用时间戳代替 console.time 避免重复调用警告
    const startTime = performance.now();
    
    try {
      // 构建 URL，添加搜索、排序和分类参数
      let url = '/api/posts';
      const params = [];
      
      // 搜索关键词
      if (this.state.searchKeyword) {
        params.push(`search=${encodeURIComponent(this.state.searchKeyword)}`);
      }
      
      // 排序方式（始终传递，除了搜索模式外的默认排序）
      if (this.state.sortBy && this.state.sortBy !== 'relevance') {
        params.push(`sortBy=${this.state.sortBy}`);
      } else if (!this.state.searchKeyword) {
        // 非搜索模式下，默认使用推荐排序
        params.push('sortBy=recommended');
      }
      
      // 分类筛选
      if (this.state.currentCategoryId) {
        params.push(`categoryId=${this.state.currentCategoryId}`);
      }
      
      // 注意：不再通过 query 传 viewerId（服务端已改为从 JWT 取身份），
      // 改为携带 Authorization 头，服务端 optionalAuth 会自动识别登录用户
      
      if (params.length > 0) {
        url += '?' + params.join('&');
      }

      console.log('请求URL:', url); // 调试日志

      // 并行加载帖子和收藏列表（携带认证头，用于可见性/黑名单过滤）
      const authHeaders = (userManager && userManager.getAuthHeaders) ? userManager.getAuthHeaders() : {};
      const [postsResponse, favoritesData] = await Promise.all([
        fetch(url, { headers: authHeaders }),
        this.loadUserFavorites()
      ]);
      
      const fetchStart = performance.now();
      console.log(`postsManager.fetchPosts: ${(performance.now() - fetchStart).toFixed(2)}ms`);
      
      if (!postsResponse.ok) {
        throw new Error(`加载失败: ${postsResponse.status}`);
      }
      
      const parseStart = performance.now();
      const data = await postsResponse.json();
      console.log(`postsManager.parseJSON: ${(performance.now() - parseStart).toFixed(2)}ms`);
      
      if (data.success) {
        this.state.posts = data.posts || [];
        
        // 更新分类列表（如果API返回了分类信息）
        if (data.categories) {
          this.state.categories = data.categories;
          this.updateCategoryNavBar();
        }
        
        // 更新搜索结果提示
        if (data.pagination && typeof data.pagination.totalPosts === 'number') {
          this.updateSearchResultsInfo(data.pagination.totalPosts);
        }
        
        const renderStart = performance.now();
        this.renderPosts(data.posts, favoritesData);
        console.log(`postsManager.renderPosts: ${(performance.now() - renderStart).toFixed(2)}ms`);
      } else {
        throw new Error(data.message || '加载帖子失败');
      }
    } catch (error) {
      console.error('加载帖子失败:', error);
      if (container) {
        container.innerHTML = '<div class="empty-state">帖子加载失败，请稍后再试</div>';
      }
      utils.showNotification(error.message || '加载帖子失败', 'error');
    } finally {
      console.log(`postsManager.loadPosts: ${(performance.now() - startTime).toFixed(2)}ms`);
    }
  },

  // 更新搜索结果提示
  updateSearchResultsInfo: function(totalPosts) {
    const infoEl = document.getElementById('search-results-info');
    const keywordEl = document.getElementById('search-keyword');
    const sortOptionsEl = document.getElementById('sort-options');
    
    if (!infoEl || !keywordEl) return;

    if (this.state.searchKeyword) {
      keywordEl.textContent = this.state.searchKeyword;
      infoEl.style.display = 'flex';
      // 显示排序选项
      if (sortOptionsEl) {
        sortOptionsEl.style.display = 'flex';
      }
    } else {
      infoEl.style.display = 'none';
      // 隐藏排序选项
      if (sortOptionsEl) {
        sortOptionsEl.style.display = 'none';
      }
    }
    
    // 更新标题
    this.updateSectionTitle();
  },

  // 更新帖子列表标题
  updateSectionTitle: function() {
    const titleEl = document.querySelector('.posts-section-header .section-title');
    if (!titleEl) return;

    // 如果在浏览某个分类
    if (this.state.currentCategoryId) {
      const category = this.state.categories.find(c => c.id === this.state.currentCategoryId);
      if (category) {
        titleEl.textContent = category.name;
        return;
      }
    }

    // 没有搜索时显示排序方式
    if (!this.state.searchKeyword) {
      const sortTitles = {
        recommended: '推荐',
        latest: '最新帖子',
        hot: '热门帖子',
        likes: '最多点赞',
        favorites: '最多收藏',
        views: '最大浏览',
        comments: '最多评论'
      };
      titleEl.textContent = sortTitles[this.state.sortBy] || '推荐';
      return;
    }

    const sortTitles = {
      relevance: '热门帖子',
      latest: '最新发布',
      likes: '最多点赞',
      favorites: '最多收藏',
      views: '最大浏览',
      comments: '最多评论'
    };

    titleEl.textContent = sortTitles[this.state.sortBy] || '搜索结果';
  },

  // 加载分类列表
  loadCategories: async function() {
    try {
      const response = await fetch('/api/categories');
      const data = await response.json();
      if (data.success && data.categories) {
        this.state.categories = data.categories;
        this.updateCategoryNavBar();
      }
    } catch (error) {
      console.error('加载分类列表失败:', error);
    }
  },

  // 更新分类导航栏
  updateCategoryNavBar: function() {
    const navBar = document.getElementById('category-nav-bar');
    if (!navBar || !this.state.categories.length) return;

    const categoriesHtml = this.state.categories
      // isActive !== false 容错：/api/posts 快照缺 isActive 字段时仍显示
      .filter(cat => cat.isActive !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(cat => `
        <a href="category.html?id=${cat.id}" 
           class="category-nav-item ${this.state.currentCategoryId === cat.id ? 'active' : ''}" 
           data-category-id="${cat.id}"
           title="${this.escapeHtml(cat.description || cat.name)}">
          <i class="fas ${cat.icon || 'fa-folder'}" style="color: ${cat.color || '#2b6cb0'}"></i>
          ${this.escapeHtml(cat.name)}
        </a>
      `).join('');

    navBar.innerHTML = `
      <a href="/" class="category-nav-item ${!this.state.currentCategoryId ? 'active' : ''}" id="nav-all">
        <i class="fas fa-globe"></i> 全部
      </a>
      ${categoriesHtml}
    `;
  },

  // 切换分类
  switchCategory: function(categoryId) {
    this.state.currentCategoryId = categoryId;
    this.state.searchKeyword = ''; // 切换分类时清除搜索
    this.state.sortBy = 'recommended'; // 重置为推荐排序
    
    // 更新UI
    this.updateCategoryNavBar();
    this.updateSectionTitle();
    
    // 清除搜索框状态
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const sortOptionsEl = document.getElementById('sort-options');
    const searchResultsInfo = document.getElementById('search-results-info');
    
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (sortOptionsEl) sortOptionsEl.style.display = 'none';
    if (searchResultsInfo) searchResultsInfo.style.display = 'none';
    
    // 更新排序按钮状态
    const sortBtns = document.querySelectorAll('.sort-btn');
    sortBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === 'recommended');
    });
    
    // 重新加载帖子
    this.loadPosts();
  },

  // 执行搜索
  search: function(keyword) {
    const trimmedKeyword = keyword.trim();
    this.state.searchKeyword = trimmedKeyword;
    
    // 更新搜索框状态
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const sortOptionsEl = document.getElementById('sort-options');
    
    if (searchInput && keyword) {
      searchInput.value = keyword;
    }
    if (clearBtn) {
      clearBtn.style.display = trimmedKeyword ? 'flex' : 'none';
    }
    // 显示排序选项
    if (sortOptionsEl && trimmedKeyword) {
      sortOptionsEl.style.display = 'flex';
    }
    
    // 保存搜索历史
    if (trimmedKeyword) {
      this.saveSearchHistory(trimmedKeyword);
    }
    
    // 隐藏搜索历史下拉
    this.hideSearchHistory();
    
    // 重新加载帖子
    this.loadPosts();
  },

  // 清除搜索
  clearSearch: function() {
    this.state.searchKeyword = '';
    this.state.sortBy = 'recommended'; // 重置排序为推荐
    // 注意：不清除 currentCategoryId，保持当前分类筛选
    
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    
    // 重置排序按钮状态（如果不在分类模式下）
    if (!this.state.currentCategoryId) {
      const sortButtons = document.querySelectorAll('.sort-btn');
      sortButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === 'recommended');
      });
    }
    
    // 隐藏搜索历史下拉
    this.hideSearchHistory();
    
    // 重新加载帖子
    this.loadPosts();
  },

  // ============ 搜索历史管理 ============

  // 加载搜索历史
  loadSearchHistory: function() {
    try {
      const saved = localStorage.getItem(this.SEARCH_HISTORY_KEY);
      this.state.searchHistory = saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('加载搜索历史失败:', error);
      this.state.searchHistory = [];
    }
  },

  // 保存搜索历史
  saveSearchHistory: function(keyword) {
    if (!keyword) return;
    
    // 移除重复项
    this.state.searchHistory = this.state.searchHistory.filter(h => h !== keyword);
    
    // 添加到开头
    this.state.searchHistory.unshift(keyword);
    
    // 限制数量
    if (this.state.searchHistory.length > this.MAX_HISTORY_ITEMS) {
      this.state.searchHistory = this.state.searchHistory.slice(0, this.MAX_HISTORY_ITEMS);
    }
    
    // 保存到 localStorage
    try {
      localStorage.setItem(this.SEARCH_HISTORY_KEY, JSON.stringify(this.state.searchHistory));
    } catch (error) {
      console.error('保存搜索历史失败:', error);
    }
  },

  // 删除单条搜索历史
  deleteHistoryItem: function(keyword) {
    this.state.searchHistory = this.state.searchHistory.filter(h => h !== keyword);
    
    try {
      localStorage.setItem(this.SEARCH_HISTORY_KEY, JSON.stringify(this.state.searchHistory));
    } catch (error) {
      console.error('删除搜索历史失败:', error);
    }
    
    // 更新显示
    this.renderSearchHistory();
  },

  // 清空所有搜索历史
  clearAllHistory: function() {
    this.state.searchHistory = [];
    
    try {
      localStorage.removeItem(this.SEARCH_HISTORY_KEY);
    } catch (error) {
      console.error('清空搜索历史失败:', error);
    }
    
    // 更新显示
    this.renderSearchHistory();
  },

  // 显示搜索历史下拉
  showSearchHistory: function() {
    this.renderSearchHistory();
    const historyEl = document.getElementById('search-history');
    if (historyEl) {
      historyEl.style.display = 'block';
    }
  },

  // 隐藏搜索历史下拉
  hideSearchHistory: function() {
    const historyEl = document.getElementById('search-history');
    if (historyEl) {
      historyEl.style.display = 'none';
    }
  },

  // 渲染搜索历史列表
  renderSearchHistory: function() {
    const listEl = document.getElementById('search-history-list');
    if (!listEl) return;

    if (this.state.searchHistory.length === 0) {
      listEl.innerHTML = '<div class="search-empty-history">暂无搜索历史</div>';
      return;
    }

    const self = this;
    listEl.innerHTML = this.state.searchHistory.map(keyword => `
      <div class="history-item" data-keyword="${this.escapeHtml(keyword)}">
        <div class="history-item-left">
          <i class="fas fa-history"></i>
          <span>${this.escapeHtml(keyword)}</span>
        </div>
        <button class="history-item-delete" data-keyword="${this.escapeHtml(keyword)}">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `).join('');
  },

  // 加载用户收藏列表
  loadUserFavorites: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) {
      return new Set();
    }
    
    try {
      const response = await fetch(`/api/favorites/user/${currentUser.id}`);
      const data = await response.json();

      if (data.success && data.posts) {
        // 返回收藏帖子ID的Set
        return new Set(data.posts.map(post => post.id));
      }
    } catch (error) {
      console.error('加载收藏列表失败:', error);
    }
    
    return new Set();
  },

  // 渲染帖子
  renderPosts: function(posts, favoritesSet = new Set()) {
    const container = this.dom.postsContainer;
    if (!container) return;
    
    if (!posts || posts.length === 0) {
      if (this.state.searchKeyword) {
        container.innerHTML = `
          <div class="empty-state search-empty">
            <i class="fas fa-search"></i>
            <p>没有找到包含「${this.escapeHtml(this.state.searchKeyword)}」的帖子</p>
            <p class="empty-hint">试试其他关键词</p>
          </div>
        `;
      } else {
        container.innerHTML = '<div class="empty-state">暂时没有帖子，成为第一个发表的人吧！</div>';
      }
      return;
    }
    
    container.innerHTML = '';
    
    // 获取当前用户（确保获取最新状态）
    const currentUser = userManager.state.currentUser;
    console.log('renderPosts: 当前用户状态', currentUser ? currentUser.id : '未登录');
    
    // 搜索模式下使用后端排序结果，非搜索模式按时间排序
    let postsToRender = posts;
    if (!this.state.searchKeyword) {
      postsToRender = [...posts].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp));
    }
    
    postsToRender.forEach(post => {
      const postElement = document.createElement('div');
      postElement.className = 'post clickable-post';
      postElement.dataset.id = post.id;
      postElement.style.cursor = 'pointer';
      
      // 检查当前用户是否点赞过此帖
      const userLiked = currentUser && post.likedBy && post.likedBy.includes(currentUser.id);
      
      // 检查当前用户是否收藏过此帖
      const userFavorited = favoritesSet.has(post.id);
      
      // 检查当前用户是否是帖子作者
      const isAuthor = currentUser && currentUser.id === post.userId;
      
      // 确保用户名正确显示（转义防 XSS）
      const escapeHtml = (s) => utils.escapeHtml(s);
      const displayUsername = post.anonymous ? '匿名用户' : escapeHtml(post.username || '未知用户');
      const displaySchool = escapeHtml(post.school || '');
      const displayGrade = escapeHtml(post.grade || '');
      const displayClassName = escapeHtml(post.className || '');
      
      // 截断内容（只显示前 300 个字符）
      const truncatedContent = this.truncateContent(post.content, 300);
      
      postElement.innerHTML = `
        <div class="post-header">
          <div class="user-info">
            ${post.anonymous ? 
              `<div class="avatar anonymous-avatar">匿</div>` : 
              `<div class="avatar clickable-avatar" data-user-id="${post.userId}" title="点击查看个人主页" ${post.userAvatar ? `style="background-image: url('${escapeHtml(post.userAvatar)}'); background-size: cover; background-position: center;"` : ''}>
                ${!post.userAvatar ? (displayClassName ? displayClassName.slice(0,1) : '?') : ''}
              </div>`
            }
            <div class="user-details">
              <div class="user-name-row">
                <h3>${displayUsername}</h3>
              </div>
              ${post.anonymous ? '' : 
                `<div class="class-info">${displaySchool} | ${displayGrade} ${displayClassName}</div>`
              }
            </div>
          </div>
          <div class="post-time">
            <i class="far fa-clock"></i> ${utils.formatDate(post.timestamp)}
          </div>
        </div>
        
        <div class="post-content">
          ${post.anonymous ? '<span class="tag anonymous-tag">匿名</span>' : 
          `<span class="tag">${displayGrade}</span>
           <span class="tag">${displayClassName}</span>`}
          ${this.renderMarkdownContent(truncatedContent)}
          ${truncatedContent !== post.content ? '<p class="read-more">点击查看全文...</p>' : ''}
          ${post.images && post.images.length > 0 ? this.renderPostImages(post.images.slice(0, 3)) : ''}
        </div>
        
        <div class="post-footer">
          <div class="action-buttons">
            <div class="action-btn like-btn ${userLiked ? 'active' : ''}" data-id="${post.id}">
              <i class="fas fa-heart ${userLiked ? 'active' : ''}"></i> 点赞 <span>${post.likes || 0}</span>
            </div>
            <div class="action-btn dislike-btn ${currentUser && post.dislikedBy && post.dislikedBy.includes(currentUser.id) ? 'active' : ''}" data-id="${post.id}">
              <i class="fas fa-thumbs-down ${currentUser && post.dislikedBy && post.dislikedBy.includes(currentUser.id) ? 'active' : ''}"></i> 点踩 <span>${post.dislikes || 0}</span>
            </div>
            <div class="action-btn favorite-btn ${userFavorited ? 'active' : ''}" data-id="${post.id}">
              <i class="fas fa-star ${userFavorited ? 'active' : ''}"></i> 收藏 <span>${post.favoriteCount || 0}</span>
            </div>
            <div class="action-btn comment-btn">
              <i class="fas fa-comment"></i> 评论 <span>${post.comments ? post.comments.length : 0}</span>
            </div>
            <div class="action-btn view-count-btn">
              <i class="fas fa-eye"></i> 浏览 <span>${post.viewCount || 0}</span>
            </div>
            ${currentUser && currentUser.id === post.userId ?
              `<div class="action-btn delete-btn" data-id="${post.id}">
                <i class="fas fa-trash"></i> 删除
              </div>` : 
              currentUser ? 
              `<div class="action-btn report-btn" data-id="${post.id}" data-type="post">
                <i class="fas fa-flag"></i> 举报
              </div>` : ''
            }
          </div>
        </div>
      `;
      
      container.appendChild(postElement);
    });
    
    // 渲染 LaTeX 公式 (MathJax)
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      console.log('开始渲染 MathJax 公式...');
      MathJax.typesetPromise([container]).then(() => {
        console.log('MathJax 公式渲染完成');
      }).catch((err) => console.error('MathJax typeset failed:', err));
    } else {
      console.log('MathJax 未就绪，等待加载...');
      // 等待 MathJax 加载完成后渲染
      const checkMathJax = setInterval(() => {
        if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
          clearInterval(checkMathJax);
          console.log('MathJax 已就绪，开始渲染...');
          MathJax.typesetPromise([container]).then(() => {
            console.log('MathJax 公式渲染完成');
          }).catch((err) => console.error('MathJax typeset failed:', err));
        }
      }, 100);
      // 10秒后停止检查
      setTimeout(() => clearInterval(checkMathJax), 10000);
    }
  },

  // 渲染 markdown 内容
  renderMarkdownContent: function(text) {
    if (!text) return '';
    
    // 如果 markdown-it 未初始化，使用简单转义
    if (!this.state.md) {
      return '<p>' + this.escapeHtml(text) + '</p>';
    }
    
    try {
      // 保护公式不被 markdown 处理
      const { protectedText, placeholders } = this.protectMathFormulas(text);
      
      // 使用 markdown-it 渲染
      const html = this.state.md.render(protectedText);
      
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

  // 截断内容
  truncateContent: function(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  },

  // 渲染评论
  renderComments: function(post) {
    if (!post.comments || post.comments.length === 0) {
      return '<div class="empty-state">暂无评论</div>';
    }
    
    // 只显示最新3条评论
    const commentsToShow = [...post.comments].slice(0, 3);
    
    let commentsHTML = '<div class="comments-list">';
    
    commentsToShow.forEach(comment => {
      // 确保评论用户名正确显示
      const commentUsername = comment.anonymous ? '匿名同学' : (comment.username || '用户');
      
      commentsHTML += `
        <div class="comment">
          <div class="comment-header">
            <div class="comment-user">${this.escapeHtml(commentUsername)}</div>
            <div class="comment-time">${utils.formatDate(comment.timestamp)}</div>
          </div>
          <div class="comment-content">${this.renderMarkdownContent(comment.content)}</div>
          ${comment.images && comment.images.length > 0 ? `
            <div class="comment-images">${comment.images.map(img =>
              `<img class="comment-img" src="${this.escapeHtml(img.url)}" alt="评论图片" loading="lazy">`
            ).join('')}</div>
          ` : ''}
        </div>
      `;
    });
    
    // 如果评论超过3条，添加"查看更多"按钮
    if (post.comments.length > 3) {
      commentsHTML += `
        <div class="view-all-comments" data-id="${post.id}">
          查看全部 ${post.comments.length} 条评论
        </div>
      `;
    }
    
    commentsHTML += '</div>';
    
    return commentsHTML;
  },

  // 渲染所有评论（不再限制数量）
  renderAllComments: function(post) {
    if (!post.comments || post.comments.length === 0) {
      return '<div class="empty-state">暂无评论</div>';
    }
    
    let commentsHTML = '<div class="comments-list">';
    
    post.comments.forEach(comment => {
      const commentUsername = comment.anonymous ? '匿名同学' : comment.username;
      
      commentsHTML += `
        <div class="comment">
          <div class="comment-header">
            <div class="comment-user">${this.escapeHtml(commentUsername)}</div>
            <div class="comment-time">${utils.formatDate(comment.timestamp)}</div>
          </div>
          <div class="comment-content">${this.renderMarkdownContent(comment.content)}</div>
          ${comment.images && comment.images.length > 0 ? `
            <div class="comment-images">${comment.images.map(img =>
              `<img class="comment-img" src="${this.escapeHtml(img.url)}" alt="评论图片" loading="lazy">`
            ).join('')}</div>
          ` : ''}
        </div>
      `;
    });
    
    commentsHTML += '</div>';
    
    return commentsHTML;
  },

  // 渲染帖子中的图片
  renderPostImages: function(images) {
    if (!images || images.length === 0) return '';
    
    let imagesHTML = '<div class="post-images">';
    
    images.forEach(image => {
      // XSS 防护：URL 同时转义 HTML 属性 + 通过 data-url 传递（onclick 不再拼接用户数据）
      const safeUrl = this.escapeHtml(image.url);
      imagesHTML += `
        <img src="${safeUrl}" alt="${this.escapeHtml(image.originalname)}" class="post-image" data-url="${safeUrl}" data-action="postsManager.showImageModal" data-arg-from="data-url">
      `;
    });
    
    imagesHTML += '</div>';
    return imagesHTML;
  },

  // 显示图片预览模态框
  showImageModal: function(imageUrl) {
    const modal = document.getElementById('image-modal');
    if (!modal) return;
    
    // 设置图片并显示模态框
    modal.querySelector('.image-modal-content img').src = imageUrl;
    modal.style.display = 'flex';
  },
  
    // 增加浏览量
    incrementViewCount: async function(postId) {
      try {
        const response = await fetch(`/api/posts/${postId}/view`, {
          method: 'POST',
          headers: userManager.getAuthHeaders()
        });
  
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            // 更新本地浏览量显示
            const viewCountBtn = document.querySelector(`.clickable-post[data-id="${postId}"] .view-count-btn span`);
            if (viewCountBtn) {
              viewCountBtn.textContent = data.viewCount;
            }
          }
        }
      } catch (error) {
        console.error('增加浏览量失败:', error);
        // 浏览量更新失败不影响用户体验，不显示错误提示
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
          this.state.tags = data.tags;
        }
      } catch (error) {
        console.error('加载标签失败:', error);
      }
    },

    // 显示收藏标签选择弹窗
    showFavoriteTagModal: function(postId) {
      // 移除已存在的弹窗
      const existingModal = document.getElementById('favorite-tag-modal');
      if (existingModal) existingModal.remove();

      let tagsHtml = `
        <div class="tag-select-item no-tag selected" data-tag-id="">
          <i class="fas fa-times-circle"></i>
          <span>不选择分类</span>
        </div>
      `;

      this.state.tags.forEach(tag => {
        tagsHtml += `
          <div class="tag-select-item" data-tag-id="${tag._id}">
            <div class="tag-color-dot" style="background: ${tag.color}"></div>
            <span>${this.escapeHtml ? this.escapeHtml(tag.name) : tag.name}</span>
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
      const self = this;
      self.selectedTagId = null;

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
          self.selectedTagId = item.dataset.tagId || null;
        }
      };

      saveBtn.onclick = async () => {
        if (self.selectedTagId !== undefined && self.selectedTagId !== null) {
          await self.updateFavoriteTag(postId, self.selectedTagId);
        }
        modal.remove();
      };
    },

    // 更新收藏标签
    updateFavoriteTag: async function(postId, tagId) {
      const currentUser = userManager.state.currentUser;
      if (!currentUser) return;

      try {
        const response = await fetch(`/api/favorites/${postId}/tag`, {
          method: 'PUT',
          headers: userManager.getAuthHeaders(),
          body: JSON.stringify({
            tagId: tagId || null
          })
        });

        const data = await response.json();
        if (data.success) {
          const tag = this.state.tags.find(t => t._id === tagId);
          if (tag) {
            utils.showNotification(`已添加到「${tag.name}」分类`, 'success');
          }
        }
      } catch (error) {
        console.error('更新收藏标签失败:', error);
      }
    },
  
    // 设置事件监听器
    setupEventListeners: function() {
      const self = this;

      // 加载搜索历史
      this.loadSearchHistory();

      // 搜索框事件
      const searchInput = document.getElementById('search-input');
      const searchClearBtn = document.getElementById('search-clear-btn');
      const clearSearchBtn = document.getElementById('clear-search-btn');
      const searchBtn = document.getElementById('search-btn');
      const searchHistory = document.getElementById('search-history');
      const clearHistoryBtn = document.getElementById('clear-history-btn');

      if (searchInput) {
        // 输入事件 - 只更新清除按钮状态，不自动搜索
        searchInput.addEventListener('input', function(e) {
          const keyword = e.target.value;
          
          // 显示/隐藏清除按钮
          if (searchClearBtn) {
            searchClearBtn.style.display = keyword ? 'flex' : 'none';
          }
        });

        // 聚焦时显示搜索历史
        searchInput.addEventListener('focus', function() {
          self.showSearchHistory();
        });

        // 回车键搜索
        searchInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            self.search(this.value);
          }
        });
      }

      // 搜索按钮
      if (searchBtn) {
        searchBtn.addEventListener('click', function() {
          const searchInput = document.getElementById('search-input');
          if (searchInput) {
            self.search(searchInput.value);
          }
        });
      }

      // 搜索框清除按钮
      if (searchClearBtn) {
        searchClearBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const searchInput = document.getElementById('search-input');
          if (searchInput) searchInput.value = '';
          self.clearSearch();
        });
      }

      // 搜索结果清除按钮
      if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
          self.clearSearch();
        });
      }

      // 清空搜索历史按钮
      if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          self.clearAllHistory();
        });
      }

      // 点击搜索历史项
      if (searchHistory) {
        searchHistory.addEventListener('click', function(e) {
          // 删除单条历史
          const deleteBtn = e.target.closest('.history-item-delete');
          if (deleteBtn) {
            e.stopPropagation();
            const keyword = deleteBtn.dataset.keyword;
            self.deleteHistoryItem(keyword);
            return;
          }

          // 点击历史项
          const historyItem = e.target.closest('.history-item');
          if (historyItem) {
            const keyword = historyItem.dataset.keyword;
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = keyword;
            self.search(keyword);
          }
        });
      }

      // 点击外部关闭搜索历史
      document.addEventListener('click', function(e) {
        const searchWrapper = e.target.closest('.search-box-wrapper');
        if (!searchWrapper) {
          self.hideSearchHistory();
        }
      });

      // 鼠标悬停事件监听（5秒浏览逻辑）
      document.addEventListener('mouseover', (e) => {
        const post = e.target.closest('.clickable-post');
        if (post && post.dataset.id) {
          const postId = post.dataset.id;
  
          // 如果这个帖子还没有计时器，创建一个
          if (!this.state.viewTimers[postId]) {
            this.state.viewTimers[postId] = setTimeout(() => {
              // 5秒后增加浏览量
              this.incrementViewCount(postId);
              // 清除计时器
              delete this.state.viewTimers[postId];
            }, 5000);
          }
        }
      });
  
      // 鼠标移出事件监听
      document.addEventListener('mouseout', (e) => {
        const post = e.target.closest('.clickable-post');
        if (post && post.dataset.id) {
          const postId = post.dataset.id;
  
          // 清除计时器
          if (this.state.viewTimers[postId]) {
            clearTimeout(this.state.viewTimers[postId]);
            delete this.state.viewTimers[postId];
          }
        }
      });

      // 排序按钮事件
      const sortButtons = document.querySelectorAll('.sort-btn');
      sortButtons.forEach(btn => {
        btn.addEventListener('click', function() {
          // 更新活动状态
          sortButtons.forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          
          // 更新排序方式并重新加载
          self.state.sortBy = this.dataset.sort;
          self.updateSectionTitle();
          self.loadPosts();
        });
      });
      
      // 分类导航栏点击事件
      document.addEventListener('click', function(e) {
        // 点击"全部"链接 → 在首页筛选全部帖子（不跳转）
        if (e.target.closest('#nav-all')) {
          e.preventDefault();
          self.switchCategory(null);
          return;
        }
        
        // 点击其他分类项 → 交给 <a href="category.html?id=xxx"> 自然跳转
        // 不再拦截，让 href 生效即可跳转到栏目页面
      });
  
      // 全局点击事件监听
    document.addEventListener('click', async (e) => {
      // 处理点赞按钮点击（必须最先处理）
      if (e.target.closest('.like-btn')) {
        e.stopPropagation();
        const likeBtn = e.target.closest('.like-btn');
        const postId = likeBtn.dataset.id;
        
        console.log('点赞按钮被点击，帖子ID:', postId);
        
        // 防止重复点击
        if (likeBtn.classList.contains('processing')) {
          return;
        }
        
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再点赞', 'error');
          window.location.href = 'login.html';
          return;
        }
        
        // 验证用户ID
        const userId = userManager.state.currentUser.id;
        if (!userId) {
          console.error('点赞失败: 用户ID为空');
          utils.showNotification('用户信息错误，请重新登录', 'error');
          return;
        }
        
        // 验证帖子ID
        if (!postId) {
          console.error('点赞失败: 帖子ID为空');
          utils.showNotification('帖子信息错误', 'error');
          return;
        }
        
        // 禁用按钮并添加处理中状态
        likeBtn.classList.add('processing');
        
        try {
          console.log('发送点赞请求:', { postId, userId });
          
          const response = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST',
            headers: userManager.getAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '操作失败');
          }
          
          const data = await response.json();
          console.log('点赞响应:', data); // 调试日志
          if (data.success) {
            // 更新UI
            const likesSpan = likeBtn.querySelector('span');
            const heartIcon = likeBtn.querySelector('i.fa-heart');
            
            if (likesSpan) {
              console.log('更新点���数:', data.likes, 'liked状态:', data.liked); // 调试日志
              likesSpan.textContent = data.likes;
            }
            
            // 根据服务器返回的liked状态更新UI
            if (data.liked) {
              console.log('添加active类'); // 调试日志
              likeBtn.classList.add('active');
              if (heartIcon) heartIcon.classList.add('active');
            } else {
              console.log('移除active类'); // 调试日志
              likeBtn.classList.remove('active');
              if (heartIcon) heartIcon.classList.remove('active');
            }
            
            // 如果点赞时取消了点踩，更新点踩状态
            if (data.dislikes !== undefined) {
              const dislikeBtn = likeBtn.parentElement.querySelector('.dislike-btn');
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
            }
          }
        } catch (error) {
          console.error('点赞失败:', error);
          utils.showNotification(error.message || '操作失败', 'error');
        } finally {
          // 移除处理中状态
          likeBtn.classList.remove('processing');
        }
        return;
      }

      // 处理点踩按钮点击
      if (e.target.closest('.dislike-btn')) {
        e.stopPropagation();
        const dislikeBtn = e.target.closest('.dislike-btn');
        const postId = dislikeBtn.dataset.id;
        
        // 防止重复点击
        if (dislikeBtn.classList.contains('processing')) {
          return;
        }
        
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再点踩', 'error');
          window.location.href = 'login.html';
          return;
        }
        
        // 禁用按钮并添加处理中状态
        dislikeBtn.classList.add('processing');
        
        try {
          const response = await fetch(`/api/posts/${postId}/dislike`, {
            method: 'POST',
            headers: userManager.getAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '操作失败');
          }
          
          const data = await response.json();
          if (data.success) {
            // 更新UI
            const dislikesSpan = dislikeBtn.querySelector('span');
            const thumbsDownIcon = dislikeBtn.querySelector('i.fa-thumbs-down');
            
            if (dislikesSpan) {
              dislikesSpan.textContent = data.dislikes;
            }
            
            // 根据服务器返回的disliked状态更新UI
            if (data.disliked) {
              dislikeBtn.classList.add('active');
              if (thumbsDownIcon) thumbsDownIcon.classList.add('active');
            } else {
              dislikeBtn.classList.remove('active');
              if (thumbsDownIcon) thumbsDownIcon.classList.remove('active');
            }
            
            // 如果点踩时取消了点赞，更新点赞状态
            if (data.likes !== undefined) {
              const likeBtn = dislikeBtn.parentElement.querySelector('.like-btn');
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
            }
          }
        } catch (error) {
          console.error('点踩失败:', error);
          utils.showNotification(error.message || '操作失败', 'error');
        } finally {
          // 移除处理中状态
          dislikeBtn.classList.remove('processing');
        }
        return;
      }

      // 处理收藏按钮点击
      if (e.target.closest('.favorite-btn')) {
        e.stopPropagation();
        const favoriteBtn = e.target.closest('.favorite-btn');
        const postId = favoriteBtn.dataset.id;
        
        // 防止重复点击
        if (favoriteBtn.classList.contains('processing')) {
          return;
        }
        
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再收藏', 'error');
          window.location.href = 'login.html';
          return;
        }
        
        // 禁用按钮并添加处理中状态
        favoriteBtn.classList.add('processing');
        
        try {
          const isFavorited = favoriteBtn.classList.contains('active');
          const method = isFavorited ? 'DELETE' : 'POST';
          
          const response = await fetch(`/api/favorites/${postId}`, {
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
              await postsManager.loadTags();
              if (postsManager.state.tags.length > 0) {
                postsManager.showFavoriteTagModal(postId);
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
          // 移除处理中状态
          favoriteBtn.classList.remove('processing');
        }
        return;
      }

      // 处理删除按钮点击（必须最先处理）
      if (e.target.closest('.delete-btn')) {
        e.stopPropagation();
        const deleteBtn = e.target.closest('.delete-btn');
        const postId = deleteBtn.dataset.id;
        
        console.log('删除按钮被点击，帖子ID:', postId);
        
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再操作', 'error');
          window.location.href = 'login.html';
          return;
        }
        
        // 验证用户ID
        const userId = userManager.state.currentUser.id;
        if (!userId) {
          console.error('删除帖子失败: 用户ID为空');
          utils.showNotification('用户信息错误，请重新登录', 'error');
          return;
        }
        
        // 验证帖子ID
        if (!postId) {
          console.error('删除帖子失败: 帖子ID为空');
          utils.showNotification('帖子信息错误', 'error');
          return;
        }
        
        // 确认删除
        if (!confirm('确定要删除这个帖子吗？此操作不可撤销。')) {
          return;
        }
        
        try {
          console.log('发送删除请求:', { postId, userId });
          
          const response = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE',
            headers: userManager.getAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '操作失败');
          }
          
          const data = await response.json();
          if (data.success) {
            utils.showNotification('帖子删除成功', 'success');
            
            // 从DOM中移除帖子
            const postElement = document.querySelector(`.post[data-id="${postId}"]`);
            if (postElement) {
              postElement.remove();
            }
            
            // 从状态中移除帖子
            const postIndex = this.state.posts.findIndex(p => p.id === postId);
            if (postIndex !== -1) {
              this.state.posts.splice(postIndex, 1);
            }
            
            // 如果所有帖子都被删除了，显示空状态
            if (this.state.posts.length === 0) {
              const container = this.dom.postsContainer;
              if (container) {
                container.innerHTML = '<div class="empty-state">暂时没有帖子，成为第一个发表的人吧！</div>';
              }
            }
          }
        } catch (error) {
          console.error('删除帖子失败:', error);
          utils.showNotification(error.message || '操作失败', 'error');
        }
        return;
      }

      // 处理举报按钮点击
      if (e.target.closest('.report-btn')) {
        e.stopPropagation();
        const reportBtn = e.target.closest('.report-btn');
        const targetId = reportBtn.dataset.id;
        const targetType = reportBtn.dataset.type || 'post';
        
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再举报', 'error');
          return;
        }
        
        this.showReportModal(targetId, targetType);
        return;
      }

      // 处理头像点击
      if (e.target.closest('.clickable-avatar')) {
        e.stopPropagation();
        const avatar = e.target.closest('.clickable-avatar');
        const userId = avatar.dataset.userId;
        
        if (userId) {
          window.location.href = `profile.html?id=${userId}`;
        }
        return;
      }

      // 处理帖子点击（跳转到详情页）- 放在最后处理
      if (e.target.closest('.clickable-post')) {
        const post = e.target.closest('.clickable-post');
        const postId = post.dataset.id;
        if (postId) {
          window.location.href = `post-detail.html?id=${postId}`;
        }
        return;
      }
    });
  },

  // 显示举报模态框
  showReportModal: function(targetId, targetType) {
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
        
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: userManager.getAuthHeaders(),
          body: JSON.stringify({
            reporterId: userManager.state.currentUser.id,
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

  // HTML转义函数，防止XSS攻击
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// 暴露到全局：[data-action] 事件委托派发器据此解析 postsManager.xxx 动作（CSP 内联事件重构）
window.postsManager = postsManager;