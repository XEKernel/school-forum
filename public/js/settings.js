// 设置页面管理模块
console.log('settings.js 文件开始加载...');

const settingsManager = {
  // 状态
  state: {
    currentTheme: 'light',
    isSaving: false,
    initialSettings: null,
    // 密码修改多步骤状态
    passwordChange: {
      currentStep: 1,
      currentPassword: '',
      isCodeVerified: false,
      sendCodeCountdown: 0
    },
    // 邮箱修改多步骤状态
    emailChange: {
      currentStep: 1,
      currentPassword: '',
      newEmail: '',
      isCodeVerified: false,
      sendCodeCountdown: 0
    },
    // QQ号修改状态
    qqChange: {
      currentStep: 1
    },
    // 学校配置
    schools: [],
    // 当前用户的学校信息
    currentSchoolInfo: {
      school: '',
      enrollmentYear: null,
      className: ''
    }
  },

  // DOM元素
  dom: {},

  // 初始化
  init: function() {
    console.log('settingsManager.init called');
    console.log('userManager.state.currentUser:', userManager.state.currentUser);
    console.log('userManager.state.settings:', userManager.state.settings);
    
    // 获取 DOM 元素
    this.dom = {
      themeOptions: document.querySelectorAll('.theme-option'),
      applyThemeBtn: document.getElementById('apply-theme'),
      resetThemeBtn: document.getElementById('reset-theme'),
      accountForm: document.getElementById('account-form'),
      saveAccountBtn: document.getElementById('save-account'),
      cancelAccountBtn: document.getElementById('cancel-account'),
      usernameInput: document.getElementById('username'),
      signatureInput: document.getElementById('signature'),
      signatureCount: document.getElementById('signature-count'),
      currentPasswordInput: document.getElementById('current-password'),
      newPasswordInput: document.getElementById('new-password'),
      confirmPasswordInput: document.getElementById('confirm-password'),
      sidebarUsername: document.getElementById('sidebar-username'),
      sidebarUserClass: document.getElementById('sidebar-user-class'),
      avatarUploadInput: document.getElementById('avatar-upload'),
      uploadAvatarBtn: document.getElementById('upload-avatar-btn'),
      removeAvatarBtn: document.getElementById('remove-avatar-btn'),
      avatarPreview: document.getElementById('avatar-preview'),
      avatarOverlay: document.querySelector('.avatar-overlay'),
      // 密码修改多步骤相关元素
      verifyCurrentPasswordBtn: document.getElementById('verify-current-password-btn'),
      sendPasswordCodeBtn: document.getElementById('send-password-code-btn'),
      verifyCodeBtn: document.getElementById('verify-code-btn'),
      changePasswordBtn: document.getElementById('change-password-btn'),
      backToStep1Btn: document.getElementById('back-to-step-1-btn'),
      backToStep2Btn: document.getElementById('back-to-step-2-btn'),
      resetPasswordFormBtn: document.getElementById('reset-password-form-btn'),
      passwordVerificationCodeInput: document.getElementById('password-verification-code'),
      userEmailDisplay: document.getElementById('user-email-display'),
      passwordSteps: document.querySelectorAll('.password-steps .step'),
      // 隐私设置相关元素
      hideBlockedPosts: document.getElementById('hide-blocked-posts'),
      hideBlockedComments: document.getElementById('hide-blocked-comments'),
      savePrivacyBtn: document.getElementById('save-privacy'),
      // 通知设置相关元素
      notifyLike: document.getElementById('notify-like'),
      notifyComment: document.getElementById('notify-comment'),
      notifyCommentReply: document.getElementById('notify-commentReply'),
      notifyCommentLike: document.getElementById('notify-commentLike'),
      notifyFollow: document.getElementById('notify-follow'),
      saveNotificationsBtn: document.getElementById('save-notifications'),
      // 个人信息修改相关元素
      settingsSchool: document.getElementById('settings-school'),
      settingsEnrollmentYear: document.getElementById('settings-enrollment-year'),
      settingsClass: document.getElementById('settings-class'),
      settingsBirthday: document.getElementById('settings-birthday'),
      settingsGender: document.getElementById('settings-gender'),
      savePersonalInfoBtn: document.getElementById('save-personal-info'),
      // 邮箱修改相关元素
      emailChangePassword: document.getElementById('email-change-password'),
      newEmail: document.getElementById('new-email'),
      emailVerificationCode: document.getElementById('email-verification-code'),
      verifyEmailPasswordBtn: document.getElementById('verify-email-password-btn'),
      resendEmailCodeBtn: document.getElementById('resend-email-code-btn'),
      verifyEmailCodeBtn: document.getElementById('verify-email-code-btn'),
      backToEmailStep1Btn: document.getElementById('back-to-email-step-1-btn'),
      resetEmailFormBtn: document.getElementById('reset-email-form-btn'),
      newEmailDisplay: document.getElementById('new-email-display'),
      updatedEmailDisplay: document.getElementById('updated-email-display'),
      emailStepLine2: document.getElementById('email-step-line-2'),
      emailStep3Indicator: document.getElementById('email-step-3-indicator'),
      // QQ号修改相关元素
      qqChangePassword: document.getElementById('qq-change-password'),
      newQQ: document.getElementById('new-qq'),
      verifyQQPasswordBtn: document.getElementById('verify-qq-password-btn'),
      resetQQFormBtn: document.getElementById('reset-qq-form-btn'),
      updatedQQDisplay: document.getElementById('updated-qq-display'),
      qqStepLine1: document.getElementById('qq-step-line-1'),
      qqStep2Indicator: document.getElementById('qq-step-2-indicator')
    };
    
    console.log('DOM 元素获取完成:', this.dom);
    
    // 检查用户是否登录
    if (!userManager.state.currentUser) {
      // 显示警告通知
      utils.showNotification('您尚未登录，设置功能需要登录后才能使用', 'error', 5000);
      
      // 在设置内容顶部添加登录警告横幅
      const settingsContent = document.querySelector('.settings-content');
      if (settingsContent) {
        const warningBanner = document.createElement('div');
        warningBanner.className = 'login-warning-banner';
        warningBanner.innerHTML = `
          <div class="warning-banner-content">
            <i class="fas fa-exclamation-circle"></i>
            <div class="warning-text">
              <h3>需要登录</h3>
              <p>设置功能需要登录后才能使用。请先登录您的账户。</p>
            </div>
            <div class="warning-actions">
              <a href="login.html" class="settings-button primary small">
                <i class="fas fa-sign-in-alt"></i> 立即登录
              </a>
              <a href="index.html" class="settings-button secondary small">
                <i class="fas fa-home"></i> 返回首页
              </a>
            </div>
          </div>
        `;
        
        // 插入到设置内容顶部
        if (settingsContent.firstChild) {
          settingsContent.insertBefore(warningBanner, settingsContent.firstChild);
        } else {
          settingsContent.appendChild(warningBanner);
        }
      }
      
      // 不返回，继续初始化，让用户可以看到设置界面但不能修改
      // 功能会在用户尝试操作时显示错误消息
    }
    
    // 加载当前设置
    this.loadCurrentSettings();
    
    // 设置事件监听器
    this.setupEventListeners();
    
    // 初始化表单
    this.initForm();
    
    // 加载学校配置（异步，加载完成后会自动填充个人信息）
    this.loadSchoolsConfig();
    
    // 加载 QQ 绑定状态
    this.loadQqBindStatus();
    
    // 标记初始化完成
    console.log('settingsManager 初始化完成');
  },

  /**
   * 加载 QQ 绑定状态并渲染绑定卡片
   */
  loadQqBindStatus: function() {
    const container = document.getElementById('qq-bind-status');
    if (!container) return;

    if (!userManager || !userManager.state || !userManager.state.currentUser) {
      container.innerHTML = '<div class="qq-bind-loading"><i class="fas fa-exclamation-circle"></i> 请先登录</div>';
      return;
    }

    fetch('/api/auth/qq/bind-status', {
      headers: userManager.getAuthHeaders()
    })
      .then(resp => resp.json())
      .then(data => {
        if (!data.success) {
          container.innerHTML = `<div class="qq-bind-loading"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(data.message || '查询失败')}</div>`;
          return;
        }
        if (!data.configured) {
          container.innerHTML = '<div class="qq-bind-loading"><i class="fas fa-info-circle"></i> QQ 登录尚未配置，请联系管理员</div>';
          return;
        }
        if (data.qqBound) {
          container.innerHTML = `
            <div class="qq-bind-bound">
              <div class="qq-bind-info">
                <i class="fab fa-qq qq-bind-icon"></i>
                <div>
                  <strong>已绑定 QQ</strong>
                  <span>可通过 QQ 快捷登录本账号${data.qqPlaceholder ? '（QQ 快捷注册账号）' : ''}</span>
                </div>
              </div>
              <button type="button" class="settings-button secondary" id="unbind-qq-btn">
                <i class="fas fa-unlink"></i> 解绑 QQ
              </button>
            </div>`;
          document.getElementById('unbind-qq-btn').addEventListener('click', () => this.unbindQq());
        } else {
          container.innerHTML = `
            <div class="qq-bind-unbound">
              <div class="qq-bind-info">
                <i class="fab fa-qq qq-bind-icon"></i>
                <div>
                  <strong>未绑定 QQ</strong>
                  <span>绑定后可使用 QQ 一键登录</span>
                </div>
              </div>
              <button type="button" class="settings-button primary" id="bind-qq-btn">
                <i class="fab fa-qq"></i> 绑定 QQ
              </button>
            </div>`;
          document.getElementById('bind-qq-btn').addEventListener('click', () => this.bindQq());
        }
      })
      .catch(err => {
        console.error('查询QQ绑定状态失败:', err);
        container.innerHTML = '<div class="qq-bind-loading"><i class="fas fa-exclamation-circle"></i> 查询失败，请刷新重试</div>';
      });
  },

  /**
   * 发起 QQ 绑定（跳转授权）
   */
  bindQq: function() {
    fetch('/api/auth/qq/authorize-url-bind?type=bind', {
      headers: userManager.getAuthHeaders()
    })
      .then(resp => resp.json())
      .then(data => {
        if (!data.success) {
          alert(data.message || 'QQ 绑定失败');
          return;
        }
        window.location.href = data.url;
      })
      .catch(err => {
        console.error('QQ 绑定失败:', err);
        alert('QQ 绑定失败，请稍后重试');
      });
  },

  /**
   * 解绑 QQ
   */
  unbindQq: function() {
    if (!confirm('确定要解绑 QQ 吗？解绑后将无法通过 QQ 快捷登录本账号。')) return;
    fetch('/api/auth/qq/unbind', {
      method: 'POST',
      headers: userManager.getAuthHeaders()
    })
      .then(resp => resp.json())
      .then(data => {
        if (data.success) {
          alert('QQ 解绑成功');
          this.loadQqBindStatus();
        } else {
          alert(data.message || '解绑失败');
        }
      })
      .catch(err => {
        console.error('QQ 解绑失败:', err);
        alert('QQ 解绑失败，请稍后重试');
      });
  },

  /**
   * HTML 转义
   */
  escapeHtml: function(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // 加载当前设置
  loadCurrentSettings: function() {
    console.log('loadCurrentSettings called');
    
    // 检查用户是否登录
    const currentUser = userManager.state.currentUser;
    
    if (currentUser) {
      // 从userManager获取当前设置
      const userSettings = userManager.state.settings;
      this.state.initialSettings = { ...userSettings };
      
      // 设置当前主题
      this.state.currentTheme = userSettings.theme || 'light';
      
      // 更新主题选项UI
      this.updateThemeSelection();
      
      // 填充表单数据
      this.fillFormData();
      
      // 更新侧边栏用户信息
      this.updateSidebarUserInfo();
      
      // 更新头像预览
      this.updateAvatarPreview();
    } else {
      // 用户未登录，使用默认设置
      this.state.initialSettings = { theme: 'light' };
      this.state.currentTheme = 'light';
      
      // 更新主题选项UI
      this.updateThemeSelection();
      
      // 清空表单数据
      this.fillFormData();
      
      // 更新侧边栏为访客状态
      this.updateSidebarUserInfo();
    }
  },

  // 更新侧边栏用户信息
  updateSidebarUserInfo: function() {
    const currentUser = userManager.state.currentUser;
    
    if (currentUser && this.dom.sidebarUsername && this.dom.sidebarUserClass) {
      // 显示毕业状态
      const gradeDisplay = currentUser.grade === "已毕业" ? 
        `已毕业 (${currentUser.enrollmentYear}级)` : 
        `${currentUser.school} ${currentUser.grade} ${currentUser.className}`;
      
      this.dom.sidebarUsername.textContent = currentUser.username;
      this.dom.sidebarUserClass.textContent = gradeDisplay;
    } else if (!currentUser && this.dom.sidebarUsername && this.dom.sidebarUserClass) {
      this.dom.sidebarUsername.textContent = '访客';
      this.dom.sidebarUserClass.textContent = '请登录查看信息';
    }
  },

  // 更新主题选择UI
  updateThemeSelection: function() {
    console.log('updateThemeSelection called, theme:', this.state.currentTheme);
    
    // 重新获取主题选项（确保DOM已加载）
    const themeOptions = document.querySelectorAll('.theme-option');
    console.log(`updateThemeSelection: 找到 ${themeOptions.length} 个主题选项`);
    
    themeOptions.forEach(option => {
      const theme = option.dataset.theme;
      console.log(`检查选项: ${theme}, 当前主题: ${this.state.currentTheme}`);
      
      // 移除所有active类
      option.classList.remove('active');
      
      // 如果主题匹配当前主题，添加active类
      if (theme === this.state.currentTheme) {
        option.classList.add('active');
        console.log(`为选项 ${theme} 添加 active 类`);
      }
    });
  },

  // 填充表单数据
  fillFormData: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    // 设置用户名
    if (this.dom.usernameInput) {
      this.dom.usernameInput.value = currentUser.username || '';
    }
    
    // 设置个性签名
    if (this.dom.signatureInput) {
      const signature = currentUser.settings?.signature || '';
      this.dom.signatureInput.value = signature;
      // 更新字符计数
      if (this.dom.signatureCount) {
        this.dom.signatureCount.textContent = signature.length;
      }
    }
    
    // 清空密码字段
    if (this.dom.currentPasswordInput) {
      this.dom.currentPasswordInput.value = '';
    }
    
    if (this.dom.newPasswordInput) {
      this.dom.newPasswordInput.value = '';
    }
    
    if (this.dom.confirmPasswordInput) {
      this.dom.confirmPasswordInput.value = '';
    }
    
    // 加载个人信息
    this.loadPersonalInfo();
    
    // 加载隐私设置
    this.loadPrivacySettings();
    
    // 加载通知设置
    this.loadNotificationSettings();
  },

  // 加载个人信息
  loadPersonalInfo: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    // 设置出生日期
    if (this.dom.settingsBirthday && currentUser.birthday) {
      this.dom.settingsBirthday.value = currentUser.birthday;
    }
    
    // 设置性别
    if (this.dom.settingsGender && currentUser.gender) {
      this.dom.settingsGender.value = currentUser.gender;
    }
    
    // 设置当前邮箱显示
    const currentEmailDisplay = document.getElementById('current-email-display');
    if (currentEmailDisplay && currentUser.email) {
      currentEmailDisplay.textContent = this.maskEmail(currentUser.email);
    }
    
    // 设置当前QQ号显示
    const currentQQDisplay = document.getElementById('current-qq-display');
    if (currentQQDisplay && currentUser.qq) {
      currentQQDisplay.textContent = currentUser.qq;
    }
    
    // 学校和班级的设置由 loadSchoolsConfig 处理
  },

  // 加载隐私设置
  loadPrivacySettings: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    const privacySettings = currentUser.settings?.privacy || {};
    
    // 设置隐藏黑名单用户帖子的开关
    if (this.dom.hideBlockedPosts) {
      this.dom.hideBlockedPosts.checked = privacySettings.hideBlockedPosts || false;
    }
    
    // 设置隐藏黑名单用户评论的开关
    if (this.dom.hideBlockedComments) {
      this.dom.hideBlockedComments.checked = privacySettings.hideBlockedComments || false;
    }
    
    // 设置帖子展示时间范围
    const postDisplayRange = document.getElementById('post-display-range');
    if (postDisplayRange) {
      postDisplayRange.value = privacySettings.postDisplayRange || 'all';
    }
    
    // 设置个人信息可见性
    const profileVisibility = privacySettings.profileVisibility || {};
    const visibilityFields = ['gender', 'birthday', 'school', 'signature', 'joinDate', 'lastLogin'];
    
    visibilityFields.forEach(field => {
      const element = document.getElementById(`visibility-${field}`);
      if (element) {
        element.value = profileVisibility[field] || 'public';
      }
    });
  },

  // 加载通知设置
  loadNotificationSettings: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    const notificationSettings = currentUser.settings?.notifications || {};
    
    // 设置各类通知开关
    if (this.dom.notifyLike) {
      this.dom.notifyLike.checked = notificationSettings.like !== false;
    }
    if (this.dom.notifyComment) {
      this.dom.notifyComment.checked = notificationSettings.comment !== false;
    }
    if (this.dom.notifyCommentReply) {
      this.dom.notifyCommentReply.checked = notificationSettings.commentReply !== false;
    }
    if (this.dom.notifyCommentLike) {
      this.dom.notifyCommentLike.checked = notificationSettings.commentLike !== false;
    }
    if (this.dom.notifyFollow) {
      this.dom.notifyFollow.checked = notificationSettings.follow !== false;
    }
  },

  // 保存隐私设置
  async savePrivacySettings() {
    console.log('savePrivacySettings called');
    
    // 检查用户是否登录
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再修改隐私设置', 'error');
      return;
    }
    
    // 收集隐私设置
    const privacySettings = {
      hideBlockedPosts: this.dom.hideBlockedPosts ? this.dom.hideBlockedPosts.checked : false,
      hideBlockedComments: this.dom.hideBlockedComments ? this.dom.hideBlockedComments.checked : false,
      postDisplayRange: document.getElementById('post-display-range')?.value || 'all',
      profileVisibility: {}
    };
    
    // 收集个人信息可见性设置
    const visibilityFields = ['gender', 'birthday', 'school', 'signature', 'joinDate', 'lastLogin'];
    visibilityFields.forEach(field => {
      const element = document.getElementById(`visibility-${field}`);
      if (element) {
        privacySettings.profileVisibility[field] = element.value;
      }
    });
    
    // 禁用按钮，显示加载状态
    this.dom.savePrivacyBtn.disabled = true;
    this.dom.savePrivacyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
    
    try {
      // 准备设置数据
      const settings = {
        privacy: privacySettings
      };

      // 发送更新请求
      const response = await fetch(`/api/user/privacy-settings`, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify(privacySettings)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存失败');
      }
      
      const data = await response.json();
      
      if (data.success) {
        // 更新本地存储的用户数据
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        if (!forumUser.settings) {
          forumUser.settings = {};
        }
        forumUser.settings.privacy = privacySettings;
        
        // 更新当前用户状态
        if (userManager.state.currentUser.settings) {
          userManager.state.currentUser.settings.privacy = privacySettings;
        } else {
          userManager.state.currentUser.settings = { privacy: privacySettings };
        }
        
        // 更新本地存储
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        
        // 显示成功消息
        utils.showNotification('隐私设置已保存', 'success');
        this.showSaveStatus('隐私设置已成功保存', 'success', 'privacy');
      } else {
        throw new Error(data.message || '保存失败');
      }
      
    } catch (error) {
      console.error('保存隐私设置失败:', error);
      utils.showNotification('保存失败: ' + error.message, 'error');
      this.showSaveStatus('保存失败，请重试', 'error', 'privacy');
    } finally {
      // 恢复按钮状态
      this.dom.savePrivacyBtn.disabled = false;
      this.dom.savePrivacyBtn.innerHTML = '<i class="fas fa-save"></i> 保存隐私设置';
    }
  },

  // 保存通知设置
  async saveNotificationSettings() {
    console.log('saveNotificationSettings called');
    
    // 检查用户是否登录
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再修改通知设置', 'error');
      return;
    }
    
    // 收集通知设置
    const notificationSettings = {
      like: this.dom.notifyLike ? this.dom.notifyLike.checked : true,
      comment: this.dom.notifyComment ? this.dom.notifyComment.checked : true,
      commentReply: this.dom.notifyCommentReply ? this.dom.notifyCommentReply.checked : true,
      commentLike: this.dom.notifyCommentLike ? this.dom.notifyCommentLike.checked : true,
      follow: this.dom.notifyFollow ? this.dom.notifyFollow.checked : true
    };
    
    // 禁用按钮，显示加载状态
    this.dom.saveNotificationsBtn.disabled = true;
    this.dom.saveNotificationsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
    
    try {
      // 准备设置数据
      const settings = {
        notifications: notificationSettings
      };

      // 发送更新请求
      const response = await fetch(`/api/user/notification-settings`, {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify(notificationSettings)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存失败');
      }
      
      const data = await response.json();
      
      if (data.success) {
        // 更新本地存储的用户数据
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        if (!forumUser.settings) {
          forumUser.settings = {};
        }
        forumUser.settings.notifications = notificationSettings;
        
        // 更新当前用户状态
        if (userManager.state.currentUser.settings) {
          userManager.state.currentUser.settings.notifications = notificationSettings;
        } else {
          userManager.state.currentUser.settings = { notifications: notificationSettings };
        }
        
        // 更新本地存储
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        
        // 显示成功消息
        utils.showNotification('通知设置已保存', 'success');
        this.showSaveStatus('通知设置已成功保存', 'success', 'notification');
      } else {
        throw new Error(data.message || '保存失败');
      }
      
    } catch (error) {
      console.error('保存通知设置失败:', error);
      utils.showNotification('保存失败: ' + error.message, 'error');
      this.showSaveStatus('保存失败，请重试', 'error', 'notification');
    } finally {
      // 恢复按钮状态
      this.dom.saveNotificationsBtn.disabled = false;
      this.dom.saveNotificationsBtn.innerHTML = '<i class="fas fa-save"></i> 保存通知设置';
    }
  },

  // 设置事件监听器
  setupEventListeners: function() {
    console.log('setupEventListeners called');
    
    // 重新获取主题选项（确保DOM已加载）
    const themeOptions = document.querySelectorAll('.theme-option');
    console.log(`找到 ${themeOptions.length} 个主题选项`);
    
    // 为每个主题选项单独绑定点击事件
    themeOptions.forEach((option, index) => {
      const theme = option.dataset.theme;
      console.log(`为主题选项 ${index} (${theme}) 绑定点击事件`);
      
      // 移除可能存在的旧事件监听器（通过克隆节点）
      const newOption = option.cloneNode(true);
      option.parentNode.replaceChild(newOption, option);
      
      // 添加新的事件监听器
      newOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selectedTheme = newOption.dataset.theme;
        console.log('主题选项被点击:', selectedTheme);
        
        // 检查用户是否登录
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再修改主题设置', 'error');
          return;
        }
        
        // 调用选择主题函数
        this.selectTheme(selectedTheme);
      });
    });
    
    console.log('主题选项点击事件监听器已绑定');
    
    // 应用主题按钮
    if (this.dom.applyThemeBtn) {
      this.dom.applyThemeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.applySelectedTheme();
      });
    }
    
    // 重置主题按钮
    if (this.dom.resetThemeBtn) {
      this.dom.resetThemeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetTheme();
      });
    }
    
    // 账户表单提交事件
    if (this.dom.accountForm) {
      this.dom.accountForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveAccountSettings();
      });
    }
    
    // 取消按钮
    if (this.dom.cancelAccountBtn) {
      this.dom.cancelAccountBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetForm();
      });
    }
    
    // 密码验证
    console.log('设置密码验证事件监听器');
    console.log('newPasswordInput 元素:', this.dom.newPasswordInput);
    console.log('confirmPasswordInput 元素:', this.dom.confirmPasswordInput);
    
    if (this.dom.newPasswordInput) {
      this.dom.newPasswordInput.addEventListener('input', () => {
        console.log('新密码输入变化');
        this.validatePassword();
      });
    } else {
      console.error('newPasswordInput 元素未找到，无法绑定事件');
    }
    
    if (this.dom.confirmPasswordInput) {
      this.dom.confirmPasswordInput.addEventListener('input', () => {
        console.log('确认密码输入变化');
        this.validatePasswordConfirmation();
      });
    } else {
      console.error('confirmPasswordInput 元素未找到，无法绑定事件');
    }
    
    // 头像上传按钮
    if (this.dom.uploadAvatarBtn) {
      this.dom.uploadAvatarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再上传头像', 'error');
          return;
        }
        this.dom.avatarUploadInput.click();
      });
    }
    
    // 头像文件选择
    if (this.dom.avatarUploadInput) {
      this.dom.avatarUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.uploadAvatar(file);
        }
      });
    }
    
    // 头像预览点击
    if (this.dom.avatarOverlay) {
      this.dom.avatarOverlay.addEventListener('click', () => {
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再上传头像', 'error');
          return;
        }
        this.dom.avatarUploadInput.click();
      });
    }
    
    // 个性签名输入事件（字符计数）
    if (this.dom.signatureInput) {
      this.dom.signatureInput.addEventListener('input', () => {
        const length = this.dom.signatureInput.value.length;
        if (this.dom.signatureCount) {
          this.dom.signatureCount.textContent = length;
        }
      });
    }
    
    // 移除头像按钮
    if (this.dom.removeAvatarBtn) {
      this.dom.removeAvatarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录后再移除头像', 'error');
          return;
        }
        this.removeAvatar();
      });
    }
    
    // 密码修改多步骤事件监听器
    this.setupPasswordChangeListeners();
    
    // 隐私设置保存按钮
    if (this.dom.savePrivacyBtn) {
      this.dom.savePrivacyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.savePrivacySettings();
      });
    }
    
    // 通知设置保存按钮
    if (this.dom.saveNotificationsBtn) {
      this.dom.saveNotificationsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.saveNotificationSettings();
      });
    }
    
    // 个人信息保存按钮
    if (this.dom.savePersonalInfoBtn) {
      this.dom.savePersonalInfoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.savePersonalInfo();
      });
    }
    
    // 学校选择变化事件
    if (this.dom.settingsSchool) {
      this.dom.settingsSchool.addEventListener('change', () => this.onSchoolChange());
    }
    
    // 入学年份变化事件
    if (this.dom.settingsEnrollmentYear) {
      this.dom.settingsEnrollmentYear.addEventListener('change', () => this.onSchoolChange());
    }
    
    // 邮箱修改事件监听器
    this.setupEmailChangeListeners();
  },

  // 设置邮箱修改事件监听器
  setupEmailChangeListeners: function() {
    // 验证密码并发送验证码按钮
    if (this.dom.verifyEmailPasswordBtn) {
      this.dom.verifyEmailPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.verifyEmailPassword();
      });
    }
    
    // 重发验证码按钮
    if (this.dom.resendEmailCodeBtn) {
      this.dom.resendEmailCodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.state.emailChange.sendCodeCountdown > 0) return;
        this.verifyEmailPassword();
      });
    }
    
    // 验证验证码按钮
    if (this.dom.verifyEmailCodeBtn) {
      this.dom.verifyEmailCodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.verifyEmailCode();
      });
    }
    
    // 返回步骤1按钮
    if (this.dom.backToEmailStep1Btn) {
      this.dom.backToEmailStep1Btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetEmailForm();
      });
    }
    
    // 重新修改邮箱按钮
    if (this.dom.resetEmailFormBtn) {
      this.dom.resetEmailFormBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetEmailForm();
      });
    }
    
    // QQ号修改事件监听器
    this.setupQQChangeListeners();
  },

  // 设置QQ号修改事件监听器
  setupQQChangeListeners: function() {
    // 验证密码并修改QQ号按钮
    if (this.dom.verifyQQPasswordBtn) {
      this.dom.verifyQQPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.verifyQQPassword();
      });
    }
    
    // 重新修改QQ号按钮
    if (this.dom.resetQQFormBtn) {
      this.dom.resetQQFormBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetQQForm();
      });
    }
    
    // 账户注销按钮
    const btnDeleteAccount = document.getElementById('btn-delete-account');
    if (btnDeleteAccount) {
      btnDeleteAccount.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录', 'error');
          return;
        }
        this.showDeletionDialog();
      });
    }

    // 数据导出按钮
    const btnExportData = document.getElementById('btn-export-data');
    if (btnExportData) {
      btnExportData.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录', 'error');
          return;
        }
        this.exportData();
      });
    }

    // 数据预览按钮
    const btnExportPreview = document.getElementById('btn-export-preview');
    if (btnExportPreview) {
      btnExportPreview.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录', 'error');
          return;
        }
        this.previewExportData();
      });
    }

    // 全选 / 取消全选
    const btnSelectAll = document.getElementById('export-select-all');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        document.querySelectorAll('.export-option-item input[type="checkbox"]').forEach(cb => {
          cb.checked = true;
        });
      });
    }

    const btnDeselectAll = document.getElementById('export-deselect-all');
    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', () => {
        document.querySelectorAll('.export-option-item input[type="checkbox"]').forEach(cb => {
          cb.checked = false;
        });
      });
    }

    // 关闭预览面板
    const btnPreviewClose = document.getElementById('export-preview-close');
    if (btnPreviewClose) {
      btnPreviewClose.addEventListener('click', () => {
        const panel = document.getElementById('export-preview-panel');
        if (panel) panel.style.display = 'none';
      });
    }

    // 数据导入按钮
    const btnImportData = document.getElementById('btn-import-data');
    if (btnImportData) {
      btnImportData.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录', 'error');
          return;
        }
        settingsManager.importData();
      });
    }

    const btnImportPreview = document.getElementById('btn-import-preview');
    if (btnImportPreview) {
      btnImportPreview.addEventListener('click', (e) => {
        e.preventDefault();
        if (!userManager.state.currentUser) {
          utils.showNotification('请先登录', 'error');
          return;
        }
        settingsManager.previewImportData();
      });
    }

    // 导入文件选择
    const importFileInput = document.getElementById('import-file-input');
    if (importFileInput) {
      importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        settingsManager.handleImportFileSelect(file);
      });
    }

    // 导入文件区域点击
    const importFileLabel = document.querySelector('.import-file-label');
    if (importFileLabel) {
      importFileLabel.addEventListener('click', () => {
        document.getElementById('import-file-input').click();
      });
    }

    // 导入全选/取消全选
    const btnImportSelectAll = document.getElementById('import-select-all');
    if (btnImportSelectAll) {
      btnImportSelectAll.addEventListener('click', () => {
        ['import-posts', 'import-favorites', 'import-follows', 'import-settings'].forEach(id => {
          const cb = document.getElementById(id);
          if (cb) cb.checked = true;
        });
      });
    }

    const btnImportDeselectAll = document.getElementById('import-deselect-all');
    if (btnImportDeselectAll) {
      btnImportDeselectAll.addEventListener('click', () => {
        ['import-posts', 'import-favorites', 'import-follows', 'import-settings'].forEach(id => {
          const cb = document.getElementById(id);
          if (cb) cb.checked = false;
        });
      });
    }

    // 关闭导入结果面板
    const btnImportResultClose = document.getElementById('import-result-close');
    if (btnImportResultClose) {
      btnImportResultClose.addEventListener('click', () => {
        const panel = document.getElementById('import-result-panel');
        if (panel) panel.style.display = 'none';
      });
    }
  },

  // 设置密码修改多步骤事件监听器
  setupPasswordChangeListeners: function() {
    // 步骤1：验证当前密码按钮
    if (this.dom.verifyCurrentPasswordBtn) {
      this.dom.verifyCurrentPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.verifyCurrentPassword();
      });
    }
    
    // 步骤2：发送验证码按钮
    if (this.dom.sendPasswordCodeBtn) {
      this.dom.sendPasswordCodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.sendPasswordChangeCode();
      });
    }
    
    // 步骤2：验证验证码按钮
    if (this.dom.verifyCodeBtn) {
      this.dom.verifyCodeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.verifyPasswordChangeCode();
      });
    }
    
    // 步骤2：返回步骤1按钮
    if (this.dom.backToStep1Btn) {
      this.dom.backToStep1Btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.goToPasswordStep(1);
      });
    }
    
    // 步骤3：返回步骤2按钮
    if (this.dom.backToStep2Btn) {
      this.dom.backToStep2Btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.goToPasswordStep(2);
      });
    }
    
    // 步骤3：确认修改密码按钮
    if (this.dom.changePasswordBtn) {
      this.dom.changePasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.confirmPasswordChange();
      });
    }
    
    // 成功页面：重新修改密码按钮
    if (this.dom.resetPasswordFormBtn) {
      this.dom.resetPasswordFormBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.resetPasswordForm();
      });
    }
  },

  // 切换密码修改步骤
  goToPasswordStep: function(step) {
    // 更新当前步骤
    this.state.passwordChange.currentStep = step;
    
    // 更新步骤指示器
    this.dom.passwordSteps.forEach((stepEl, index) => {
      const stepNum = index + 1;
      stepEl.classList.remove('active', 'completed');
      if (stepNum < step) {
        stepEl.classList.add('completed');
      } else if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });
    
    // 更新步骤指示器样式
    const stepLines = document.querySelectorAll('.password-steps .step-line');
    stepLines.forEach((line, index) => {
      if (index < step - 1) {
        line.classList.add('completed');
      } else {
        line.classList.remove('completed');
      }
    });
    
    // 显示对应步骤内容
    document.querySelectorAll('.password-step-content').forEach(content => {
      content.style.display = 'none';
    });
    document.getElementById(`password-step-${step}`).style.display = 'block';
  },

  // 验证当前密码
  async verifyCurrentPassword() {
    const currentPassword = this.dom.currentPasswordInput.value;
    
    if (!currentPassword) {
      utils.showNotification('请输入当前密码', 'error');
      return;
    }
    
    // 禁用按钮，显示加载状态
    this.dom.verifyCurrentPasswordBtn.disabled = true;
    this.dom.verifyCurrentPasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';

    try {
      const response = await fetch('/api/send-password-change-code', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: currentPassword
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // 保存当前密码
        this.state.passwordChange.currentPassword = currentPassword;
        
        // 显示用户邮箱
        if (this.dom.userEmailDisplay && data.data && data.data.email) {
          this.dom.userEmailDisplay.textContent = this.maskEmail(data.data.email);
        } else if (userManager.state.currentUser && userManager.state.currentUser.email) {
          this.dom.userEmailDisplay.textContent = this.maskEmail(userManager.state.currentUser.email);
        }
        
        // 进入步骤2
        this.goToPasswordStep(2);
        utils.showNotification('密码验证成功，验证码已发送到您的邮箱', 'success');
        
        // 开始倒计时
        this.startSendCodeCountdown(60);
      } else {
        utils.showNotification(data.message || '密码验证失败', 'error');
      }
    } catch (error) {
      console.error('验证当前密码失败:', error);
      utils.showNotification('验证失败，请稍后重试', 'error');
    } finally {
      // 恢复按钮状态
      this.dom.verifyCurrentPasswordBtn.disabled = false;
      this.dom.verifyCurrentPasswordBtn.innerHTML = '<i class="fas fa-arrow-right"></i> 验证密码';
    }
  },

  // 发送密码修改验证码
  async sendPasswordChangeCode() {
    // 检查是否在倒计时中
    if (this.state.passwordChange.sendCodeCountdown > 0) {
      utils.showNotification(`请等待 ${this.state.passwordChange.sendCodeCountdown} 秒后重试`, 'error');
      return;
    }
    
    // 禁用按钮，显示加载状态
    this.dom.sendPasswordCodeBtn.disabled = true;
    this.dom.sendPasswordCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';

    try {
      const response = await fetch('/api/send-password-change-code', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: this.state.passwordChange.currentPassword
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        utils.showNotification('验证码已发送到您的邮箱', 'success');
        
        // 开始倒计时
        this.startSendCodeCountdown(60);
      } else {
        utils.showNotification(data.message || '发送验证码失败', 'error');
        this.dom.sendPasswordCodeBtn.disabled = false;
        this.dom.sendPasswordCodeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送验证码';
      }
    } catch (error) {
      console.error('发送验证码失败:', error);
      utils.showNotification('发送验证码失败，请稍后重试', 'error');
      this.dom.sendPasswordCodeBtn.disabled = false;
      this.dom.sendPasswordCodeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送验证码';
    }
  },

  // 开始发送验证码倒计时
  startSendCodeCountdown: function(seconds) {
    this.state.passwordChange.sendCodeCountdown = seconds;
    
    const updateCountdown = () => {
      if (this.state.passwordChange.sendCodeCountdown > 0) {
        this.dom.sendPasswordCodeBtn.innerHTML = `${this.state.passwordChange.sendCodeCountdown}秒后重试`;
        this.dom.sendPasswordCodeBtn.disabled = true;
        this.state.passwordChange.sendCodeCountdown--;
        setTimeout(updateCountdown, 1000);
      } else {
        this.dom.sendPasswordCodeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送验证码';
        this.dom.sendPasswordCodeBtn.disabled = false;
      }
    };
    
    updateCountdown();
  },

  // 验证密码修改验证码
  async verifyPasswordChangeCode() {
    const verificationCode = this.dom.passwordVerificationCodeInput.value;
    
    if (!verificationCode) {
      utils.showNotification('请输入验证码', 'error');
      return;
    }
    
    if (verificationCode.length !== 6) {
      utils.showNotification('请输入6位验证码', 'error');
      return;
    }
    
    // 禁用按钮，显示加载状态
    this.dom.verifyCodeBtn.disabled = true;
    this.dom.verifyCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';

    try {
      const response = await fetch('/api/verify-password-change-code', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          verificationCode: verificationCode
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        this.state.passwordChange.isCodeVerified = true;
        this.goToPasswordStep(3);
        utils.showNotification('验证码验证成功，请设置新密码', 'success');
      } else {
        utils.showNotification(data.message || '验证码验证失败', 'error');
      }
    } catch (error) {
      console.error('验证验证码失败:', error);
      utils.showNotification('验证失败，请稍后重试', 'error');
    } finally {
      // 恢复按钮状态
      this.dom.verifyCodeBtn.disabled = false;
      this.dom.verifyCodeBtn.innerHTML = '<i class="fas fa-check"></i> 验证';
    }
  },

  // 确认修改密码
  async confirmPasswordChange() {
    const newPassword = this.dom.newPasswordInput.value;
    const confirmPassword = this.dom.confirmPasswordInput.value;
    
    // 验证新密码
    if (!newPassword) {
      utils.showNotification('请输入新密码', 'error');
      return;
    }
    
    if (newPassword.length < 6) {
      utils.showNotification('新密码长度至少为6个字符', 'error');
      return;
    }
    
    if (newPassword === this.state.passwordChange.currentPassword) {
      utils.showNotification('新密码不能与当前密码相同', 'error');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      utils.showNotification('两次输入的密码不一致', 'error');
      return;
    }
    
    // 禁用按钮，显示加载状态
    this.dom.changePasswordBtn.disabled = true;
    this.dom.changePasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 修改中...';
    
    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: this.state.passwordChange.currentPassword,
          newPassword: newPassword
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // 显示成功页面
        document.querySelectorAll('.password-step-content').forEach(content => {
          content.style.display = 'none';
        });
        document.getElementById('password-step-success').style.display = 'block';
        
        // 更新所有步骤为完成状态
        this.dom.passwordSteps.forEach(step => {
          step.classList.remove('active');
          step.classList.add('completed');
        });
        
        const stepLines = document.querySelectorAll('.password-steps .step-line');
        stepLines.forEach(line => {
          line.classList.add('completed');
        });
        
        utils.showNotification('密码修改成功！', 'success');

        // 安全：密码已修改，清除 refreshToken（服务端已注销 accessToken，
        // 旧 refreshToken 换新 token 的通道必须一并关闭）
        localStorage.removeItem('refreshToken');
      } else {
        utils.showNotification(data.message || '密码修改失败', 'error');
      }
    } catch (error) {
      console.error('修改密码失败:', error);
      utils.showNotification('修改密码失败，请稍后重试', 'error');
    } finally {
      // 恢复按钮状态
      this.dom.changePasswordBtn.disabled = false;
      this.dom.changePasswordBtn.innerHTML = '<i class="fas fa-save"></i> 确认修改';
    }
  },

  // 重置密码修改表单
  resetPasswordForm: function() {
    // 重置状态
    this.state.passwordChange = {
      currentStep: 1,
      currentPassword: '',
      isCodeVerified: false,
      sendCodeCountdown: 0
    };
    
    // 清空输入框
    if (this.dom.currentPasswordInput) {
      this.dom.currentPasswordInput.value = '';
    }
    if (this.dom.passwordVerificationCodeInput) {
      this.dom.passwordVerificationCodeInput.value = '';
    }
    if (this.dom.newPasswordInput) {
      this.dom.newPasswordInput.value = '';
    }
    if (this.dom.confirmPasswordInput) {
      this.dom.confirmPasswordInput.value = '';
    }
    
    // 重置步骤指示器
    this.dom.passwordSteps.forEach((step, index) => {
      step.classList.remove('completed');
      if (index === 0) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
    
    const stepLines = document.querySelectorAll('.password-steps .step-line');
    stepLines.forEach(line => {
      line.classList.remove('completed');
    });
    
    // 重置发送验证码按钮
    if (this.dom.sendPasswordCodeBtn) {
      this.dom.sendPasswordCodeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送验证码';
      this.dom.sendPasswordCodeBtn.disabled = false;
    }
    
    // 显示步骤1
    document.querySelectorAll('.password-step-content').forEach(content => {
      content.style.display = 'none';
    });
    document.getElementById('password-step-1').style.display = 'block';
  },

  // 邮箱脱敏显示
  maskEmail: function(email) {
    if (!email) return '';
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    
    const username = parts[0];
    const domain = parts[1];
    
    if (username.length <= 2) {
      return username.charAt(0) + '***@' + domain;
    }
    
    return username.charAt(0) + '***' + username.charAt(username.length - 1) + '@' + domain;
  },

  // 初始化表单
  initForm: function() {
    // 设置初始表单状态
    this.state.isSaving = false;
  },

  // 选择主题
  selectTheme: async function(theme) {
    console.log('selectTheme called:', theme);
    
    // 检查用户是否登录
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录后再修改主题设置', 'error');
      return;
    }
    
    // 更新当前选中的主题
    this.state.currentTheme = theme;
    
    // 更新UI
    this.updateThemeSelection();
    
    // 立即应用主题到当前页面
    if (theme === 'auto') {
      // 自动模式：检测系统主题
      const systemTheme = this.detectSystemTheme();
      userManager.applyTheme(systemTheme);
    } else {
      // 手动模式：直接应用选择的主题
      userManager.applyTheme(theme);
    }
    
    // 如果是自动模式，监听系统主题变化
    if (theme === 'auto') {
      this.setupThemeAutoDetection();
    }
    
    // 立即保存设置到服务器（不显示加载状态，因为已经实时应用）
    const settings = { theme: this.state.currentTheme };
    await userManager.updateSettings(settings);
  },

  // 检测系统主题
  detectSystemTheme: function() {
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const systemTheme = prefersDarkScheme.matches ? 'dark' : 'light';
    console.log('检测到系统主题:', systemTheme);
    return systemTheme;
  },

  // 应用选中的主题
  async applySelectedTheme() {
    console.log('applySelectedTheme called, theme:', this.state.currentTheme);
    
    try {
      // 检查用户是否登录
      if (!userManager.state.currentUser) {
        utils.showNotification('请先登录后再修改主题设置', 'error');
        return;
      }
      
      // 准备设置数据
      const settings = {
        theme: this.state.currentTheme
      };
      
      // 显示加载状态
      this.dom.applyThemeBtn.disabled = true;
      this.dom.applyThemeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 应用中...';
      
      // 立即应用主题到当前页面
      if (this.state.currentTheme === 'auto') {
        // 自动模式：检测系统主题
        const systemTheme = this.detectSystemTheme();
        userManager.applyTheme(systemTheme);
      } else {
        // 手动模式：直接应用选择的主题
        userManager.applyTheme(this.state.currentTheme);
      }
      
      // 通过userManager保存设置到服务器
      const success = await userManager.updateSettings(settings);
      
      if (success) {
        utils.showNotification('主题已应用并保存', 'success');
        this.showSaveStatus('主题已成功应用并保存', 'success', 'theme');
        
        // 如果是自动模式，监听系统主题变化
        if (this.state.currentTheme === 'auto') {
          this.setupThemeAutoDetection();
        }
      } else {
        utils.showNotification('主题应用失败，请重试', 'error');
        this.showSaveStatus('主题应用失败，请重试', 'error', 'theme');
      }
    } catch (error) {
      console.error('应用主题失败:', error);
      utils.showNotification('应用主题失败: ' + error.message, 'error');
    } finally {
      // 恢复按钮状态
      this.dom.applyThemeBtn.disabled = false;
      this.dom.applyThemeBtn.innerHTML = '<i class="fas fa-check"></i> 应用主题';
    }
  },

  // 设置主题自动检测
  setupThemeAutoDetection: function() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // 定义处理函数
    const handleThemeChange = (e) => {
      const newTheme = e.matches ? 'dark' : 'light';
      console.log('系统主题变化，应用新主题:', newTheme);
      userManager.applyTheme(newTheme);
    };
    
    // 添加监听器
    mediaQuery.addEventListener('change', handleThemeChange);
    
    // 存储监听器以便后续清理（如果需要）
    this.themeChangeListener = handleThemeChange;
  },

  // 重置主题
  async resetTheme() {
    console.log('resetTheme called');
    
    try {
      // 检查用户是否登录
      if (!userManager.state.currentUser) {
        utils.showNotification('请先登录后再修改主题设置', 'error');
        return;
      }
      
      // 重置为默认主题（light）
      this.state.currentTheme = 'light';
      this.updateThemeSelection();
      
      // 立即应用主题
      userManager.applyTheme('light');
      
      // 保存设置到服务器
      const success = await userManager.updateSettings({ theme: 'light' });
      
      if (success) {
        utils.showNotification('已恢复默认主题', 'success');
        this.showSaveStatus('已恢复默认主题', 'success', 'theme');
      } else {
        utils.showNotification('重置主题失败，请重试', 'error');
        this.showSaveStatus('重置主题失败，请重试', 'error', 'theme');
      }
    } catch (error) {
      console.error('重置主题失败:', error);
      utils.showNotification('重置主题失败: ' + error.message, 'error');
    }
  },

  // 验证密码
  validatePassword: function() {
    if (!this.dom.newPasswordInput) {
      console.error('newPasswordInput 元素未找到');
      return;
    }
    
    const password = this.dom.newPasswordInput.value;
    const strengthIndicator = document.getElementById('password-strength');
    
    if (!strengthIndicator) {
      console.error('password-strength 元素未找到');
      return;
    }
    
    console.log('密码验证被触发，密码长度:', password.length);
    
    // 简单的密码强度检查
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    console.log('密码强度得分:', strength);
    
    // 更新强度指示器
    strengthIndicator.className = 'strength-meter';
    strengthIndicator.style.width = `${strength * 25}%`;
    
    if (strength === 0) {
      strengthIndicator.className += ' strength-weak';
      console.log('密码强度: 弱');
    } else if (strength <= 2) {
      strengthIndicator.className += ' strength-medium';
      console.log('密码强度: 中等');
    } else {
      strengthIndicator.className += ' strength-strong';
      console.log('密码强度: 强');
    }
  },

  // 验证密码确认
  validatePasswordConfirmation: function() {
    const password = this.dom.newPasswordInput.value;
    const confirmPassword = this.dom.confirmPasswordInput.value;
    
    if (!password || !confirmPassword) return;
    
    if (password !== confirmPassword) {
      this.dom.confirmPasswordInput.style.borderColor = 'var(--error-color)';
      return false;
    } else {
      this.dom.confirmPasswordInput.style.borderColor = 'var(--success-color)';
      return true;
    }
  },

  // 保存账户设置
  async saveAccountSettings() {
    console.log('saveAccountSettings called');
    
    // 防止重复提交
    if (this.state.isSaving) return;
    this.state.isSaving = true;
    
    try {
      // 检查用户是否登录
      if (!userManager.state.currentUser) {
        utils.showNotification('请先登录后再修改账户设置', 'error');
        this.state.isSaving = false;
        return;
      }
      
      // 验证用户ID
      const userId = userManager.state.currentUser.id;
      if (!userId) {
        console.error('saveAccountSettings: 用户ID为空');
        utils.showNotification('用户信息错误，请重新登录', 'error');
        this.state.isSaving = false;
        return;
      }
      
      console.log('saveAccountSettings: 用户ID:', userId);
      
      // 获取表单数据（不包含密码，密码修改使用独立流程）
      const formData = {
        username: this.dom.usernameInput.value.trim(),
        signature: this.dom.signatureInput ? this.dom.signatureInput.value.trim() : ''
      };
      
      // 验证用户名
      if (!formData.username) {
        utils.showNotification('昵称不能为空', 'error');
        this.state.isSaving = false;
        return;
      }
      
      if (formData.username.length < 2 || formData.username.length > 20) {
        utils.showNotification('昵称长度必须在2-20个字符之间', 'error');
        this.state.isSaving = false;
        return;
      }
      
      // 准备发送到服务器的数据
      const updateData = {};
      const currentUser = userManager.state.currentUser;
      
      // 如果用户名有变化，添加用户名
      if (formData.username !== currentUser.username) {
        updateData.username = formData.username;
      }
      
      // 检查个性签名是否有变化
      const currentSignature = currentUser.settings?.signature || '';
      if (formData.signature !== currentSignature) {
        updateData.settings = {
          ...currentUser.settings,
          signature: formData.signature
        };
      }
      
      // 检查个人信息是否有变化
      if (this.dom.settingsSchool && this.dom.settingsSchool.value && this.dom.settingsSchool.value !== currentUser.school) {
        updateData.school = this.dom.settingsSchool.value;
      }
      
      if (this.dom.settingsEnrollmentYear) {
        const newYear = parseInt(this.dom.settingsEnrollmentYear.value);
        if (newYear && newYear !== currentUser.enrollmentYear) {
          updateData.enrollmentYear = newYear;
        }
      }
      
      if (this.dom.settingsClass && this.dom.settingsClass.value && this.dom.settingsClass.value !== currentUser.className) {
        updateData.className = this.dom.settingsClass.value;
      }
      
      if (this.dom.settingsBirthday) {
        const newBirthday = this.dom.settingsBirthday.value || null;
        if (newBirthday !== currentUser.birthday) {
          updateData.birthday = newBirthday;
        }
      }
      
      if (this.dom.settingsGender) {
        const newGender = this.dom.settingsGender.value || '';
        if (newGender !== currentUser.gender) {
          updateData.gender = newGender;
        }
      }
      
      // 如果没有更改，直接返回
      if (Object.keys(updateData).length === 0) {
        utils.showNotification('没有检测到任何更改', 'info');
        this.state.isSaving = false;
        return;
      }
      
      // 显示加载状态
      this.dom.saveAccountBtn.disabled = true;
      this.dom.saveAccountBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
      
      // 发送更新请求
      const response = await fetch(`/api/users/${userManager.state.currentUser.id}`, {
        method: 'PUT',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify(updateData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存失败');
      }
      
      const data = await response.json();
      
      if (data.success) {
        // 使用 API 响应数据更新本地存储和内存状态（避免 localStorage 旧数据覆盖新状态）
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        if (updateData.username) {
          forumUser.username = updateData.username;
        }
        
        // 更新签名设置
        if (updateData.settings) {
          if (!forumUser.settings) {
            forumUser.settings = {};
          }
          Object.assign(forumUser.settings, updateData.settings);
        }
        
        // 使用 API 响应数据更新当前用户状态（而非从 localStorage 读取旧数据）
        if (data.user) {
          Object.assign(userManager.state.currentUser, data.user);
        } else {
          Object.assign(userManager.state.currentUser, forumUser);
        }
        
        // 更新本地存储
        localStorage.setItem('forumUser', JSON.stringify(userManager.state.currentUser));
        
        // 更新UI
        userManager.updateUserUI(userManager.state.currentUser);
        
        // 显示成功消息
        utils.showNotification('账户设置已保存', 'success');
        this.showSaveStatus('账户设置已成功保存', 'success', 'account');
        
        // 重置表单
        this.resetForm();
      } else {
        throw new Error(data.message || '保存失败');
      }
      
    } catch (error) {
      console.error('保存账户设置失败:', error);
      utils.showNotification('保存失败: ' + error.message, 'error');
    } finally {
      // 恢复按钮状态
      this.dom.saveAccountBtn.disabled = false;
      this.dom.saveAccountBtn.innerHTML = '<i class="fas fa-save"></i> 保存账户设置';
      this.state.isSaving = false;
    }
  },

  // 验证账户表单
  validateAccountForm: function(formData) {
    // 验证用户名
    if (!formData.username) {
      utils.showNotification('昵称不能为空', 'error');
      return false;
    }
    
    if (formData.username.length < 2 || formData.username.length > 20) {
      utils.showNotification('昵称长度必须在2-20个字符之间', 'error');
      return false;
    }
    
    return true;
  },

  // 重置表单
  resetForm: function() {
    this.fillFormData();
    utils.showNotification('表单已重置', 'info');
  },

  // 显示保存状态
  showSaveStatus: function(message, type = 'info', target = 'account') {
    // 确定目标元素ID
    let elementId;
    if (target === 'theme') {
      elementId = 'theme-save-status';
    } else if (target === 'privacy') {
      elementId = 'privacy-save-status';
    } else if (target === 'notification') {
      elementId = 'notification-save-status';
    } else {
      elementId = 'account-save-status';
    }
    
    // 获取状态元素
    let statusElement = document.getElementById(elementId);
    if (!statusElement) {
      console.warn(`状态元素 ${elementId} 未找到`);
      return;
    }
    
    // 设置内容和样式
    statusElement.textContent = message;
    statusElement.className = `save-status ${type}`;
    statusElement.style.display = 'block';
    
    // 3秒后自动隐藏
    setTimeout(() => {
      statusElement.className = 'save-status';
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 300);
    }, 3000);
  },

  // 上传头像
  async uploadAvatar(file) {
    try {
      // 验证文件类型
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/avif', 'image/heic', 'image/heif'];
      if (!allowedTypes.includes(file.type)) {
        utils.showNotification('只支持 JPG、PNG、GIF、WEBP 格式的图片', 'error');
        return;
      }
      
      // 验证文件大小（10MB限制）
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        utils.showNotification('图片大小不能超过 10MB', 'error');
        return;
      }
      
      const formData = new FormData();
      formData.append('avatar', file);
      
      utils.showNotification('头像上传中...', 'info');
      
      const response = await fetch(`/api/users/${userManager.state.currentUser.id}/avatar`, {
        method: 'POST',
        // 令牌在 HttpOnly Cookie 中，同源请求自动携带，无需手动拼 Authorization
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showNotification('头像上传成功', 'success');
        
        // 更新预览
        if (data.avatarUrl) {
          this.dom.avatarPreview.src = data.avatarUrl;
        }
        
        // 显示移除头像按钮
        this.dom.removeAvatarBtn.style.display = 'inline-flex';
        
        // 更新用户信息
        if (data.user) {
          userManager.state.currentUser = { ...userManager.state.currentUser, ...data.user };
          // 更新头像缓存
          userManager.updateUserAvatar(data.user.avatar);
        }
        
        // 清空文件输入
        this.dom.avatarUploadInput.value = '';
      } else {
        utils.showNotification(data.message || '头像上传失败', 'error');
      }
    } catch (error) {
      console.error('上传头像失败:', error);
      utils.showNotification('头像上传失败，请稍后重试', 'error');
    }
  },

  // 移除头像
  async removeAvatar() {
    if (!confirm('确定要移除头像吗？移除后将使用默认头像')) {
      return;
    }
    
    try {
      utils.showNotification('头像移除中...', 'info');
      
      const response = await fetch(`/api/users/${userManager.state.currentUser.id}/avatar`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showNotification('头像已移除', 'success');
        
        // 更新预览为默认头像
        this.dom.avatarPreview.src = '/images/default-avatar.svg';
        
        // 隐藏移除头像按钮
        this.dom.removeAvatarBtn.style.display = 'none';
        
        // 更新用户信息
        if (data.user) {
          userManager.state.currentUser = { ...userManager.state.currentUser, ...data.user };
          // 更新头像缓存
          userManager.updateUserAvatar(null);
        }
      } else {
        utils.showNotification(data.message || '移除头像失败', 'error');
      }
    } catch (error) {
      console.error('移除头像失败:', error);
      utils.showNotification('移除头像失败，请稍后重试', 'error');
    }
  },

  // 更新头像预览
  updateAvatarPreview: function() {
    const currentUser = userManager.state.currentUser;
    if (currentUser && currentUser.avatar) {
      this.dom.avatarPreview.src = currentUser.avatar;
      this.dom.removeAvatarBtn.style.display = 'inline-flex';
    } else {
      this.dom.avatarPreview.src = '/images/default-avatar.svg';
      this.dom.removeAvatarBtn.style.display = 'none';
    }
  },

  // 加载学校配置
  loadSchoolsConfig: async function() {
    console.log('开始加载学校配置...');
    try {
      const response = await fetch('/api/schools');
      if (!response.ok) {
        throw new Error('加载学校配置失败');
      }
      
      const data = await response.json();
      if (data.success && data.schools) {
        this.state.schools = data.schools;
        this.initSchoolOptions();
        this.initEnrollmentYearOptions();
        
        // 如果用户已有学校和年份，自动触发班级选项加载
        const currentUser = userManager.state.currentUser;
        if (currentUser && currentUser.school && currentUser.enrollmentYear) {
          // 延迟执行确保选项已设置
          setTimeout(() => {
            this.onSchoolChange();
            // 设置当前班级
            if (this.dom.settingsClass && currentUser.className) {
              this.dom.settingsClass.value = currentUser.className;
            }
          }, 100);
        }
      }
    } catch (error) {
      console.error('加载学校配置失败:', error);
    }
  },

  // 初始化学校选项
  initSchoolOptions: function() {
    const schoolSelect = this.dom.settingsSchool;
    if (!schoolSelect) return;
    
    schoolSelect.innerHTML = '<option value="">请选择学校</option>';
    
    this.state.schools.forEach(school => {
      const option = document.createElement('option');
      option.value = school.name;
      option.textContent = school.name;
      schoolSelect.appendChild(option);
    });
    
    // 设置当前用户的学校
    const currentUser = userManager.state.currentUser;
    if (currentUser && currentUser.school) {
      schoolSelect.value = currentUser.school;
      this.state.currentSchoolInfo.school = currentUser.school;
    }
  },

  // 初始化入学年份选项
  initEnrollmentYearOptions: function() {
    const enrollmentYearSelect = this.dom.settingsEnrollmentYear;
    if (!enrollmentYearSelect || !this.state.schools) return;
    
    const years = new Set();
    this.state.schools.forEach(school => {
      if (school.classInfo && Array.isArray(school.classInfo)) {
        school.classInfo.forEach(info => {
          if (info.year) years.add(info.year);
        });
      }
    });
    
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    enrollmentYearSelect.innerHTML = '<option value="">请选择入学年份</option>';
    
    sortedYears.forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = `${year}年`;
      enrollmentYearSelect.appendChild(option);
    });
    
    // 设置当前用户的入学年份
    const currentUser = userManager.state.currentUser;
    if (currentUser && currentUser.enrollmentYear) {
      enrollmentYearSelect.value = currentUser.enrollmentYear;
      this.state.currentSchoolInfo.enrollmentYear = currentUser.enrollmentYear;
    }
  },

  // 学校选择变化处理
  onSchoolChange: function() {
    const schoolSelect = this.dom.settingsSchool;
    const enrollmentYearSelect = this.dom.settingsEnrollmentYear;
    const classSelect = this.dom.settingsClass;
    
    if (!schoolSelect || !enrollmentYearSelect || !classSelect) return;
    
    const selectedSchool = schoolSelect.value;
    const selectedYear = parseInt(enrollmentYearSelect.value);
    
    if (!selectedSchool || !selectedYear) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">请先选择学校和年份</option>';
      return;
    }
    
    const schoolConfig = this.state.schools.find(s => s.name === selectedSchool);
    if (!schoolConfig || !schoolConfig.classInfo) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">未找到班级配置</option>';
      return;
    }
    
    const classInfo = schoolConfig.classInfo.find(info => info.year === selectedYear);
    if (!classInfo || !classInfo.classCount) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">该年份暂无班级配置</option>';
      return;
    }
    
    classSelect.innerHTML = '<option value="">请选择班级</option>';
    for (let i = 1; i <= classInfo.classCount; i++) {
      const option = document.createElement('option');
      option.value = `${i}班`;
      option.textContent = `${i}班`;
      classSelect.appendChild(option);
    }
    
    classSelect.disabled = false;
    
    // 设置当前用户的班级
    const currentUser = userManager.state.currentUser;
    if (currentUser && currentUser.className && this.state.currentSchoolInfo.school === selectedSchool) {
      classSelect.value = currentUser.className;
    }
  },

  // 加载个人信息设置
  loadPersonalInfoSettings: function() {
    const currentUser = userManager.state.currentUser;
    if (!currentUser) return;
    
    // 设置出生日期
    if (this.dom.settingsBirthday && currentUser.birthday) {
      this.dom.settingsBirthday.value = currentUser.birthday;
    }
    
    // 设置性别
    if (this.dom.settingsGender && currentUser.gender) {
      this.dom.settingsGender.value = currentUser.gender;
    }
    
    // 设置当前邮箱显示
    if (document.getElementById('current-email-display') && currentUser.email) {
      document.getElementById('current-email-display').textContent = this.maskEmail(currentUser.email);
    }
    
    // 触发学校选择以更新班级选项
    this.onSchoolChange();
  },

  // 保存个人信息
  savePersonalInfo: async function() {
    if (!userManager.state.currentUser) {
      utils.showNotification('请先登录', 'error');
      return;
    }
    
    const updateData = {};
    const currentUser = userManager.state.currentUser;
    
    // 检查学校是否有变化
    if (this.dom.settingsSchool && this.dom.settingsSchool.value !== currentUser.school) {
      updateData.school = this.dom.settingsSchool.value;
    }
    
    // 检查入学年份是否有变化
    if (this.dom.settingsEnrollmentYear) {
      const newYear = parseInt(this.dom.settingsEnrollmentYear.value);
      if (newYear !== currentUser.enrollmentYear) {
        updateData.enrollmentYear = newYear;
      }
    }
    
    // 检查班级是否有变化
    if (this.dom.settingsClass && this.dom.settingsClass.value !== currentUser.className) {
      updateData.className = this.dom.settingsClass.value;
    }
    
    // 检查出生日期是否有变化
    if (this.dom.settingsBirthday) {
      const newBirthday = this.dom.settingsBirthday.value || null;
      if (newBirthday !== currentUser.birthday) {
        updateData.birthday = newBirthday;
      }
    }
    
    // 检查性别是否有变化
    if (this.dom.settingsGender) {
      const newGender = this.dom.settingsGender.value || '';
      if (newGender !== currentUser.gender) {
        updateData.gender = newGender;
      }
    }
    
    if (Object.keys(updateData).length === 0) {
      utils.showNotification('没有检测到任何更改', 'info');
      return;
    }
    
    try {
      const response = await fetch(`/api/users/${userManager.state.currentUser.id}`, {
        method: 'PUT',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify(updateData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 更新本地存储
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        Object.assign(forumUser, updateData);
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        
        // 更新当前用户状态
        Object.assign(userManager.state.currentUser, updateData);
        
        utils.showNotification('个人信息已保存', 'success');
      } else {
        throw new Error(data.message || '保存失败');
      }
    } catch (error) {
      console.error('保存个人信息失败:', error);
      utils.showNotification('保存失败: ' + error.message, 'error');
    }
  },

  // 邮箱修改：验证密码并发送验证码
  verifyEmailPassword: async function() {
    const currentPassword = this.dom.emailChangePassword?.value;
    const newEmail = this.dom.newEmail?.value?.trim();
    
    if (!currentPassword) {
      utils.showNotification('请输入当前密码', 'error');
      return;
    }
    
    if (!newEmail) {
      utils.showNotification('请输入新邮箱', 'error');
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      utils.showNotification('请输入有效的邮箱地址', 'error');
      return;
    }
    
    if (newEmail.toLowerCase() === userManager.state.currentUser.email.toLowerCase()) {
      utils.showNotification('新邮箱不能与当前邮箱相同', 'error');
      return;
    }
    
    this.dom.verifyEmailPasswordBtn.disabled = true;
    this.dom.verifyEmailPasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';
    
    try {
      const response = await fetch('/api/send-email-change-code', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: currentPassword,
          newEmail: newEmail
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.state.emailChange.currentPassword = currentPassword;
        this.state.emailChange.newEmail = newEmail;
        
        // 显示步骤2
        document.getElementById('email-step-1').style.display = 'none';
        document.getElementById('email-step-2').style.display = 'block';
        
        // 更新步骤指示器
        document.getElementById('email-step-1-indicator').classList.remove('active');
        document.getElementById('email-step-1-indicator').classList.add('completed');
        document.getElementById('email-step-line-1').classList.add('completed');
        document.getElementById('email-step-2-indicator').classList.add('active');
        
        // 显示新邮箱
        if (this.dom.newEmailDisplay) {
          this.dom.newEmailDisplay.textContent = this.maskEmail(newEmail);
        }
        
        utils.showNotification('验证码已发送到新邮箱', 'success');
        this.startEmailCodeCountdown();
      } else {
        utils.showNotification(data.message || '验证失败', 'error');
      }
    } catch (error) {
      console.error('验证邮箱失败:', error);
      utils.showNotification('验证失败，请稍后重试', 'error');
    } finally {
      this.dom.verifyEmailPasswordBtn.disabled = false;
      this.dom.verifyEmailPasswordBtn.innerHTML = '<i class="fas fa-arrow-right"></i> 验证并发送验证码';
    }
  },

  // 邮箱验证码倒计时
  startEmailCodeCountdown: function() {
    this.state.emailChange.sendCodeCountdown = 60;
    
    const updateBtn = () => {
      if (this.state.emailChange.sendCodeCountdown > 0) {
        this.dom.resendEmailCodeBtn.innerHTML = `${this.state.emailChange.sendCodeCountdown}秒后重试`;
        this.dom.resendEmailCodeBtn.disabled = true;
        this.state.emailChange.sendCodeCountdown--;
        setTimeout(updateBtn, 1000);
      } else {
        this.dom.resendEmailCodeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 重发验证码';
        this.dom.resendEmailCodeBtn.disabled = false;
      }
    };
    
    updateBtn();
  },

  // 验证邮箱验证码并完成修改
  verifyEmailCode: async function() {
    const verificationCode = this.dom.emailVerificationCode?.value;
    
    if (!verificationCode) {
      utils.showNotification('请输入验证码', 'error');
      return;
    }
    
    if (verificationCode.length !== 6) {
      utils.showNotification('请输入6位验证码', 'error');
      return;
    }
    
    this.dom.verifyEmailCodeBtn.disabled = true;
    this.dom.verifyEmailCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';
    
    try {
      const response = await fetch('/api/verify-email-change', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          verificationCode: verificationCode,
          newEmail: this.state.emailChange.newEmail
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 显示成功页面
        document.getElementById('email-step-2').style.display = 'none';
        document.getElementById('email-step-success').style.display = 'block';
        
        // 更新步骤指示器
        document.getElementById('email-step-2-indicator').classList.remove('active');
        document.getElementById('email-step-2-indicator').classList.add('completed');
        document.getElementById('email-step-line-2').classList.add('completed');
        document.getElementById('email-step-3-indicator').classList.add('active');
        document.getElementById('email-step-3-indicator').classList.add('completed');
        
        // 显示更新后的邮箱
        if (this.dom.updatedEmailDisplay) {
          this.dom.updatedEmailDisplay.textContent = this.maskEmail(this.state.emailChange.newEmail);
        }
        
        // 更新本地存储
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        forumUser.email = this.state.emailChange.newEmail;
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        userManager.state.currentUser.email = this.state.emailChange.newEmail;
        
        // 更新显示
        document.getElementById('current-email-display').textContent = this.maskEmail(this.state.emailChange.newEmail);
        
        utils.showNotification('邮箱修改成功！', 'success');
      } else {
        utils.showNotification(data.message || '验证码验证失败', 'error');
      }
    } catch (error) {
      console.error('验证验证码失败:', error);
      utils.showNotification('验证失败，请稍后重试', 'error');
    } finally {
      this.dom.verifyEmailCodeBtn.disabled = false;
      this.dom.verifyEmailCodeBtn.innerHTML = '<i class="fas fa-check"></i> 确认修改';
    }
  },

  // 重置邮箱修改表单
  resetEmailForm: function() {
    this.state.emailChange = {
      currentStep: 1,
      currentPassword: '',
      newEmail: '',
      isCodeVerified: false,
      sendCodeCountdown: 0
    };
    
    if (this.dom.emailChangePassword) this.dom.emailChangePassword.value = '';
    if (this.dom.newEmail) this.dom.newEmail.value = '';
    if (this.dom.emailVerificationCode) this.dom.emailVerificationCode.value = '';
    
    // 重置步骤显示
    document.getElementById('email-step-1').style.display = 'block';
    document.getElementById('email-step-2').style.display = 'none';
    document.getElementById('email-step-success').style.display = 'none';
    
    // 重置步骤指示器
    document.getElementById('email-step-1-indicator').classList.add('active');
    document.getElementById('email-step-1-indicator').classList.remove('completed');
    document.getElementById('email-step-line-1').classList.remove('completed');
    document.getElementById('email-step-2-indicator').classList.remove('active', 'completed');
    document.getElementById('email-step-line-2').classList.remove('completed');
    document.getElementById('email-step-3-indicator').classList.remove('active', 'completed');
  },

  // QQ号修改：验证密码并修改
  verifyQQPassword: async function() {
    const currentPassword = this.dom.qqChangePassword?.value;
    const newQQ = this.dom.newQQ?.value?.trim();
    
    if (!currentPassword) {
      utils.showNotification('请输入当前密码', 'error');
      return;
    }
    
    if (!newQQ) {
      utils.showNotification('请输入新QQ号', 'error');
      return;
    }
    
    // 验证QQ号格式
    const qqRegex = /^[1-9]\d{4,14}$/;
    if (!qqRegex.test(newQQ)) {
      utils.showNotification('请输入有效的QQ号（5-15位数字）', 'error');
      return;
    }
    
    if (newQQ === userManager.state.currentUser.qq) {
      utils.showNotification('新QQ号不能与当前QQ号相同', 'error');
      return;
    }
    
    this.dom.verifyQQPasswordBtn.disabled = true;
    this.dom.verifyQQPasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';
    
    try {
      const response = await fetch('/api/change-qq', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          currentPassword: currentPassword,
          newQQ: newQQ
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 显示成功页面
        document.getElementById('qq-step-1').style.display = 'none';
        document.getElementById('qq-step-success').style.display = 'block';
        
        // 更新步骤指示器
        document.getElementById('qq-step-1-indicator').classList.remove('active');
        document.getElementById('qq-step-1-indicator').classList.add('completed');
        document.getElementById('qq-step-line-1').classList.add('completed');
        document.getElementById('qq-step-2-indicator').classList.add('active');
        document.getElementById('qq-step-2-indicator').classList.add('completed');
        
        // 显示更新后的QQ号
        if (this.dom.updatedQQDisplay) {
          this.dom.updatedQQDisplay.textContent = newQQ;
        }
        
        // 更新本地存储
        const forumUser = JSON.parse(localStorage.getItem('forumUser') || '{}');
        forumUser.qq = newQQ;
        localStorage.setItem('forumUser', JSON.stringify(forumUser));
        userManager.state.currentUser.qq = newQQ;
        
        // 更新显示
        document.getElementById('current-qq-display').textContent = newQQ;
        
        utils.showNotification('QQ号修改成功！', 'success');
      } else {
        utils.showNotification(data.message || '修改失败', 'error');
      }
    } catch (error) {
      console.error('修改QQ号失败:', error);
      utils.showNotification('修改失败，请稍后重试', 'error');
    } finally {
      this.dom.verifyQQPasswordBtn.disabled = false;
      this.dom.verifyQQPasswordBtn.innerHTML = '<i class="fas fa-check"></i> 确认修改';
    }
  },

  // 重置QQ号修改表单
  resetQQForm: function() {
    this.state.qqChange = { currentStep: 1 };
    
    if (this.dom.qqChangePassword) this.dom.qqChangePassword.value = '';
    if (this.dom.newQQ) this.dom.newQQ.value = '';
    
    // 重置步骤显示
    document.getElementById('qq-step-1').style.display = 'block';
    document.getElementById('qq-step-success').style.display = 'none';
    
    // 重置步骤指示器
    document.getElementById('qq-step-1-indicator').classList.add('active');
    document.getElementById('qq-step-1-indicator').classList.remove('completed');
    document.getElementById('qq-step-line-1').classList.remove('completed');
    document.getElementById('qq-step-2-indicator').classList.remove('active', 'completed');
  },
  
  // 显示账户注销对话框
  showDeletionDialog: function() {
    const modal = document.createElement('div');
    modal.className = 'deletion-modal';
    modal.innerHTML = `
      <div class="deletion-modal-content">
        <div class="deletion-modal-header">
          <h3><i class="fas fa-exclamation-triangle"></i> 注销账户</h3>
          <button class="close-modal" data-action="utils.removeClosest" data-arg-from="this" data-arg2=".deletion-modal">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="deletion-modal-body">
          <div class="deletion-step" id="deletion-step-1">
            <p class="step-description">请输入您的密码以验证身份</p>
            <div class="form-group">
              <label for="deletion-password">密码</label>
              <input type="password" id="deletion-password" placeholder="请输入密码">
            </div>
            <button type="button" class="settings-button primary" id="btn-send-deletion-code">
              <i class="fas fa-paper-plane"></i> 发送验证码
            </button>
          </div>
          <div class="deletion-step" id="deletion-step-2" style="display: none;">
            <p class="step-description">验证码已发送到您的邮箱，请输入验证码</p>
            <div class="form-group">
              <label for="deletion-code">验证码</label>
              <input type="text" id="deletion-code" placeholder="请输入6位验证码" maxlength="6">
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="deletion-keep-data">
                保留发布的帖子和评论
              </label>
            </div>
            <div class="deletion-step-actions">
              <button type="button" class="settings-button secondary" id="btn-deletion-back">
                <i class="fas fa-arrow-left"></i> 返回
              </button>
              <button type="button" class="settings-button danger" id="btn-confirm-deletion">
                <i class="fas fa-trash-alt"></i> 确认注销
              </button>
            </div>
          </div>
          <div class="deletion-step" id="deletion-step-success" style="display: none;">
            <div class="deletion-success">
              <i class="fas fa-check-circle"></i>
              <h3>账户已注销</h3>
              <p>您的账户已成功注销，感谢您使用校园论坛。</p>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 绑定事件
    document.getElementById('btn-send-deletion-code').addEventListener('click', () => this.sendDeletionCode());
    document.getElementById('btn-deletion-back').addEventListener('click', () => {
      document.getElementById('deletion-step-1').style.display = 'block';
      document.getElementById('deletion-step-2').style.display = 'none';
    });
    document.getElementById('btn-confirm-deletion').addEventListener('click', () => this.confirmDeletion());
  },
  
  // 发送账户注销验证码
  sendDeletionCode: async function() {
    const password = document.getElementById('deletion-password').value;
    
    if (!password) {
      utils.showNotification('请输入密码', 'error');
      return;
    }
    
    const btn = document.getElementById('btn-send-deletion-code');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';
    
    try {
      const response = await fetch('/api/send-deletion-code', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          password: password
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 保存密码用于后续验证
        this.state.deletionPassword = password;
        
        // 显示步骤2
        document.getElementById('deletion-step-1').style.display = 'none';
        document.getElementById('deletion-step-2').style.display = 'block';
        
        utils.showNotification('验证码已发送到您的邮箱', 'success');
      } else {
        utils.showNotification(data.message || '发送失败', 'error');
      }
    } catch (error) {
      utils.showNotification('发送失败，请稍后重试', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送验证码';
    }
  },
  
  // 确认账户注销
  confirmDeletion: async function() {
    const code = document.getElementById('deletion-code').value;
    const keepData = document.getElementById('deletion-keep-data').checked;
    
    if (!code || code.length !== 6) {
      utils.showNotification('请输入6位验证码', 'error');
      return;
    }
    
    const btn = document.getElementById('btn-confirm-deletion');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 注销中...';
    
    try {
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: userManager.getAuthHeaders(),
        body: JSON.stringify({
          password: this.state.deletionPassword,
          verificationCode: code,
          keepData: keepData
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 显示成功页面
        document.getElementById('deletion-step-2').style.display = 'none';
        document.getElementById('deletion-step-success').style.display = 'block';
        
        // 清除本地存储
        localStorage.removeItem('forumUser');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('adminToken');
        
        // 3秒后跳转到登录页
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 3000);
      } else {
        utils.showNotification(data.message || '注销失败', 'error');
      }
    } catch (error) {
      utils.showNotification('注销失败，请稍后重试', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-trash-alt"></i> 确认注销';
    }
  },

  // ======== 数据导出 ========

  // 获取当前勾选的导出范围
  _getExportIncludes: function() {
    const map = {
      'export-profile':       'profile',
      'export-posts':         'posts',
      'export-favorites':     'favorites',
      'export-follows':       'follows',
      'export-messages':      'messages',
      'export-notifications': 'notifications',
      'export-settings':      'settings'
    };
    const selected = [];
    Object.entries(map).forEach(([id, key]) => {
      const cb = document.getElementById(id);
      if (cb && cb.checked) selected.push(key);
    });
    return selected;
  },

  // 设置进度条状态
  _setExportProgress: function(visible, text, percent) {
    const wrap = document.getElementById('export-progress');
    const textEl = document.getElementById('export-progress-text');
    const fill = document.getElementById('export-progress-fill');
    if (!wrap) return;
    wrap.style.display = visible ? 'block' : 'none';
    if (textEl && text !== undefined) textEl.textContent = text;
    if (fill && percent !== undefined) fill.style.width = percent + '%';
  },

  // 显示导出状态
  _setExportStatus: function(msg, type) {
    const el = document.getElementById('export-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'save-status ' + (type || 'success');
    el.style.display = msg ? 'block' : 'none';
    if (msg) {
      setTimeout(() => {
        el.style.display = 'none';
      }, 6000);
    }
  },

  // 执行数据导出
  exportData: async function() {
    const includes = this._getExportIncludes();
    if (includes.length === 0) {
      utils.showNotification('请至少选择一项导出内容', 'warning');
      return;
    }

    const btn = document.getElementById('btn-export-data');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在导出...';
    }

    this._setExportProgress(true, '正在连接服务器...', 20);
    this._setExportStatus('');

    try {
      const include = includes.join(',');
      this._setExportProgress(true, '正在收集您的数据，请稍候...', 50);

      const res = await fetch(`/api/user/export-data?include=${encodeURIComponent(include)}`, {
        headers: userManager.getAuthHeaders()
      });

      this._setExportProgress(true, '数据已接收，正在生成文件...', 85);

      if (!res.ok) {
        let errMsg = '导出失败';
        try {
          const err = await res.json();
          errMsg = err.message || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      this._setExportProgress(true, '正在生成下载文件...', 95);

      // 生成 JSON 文件并触发下载
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `my-forum-data-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this._setExportProgress(false);
      this._setExportStatus(`数据导出成功！文件已开始下载（共 ${includes.length} 类数据）`, 'success');
      utils.showNotification('数据导出成功，文件已开始下载', 'success');
    } catch (error) {
      this._setExportProgress(false);
      this._setExportStatus('导出失败：' + error.message, 'error');
      utils.showNotification('数据导出失败：' + error.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> 导出数据';
      }
    }
  },

  // 预览数据量（不下载）
  previewExportData: async function() {
    const btn = document.getElementById('btn-export-preview');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 查询中...';
    }
    this._setExportStatus('');

    try {
      // 查询全部数据以获取数量统计
      const res = await fetch('/api/user/export-data', {
        headers: userManager.getAuthHeaders()
      });

      if (!res.ok) {
        let errMsg = '预览失败';
        try {
          const err = await res.json();
          errMsg = err.message || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await res.json();

      // 渲染预览面板
      const panel = document.getElementById('export-preview-panel');
      const content = document.getElementById('export-preview-content');
      if (!panel || !content) return;

      const items = [
        { key: 'profile',       label: '个人资料',   icon: 'fa-user-circle',   count: data.profile ? '已包含' : '-' },
        { key: 'posts',         label: '发布的帖子', icon: 'fa-file-alt',      count: (data.posts || []).length + ' 条' },
        { key: 'favorites',     label: '收藏记录',   icon: 'fa-star',          count: (data.favorites || []).length + ' 条' },
        { key: 'follows',       label: '关注 / 粉丝',icon: 'fa-users',         count: `关注 ${data.follows?.followingCount || 0} 人 / 粉丝 ${data.follows?.followerCount || 0} 人` },
        { key: 'conversations', label: '私信会话',   icon: 'fa-envelope',      count: (data.conversations || []).length + ' 个' },
        { key: 'notifications', label: '通知记录',   icon: 'fa-bell',          count: (data.notifications || []).length + ' 条（最近200条）' },
        { key: 'settings',      label: '账号设置',   icon: 'fa-cog',           count: data.settings ? '已包含' : '-' }
      ];

      const totalSize = Math.ceil(JSON.stringify(data).length / 1024);

      content.innerHTML = `
        <div class="export-preview-table">
          ${items.map(item => `
            <div class="export-preview-row">
              <span class="export-preview-label"><i class="fas ${item.icon}"></i> ${item.label}</span>
              <span class="export-preview-value">${item.count}</span>
            </div>
          `).join('')}
          <div class="export-preview-row export-preview-total">
            <span class="export-preview-label"><i class="fas fa-file-code"></i> 预估文件大小</span>
            <span class="export-preview-value">约 ${totalSize} KB</span>
          </div>
        </div>
        <p class="export-preview-hint"><i class="fas fa-info-circle"></i> 实际导出内容取决于您的勾选项</p>
      `;
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      this._setExportStatus('预览失败：' + error.message, 'error');
      utils.showNotification('数据预览失败：' + error.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-eye"></i> 预览数据量';
      }
    }
  },

  // ======== 数据导入 ========

  // 保存当前选中的导入文件内容
  _importFileData: null,

  // 文件选择处理器
  handleImportFileSelect: function(file) {
    if (!file) return;
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      utils.showNotification('请选择 JSON 格式的备份文件', 'warning');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      utils.showNotification('文件大小不能超过 10MB', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.exportVersion || !data.userId) {
          utils.showNotification('无效的备份文件格式', 'error');
          this._importFileData = null;
          return;
        }
        this._importFileData = data;

        // 显示文件信息
        const sizeKB = (file.size / 1024).toFixed(1);
        const preview = document.getElementById('import-file-preview');
        const fileName = document.getElementById('import-file-name');
        if (preview) {
          preview.style.display = 'flex';
          preview.innerHTML = `
            <i class="fas fa-file-code" style="color: var(--primary-color); font-size: 18px;"></i>
            <div>
              <strong>${this._escapeHtml(file.name)}</strong>
              <small>${sizeKB} KB · 导出时间：${data.exportedAt ? data.exportedAt.slice(0, 10) : '未知'}</small>
            </div>
            <button type="button" class="import-file-remove" id="import-file-remove-btn">
              <i class="fas fa-times"></i>
            </button>
          `;
          const removeBtn = document.getElementById('import-file-remove-btn');
          if (removeBtn) {
            removeBtn.addEventListener('click', () => {
              this._importFileData = null;
              document.getElementById('import-file-input').value = '';
              if (preview) preview.style.display = 'none';
              this._setImportButtonsEnabled(false);
            });
          }
        }
        // textContent 不会解析 HTML，无需（也不能）预先转义，否则文件名含 < > 会显示为 &lt; &gt;
        if (fileName) fileName.textContent = `已选择：${file.name}（${sizeKB} KB）`;

        this._setImportButtonsEnabled(true);
        this._hideImportResult();
      } catch (err) {
        utils.showNotification('JSON 解析失败：' + err.message, 'error');
        this._importFileData = null;
        this._setImportButtonsEnabled(false);
      }
    };
    reader.readAsText(file);
  },

  // 启用/禁用导入按钮
  _setImportButtonsEnabled: function(enabled) {
    const btnImport = document.getElementById('btn-import-data');
    const btnPreview = document.getElementById('btn-import-preview');
    if (btnImport) btnImport.disabled = !enabled;
    if (btnPreview) btnPreview.disabled = !enabled;
  },

  // 获取当前勾选的导入范围
  _getImportIncludes: function() {
    const map = {
      'import-posts':     'posts',
      'import-favorites': 'favorites',
      'import-follows':   'follows',
      'import-settings':  'settings'
    };
    const selected = [];
    Object.entries(map).forEach(([id, key]) => {
      const cb = document.getElementById(id);
      if (cb && cb.checked) selected.push(key);
    });
    return selected;
  },

  // 设置导入进度
  _setImportProgress: function(visible, text, percent) {
    const wrap = document.getElementById('import-progress');
    const textEl = document.getElementById('import-progress-text');
    const fill = document.getElementById('import-progress-fill');
    if (!wrap) return;
    wrap.style.display = visible ? 'block' : 'none';
    if (textEl && text !== undefined) textEl.textContent = text;
    if (fill && percent !== undefined) fill.style.width = percent + '%';
  },

  // 显示/隐藏导入结果面板
  _showImportResult: function(html) {
    const panel = document.getElementById('import-result-panel');
    const content = document.getElementById('import-result-content');
    if (!panel || !content) return;
    content.innerHTML = html;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _hideImportResult: function() {
    const panel = document.getElementById('import-result-panel');
    if (panel) panel.style.display = 'none';
  },

  // 设置导入状态
  _setImportStatus: function(msg, type) {
    const el = document.getElementById('import-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'save-status ' + (type || 'success');
    el.style.display = msg ? 'block' : 'none';
    if (msg) {
      setTimeout(() => { el.style.display = 'none'; }, 8000);
    }
  },

  // HTML 转义
  _escapeHtml: function(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // 预览导入
  previewImportData: async function() {
    if (!this._importFileData) {
      utils.showNotification('请先选择备份文件', 'warning');
      return;
    }
    const includes = this._getImportIncludes();
    if (includes.length === 0) {
      utils.showNotification('请至少选择一项导入内容', 'warning');
      return;
    }
    const btn = document.getElementById('btn-import-preview');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 解析中...'; }
    this._setImportStatus('');

    try {
      const data = this._importFileData;
      const typeLabels = { posts: '帖子', favorites: '收藏', follows: '关注', settings: '设置' };
      const rows = includes.map(key => {
        let count = '-';
        if (key === 'posts')     count = (data.posts || []).length + ' 条';
        if (key === 'favorites') count = (data.favorites || []).length + ' 条';
        if (key === 'follows')   count = (data.follows?.followingIds || []).length + ' 人';
        if (key === 'settings')  count = data.settings ? '待合并' : '无';
        return `<div class="export-preview-row">
          <span class="export-preview-label"><i class="fas fa-arrow-right" style="color: #16a34a;"></i> 导入：${typeLabels[key] || key}</span>
          <span class="export-preview-value">${count}</span>
        </div>`;
      }).join('');

      const summary = `
        <div class="export-preview-table">
          ${rows}
          <div class="export-preview-row export-preview-total">
            <span class="export-preview-label"><i class="fas fa-info-circle"></i> 说明</span>
            <span class="export-preview-value">帖子将使用新 ID；收藏需目标帖子同时存在；关注关系需对方账号仍存在</span>
          </div>
        </div>
        <p class="export-preview-hint"><i class="fas fa-lightbulb" style="color: var(--primary-color);"></i> 确认无误后点击「开始导入」</p>
      `;
      this._showImportResult(summary);
    } catch (error) {
      this._setImportStatus('预览失败：' + error.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-eye"></i> 预览导入'; }
    }
  },

  // 执行数据导入
  importData: async function() {
    if (!this._importFileData) {
      utils.showNotification('请先选择备份文件', 'warning');
      return;
    }
    const includes = this._getImportIncludes();
    if (includes.length === 0) {
      utils.showNotification('请至少选择一项导入内容', 'warning');
      return;
    }

    const btn = document.getElementById('btn-import-data');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在导入...'; }

    this._hideImportResult();
    this._setImportProgress(true, '正在解析备份文件...', 20);
    this._setImportStatus('');

    try {
      const jsonStr = JSON.stringify(this._importFileData);
      this._setImportProgress(true, '正在上传数据，请稍候...', 40);

      const res = await fetch(`/api/user/import-data`, {
        method: 'POST',
        headers: {
          ...userManager.getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: jsonStr
      });

      this._setImportProgress(true, '正在处理数据...', 75);

      if (!res.ok) {
        let errMsg = '导入失败';
        try {
          const err = await res.json();
          errMsg = err.message || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const result = await res.json();
      const rd = result.data?.data || result.data || {};

      this._setImportProgress(true, '导入完成！', 100);

      // 渲染导入结果
      const resultItems = [
        { label: '帖子', icon: 'fa-file-alt', imported: rd.postsImported, skipped: rd.postsSkipped },
        { label: '收藏', icon: 'fa-star', imported: rd.favoritesImported, skipped: rd.favoritesSkipped },
        { label: '关注', icon: 'fa-users', imported: rd.followsImported, skipped: rd.followsSkipped }
      ];

      const rowsHtml = resultItems.map(item => `
        <div class="import-result-row">
          <div class="import-result-row-header">
            <i class="fas ${item.icon}"></i> ${item.label}
          </div>
          <div class="import-result-row-stats">
            <span class="import-stat-success"><i class="fas fa-check"></i> 成功 ${item.imported || 0}</span>
            <span class="import-stat-skip"><i class="fas fa-minus"></i> 跳过 ${item.skipped || 0}</span>
          </div>
        </div>
      `).join('');

      const settingsNote = rd.settingsApplied
        ? '<div class="import-result-row"><div class="import-result-row-header"><i class="fas fa-cog"></i> 账号设置</div><div class="import-result-row-stats"><span class="import-stat-success"><i class="fas fa-check"></i> 已合并</span></div></div>'
        : '';

      const summaryHtml = `
        <div class="import-result-summary">
          <i class="fas fa-check-circle import-result-icon"></i>
          <div>
            <strong>数据导入完成！</strong>
            <p>以下数据已成功同步到您的当前账号</p>
          </div>
        </div>
        <div class="import-result-rows">${rowsHtml}${settingsNote}</div>
        <p class="export-preview-hint">
          <i class="fas fa-info-circle"></i> 导入过程中跳过的项目不影响账号安全，个人资料未被覆盖。
        </p>
      `;
      this._showImportResult(summaryHtml);
      this._setImportStatus('数据导入成功！', 'success');
      utils.showNotification('数据导入成功！', 'success');

      // 清空文件选择
      setTimeout(() => {
        document.getElementById('import-file-input').value = '';
        const preview = document.getElementById('import-file-preview');
        if (preview) preview.style.display = 'none';
        this._importFileData = null;
        this._setImportButtonsEnabled(false);
      }, 3000);
    } catch (error) {
      this._setImportProgress(false);
      this._setImportStatus('导入失败：' + error.message, 'error');
      utils.showNotification('数据导入失败：' + error.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> 开始导入'; }
    }
  }
};

// 自动检测系统主题并应用（仅当当前主题为auto时）
function setupAutoThemeDetection() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // 检查当前主题是否为auto
  if (window.userManager.state.settings.theme === 'auto') {
    const systemTheme = mediaQuery.matches ? 'dark' : 'light';
    window.userManager.applyTheme(systemTheme);
  }
  
  // 监听系统主题变化
  mediaQuery.addEventListener('change', (e) => {
    if (window.userManager.state.settings.theme === 'auto') {
      const newTheme = e.matches ? 'dark' : 'light';
      console.log('系统主题变化，应用新主题:', newTheme);
      window.userManager.applyTheme(newTheme);
    }
  });
}

// 页面加载完成后初始化自动主题检测
document.addEventListener('DOMContentLoaded', () => {
  if (window.userManager && window.userManager.state.currentUser) {
    setupAutoThemeDetection();
  }
});

// 将 settingsManager 挂载到 window（const 声明不会自动挂到 window）
window.settingsManager = settingsManager;

console.log('settings.js 文件执行完成');
console.log('window.settingsManager:', window.settingsManager);