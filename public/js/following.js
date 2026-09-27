// 我的关注页面管理模块
const followingManager = {
  // 全局状态（currentUser 统一使用 userManager.state.currentUser）
  state: {
    followingList: [],
    posts: [],
    currentTab: 'posts',
    currentPage: 1,
    totalPages: 1,
    total: 0,
    md: null, // markdown-it 实例
    favoritesSet: new Set()
  },

  // DOM元素
  dom: {
    followingCountBadge: document.getElementById('following-count-badge'),
    followingPostsContainer: document.getElementById('following-posts-container'),
    followingListContainer: document.getElementById('following-list-container'),
    noFollowingPosts: document.getElementById('no-following-posts'),
    noFollowing: document.getElementById('no-following'),
    loadMoreContainer: document.getElementById('load-more-container'),
    loadMoreBtn: document.getElementById('load-more-btn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    postsTab: document.getElementById('posts-tab'),
    listTab: document.getElementById('list-tab')
  },

  // 初始化
  init: function() {
    this.initializeMarkdownRenderer();
    this.checkLogin();
    this.setupEventListeners();
  },

  // 初始化 markdown 渲染器
  initializeMarkdownRenderer: function() {
    let markdownItGlobal = window.markdownit || window.markdownIt || window.markdown_it || window.MarkdownIt;
    
    if (!markdownItGlobal) {
      console.warn('markdown-it 未加载');
      this.state.md = null;
      return;
    }

    try {
      this.state.md = markdownItGlobal({
        html: false,
        linkify: true,
        typographer: true
      });
    } catch (error) {
      console.error('初始化 markdown 渲染器失败:', error);
      this.state.md = null;
    }
  },

  // 检查登录状态（userManager.initAsync 已完成，state 已同步）
  checkLogin: function() {
    if (!userManager.state.currentUser) {
      this.showLoginRequired();
      return;
    }
    this.loadFollowingPosts();
    this.loadFollowingList();
    this.markFollowingViewed();
  },

  // 标记查看动态
  markFollowingViewed: async function() {
    if (!userManager.state.currentUser) return;
    
    try {
      await fetch('/api/follow/mark-viewed', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({ userId: userManager.state.currentUser.id })
      });
      
      // 更新顶栏徽章为0
      if (typeof userManager !== 'undefined' && userManager.setUpdatesBadge) {
        userManager.setUpdatesBadge(0);
      }
    } catch (error) {
      console.error('标记查看动态失败:', error);
    }
  },

  // 显示需要登录提示
  showLoginRequired: function() {
    const container = this.dom.followingPostsContainer;
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-sign-in-alt"></i>
          <p>请先登录查看关注的用户动态</p>
          <button class="post-button" data-action="utils.navigate" data-arg="login.html">
            <i class="fas fa-sign-in-alt"></i> 去登录
          </button>
        </div>
      `;
    }
    
    if (this.dom.followingListContainer) {
      this.dom.followingListContainer.innerHTML = '';
    }
  },

  // 加载关注的用户的帖子
  loadFollowingPosts: async function(page = 1) {
    if (!userManager.state.currentUser) return;

    const container = this.dom.followingPostsContainer;

    if (page === 1) {
      container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    }

    try {
      const response = await fetch(`/api/following/posts/${userManager.state.currentUser.id}?page=${page}`);
      
      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        this.state.currentPage = data.pagination.currentPage;
        this.state.totalPages = data.pagination.totalPages;
        this.state.total = data.pagination.total;

        if (page === 1) {
          this.state.posts = data.posts;
        } else {
          this.state.posts = [...this.state.posts, ...data.posts];
        }

        // 加载收藏列表
        await this.loadUserFavorites();

        this.renderPosts();
        this.updateLoadMoreButton();
      } else {
        throw new Error(data.message || '加载失败');
      }
    } catch (error) {
      console.error('加载关注帖子失败:', error);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>加载失败，请稍后重试</p>
        </div>
      `;
    }
  },

  // 加载关注列表
  loadFollowingList: async function() {
    if (!userManager.state.currentUser) return;

    const container = this.dom.followingListContainer;
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';

    try {
      const response = await fetch(`/api/following/${userManager.state.currentUser.id}`);
      
      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        this.state.followingList = data.list;
        this.renderFollowingList();
        
        // 更新关注数徽章
        if (this.dom.followingCountBadge) {
          this.dom.followingCountBadge.textContent = `(${data.pagination.total})`;
        }
      } else {
        throw new Error(data.message || '加载失败');
      }
    } catch (error) {
      console.error('加载关注列表失败:', error);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>加载失败，请稍后重试</p>
        </div>
      `;
    }
  },

  // 加载用户收藏列表
  loadUserFavorites: async function() {
    if (!userManager.state.currentUser) {
      return new Set();
    }
    
    try {
      const response = await fetch(`/api/favorites/user/${userManager.state.currentUser.id}`);
      const data = await response.json();

      if (data.success && data.posts) {
        this.state.favoritesSet = new Set(data.posts.map(post => post.id));
      }
    } catch (error) {
      console.error('加载收藏列表失败:', error);
    }
  },

  // 渲染帖子
  renderPosts: function() {
    const container = this.dom.followingPostsContainer;
    
    // 检查是否有关注
    if (this.state.total === 0) {
      container.innerHTML = '';
      this.dom.noFollowing.style.display = 'block';
      this.dom.noFollowingPosts.style.display = 'none';
      return;
    }

    // 检查是否有帖子
    if (this.state.posts.length === 0) {
      container.innerHTML = '';
      this.dom.noFollowing.style.display = 'none';
      this.dom.noFollowingPosts.style.display = 'block';
      return;
    }

    this.dom.noFollowing.style.display = 'none';
    this.dom.noFollowingPosts.style.display = 'none';

    container.innerHTML = '';
    
    this.state.posts.forEach(post => {
      const postElement = document.createElement('div');
      postElement.className = 'post clickable-post';
      postElement.dataset.id = post.id;
      postElement.style.cursor = 'pointer';
      
      const userFavorited = this.state.favoritesSet.has(post.id);
      const truncatedContent = this.truncateContent(post.content, 300);
      
      // 转义防 XSS
      const esc = (s) => this.escapeHtml(s);
      postElement.innerHTML = `
        <div class="post-header">
          <div class="user-info">
            ${post.anonymous ? 
              `<div class="avatar anonymous-avatar">匿</div>` : 
              `<div class="avatar clickable-avatar" data-user-id="${post.userId}" title="点击查看个人主页" ${post.userAvatar ? `style="background-image: url('${esc(post.userAvatar)}'); background-size: cover; background-position: center;"` : ''}>
                ${!post.userAvatar ? (post.className ? esc(post.className).slice(0,1) : '?') : ''}
              </div>`
            }
            <div class="user-details">
              <div class="user-name-row">
                <h3>${post.anonymous ? '匿名用户' : esc(post.username || '未知用户')}</h3>
              </div>
              ${post.anonymous ? '' : 
                `<div class="class-info">${esc(post.school || '')} | ${esc(post.grade || '')} ${esc(post.className || '')}</div>`
              }
            </div>
          </div>
          <div class="post-time">
            <i class="far fa-clock"></i> ${utils.formatDate(post.timestamp)}
          </div>
        </div>
        
        <div class="post-content">
          ${post.anonymous ? '<span class="tag anonymous-tag">匿名</span>' : 
          `<span class="tag">${esc(post.grade || '')}</span>
           <span class="tag">${esc(post.className || '')}</span>`}
          ${this.renderMarkdownContent(truncatedContent)}
          ${truncatedContent !== post.content ? '<p class="read-more">点击查看全文...</p>' : ''}
          ${post.images && post.images.length > 0 ? this.renderPostImages(post.images.slice(0, 3)) : ''}
        </div>
        
        <div class="post-footer">
          <div class="action-buttons">
            <div class="action-btn like-btn" data-id="${post.id}">
              <i class="fas fa-heart"></i> 点赞 <span>${post.likes || 0}</span>
            </div>
            <div class="action-btn comment-btn">
              <i class="fas fa-comment"></i> 评论 <span>${post.comments ? post.comments.length : 0}</span>
            </div>
            <div class="action-btn favorite-btn ${userFavorited ? 'active' : ''}" data-id="${post.id}">
              <i class="fas fa-star ${userFavorited ? 'active' : ''}"></i> 收藏
            </div>
            <div class="action-btn view-count-btn">
              <i class="fas fa-eye"></i> 浏览 <span>${post.viewCount || 0}</span>
            </div>
          </div>
        </div>
      `;
      
      container.appendChild(postElement);
    });

    // 渲染 MathJax
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      MathJax.typesetPromise([container]).catch(err => console.error('MathJax typeset failed:', err));
    }
  },

  // 渲染关注列表
  renderFollowingList: function() {
    const container = this.dom.followingListContainer;
    
    if (this.state.followingList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-plus"></i>
          <p>你还没有关注任何人</p>
          <button class="post-button" data-action="utils.navigate" data-arg="index.html">
            <i class="fas fa-home"></i> 去首页发现
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    
    this.state.followingList.forEach(user => {
      const userElement = document.createElement('div');
      userElement.className = 'following-user-card';
      userElement.dataset.userId = user.id;
      
      userElement.innerHTML = `
        <div class="user-avatar" ${user.avatar ? `style="background-image: url('${user.avatar}'); background-size: cover; background-position: center;"` : ''}>
          ${!user.avatar ? (user.className ? user.className.slice(0, 1) : '?') : ''}
        </div>
        <div class="user-info">
          <div class="user-name">${this.escapeHtml(user.username)}</div>
          <div class="user-class">${user.school || ''} · ${user.grade || ''} ${user.className || ''}</div>
        </div>
        <button class="unfollow-btn" data-user-id="${user.id}">
          <i class="fas fa-user-check"></i> 已关注
        </button>
      `;
      
      container.appendChild(userElement);
    });

    // 添加点击事件
    container.querySelectorAll('.following-user-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('.unfollow-btn')) {
          const userId = card.dataset.userId;
          window.location.href = `profile.html?id=${userId}`;
        }
      });
    });

    // 添加取消关注按钮事件
    container.querySelectorAll('.unfollow-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleUnfollow(btn.dataset.userId, btn);
      });
    });
  },

  // 处理取消关注
  handleUnfollow: async function(followingId, btn) {
    btn.disabled = true;
    
    try {
      const response = await fetch('/api/unfollow', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          followingId: followingId
        })
      });

      const data = await response.json();

      if (data.success) {
        utils.showNotification('已取消关注', 'success');
        
        // ��列表中移除
        this.state.followingList = this.state.followingList.filter(u => u.id !== followingId);
        this.renderFollowingList();
        
        // 更新徽章
        if (this.dom.followingCountBadge) {
          this.dom.followingCountBadge.textContent = `(${this.state.followingList.length})`;
        }
        
        // 如果当前在动态标签页，重新加载帖子
        if (this.state.currentTab === 'posts') {
          this.loadFollowingPosts();
        }
      } else {
        throw new Error(data.message || '操作失败');
      }
    } catch (error) {
      console.error('取消关注失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      btn.disabled = false;
    }
  },

  // 更新加载更多按钮
  updateLoadMoreButton: function() {
    if (!this.dom.loadMoreContainer) return;
    if (this.state.currentPage < this.state.totalPages) {
      this.dom.loadMoreContainer.style.display = 'block';
    } else {
      this.dom.loadMoreContainer.style.display = 'none';
    }
  },

  // 设置事件监听器
  setupEventListeners: function() {
    const self = this;

    // 标签页切换
    this.dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const tab = this.dataset.tab;
        self.switchTab(tab);
      });
    });

    // 加载更多
    if (this.dom.loadMoreBtn) {
      this.dom.loadMoreBtn.addEventListener('click', function() {
        self.loadFollowingPosts(self.state.currentPage + 1);
      });
    }

    // 点击帖子跳转到详情页
    document.addEventListener('click', async function(e) {
      // 点赞按钮
      if (e.target.closest('.like-btn')) {
        e.stopPropagation();
        const likeBtn = e.target.closest('.like-btn');
        await self.handleLike(likeBtn);
        return;
      }
      
      // 收藏按钮
      if (e.target.closest('.favorite-btn')) {
        e.stopPropagation();
        const favoriteBtn = e.target.closest('.favorite-btn');
        await self.handleFavorite(favoriteBtn);
        return;
      }
      
      if (e.target.closest('.clickable-post') && !e.target.closest('.action-btn')) {
        const post = e.target.closest('.clickable-post');
        const postId = post.dataset.id;
        if (postId) {
          window.location.href = `post-detail.html?id=${postId}`;
        }
      }
      
      // 点击头像跳转到个人主页
      if (e.target.closest('.clickable-avatar')) {
        e.stopPropagation();
        const avatar = e.target.closest('.clickable-avatar');
        const userId = avatar.dataset.userId;
        if (userId) {
          window.location.href = `profile.html?id=${userId}`;
        }
      }
    });
  },
  
  // 处理点赞
  handleLike: async function(likeBtn) {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录', 'error');
      window.location.href = 'login.html';
      return;
    }
    
    if (likeBtn.classList.contains('processing')) {
      return;
    }
    
    const postId = likeBtn.dataset.id;
    likeBtn.classList.add('processing');
    
    try {
      const response = await fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        headers: userManager.getAuthHeaders()
      });
      
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
      }
    } catch (error) {
      console.error('点赞失败:', error);
      utils.showNotification('操作失败', 'error');
    } finally {
      likeBtn.classList.remove('processing');
    }
  },
  
  // 处理收藏
  handleFavorite: async function(favoriteBtn) {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录', 'error');
      window.location.href = 'login.html';
      return;
    }
    
    if (favoriteBtn.classList.contains('processing')) {
      return;
    }
    
    const postId = favoriteBtn.dataset.id;
    favoriteBtn.classList.add('processing');
    
    try {
      const isFavorited = favoriteBtn.classList.contains('active');
      const method = isFavorited ? 'DELETE' : 'POST';
      
      const response = await fetch(`/api/favorites/${postId}`, {
        method: method,
        headers: userManager.getAuthHeaders()
      });
      
      const data = await response.json();
      
      if (data.success) {
        const starIcon = favoriteBtn.querySelector('i.fa-star');
        
        if (data.favorited) {
          favoriteBtn.classList.add('active');
          if (starIcon) starIcon.classList.add('active');
          utils.showNotification('收藏成功', 'success');
        } else {
          favoriteBtn.classList.remove('active');
          if (starIcon) starIcon.classList.remove('active');
          utils.showNotification('取消收藏成功', 'success');
        }
      }
    } catch (error) {
      console.error('收藏操作失败:', error);
      utils.showNotification('操作失败', 'error');
    } finally {
      favoriteBtn.classList.remove('processing');
    }
  },

  // 切换标签页
  switchTab: function(tab) {
    this.state.currentTab = tab;

    // 更新标签按钮状态
    this.dom.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    if (tab === 'posts') {
      if (this.dom.postsTab) this.dom.postsTab.classList.add('active');
      if (this.dom.listTab) this.dom.listTab.classList.remove('active');
      this.updateLoadMoreButton();
    } else {
      if (this.dom.postsTab) this.dom.postsTab.classList.remove('active');
      if (this.dom.listTab) this.dom.listTab.classList.add('active');
      if (this.dom.loadMoreContainer) this.dom.loadMoreContainer.style.display = 'none';
    }
  },

  // 渲染 markdown 内容
  renderMarkdownContent: function(text) {
    if (!text) return '';
    
    if (!this.state.md) {
      return '<p>' + this.escapeHtml(text) + '</p>';
    }
    
    try {
      // 保护公式不被 markdown 处理
      const { protectedText, placeholders } = this.protectMathFormulas(text);
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
    
    const replaceWithPlaceholder = (match) => {
      const placeholder = `MATHJAXPH${index}PH`;
      placeholders.push({ placeholder, formula: match });
      index++;
      return placeholder;
    };
    
    let protectedText = text.replace(/\$\$[\s\S]*?\$\$/g, replaceWithPlaceholder);
    protectedText = protectedText.replace(/\\[[\s\S]*?\\]/g, replaceWithPlaceholder);
    protectedText = protectedText.replace(/\$(?!\$)([^\$\n]+?)\$/g, replaceWithPlaceholder);
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

  // 渲染帖子图片
  renderPostImages: function(images) {
    if (!images || images.length === 0) return '';
    
    let imagesHTML = '<div class="post-images">';
    
    images.forEach(image => {
      // XSS 防护：URL 转义 HTML 属性 + 通过 data-url 传递（onclick 不再拼接用户数据）
      const safeUrl = this.escapeHtml(image.url);
      imagesHTML += `
        <img src="${safeUrl}" alt="${this.escapeHtml(image.originalname)}" class="post-image" data-url="${safeUrl}" data-action="followingManager.showImageModal" data-arg-from="data-url">
      `;
    });
    
    imagesHTML += '</div>';
    return imagesHTML;
  },

  // 显示图片预览模态框
  showImageModal: function(imageUrl) {
    const modal = document.getElementById('image-modal');
    if (!modal) return;
    
    modal.querySelector('.image-modal-content img').src = imageUrl;
    modal.style.display = 'flex';
  },

  // HTML 转义
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// 将 followingManager 挂载到 window（const 声明不会自动挂到 window）
window.followingManager = followingManager;
