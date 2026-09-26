// 用户管理模块
const userManager = {
  // 全局状态
  state: {
    currentUser: null,
    settings: {
      theme: 'light' // 默认主题：light（明亮）或 dark（暗色）
    },
    initialized: false, // 防止重复初始化
    messageRefreshTimer: null // 消息数量刷新定时器
  },

  // 初始化 Promise（共享，避免 init/initAsync 竞态）
  _initPromise: null,

  // DOM元素（懒加载，避免脚本解析时 DOM 尚未就绪）
  _dom: null,
  get dom() {
    if (!this._dom) {
      this._dom = {
        username: document.getElementById('username'),
        userClass: document.getElementById('user-class'),
        notificationArea: document.getElementById('notificationArea'),
        loginBtn: document.getElementById('login-btn'),
        registerBtn: document.getElementById('register-btn')
      };
    }
    return this._dom;
  },

  // 获取携带 JWT Token 的请求头（所有需要认证的 fetch 调用必须使用此函数）
  getAuthHeaders: function(skipContentType) {
    // 令牌改由 HttpOnly Cookie 传输（浏览器同源 fetch 自动携带，JS 读不到，
    // XSS 无法窃取）；不再从 localStorage 取 token 拼 Authorization
    const headers = {};
    if (!skipContentType) headers['Content-Type'] = 'application/json';
    return headers;
  },

  // 初始化（同步版本，用于快速设置事件监听器等）
  init: function() {
    // 防止重复初始化
    if (this.state.initialized) {
      console.log('userManager: 已经初始化，跳过重复初始化');
      return;
    }
    this.state.initialized = true;
    // 启动异步初始化但不阻塞
    this._initPromise = this.checkAutoLogin();
  },

  // 异步初始化（返回 Promise，等待初始化完成后再继续）
  initAsync: function() {
    // 如果已有初始化 Promise，返回它
    if (this._initPromise) {
      console.log('userManager: 等待已有初始化完成');
      return this._initPromise;
    }
    // 如果已初始化但没有 Promise（同步 init 已完成），创建空 Promise
    if (this.state.initialized) {
      console.log('userManager: 同步初始化已完成，返回 resolved Promise');
      return Promise.resolve();
    }
    // 首次初始化
    this.state.initialized = true;
    this._initPromise = this.checkAutoLogin();
    return this._initPromise;
  },

  // 检查自动登录
  checkAutoLogin: async function() {
    console.log('checkAutoLogin: 开始检查自动登录状态');
    const savedUser = localStorage.getItem('forumUser');
    console.log('checkAutoLogin: localStorage中的forumUser数据:', savedUser ? '存在' : '不存在');
    
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        console.log('checkAutoLogin: 解析用户数据成功，用户名:', user.username);
        console.log('checkAutoLogin: 用户ID:', user.id);
        console.log('checkAutoLogin: 是否为管理员:', user.isAdmin);
        
        // 向服务器验证用户状态
        const isValid = await this.verifyUserWithServer(user.id);
        
        if (!isValid) {
          console.log('checkAutoLogin: 服务器验证失败，清除登录状态');
          localStorage.removeItem('forumUser');
          this.state.currentUser = null;
          this.updateUserUI(null);
          this.updateImageUploadStatus(null);
          this.applySavedTheme();
          return;
        }
        
        this.state.currentUser = user;
        // 加载用户设置
        this.loadSettings(user);
        this.updateUserUI(user);
        utils.showNotification(`欢迎回来，${user.username}！`, 'success');
        
        // 启动消息数量刷新定时器（每60秒刷新一次）
        this.startMessageRefreshTimer();
        
        // 如果帖子管理器已初始化，重新加载帖子以更新用户状态
        if (typeof postsManager !== 'undefined' && postsManager.state.initialized) {
          console.log('checkAutoLogin: 重新加载帖子以更新用户状态');
          postsManager.loadPosts();
        }
      } catch (error) {
        console.error('checkAutoLogin: 解析用户数据失败:', error);
        // 清除无效数据
        localStorage.removeItem('forumUser');
        this.updateUserUI(null);
        this.updateImageUploadStatus(null);
        // 即使解析失败，也尝试应用保存的主题
        this.applySavedTheme();
      }
    } else {
      console.log('checkAutoLogin: 用户未登录，更新图片上传状态');
      // 未登录时也需要更新图片上传状态
      this.updateImageUploadStatus(null);
      // 即使未登录，也尝试应用之前保存的主题
      this.applySavedTheme();
    }
    console.log('checkAutoLogin: 完成');
  },

  // 向服务器验证用户状态
  verifyUserWithServer: async function(userId) {
    try {
      console.log('verifyUserWithServer: 正在验证用户状态，userId:', userId);
      
      // 携带 Authorization 头：服务端 verifyAuth 已不再信任 body.userId，
      // 身份完全来自 JWT token
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.log('verifyUserWithServer: 验证失败 -', errorData.message);
        
        // 429 接口限流：只是临时限流，保持当前登录状态，避免用户被误登出
        if (response.status === 429) {
          console.warn('verifyUserWithServer: 验证接口限流，保持当前登录状态');
          return true;
        }
        
        // 用户不存在
        if (response.status === 404) {
          utils.showNotification(errorData.message || '用户不存在，请重新登录', 'error');
        }
        return false;
      }
      
      const data = await response.json();
      console.log('verifyUserWithServer: 验证结果 -', data);
      
      if (data.success && data.valid) {
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        
        // 比较本地存储与服务器返回的关键数据是否一致
        const localUser = forumUser;
        const serverUser = data.user;
        
        // 检查关键字段是否一致
        const fieldsToCheck = ['username', 'qq', 'school', 'enrollmentYear', 'className'];
        let hasConflict = false;
        let conflictField = '';
        
        for (const field of fieldsToCheck) {
          if (localUser[field] !== serverUser[field]) {
            hasConflict = true;
            conflictField = field;
            console.log(`verifyUserWithServer: 数据不一致 - ${field}: 本地="${localUser[field]}", 服务器="${serverUser[field]}"`);
            break;
          }
        }
        
        // 检查管理员状态是否一致
        const localIsAdmin = localUser.isAdmin || false;
        const serverIsAdmin = data.isAdmin || false;
        if (localIsAdmin !== serverIsAdmin) {
          hasConflict = true;
          conflictField = 'isAdmin';
          console.log(`verifyUserWithServer: 管理员状态不一致 - 本地="${localIsAdmin}", 服务器="${serverIsAdmin}"`);
        }
        
        // 检查用户是否被禁用（使用服务器返回的 isBanned 字段）
        const isBanned = data.isBanned || serverUser.isActive === false;
        if (isBanned) {
          console.log('verifyUserWithServer: 用户已被禁用');
          // 只在首次检测到封禁时显示提示
          if (!forumUser.isBanned) {
            utils.showNotification('您的账号已被封禁，部分功能受限', 'warning');
          }
        }
        
        // 如果数据不一致，清除登录状态
        if (hasConflict) {
          console.log(`verifyUserWithServer: 检测到数据不一致(${conflictField})，清除登录状态`);
          utils.showNotification('账户信息已变更，请重新登录', 'error');
          return false;
        }
        
        // 数据一致，更新本地存储（保留本地设置和头像等非关键字段）
        const updatedUser = {
          ...forumUser,
          ...serverUser,
          isAdmin: data.isAdmin,
          isBanned: isBanned
        };
        localStorage.setItem('forumUser', JSON.stringify(updatedUser));
        this.state.currentUser = updatedUser;
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('verifyUserWithServer: 验证请求失败 -', error);
      // 网络错误时，保持登录状态但记录警告
      console.warn('verifyUserWithServer: 无法连接服务器，保持当前登录状态');
      return true;
    }
  },

  // 应用保存的主题（即使未登录）
  applySavedTheme: function() {
    try {
      const savedUser = localStorage.getItem('forumUser');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user.settings && user.settings.theme) {
          this.applyTheme(user.settings.theme);
          return;
        }
      }
      // 尝试从单独的设置中读取
      const savedTheme = localStorage.getItem('forumTheme');
      if (savedTheme) {
        this.applyTheme(savedTheme);
      }
    } catch (error) {
      console.error('applySavedTheme: 应用主题失败:', error);
    }
  },

  // 更新用户界面
  updateUserUI: function(user) {
    console.log('updateUserUI: 开始更新用户界面，用户信息:', user);
    
    // 注意：不再检查user-panel元素，因为侧边栏用户面板已被移除
    
    if (user) {
      console.log('updateUserUI: 用户已登录，用户名:', user.username);
      // 显示毕业状态
      const gradeDisplay = user.grade === "已毕业" ? 
        `已毕业 (${user.enrollmentYear}级)` : 
        `${user.school} ${user.grade} ${user.className}`;
      
      if (this.dom.username) this.dom.username.textContent = user.username;
      if (this.dom.userClass) this.dom.userClass.textContent = gradeDisplay;
      
      // 更新按钮状态
      if (this.dom.loginBtn) this.dom.loginBtn.style.display = 'none';
      if (this.dom.registerBtn) this.dom.registerBtn.style.display = 'none';
      
      // 添加消息图标按钮（带未读数徽章）- 圆形图标样式
      const existingMessageBtn = document.getElementById('message-btn');
      if (!existingMessageBtn) {
        const messageBtnWrapper = document.createElement('div');
        messageBtnWrapper.id = 'message-btn';
        messageBtnWrapper.className = 'header-icon-btn';
        messageBtnWrapper.title = '消息通知';
        messageBtnWrapper.innerHTML = `
          <a href="message.html">
            <i class="fas fa-bell"></i>
            <span class="btn-label">通知</span>
            <span id="message-badge" class="notification-badge message-badge">0</span>
          </a>
        `;
        if (document.getElementById('user-actions')) {
          document.getElementById('user-actions').appendChild(messageBtnWrapper);
        }
      } else {
        // 按钮已存在，确保徽章元素也存在
        if (!document.getElementById('message-badge')) {
          const badge = document.createElement('span');
          badge.id = 'message-badge';
          badge.className = 'notification-badge message-badge';
          badge.textContent = '0';
          existingMessageBtn.querySelector('a')?.appendChild(badge);
        }
      }
      
      // 获取未读消息数量（无论按钮是新创建还是已存在）
      this.updateUnreadMessageCount();
      
      // 添加收藏按钮 - 圆形图标样式
      if (!document.getElementById('favorites-btn')) {
        const favoritesBtnWrapper = document.createElement('div');
        favoritesBtnWrapper.id = 'favorites-btn';
        favoritesBtnWrapper.className = 'header-icon-btn';
        favoritesBtnWrapper.title = '我的收藏';
        favoritesBtnWrapper.innerHTML = `
          <a href="favorites.html">
            <i class="fas fa-star"></i>
            <span class="btn-label">收藏</span>
          </a>
        `;
        if (document.getElementById('user-actions')) {
          document.getElementById('user-actions').appendChild(favoritesBtnWrapper);
        }
      }
      
      // 添加设置按钮 - 圆形图标样式
      if (!document.getElementById('settings-btn')) {
        const settingsBtnWrapper = document.createElement('div');
        settingsBtnWrapper.id = 'settings-btn';
        settingsBtnWrapper.className = 'header-icon-btn';
        settingsBtnWrapper.title = '用户设置';
        settingsBtnWrapper.innerHTML = `
          <a href="settings.html">
            <i class="fas fa-cog"></i>
            <span class="btn-label">设置</span>
          </a>
        `;
        if (document.getElementById('user-actions')) {
          document.getElementById('user-actions').appendChild(settingsBtnWrapper);
        }
      }
    } else {
      if (this.dom.username) this.dom.username.textContent = '访客';
      if (this.dom.userClass) this.dom.userClass.textContent = '请登录查看信息';
      
      // 更新按钮状态
      if (this.dom.loginBtn) this.dom.loginBtn.style.display = 'inline-block';
      if (this.dom.registerBtn) this.dom.registerBtn.style.display = 'inline-block';
      
      // 移除消息图标按钮
      const messageBtn = document.getElementById('message-btn');
      if (messageBtn) {
        messageBtn.remove();
      }
      
      // 移除收藏按钮
      const favoritesBtn = document.getElementById('favorites-btn');
      if (favoritesBtn) {
        favoritesBtn.remove();
      }
      
      // 移除设置按钮
      const settingsBtn = document.getElementById('settings-btn');
      if (settingsBtn) {
        settingsBtn.remove();
      }
    }
    
    // 更新图片上传区域状态
    this.updateImageUploadStatus(user);
    this.fillPostFormWithUserData(user);
    
    // 更新顶栏用户头像
    this.updateHeaderUserAvatar(user);
  },

  // 更新顶栏用户头像
  updateHeaderUserAvatar: function(user) {
    console.log('updateHeaderUserAvatar: 开始更新顶栏头像，用户信息:', user);
    
    const headerAvatar = document.getElementById('header-user-avatar');
    const headerUsername = document.getElementById('header-username');
    const headerUserClass = document.getElementById('header-user-class');
    const headerLogoutBtn = document.getElementById('header-logout-btn');
    
    console.log('updateHeaderUserAvatar: 获取的元素 - headerAvatar:', headerAvatar, 'headerUsername:', headerUsername, 'headerUserClass:', headerUserClass, 'headerLogoutBtn:', headerLogoutBtn);
    
    if (headerAvatar && headerUsername && headerUserClass) {
      console.log('updateHeaderUserAvatar: 所有必需元素都存在');
      
      if (user) {
        console.log('updateHeaderUserAvatar: 用户已登录，用户名:', user.username);
        // 显示毕业状态
        const gradeDisplay = user.grade === "已毕业" ? 
          `已毕业 (${user.enrollmentYear}级)` : 
          `${user.school} ${user.grade} ${user.className}`;
        
        console.log('updateHeaderUserAvatar: 班级信息:', gradeDisplay);
        
        // 更新头像信息（用户名转义防 XSS）
        headerUsername.innerHTML = user.isAdmin ?
          `${utils.escapeHtml(user.username)} <span style="color: #dc2626; margin-left: 5px; font-size: 14px;">管理员</span>` :
          utils.escapeHtml(user.username);
        headerUserClass.textContent = gradeDisplay;
        
        // 为管理员添加特殊样式
        if (user.isAdmin) {
          headerAvatar.classList.add('admin-avatar');
        } else {
          headerAvatar.classList.remove('admin-avatar');
        }
        
        // 如果是管理员，确保管理员控制面板选项存在
        if (user.isAdmin) {
          const headerMenu = headerAvatar.querySelector('.header-user-menu');
          if (headerMenu) {
            // 检查是否已有管理员选项
            let adminOption = headerMenu.querySelector('.header-menu-item.admin-panel');
            if (!adminOption) {
              // 创建管理员控制面板选项
              adminOption = document.createElement('a');
              adminOption.href = 'admin.html';
              adminOption.className = 'header-menu-item admin-panel';
              adminOption.innerHTML = '<i class="fas fa-shield-alt"></i> 管理员控制面板';

              // 在第一个选项之前插入
              const firstOption = headerMenu.querySelector('.header-menu-item');
              if (firstOption) {
                headerMenu.insertBefore(adminOption, firstOption);
              } else {
                headerMenu.appendChild(adminOption);
              }
            }
          }
        } else {
          // 如果不是管理员，移除管理员选项
          const adminOption = headerAvatar.querySelector('.header-menu-item.admin-panel');
          if (adminOption) {
            adminOption.remove();
          }
        }

        // 添加「申请栏目」链接（所有登录用户可见）
        const headerMenuEl = headerAvatar.querySelector('.header-user-menu');
        if (headerMenuEl) {
          let applyCatLink = headerMenuEl.querySelector('.header-menu-item.apply-category');
          if (!applyCatLink) {
            applyCatLink = document.createElement('a');
            applyCatLink.href = '#';
            applyCatLink.className = 'header-menu-item apply-category';
            applyCatLink.innerHTML = '<i class="fas fa-folder-plus"></i> 申请栏目';
            applyCatLink.addEventListener('click', (e) => {
              e.preventDefault();
              if (typeof openApplyCategoryModal === 'function') {
                openApplyCategoryModal();
              }
            });
            // 插入到设置之前
            const settingsLink = headerMenuEl.querySelector('a[href="settings.html"]');
            if (settingsLink) {
              headerMenuEl.insertBefore(applyCatLink, settingsLink);
            } else {
              headerMenuEl.insertBefore(applyCatLink, headerMenuEl.firstChild);
            }
          }
        }
        
        // 设置用户头像
        if (user.avatar) {
          // 如果有自定义头像，显示图片
          if (!headerAvatar.querySelector('img')) {
            // 创建图片元素
            const avatarImg = document.createElement('img');
            avatarImg.src = user.avatar;
            avatarImg.alt = user.username;
            avatarImg.className = 'header-avatar-image';
            
            // 移除默认图标
            const defaultIcon = headerAvatar.querySelector('i.fa-user-circle');
            if (defaultIcon) {
              defaultIcon.style.display = 'none';
            }
            
            headerAvatar.appendChild(avatarImg);
          } else {
            // 更新现有图片
            const avatarImg = headerAvatar.querySelector('img');
            if (avatarImg) {
              avatarImg.src = user.avatar;
            }
          }
        } else {
          // 如果没有自定义头像，显示默认图标
          const avatarImg = headerAvatar.querySelector('img');
          if (avatarImg) {
            avatarImg.remove();
          }
          const defaultIcon = headerAvatar.querySelector('i.fa-user-circle');
          if (defaultIcon) {
            defaultIcon.style.display = 'block';
          }
        }
        
        // 显示头像
        headerAvatar.style.display = 'block';
        console.log('updateHeaderUserAvatar: 头像显示已设置为 block');
        
        // 显示更新动态按钮
        const updatesBtn = document.getElementById('header-updates-btn');
        if (updatesBtn) {
          updatesBtn.style.display = 'block';
          // 获取新帖子数量
          this.updateUpdatesCount();
        }
        
        // 显示私信按钮
        const chatBtn = document.getElementById('header-chat-btn');
        if (chatBtn) {
          chatBtn.style.display = 'block';
          // 获取私信未读数量
          this.updateChatUnreadCount();
        }
        
        // 添加头像点击事件（打开/关闭下拉菜单）
        this.setupHeaderAvatarClickEvent(headerAvatar);
        
        // 添加退出按钮事件监听
        if (headerLogoutBtn) {
          console.log('updateHeaderUserAvatar: 设置退出按钮事件监听');
          // 移除现有的事件监听器
          const newLogoutBtn = headerLogoutBtn.cloneNode(true);
          headerLogoutBtn.parentNode.replaceChild(newLogoutBtn, headerLogoutBtn);
          
          // 添加新的事件监听
          newLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.logoutUser();
          });
        }
      } else {
        console.log('updateHeaderUserAvatar: 用户未登录，隐藏头像');
        // 隐藏头像
        headerAvatar.style.display = 'none';
        
        // 隐藏更新动态按钮
        const updatesBtn = document.getElementById('header-updates-btn');
        if (updatesBtn) {
          updatesBtn.style.display = 'none';
        }
        
        // 隐藏私信按钮
        const chatBtn = document.getElementById('header-chat-btn');
        if (chatBtn) {
          chatBtn.style.display = 'none';
        }
        
        // 重置信息
        headerUsername.textContent = '用户名';
        headerUserClass.textContent = '班级信息';
        
        // 移除管理员样式
        headerAvatar.classList.remove('admin-avatar');
        
        // 移除头像点击事件
        headerAvatar.removeEventListener('click', this.handleAvatarClick);
      }
    } else {
      console.warn('updateHeaderUserAvatar: 未找到所有必需元素，无法更新顶栏头像');
      console.warn('headerAvatar:', headerAvatar, 'headerUsername:', headerUsername, 'headerUserClass:', headerUserClass);
    }
  },

  // 设置顶栏头像点击事件
  setupHeaderAvatarClickEvent: function(headerAvatar) {
    console.log('setupHeaderAvatarClickEvent: 设置头像点击事件');
    
    // 移除现有的事件监听器，防止重复绑定
    headerAvatar.removeEventListener('click', this.handleAvatarClick);
    
    // 定义点击处理函数
    this.handleAvatarClick = function(e) {
      console.log('头像被点击，当前active状态:', headerAvatar.classList.contains('active'));
      e.stopPropagation(); // 防止事件冒泡
      
      // 切换active类
      if (headerAvatar.classList.contains('active')) {
        headerAvatar.classList.remove('active');
        console.log('下拉菜单已关闭');
      } else {
        // 关闭其他可能打开的下拉菜单
        const allActiveAvatars = document.querySelectorAll('.header-user-avatar.active');
        allActiveAvatars.forEach(avatar => {
          if (avatar !== headerAvatar) {
            avatar.classList.remove('active');
          }
        });
        
        headerAvatar.classList.add('active');
        console.log('下拉菜单已打开');
      }
    };
    
    // 绑定点击事件
    headerAvatar.addEventListener('click', this.handleAvatarClick);
    
    // 点击页面其他地方关闭下拉菜单
    if (!this.documentClickHandler) {
      this.documentClickHandler = function(e) {
        // 如果点击的不是头像或下拉菜单内部
        const isClickInsideAvatar = headerAvatar.contains(e.target);
        const isClickInsideDropdown = headerAvatar.querySelector('.header-user-dropdown')?.contains(e.target);
        
        if (!isClickInsideAvatar && !isClickInsideDropdown) {
          headerAvatar.classList.remove('active');
        }
      };
      
      // 添加全局点击事件监听器
      document.addEventListener('click', this.documentClickHandler);
    }
    
    console.log('setupHeaderAvatarClickEvent: 点击事件设置完成');
  },

  // 使用用户数据填充发帖表单
  fillPostFormWithUserData: function(user) {
    const userInfoDisplay = document.getElementById('user-info-display');
    if (!userInfoDisplay) return;

    if (!user) {
      userInfoDisplay.style.display = 'none';
      return;
    }
    
    // 转义用户字段防 XSS
    const esc = (s) => utils.escapeHtml(s);
    userInfoDisplay.innerHTML = `
      <div class="form-group">
        <label>您的身份信息</label>
        <div class="user-info-card">
          <div class="user-info-avatar clickable-avatar" id="user-info-avatar" title="点击查看个人主页" ${user.avatar ? `style="background-image: url('${esc(user.avatar)}'); background-size: cover; background-position: center;"` : ''}>
            ${!user.avatar ? (user.className ? esc(user.className).slice(0,1) : '?') : ''}
          </div>
          <div class="user-info-details">
            <div class="user-info-name">${esc(user.username)}</div>
            <div class="user-info-class">
              ${user.grade === "已毕业" ? 
                `已毕业 · ${esc(user.school)} ${esc(String(user.enrollmentYear))}级 ${esc(user.className)}` :
                `${esc(user.school)} · ${esc(user.grade)} ${esc(user.className)}`
              }
            </div>
          </div>
        </div>
      </div>
      <div class="user-info-note">
        <i class="fas fa-info-circle"></i> 发帖时将使用您的注册信息
      </div>
    `;
    userInfoDisplay.style.display = 'block';
    
    // 为头像添加点击事件
    const userInfoAvatar = document.getElementById('user-info-avatar');
    if (userInfoAvatar) {
      userInfoAvatar.addEventListener('click', () => {
        window.location.href = `profile.html?id=${user.id}`;
      });
    }
  },

  // 更新上传区域状态
  updateImageUploadStatus: function(user) {
    // 图片上传区域
    const imageUploadArea = document.getElementById('image-upload-area');
    const imageUpload = document.getElementById('image-upload');
    
    if (imageUploadArea && imageUpload) {
      if (!user) {
        // 未登录时禁用图片上传
        imageUploadArea.classList.add('disabled');
        imageUploadArea.title = '请先登录后再上传图片';
        imageUpload.disabled = true;
      } else {
        // 登录时启用图片上传
        imageUploadArea.classList.remove('disabled');
        imageUploadArea.title = '';
        imageUpload.disabled = false;
      }
    }
    
    // 文本文件上传区域
    const textUploadArea = document.getElementById('text-upload-area');
    const textFileUpload = document.getElementById('text-file-upload');
    
    if (textUploadArea && textFileUpload) {
      if (!user) {
        // 未登录时禁用文本文件上传
        textUploadArea.classList.add('disabled');
        textUploadArea.title = '请先登录后再上传文件';
        textFileUpload.disabled = true;
      } else {
        // 登录时启用文本文件上传
        textUploadArea.classList.remove('disabled');
        textUploadArea.title = '点击上传文本文件';
        textFileUpload.disabled = false;
      }
    }
  },

  // 用户退出
  logoutUser: function() {
    // 停止消息刷新定时器
    this.stopMessageRefreshTimer();

    // 通知服务端登出：令牌在 HttpOnly Cookie 里，前端无法自行清除，
    // 必须由服务端 Set-Cookie 过期（同时把令牌加入黑名单）。失败不阻塞本地清理。
    fetch('/api/logout', { method: 'POST', headers: this.getAuthHeaders() }).catch(() => {});

    // 清除本地存储（令牌已不在 localStorage，这里做兼容清理）
    localStorage.removeItem('forumUser');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('adminToken');

    // 重置状态
    this.state.currentUser = null;

    // 更新UI
    this.updateUserUI(null);

    // 重新加载帖子（仅在 postsManager 存在时）
    if (typeof postsManager !== 'undefined' && postsManager.loadPosts) {
      postsManager.loadPosts();
    }

    // 显示通知
    utils.showNotification('您已成功退出登录', 'success');
  },

  // 设置事件监听器（用于首页的登录/注册按钮）
  setupEventListeners: function() {
    console.log('setupEventListeners: 开始设置按钮事件监听器');
    
    // 确定登录页面路径（根据当前页面位置）
    const isInSubdir = window.location.pathname.includes('/errors/') || 
                       window.location.pathname.includes('/public/');
    const loginPath = isInSubdir ? '../login.html' : 'login.html';
    
    // 动态获取登录按钮
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    
    console.log('setupEventListeners: loginBtn 元素:', loginBtn);
    console.log('setupEventListeners: registerBtn 元素:', registerBtn);
    console.log('setupEventListeners: 登录路径:', loginPath);
    
    // 登录按钮
    if (loginBtn) {
      console.log('setupEventListeners: 为登录按钮添加事件监听器');
      loginBtn.addEventListener('click', (e) => {
        console.log('登录按钮被点击');
        e.preventDefault();
        window.location.href = loginPath;
      });
    } else {
      console.warn('setupEventListeners: 未找到登录按钮元素');
    }
    
    // 注册按钮
    if (registerBtn) {
      console.log('setupEventListeners: 为注册按钮添加事件监听器');
      registerBtn.addEventListener('click', (e) => {
        console.log('注册按钮被点击');
        e.preventDefault();
        window.location.href = loginPath + '?register=true';
      });
    } else {
      console.warn('setupEventListeners: 未找到注册按钮元素');
    }
    
    console.log('setupEventListeners: 事件监听器设置完成');

    // 初始化搜索功能（所有页面通用）
    this.setupSearch();
  },

  // 设置搜索功能（所有页面通用）
  setupSearch: function() {
    // 主页由 posts.js 处理搜索，跳过
    // categories.html 由 categories.js 处理本地搜索，跳过
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/') ||
        window.location.pathname.endsWith('categories.html')) {
      return;
    }

    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    const searchBtn = document.getElementById('search-btn');
    const searchHistory = document.getElementById('search-history');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    // 如果页面没有搜索框，跳过
    if (!searchInput) return;

    // 搜索历史配置
    const SEARCH_HISTORY_KEY = 'forum_search_history';
    const MAX_HISTORY_ITEMS = 10;

    // 加载搜索历史
    const loadSearchHistory = () => {
      try {
        return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
      } catch {
        return [];
      }
    };

    // 保存搜索历史
    const saveSearchHistory = (keyword) => {
      if (!keyword) return;
      let history = loadSearchHistory().filter(h => h !== keyword);
      history.unshift(keyword);
      if (history.length > MAX_HISTORY_ITEMS) {
        history = history.slice(0, MAX_HISTORY_ITEMS);
      }
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
    };

    // 渲染搜索历史
    const renderSearchHistory = () => {
      if (!searchHistory) return;
      const listEl = document.getElementById('search-history-list');
      if (!listEl) return;

      const history = loadSearchHistory();
      if (history.length === 0) {
        listEl.innerHTML = '<div class="search-empty-history">暂无搜索历史</div>';
        return;
      }

      listEl.innerHTML = history.map(keyword => `
        <div class="history-item" data-keyword="${escapeHtml(keyword)}">
          <div class="history-item-left">
            <i class="fas fa-history"></i>
            <span>${escapeHtml(keyword)}</span>
          </div>
          <button class="history-item-delete" data-keyword="${escapeHtml(keyword)}">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `).join('');
    };

    // 显示搜索历史
    const showSearchHistory = () => {
      if (searchHistory) {
        renderSearchHistory();
        searchHistory.style.display = 'block';
      }
    };

    // 隐藏搜索历史
    const hideSearchHistory = () => {
      if (searchHistory) {
        searchHistory.style.display = 'none';
      }
    };

    // 执行搜索
    const doSearch = (keyword) => {
      const trimmed = keyword.trim();
      if (trimmed) {
        saveSearchHistory(trimmed);
      }
      hideSearchHistory();
      // 跳转到首页并带上搜索参数
      window.location.href = `index.html?search=${encodeURIComponent(trimmed)}`;
    };

    // 清除搜索
    const clearSearch = () => {
      searchInput.value = '';
      if (searchClearBtn) searchClearBtn.style.display = 'none';
      hideSearchHistory();
    };

    // 删除单条历史
    const deleteHistoryItem = (keyword) => {
      let history = loadSearchHistory().filter(h => h !== keyword);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
      renderSearchHistory();
    };

    // 清空所有历史
    const clearAllHistory = () => {
      localStorage.removeItem(SEARCH_HISTORY_KEY);
      renderSearchHistory();
    };

    // HTML 转义
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    // 输入事件
    searchInput.addEventListener('input', function() {
      if (searchClearBtn) {
        searchClearBtn.style.display = this.value ? 'flex' : 'none';
      }
    });

    // 聚焦时显示搜索历史
    searchInput.addEventListener('focus', showSearchHistory);

    // 回车搜索
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        doSearch(this.value);
      }
    });

    // 搜索按钮
    if (searchBtn) {
      searchBtn.addEventListener('click', function() {
        doSearch(searchInput.value);
      });
    }

    // 清除按钮
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        clearSearch();
      });
    }

    // 清空历史按钮
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        clearAllHistory();
      });
    }

    // 点击历史项
    if (searchHistory) {
      searchHistory.addEventListener('click', function(e) {
        const deleteBtn = e.target.closest('.history-item-delete');
        if (deleteBtn) {
          e.stopPropagation();
          deleteHistoryItem(deleteBtn.dataset.keyword);
          return;
        }

        const historyItem = e.target.closest('.history-item');
        if (historyItem) {
          searchInput.value = historyItem.dataset.keyword;
          doSearch(historyItem.dataset.keyword);
        }
      });
    }

    // 点击外部关闭历史
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-box-wrapper')) {
        hideSearchHistory();
      }
    });
  },

  // 应用主题
  applyTheme: function(theme) {
    const root = document.documentElement;
    
    // 定义主题变量（与 style.css :root 设计体系一致：校园蓝 + 直角；
    // 浅色 = style.css 默认值，深色 = 同色相暗色变体）
    const themes = {
      light: {
        '--primary-color': '#2b6cb0',
        '--primary-light': '#ebf4fc',
        '--primary-dark': '#245a94',
        '--secondary-color': '#1e4e79',
        '--text-color': '#1f2328',
        '--text-light': '#57606a',
        '--text-muted': '#8c959f',
        '--background-light': '#f6f7f8',
        '--background-card': '#ffffff',
        '--background-hover': '#f0f1f2',
        '--border-color': '#e4e6e8',
        '--border-light': '#f0f1f2',
        '--success-color': '#2f9e44',
        '--success-dark': '#2b8a3e',
        '--error-color': '#e03131',
        '--error-dark': '#c92a2a',
        '--warning-color': '#f08c00',
        '--warning-dark': '#e8590c',
        '--info-color': '#1971c2',
        '--info-dark': '#1864ab',
        '--favorite-color': '#e67700',
        '--favorite-dark': '#d9480f',
        '--dislike-color': '#d6336c',
        '--dislike-dark': '#c2255c',
        '--icon-color': '#57606a',
        '--shadow': '0 1px 3px rgba(0, 0, 0, 0.07)',
        '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
        '--shadow-md': '0 2px 8px rgba(0, 0, 0, 0.08)',
        '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.10)',
        '--code-bg': '#f6f8fa',
        '--inline-code-bg': '#f0f2f4',
        '--code-border': '#e4e6e8',
        '--code-header-bg': '#2f3a45',
        '--code-text': '#1f2328',
        '--button-text': '#ffffff'
      },
      dark: {
        '--primary-color': '#5a9bdd',
        '--primary-light': '#1e2f42',
        '--primary-dark': '#6fabe2',
        '--secondary-color': '#4a7fa8',
        '--text-color': '#e2e8f0',
        '--text-light': '#94a3b8',
        '--text-muted': '#64748b',
        '--background-light': '#0f172a',
        '--background-card': '#1e293b',
        '--background-hover': '#2a3648',
        '--border-color': '#334155',
        '--border-light': '#2a3648',
        '--success-color': '#4ade80',
        '--success-dark': '#2f9e44',
        '--error-color': '#ff6b6b',
        '--error-dark': '#e03131',
        '--warning-color': '#fbbf24',
        '--warning-dark': '#f08c00',
        '--info-color': '#60a5fa',
        '--info-dark': '#1971c2',
        '--favorite-color': '#fbbf24',
        '--favorite-dark': '#e67700',
        '--dislike-color': '#f472b6',
        '--dislike-dark': '#d6336c',
        '--icon-color': '#94a3b8',
        '--shadow': '0 1px 3px rgba(0, 0, 0, 0.3)',
        '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.25)',
        '--shadow-md': '0 2px 8px rgba(0, 0, 0, 0.35)',
        '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.4)',
        '--code-bg': '#1e1e1e',
        '--inline-code-bg': '#2d2d2d',
        '--code-border': '#404040',
        '--code-header-bg': '#252526',
        '--code-text': '#d4d4d4',
        '--button-text': '#ffffff'
      }
    };
    
    const themeVars = themes[theme] || themes.light;
    
    // 设置 data-theme 属性（用于CSS选择器）
    root.setAttribute('data-theme', theme);
    
    // 应用CSS变量
    Object.entries(themeVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    
    // 保存主题到状态
    this.state.settings.theme = theme;
    
    // 保存到localStorage（同时保存到单独的key以便未登录时也能应用）
    localStorage.setItem('forumTheme', theme);
    
    const currentUser = this.state.currentUser;
    if (currentUser) {
      const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
      forumUser.settings = forumUser.settings || {};
      forumUser.settings.theme = theme;
      localStorage.setItem('forumUser', JSON.stringify(forumUser));
    }
    
    // 触发主题更改事件
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  },

  // 加载用户设置
  loadSettings: function(user) {
    if (!user) return;
    
    // 合并用户设置
    if (user.settings) {
      Object.assign(this.state.settings, user.settings);
    }
    
    // 应用保存的主题
    if (this.state.settings.theme) {
      this.applyTheme(this.state.settings.theme);
    }
  },

  // 保存设置到服务器
  async saveSettings(settings) {
    const currentUser = this.state.currentUser;
    if (!currentUser) {
      utils.showNotification('请先登录后再修改设置', 'error');
      return false;
    }
    
    try {
      const response = await fetch(`/api/users/${currentUser.id}/settings`, {
        method: 'PUT',
        headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存设置失败');
      }
      
      const data = await response.json();
      
      // 更新本地存储的用户数据
      if (data.success && data.user) {
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        forumUser.settings = forumUser.settings || {};
        Object.assign(forumUser.settings, settings);
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        
        // 更新当前用户状态
        this.state.currentUser.settings = forumUser.settings;
        
        utils.showNotification('设置保存成功', 'success');
        return true;
      }
    } catch (error) {
      console.error('保存设置失败:', error);
      utils.showNotification(error.message || '保存设置失败', 'error');
      return false;
    }
  },

  // 更新设置
  async updateSettings(newSettings) {
    // 合并新设置
    Object.assign(this.state.settings, newSettings);
    
    // 立即应用主题更改
    if (newSettings.theme !== undefined) {
      this.applyTheme(newSettings.theme);
    }
    
    // 保存到服务器
    return await this.saveSettings(this.state.settings);
  },

  // 更新用户头像
  updateUserAvatar: function(avatarUrl) {
    console.log('updateUserAvatar: 更新用户头像', avatarUrl);
    
    if (!this.state.currentUser) {
      console.warn('updateUserAvatar: 用户未登录');
      return;
    }
    
    // 更新当前用户状态
    this.state.currentUser.avatar = avatarUrl;
    
    // 更新本地存储
    const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
    forumUser.avatar = avatarUrl;
    localStorage.setItem('forumUser', JSON.stringify(forumUser));
    
    // 更新顶栏头像显示
    this.updateHeaderUserAvatar(this.state.currentUser);
    
    // 更新所有显示头像的元素
    this.updateAllUserAvatars(avatarUrl);
  },

  // 更新所有用户头像显示
  updateAllUserAvatars: function(avatarUrl) {
    if (!this.state.currentUser) {
      return;
    }
    
    // 调用 updateHeaderUserAvatar 来更新顶栏头像
    this.updateHeaderUserAvatar(this.state.currentUser);
    
    // 更新用户信息区域头像（如果存在）
    const userInfoAvatar = document.getElementById('user-info-avatar');
    if (userInfoAvatar) {
      if (avatarUrl) {
        userInfoAvatar.style.backgroundImage = `url(${avatarUrl})`;
      } else {
        userInfoAvatar.style.backgroundImage = '';
      }
    }
  },

  // 获取并更新未读消息数量
  updateUnreadMessageCount: async function() {
    const currentUser = this.state.currentUser;
    if (!currentUser) {
      console.log('updateUnreadMessageCount: 用户未登录');
      this.setMessageBadge(0);
      return;
    }
    
    try {
      console.log('updateUnreadMessageCount: 正在获取未读消息数量, userId:', currentUser.id);
      const response = await fetch(`/api/notifications`, {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        console.error('updateUnreadMessageCount: 获取消息失败');
        return;
      }
      
      const data = await response.json();
      console.log('updateUnreadMessageCount: API返回数据:', data);
      
      // API返回格式: {success: true, notifications: [...]}
      if (data.success && data.notifications) {
        const unreadCount = data.notifications.filter(n => !n.read).length;
        console.log('updateUnreadMessageCount: 未读消息数量:', unreadCount);
        this.setMessageBadge(unreadCount);
      } else {
        console.log('updateUnreadMessageCount: 数据格式不符');
      }
    } catch (error) {
      console.error('updateUnreadMessageCount: 获取未读消息数量失败:', error);
    }
  },

  // 设置消息徽章
  setMessageBadge: function(count) {
    const badge = document.getElementById('message-badge');
    console.log('setMessageBadge: 徽章元素:', badge, '数量:', count);
    
    if (!badge) {
      console.warn('setMessageBadge: 找不到徽章元素');
      return;
    }
    
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
      console.log('setMessageBadge: 显示徽章');
    } else {
      badge.style.display = 'none';
      console.log('setMessageBadge: 隐藏徽章');
    }
  },

  // 启动消息数量刷新定时器
  startMessageRefreshTimer: function() {
    console.log('startMessageRefreshTimer: 启动消息刷新定时器');
    
    // 先停止已有的定时器
    this.stopMessageRefreshTimer();
    
    // 立即刷新一次
    this.updateUnreadMessageCount();
    this.updateUpdatesCount();
    this.updateChatUnreadCount();
    
    // 每60秒刷新一次
    this.state.messageRefreshTimer = setInterval(() => {
      console.log('startMessageRefreshTimer: 定时刷新消息数量');
      this.updateUnreadMessageCount();
      this.updateUpdatesCount();
      this.updateChatUnreadCount();
    }, 60000);
    
    console.log('startMessageRefreshTimer: 定时器已启动');
  },

  // 停止消息数量刷新定时器
  stopMessageRefreshTimer: function() {
    if (this.state.messageRefreshTimer) {
      clearInterval(this.state.messageRefreshTimer);
      this.state.messageRefreshTimer = null;
    }
  },

  // 获取并更新关注用户的新帖子数量
  updateUpdatesCount: async function() {
    const currentUser = this.state.currentUser;
    if (!currentUser) {
      console.log('updateUpdatesCount: 用户未登录');
      this.setUpdatesBadge(0);
      return;
    }
    
    try {
      console.log('updateUpdatesCount: 正在获取新帖子数量, userId:', currentUser.id);
      const response = await fetch(`/api/stats`);
      if (!response.ok) {
        console.error('updateUpdatesCount: 获取新帖子数量失败');
        return;
      }
      
      const data = await response.json();
      console.log('updateUpdatesCount: API返回数据:', data);
      
      if (data.success) {
        const count = data.count || 0;
        console.log('updateUpdatesCount: 新帖子数量:', count);
        this.setUpdatesBadge(count);
      }
    } catch (error) {
      console.error('updateUpdatesCount: 获取新帖子数量失败:', error);
    }
  },

  // 设置更新动态徽章
  setUpdatesBadge: function(count) {
    const badge = document.getElementById('updates-badge');
    console.log('setUpdatesBadge: 徽章元素:', badge, '数量:', count);
    
    if (!badge) {
      console.warn('setUpdatesBadge: 找不到徽章元素');
      return;
    }
    
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
      console.log('setUpdatesBadge: 显示徽章');
    } else {
      badge.style.display = 'none';
      console.log('setUpdatesBadge: 隐藏徽章');
    }
  },

  // 获取私信未读数量
  updateChatUnreadCount: async function() {
    const currentUser = this.state.currentUser;
    if (!currentUser) {
      console.log('updateChatUnreadCount: 用户未登录');
      this.setChatBadge(0);
      return;
    }
    
    try {
      const response = await fetch(`/api/messages/unread`, {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        console.error('updateChatUnreadCount: 获取私信未读数量失败');
        return;
      }
      
      const data = await response.json();
      console.log('updateChatUnreadCount: API返回数据:', data);
      
      if (data.success) {
        const count = data.unreadCount || 0;
        console.log('updateChatUnreadCount: 私信未读数量:', count);
        this.setChatBadge(count);
      }
    } catch (error) {
      console.error('updateChatUnreadCount: 获取私信未读数量失败:', error);
    }
  },

  // 设置私信徽章
  setChatBadge: function(count) {
    const badge = document.getElementById('chat-badge');
    console.log('setChatBadge: 徽章元素:', badge, '数量:', count);
    
    if (!badge) {
      console.warn('setChatBadge: 找不到徽章元素');
      return;
    }
    
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
      console.log('setChatBadge: 显示徽章');
    } else {
      badge.style.display = 'none';
      console.log('setChatBadge: 隐藏徽章');
    }
  }
};

// 将 userManager 挂载到 window，使所有页面脚本都能通过 window.userManager 访问
// （const 声明不会自动挂到 window，需要显式挂载）
window.userManager = userManager;