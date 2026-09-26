// 个人主页管理模块
const profileManager = {
  // 全局状态
  state: {
    userId: null,
    userData: null,
    userStats: null,
    userPosts: [],
    currentFilter: 'all',
    md: null, // markdown-it 实例
    hljs: null, // highlight.js 实例
    isFollowing: false, // 当前用户是否关注了该用户
    followingCount: 0, // 关注数
    followerCount: 0, // 粉丝数
    isCurrentUser: false, // 是否是当前用户的个人主页
    isBlocked: false, // 当前用户是否拉黑了该用户
    isBlockedBy: false // 该用户是否拉黑了当前用户
  },

  // DOM元素
  dom: {
    profileAvatar: document.getElementById('profile-avatar'),
    profileUsername: document.getElementById('profile-username'),
    profileClass: document.getElementById('profile-class'),
    postCount: document.getElementById('post-count'),
    commentCount: document.getElementById('comment-count'),
    likeCount: document.getElementById('like-count'),
    viewCount: document.getElementById('view-count'),
    joinDate: document.getElementById('join-date'),
    lastLogin: document.getElementById('last-login'),
    postsCount: document.getElementById('posts-count'),
    profilePostsContainer: document.getElementById('profile-posts-container'),
    noPostsMessage: document.getElementById('no-posts-message'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    signatureContainer: document.getElementById('profile-signature-container'),
    signatureText: document.getElementById('profile-signature'),
    followingCount: document.getElementById('following-count'),
    followerCount: document.getElementById('follower-count'),
    followBtn: document.getElementById('follow-btn'),
    messageBtn: document.getElementById('message-btn'),
    profileActions: document.getElementById('profile-actions'),
    followingStat: document.getElementById('following-stat'),
    followerStat: document.getElementById('follower-stat'),
    blockBtn: document.getElementById('block-btn')
  },

  // 初始化
  init: function() {
    this.initializeMarkdownRenderer();
    this.getUserIdFromURL();
    if (this.state.userId) {
      this.loadUserProfile();
      this.loadFollowStats();
      this.setupEventListeners();
      this.updateUserPanel();
    } else {
      this.showError('用户ID无效');
    }
  },

  // 初始化 markdown 渲染器
  initializeMarkdownRenderer: function() {
    // 检查 markdown-it 是否已加载（支持多种可能的全局变量名）
    let markdownItGlobal = window.markdownit || window.markdownIt || window.markdown_it || window.MarkdownIt;
    
    if (!markdownItGlobal) {
      console.warn('markdown-it 未加载，将使用简单文本显示');
      this.state.md = null;
      return;
    }

    try {
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
        html: false, // 禁用原始 HTML 防 XSS
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

  // 从URL获取用户ID
  getUserIdFromURL: function() {
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id');
    
    if (userId) {
      this.state.userId = userId;
    } else {
      // 如果没有用户ID，检查当前登录用户
      // 首先检查 userManager.state.currentUser
      let currentUser = userManager.state.currentUser;
      
      // 如果 userManager 还没加载完成，尝试从 localStorage 获取
      if (!currentUser) {
        const savedUser = localStorage.getItem('forumUser');
        if (savedUser) {
          try {
            currentUser = JSON.parse(savedUser);
          } catch (e) {
            console.error('解析用户数据失败:', e);
          }
        }
      }
      
      if (currentUser) {
        this.state.userId = currentUser.id;
        // 更新URL但不刷新页面
        const newUrl = `${window.location.pathname}?id=${currentUser.id}`;
        window.history.replaceState({}, '', newUrl);
      } else {
        // 未登录且没有用户ID，重定向到首页
        utils.showNotification('请先登录或指定用户ID', 'error');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1500);
      }
    }
  },

  // 加载用户个人资料
  loadUserProfile: async function() {
    try {
      // 注意：服务端 getUserProfile 从 JWT 取查看者身份，不再信任 query viewerId。
      // 携带 Authorization 头即可让服务端识别当前登录用户（可见性/隐私过滤）。
      const authHeaders = (userManager && userManager.getAuthHeaders) ? userManager.getAuthHeaders() : {};
      const url = `/api/users/${this.state.userId}`;
      
      const response = await fetch(url, { headers: authHeaders });
      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('API返回的用户数据:', data); // 调试日志
      
      if (data.success) {
        this.state.userData = data.user;
        this.state.userStats = data.stats;
        this.state.userPosts = data.recentPosts || [];
        this.state.isCurrentUser = data.isSelf || false;
        
        this.renderUserProfile();
        this.renderUserPosts();
      } else {
        throw new Error(data.message || '加载用户资料失败');
      }
    } catch (error) {
      console.error('加载用户资料失败:', error);
      this.showError(error.message || '加载用户资料失败');
    }
  },

  // 渲染用户个人资料
  renderUserProfile: function() {
    const user = this.state.userData;
    if (!user) return;
    
    // 更新页面标题
    document.title = `${user.username}的个人主页 - 校园论坛`;
    
    // 渲染头像
    if (user.avatar) {
      // 如果用户有头像，使用背景图片显示
      this.dom.profileAvatar.style.backgroundImage = `url(${user.avatar})`;
      this.dom.profileAvatar.style.backgroundSize = 'cover';
      this.dom.profileAvatar.style.backgroundPosition = 'center';
      this.dom.profileAvatar.innerHTML = '';
    } else {
      // 如果没有头像，显示班级名称首字母
      const avatarChar = user.className ? user.className.slice(0,1) : '?';
      this.dom.profileAvatar.style.backgroundImage = '';
      this.dom.profileAvatar.innerHTML = avatarChar;
    }
    
    // 渲染用户名（如果是管理员，添加管理员标识）
    this.dom.profileUsername.innerHTML = user.isAdmin ?
      `${utils.escapeHtml(user.username)} <span style="color: #dc2626; margin-left: 8px; font-size: 14px;">管理员</span>` :
      utils.escapeHtml(user.username);
    
    // 渲染班级信息
    const gradeDisplay = user.grade === "已毕业" ? 
      `已毕业 · ${user.school} ${user.enrollmentYear}级 ${user.className}` :
      `${user.school} · ${user.grade} ${user.className}`;
    this.dom.profileClass.textContent = gradeDisplay;
    
    // 渲染性别
    const genderEl = document.getElementById('profile-gender');
    const genderText = document.getElementById('gender-text');
    if (genderEl && genderText && user.gender) {
      const genderMap = { 'male': '男', 'female': '女', 'other': '其他' };
      if (genderMap[user.gender]) {
        genderText.textContent = genderMap[user.gender];
        genderEl.style.display = 'inline-flex';
      }
    }
    
    // 渲染出生日期
    const birthdayEl = document.getElementById('profile-birthday');
    const birthdayText = document.getElementById('birthday-text');
    if (birthdayEl && birthdayText && user.birthday) {
      const birthday = new Date(user.birthday);
      const today = new Date();
      const age = today.getFullYear() - birthday.getFullYear();
      const monthDiff = today.getMonth() - birthday.getMonth();
      const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate()) ? age - 1 : age;
      
      birthdayText.textContent = `${birthday.toLocaleDateString('zh-CN')} (${actualAge}岁)`;
      birthdayEl.style.display = 'inline-flex';
    }
    
    // 渲染统计数据
    const stats = this.calculateUserStats();
    this.dom.postCount.textContent = stats.postCount;
    this.dom.commentCount.textContent = stats.commentCount;
    this.dom.likeCount.textContent = stats.totalLikes;
    this.dom.viewCount.textContent = stats.totalViews;
    this.dom.postsCount.textContent = `(${stats.postCount})`;
    
    // 渲染个性签名
    this.renderSignature(user);
    
    // 渲染加入时间和最后登录时间
    if (user.createdAt) {
      const joinDate = new Date(user.createdAt);
      this.dom.joinDate.textContent = `加入时间：${joinDate.toLocaleDateString('zh-CN')}`;
    }
    
    if (user.lastLogin) {
      const lastLogin = new Date(user.lastLogin);
      this.dom.lastLogin.textContent = `最后登录：${lastLogin.toLocaleDateString('zh-CN')}`;
    }
  },

  // 渲染个性签名
  renderSignature: function(user) {
    if (!this.dom.signatureContainer || !this.dom.signatureText) return;
    
    const signature = user.settings?.signature;
    
    if (signature && signature.trim()) {
      this.dom.signatureText.textContent = signature;
    } else {
      this.dom.signatureText.textContent = '这个人很懒，什么也没写~~~';
    }
    this.dom.signatureContainer.style.display = 'flex';
  },

  // 计算用户统计数据
  calculateUserStats: function() {
    // 如果API返回了stats数据，直接使用
    if (this.state.userStats) {
      return {
        postCount: this.state.userStats.postCount || 0,
        commentCount: this.state.userStats.commentCount || 0,
        totalLikes: this.state.userStats.totalLikes || 0,
        totalViews: this.state.userStats.totalViews || 0
      };
    }
    
    // 否则从用户数据和帖子数据计算
    const user = this.state.userData;
    const posts = this.state.userPosts;
    
    return {
      postCount: posts.length,
      commentCount: user.commentCount || 0,
      totalLikes: posts.reduce((sum, post) => sum + (post.likes || 0), 0),
      totalViews: posts.reduce((sum, post) => sum + (post.viewCount || 0), 0)
    };
  },

  // 渲染用户帖子
  renderUserPosts: function() {
    const container = this.dom.profilePostsContainer;
    if (!container) return;
    
    const filteredPosts = this.getFilteredPosts();
    
    if (filteredPosts.length === 0) {
      container.style.display = 'none';
      this.dom.noPostsMessage.style.display = 'block';
      return;
    }
    
    container.style.display = 'block';
    this.dom.noPostsMessage.style.display = 'none';
    
    container.innerHTML = '';
    
    filteredPosts.forEach(post => {
      const postElement = document.createElement('div');
      postElement.className = 'profile-post';
      postElement.dataset.id = post.id;
      
      // 格式化时间
      const timeDisplay = utils.formatDate(post.timestamp);
      
      // 计算评论数
      const commentCount = post.comments ? post.comments.length : 0;
      
      postElement.innerHTML = `
        <div class="profile-post-header">
          <div class="profile-post-time">
            <i class="far fa-clock"></i> ${timeDisplay}
          </div>
        </div>
        
        <div class="profile-post-content">
          ${post.anonymous ? '<span class="tag anonymous-tag">匿名</span>' : 
          `<span class="tag">${utils.escapeHtml(post.grade || '')}</span>
           <span class="tag">${utils.escapeHtml(post.className || '')}</span>`}
          ${this.renderPostContentPreview(post.content)}
        </div>
        
        <div class="profile-post-footer">
          <div class="profile-post-stats">
            <div class="profile-post-stat likes">
              <i class="fas fa-heart"></i> ${post.likes || 0}
            </div>
            <div class="profile-post-stat comments">
              <i class="fas fa-comment"></i> ${commentCount}
            </div>
            <div class="profile-post-stat views">
              <i class="fas fa-eye"></i> ${post.viewCount || 0}
            </div>
          </div>
          
          <div class="profile-post-actions">
            <button class="profile-post-action view" data-id="${post.id}">
              <i class="fas fa-external-link-alt"></i> 查看详情
            </button>
          </div>
        </div>
      `;
      
      container.appendChild(postElement);
    });
    
    // 添加查看详情按钮事件
    this.addPostActionListeners();
    
    // 渲染 LaTeX 公式 (MathJax)
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
      MathJax.typesetPromise([container]).catch((err) => console.error('MathJax typeset failed:', err));
    } else {
      // 等待 MathJax 加载完成后渲染
      const checkMathJax = setInterval(() => {
        if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
          clearInterval(checkMathJax);
          MathJax.typesetPromise([container]).catch((err) => console.error('MathJax typeset failed:', err));
        }
      }, 100);
      // 10秒后停止检查
      setTimeout(() => clearInterval(checkMathJax), 10000);
    }
  },

  // 获取筛选后的帖子
  getFilteredPosts: function() {
    let posts = [...this.state.userPosts];
    
    switch (this.state.currentFilter) {
      case 'recent':
        // 按时间倒序排序
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        break;
      case 'popular':
        // 按点赞数倒序排序
        posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        break;
      case 'all':
      default:
        // 默认按时间倒序排序
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        break;
    }
    
    return posts;
  },

  // 渲染帖子内容预览
  renderPostContentPreview: function(content) {
    if (!content) return '<p class="empty-content">[无文本内容]</p>';
    
    // 限制预览长度（对原始文本截断）
    const maxLength = 200;
    let textToRender = content;
    
    if (content.length > maxLength) {
      textToRender = content.substring(0, maxLength) + '...';
    }
    
    // 使用 markdown-it 渲染
    if (this.state.md) {
      try {
        // 保护公式不被 markdown 处理
        const { protectedText, placeholders } = this.protectMathFormulas(textToRender);
        const html = this.state.md.render(protectedText);
        // 恢复公式
        return this.restoreMathFormulas(html, placeholders);
      } catch (error) {
        console.error('Markdown 渲染失败:', error);
        return '<p>' + this.escapeHtml(textToRender) + '</p>';
      }
    }
    
    // 回退：简单的 Markdown 处理
    let preview = textToRender;
    preview = preview.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    preview = preview.replace(/\*(.*?)\*/g, '<em>$1</em>');
    preview = preview.replace(/`(.*?)`/g, '<code>$1</code>');
    preview = preview.replace(/\n/g, '<br>');
    
    return `<p>${preview}</p>`;
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

  // HTML 转义
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 添加帖子操作事件监听
  addPostActionListeners: function() {
    const viewButtons = document.querySelectorAll('.profile-post-action.view');
    
    viewButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const postId = e.currentTarget.dataset.id;
        this.viewPostDetails(postId);
      });
    });
  },

  // 查看帖子详情
  viewPostDetails: function(postId) {
    // 直接跳转到帖子详情页
    window.location.href = `post-detail.html?id=${postId}`;
  },

  // 设置事件监听器
  setupEventListeners: function() {
    const self = this;
    
    // 筛选按钮事件
    this.dom.filterButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        this.applyFilter(filter);
      });
    });
    
    // 图片预览模态框关闭事件
    const imageModalClose = document.querySelector('.image-modal-close');
    if (imageModalClose) {
      imageModalClose.addEventListener('click', () => {
        const modal = document.getElementById('image-modal');
        if (modal) {
          modal.style.display = 'none';
        }
      });
    }
    
    // 点击模态框背景关闭
    const imageModal = document.getElementById('image-modal');
    if (imageModal) {
      imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal) {
          imageModal.style.display = 'none';
        }
      });
    }
    
    // 关注按钮事件
    if (this.dom.followBtn) {
      this.dom.followBtn.addEventListener('click', function() {
        self.handleFollowClick();
      });
    }
    
    // 发私信按钮事件
    if (this.dom.messageBtn) {
      this.dom.messageBtn.addEventListener('click', function() {
        window.location.href = `chat.html?user=${self.state.userId}`;
      });
    }
    
    // 点击关注数
    if (this.dom.followingStat) {
      this.dom.followingStat.addEventListener('click', function() {
        self.showFollowList('following');
      });
    }
    
    // 点击粉丝数
    if (this.dom.followerStat) {
      this.dom.followerStat.addEventListener('click', function() {
        self.showFollowList('followers');
      });
    }
  },

  // 应用筛选
  applyFilter: function(filter) {
    // 更新按钮状态
    this.dom.filterButtons.forEach(button => {
      if (button.dataset.filter === filter) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
    
    // 更新筛选状态
    this.state.currentFilter = filter;
    
    // 重新渲染帖子
    this.renderUserPosts();
  },

  // 显示错误
  showError: function(message) {
    const container = this.dom.profilePostsContainer;
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>${message}</p>
          <button onclick="window.location.href='index.html'" class="post-button" style="margin-top: 20px;">
            返回首页
          </button>
        </div>
      `;
    }
    
    utils.showNotification(message, 'error');
  },

  // 更新侧边栏用户面板
  updateUserPanel: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    const usernameElement = document.getElementById('username');
    const userClassElement = document.getElementById('user-class');
    
    if (usernameElement) {
      usernameElement.textContent = currentUser.username;
    }
    
    if (userClassElement) {
      const gradeDisplay = currentUser.grade === "已毕业" ? 
        `已毕业 · ${currentUser.className}` :
        `${currentUser.grade} ${currentUser.className}`;
      userClassElement.textContent = gradeDisplay;
    }
  },

  // 显示图片预览模态框
  showImageModal: function(imageUrl) {
    const modal = document.getElementById('image-modal');
    if (!modal) return;
    
    // 设置图片并显示模态框
    modal.querySelector('.image-modal-content img').src = imageUrl;
    modal.style.display = 'flex';
  },

  // 加载关注统计数据
  loadFollowStats: async function() {
    try {
      const response = await fetch(`/api/user/profile/${this.state.userId}`);
      
      const data = await response.json();
      
      if (data.success) {
        this.state.followingCount = data.followingCount || 0;
        this.state.followerCount = data.followerCount || 0;
        
        // 更新UI
        if (this.dom.followingCount) {
          this.dom.followingCount.textContent = this.state.followingCount;
        }
        if (this.dom.followerCount) {
          this.dom.followerCount.textContent = this.state.followerCount;
        }
      }
      
      // 检查当前用户是否关注了该用户
      await this.checkFollowStatus();
      
      // 设置关注按钮显示状态
      this.setupFollowButton();
    } catch (error) {
      console.error('加载关注统计失败:', error);
    }
  },

  // 检查关注状态
  checkFollowStatus: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) {
      this.state.isCurrentUser = false;
      return;
    }
    
    // 检查是否是当前用户的个人主页
    this.state.isCurrentUser = currentUser.id === this.state.userId;
    
    if (this.state.isCurrentUser) {
      return;
    }
    
    try {
      const currentUser = userManager.state.currentUser;
      const response = await fetch(`/api/follow/status?followerId=${currentUser.id}&followingId=${this.state.userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.state.isFollowing = data.isFollowing;
          this.updateFollowButton();
        }
      }
    } catch (error) {
      console.error('检查关注状态失败:', error);
    }
  },

  // 设置关注按钮
  setupFollowButton: async function() {
    if (!this.dom.profileActions || !this.dom.followBtn) return;
    
    // 如果是当前用户的个人主页，不显示关注和私信按钮
    if (this.state.isCurrentUser) {
      this.dom.profileActions.style.display = 'none';
      return;
    }
    
    // 检查是否登录
    const currentUser = userManager.state.currentUser;
    if (!currentUser) {
      this.dom.profileActions.style.display = 'none';
      return;
    }
    
    // 检查拉黑状态
    await this.checkBlockStatus();
    
    // 显示关注和私信按钮
    this.dom.profileActions.style.display = 'block';
    if (this.dom.messageBtn) {
      this.dom.messageBtn.style.display = 'inline-flex';
    }
    
    // 添加拉黑按钮（如果不存在）
    if (!this.dom.blockBtn) {
      this.dom.blockBtn = document.createElement('button');
      this.dom.blockBtn.className = 'block-btn';
      this.dom.blockBtn.id = 'block-btn';
      this.dom.profileActions.appendChild(this.dom.blockBtn);
      
      const self = this;
      this.dom.blockBtn.addEventListener('click', function() {
        self.handleBlockClick();
      });
    }
    
    this.updateFollowButton();
    this.updateBlockButton();
  },

  // 更新关注按钮状态
  updateFollowButton: function() {
    if (!this.dom.followBtn) return;
    
    if (this.state.isFollowing) {
      this.dom.followBtn.innerHTML = '<i class="fas fa-user-check"></i> 已关注';
      this.dom.followBtn.classList.add('following');
    } else {
      this.dom.followBtn.innerHTML = '<i class="fas fa-user-plus"></i> 关注';
      this.dom.followBtn.classList.remove('following');
    }
  },

  // 处理关注按钮点击
  handleFollowClick: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) {
      utils.showNotification('请先登录', 'error');
      window.location.href = 'login.html';
      return;
    }
    
    // 防止重复点击
    if (this.dom.followBtn.classList.contains('processing')) {
      return;
    }
    
    this.dom.followBtn.classList.add('processing');
    
    try {
      // 关注使用 POST /follow，取消关注使用 POST /unfollow
      const url = this.state.isFollowing ? '/api/unfollow' : '/api/follow';
      const response = await fetch(url, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          followerId: currentUser.id,
          followingId: this.state.userId
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.state.isFollowing = data.following;
        this.updateFollowButton();
        
        // 更新粉丝数
        if (data.following) {
          this.state.followerCount++;
        } else {
          this.state.followerCount = Math.max(0, this.state.followerCount - 1);
        }
        if (this.dom.followerCount) {
          this.dom.followerCount.textContent = this.state.followerCount;
        }
        
        utils.showNotification(data.message || (data.following ? '关注成功' : '取消关注成功'), 'success');
      }
    } catch (error) {
      console.error('关注操作失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      this.dom.followBtn.classList.remove('processing');
    }
  },

  // 显示关注/粉丝列表（跳转到单独页面）
  showFollowList: function(type) {
    // 跳转到关注/粉丝列表页面
    window.location.href = `follow-list.html?id=${this.state.userId}&type=${type}`;
  },

  // 检查拉黑状态
  checkBlockStatus: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    try {
      const response = await fetch(`/api/block/status?blockerId=${currentUser.id}&blockedId=${this.state.userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.state.isBlocked = data.data?.isBlocked;
          this.state.isBlockedBy = data.data?.isBlockedBy;
        }
      }
    } catch (error) {
      console.error('检查拉黑状态失败:', error);
    }
  },

  // 更新拉黑按钮状态
  updateBlockButton: function() {
    if (!this.dom.blockBtn) return;
    
    // 如果被对方拉黑，禁用关注按钮
    if (this.state.isBlockedBy) {
      if (this.dom.followBtn) {
        this.dom.followBtn.disabled = true;
        this.dom.followBtn.innerHTML = '<i class="fas fa-ban"></i> 已被对方拉黑';
        this.dom.followBtn.classList.add('disabled');
      }
      if (this.dom.messageBtn) {
        this.dom.messageBtn.disabled = true;
        this.dom.messageBtn.classList.add('disabled');
      }
    }
    
    if (this.state.isBlocked) {
      this.dom.blockBtn.innerHTML = '<i class="fas fa-unlock"></i> 解除拉黑';
      this.dom.blockBtn.classList.add('blocked');
      this.dom.blockBtn.title = '解除拉黑后，对方可以关注您和查看您的帖子';
    } else {
      this.dom.blockBtn.innerHTML = '<i class="fas fa-ban"></i> 拉黑';
      this.dom.blockBtn.classList.remove('blocked');
      this.dom.blockBtn.title = '拉黑后，对方无法关注您或查看您的帖子';
    }
  },

  // 处理拉黑按钮点击
  handleBlockClick: async function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) {
      utils.showNotification('请先登录', 'error');
      window.location.href = 'login.html';
      return;
    }
    
    // 防止重复点击
    if (this.dom.blockBtn.classList.contains('processing')) {
      return;
    }
    
    // 确认操作
    const action = this.state.isBlocked ? '解除拉黑' : '拉黑';
    const username = this.state.userData ? this.state.userData.username : '该用户';
    if (!confirm(`确定要${action}${username}吗？`)) {
      return;
    }
    
    this.dom.blockBtn.classList.add('processing');
    
    try {
      // 拉黑使用 POST /api/block，取消拉黑使用 POST /api/unblock
      const url = this.state.isBlocked ? '/api/unblock' : '/api/block';
      const response = await fetch(url, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          blockerId: currentUser.id,
          blockedId: this.state.userId
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '操作失败');
      }
      
      const data = await response.json();
      
      if (data.success) {
        const isBlocked = data.data?.blocked;
        this.state.isBlocked = isBlocked;
        this.updateBlockButton();
        
        // 如果是拉黑操作，更新关注状态
        if (isBlocked && this.state.isFollowing) {
          this.state.isFollowing = false;
          this.updateFollowButton();
          // 拉黑时解除关注，减少的是"关注数"而非"粉丝数"
          this.state.followingCount = Math.max(0, this.state.followingCount - 1);
          if (this.dom.followingCount) {
            this.dom.followingCount.textContent = this.state.followingCount;
          }
        }
        
        utils.showNotification(data.message || (data.data?.blocked ? '拉黑成功' : '解除拉黑成功'), 'success');
      }
    } catch (error) {
      console.error('拉黑操作失败:', error);
      utils.showNotification(error.message || '操作失败', 'error');
    } finally {
      this.dom.blockBtn.classList.remove('processing');
    }
  }
};

// 将 profileManager 挂载到 window（const 声明不会自动挂到 window）
window.profileManager = profileManager;