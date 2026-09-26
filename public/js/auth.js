// 全局状态
const state = {
  currentUser: null,
  schools: [], // 存储学校配置
  captchaKeys: { login: null, register: null, admin: null } // 图形验证码 key
};

// DOM元素（登录页面专用）
const dom = {
  loginBtn: document.getElementById('confirm-login'),
  registerBtn: document.getElementById('confirm-register'),
  adminLoginBtn: document.getElementById('confirm-admin-login'),
  qqLogin: document.getElementById('qq-login'),
  qqAdmin: document.getElementById('qq-admin'),
  qqRegister: document.getElementById('qq-register'),
  usernameRegister: document.getElementById('username-register'),
  schoolRegister: document.getElementById('school-register'),
  enrollmentYearRegister: document.getElementById('enrollment-year-register'),
  classRegister: document.getElementById('class-register'),
  passwordLogin: document.getElementById('password-login'),
  passwordAdmin: document.getElementById('password-admin'),
  passwordRegister: document.getElementById('password-register'),
  confirmPassword: document.getElementById('confirm-password'),
  emailRegister: document.getElementById('email-register'),
  emailLogin: document.getElementById('email-login'),
  emailAdmin: document.getElementById('email-admin'),
  verificationCode: document.getElementById('verification-code'),
  verificationCodeLogin: document.getElementById('verification-code-login'),
  verificationCodeAdmin: document.getElementById('verification-code-admin'),
  sendVerificationCodeBtn: document.getElementById('send-verification-code'),
  sendLoginVerificationCodeBtn: document.getElementById('send-login-verification-code'),
  sendAdminVerificationCodeBtn: document.getElementById('send-admin-verification-code'),
  notificationArea: document.getElementById('notificationArea')
};

// 初始化函数
document.addEventListener('DOMContentLoaded', () => {
  // 先加载学校配置，再初始化年份选项
  loadSchoolsConfig().then(() => {
    // 学校配置加载完成后，初始化入学年份选项
    initEnrollmentYearOptions();
  });
  
  // 设置事件监听器
  setupEventListeners();
  
  // 加载图形验证码
  loadCaptcha('login');
  loadCaptcha('register');
  loadCaptcha('admin');
  
  // 检查 QQ 快捷登录是否已配置，配置后显示按钮
  checkQqLoginConfig();
  
  // 检查是否已登录，如果已登录则跳转到首页
  checkAutoLogin();
});

/**
 * QQ 快捷登录：检查服务端配置，已配置则显示按钮
 */
async function checkQqLoginConfig() {
  try {
    const resp = await fetch('/api/auth/qq/status');
    const data = await resp.json();
    const section = document.getElementById('qq-login-section');
    if (section && data && data.configured) {
      section.style.display = '';
    }
  } catch (e) {
    // 网络异常时静默隐藏 QQ 按钮
  }
}

/**
 * QQ 快捷登录：获取授权 URL 并跳转 QQ 授权页
 */
async function qqLoginStart() {
  try {
    const btn = document.getElementById('qq-login-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 跳转中...';
    }
    const resp = await fetch('/api/auth/qq/authorize-url?type=login');
    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.message || 'QQ登录未配置');
    }
    window.location.href = data.url;
  } catch (error) {
    console.error('QQ登录失败:', error);
    showNotification(error.message || 'QQ登录失败，请稍后重试', 'error');
    const btn = document.getElementById('qq-login-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fab fa-qq"></i> QQ 快捷登录';
    }
  }
}

// 加载学校配置
async function loadSchoolsConfig() {
  console.log('开始加载学校配置...');
  try {
    const response = await fetch('/api/schools');
    console.log('学校配置响应状态:', response.status);
    console.log('学校配置响应OK:', response.ok);
    
    if (!response.ok) {
      console.error('响应状态不正常:', response.status, response.statusText);
      throw new Error(`加载学校配置失败: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('学校配置响应数据:', data);
    console.log('data.success:', data.success);
    console.log('data.schools:', data.schools);
    
    if (data.success && data.schools) {
      state.schools = data.schools;
      console.log('加载的学校列表:', state.schools);
      initSchoolOptions();
    } else {
      console.error('学校配置数据格式错误:', {
        success: data.success,
        hasSchools: !!data.schools,
        schools: data.schools
      });
      showNotification('学校配置数据格式错误', 'error');
    }
  } catch (error) {
    console.error('加载学校配置失败:', error);
    console.error('错误详情:', error.message, error.stack);
    showNotification('加载学校配置失败: ' + error.message, 'error');
  }
}

// 初始化学校选项
function initSchoolOptions() {
  console.log('初始化学校选项，当前学校列表:', state.schools);
  const schoolSelect = document.getElementById('school-register');
  if (!schoolSelect) {
    console.error('未找到学校选择框元素');
    return;
  }
  
  console.log('学校选择框元素已找到');
  
  // 清空现有选项（保留第一个默认选项）
  schoolSelect.innerHTML = '<option value="">请选择学校</option>';
  
  // 添加学校选项
  state.schools.forEach((school, index) => {
    console.log(`添加学校选项 ${index}:`, school);
    const option = document.createElement('option');
    option.value = school.name;
    option.textContent = school.name;
    schoolSelect.appendChild(option);
  });
  
  console.log('学校选项添加完成，当前选项数量:', schoolSelect.options.length);
}

// 初始化入学年份选项（从配置动态加载）
function initEnrollmentYearOptions() {
  const enrollmentYearSelect = document.getElementById('enrollment-year-register');
  if (!enrollmentYearSelect || !state.schools || state.schools.length === 0) return;
  
  // 收集所有学校配置中的入学年份
  const years = new Set();
  state.schools.forEach(school => {
    if (school.classInfo && Array.isArray(school.classInfo)) {
      school.classInfo.forEach(info => {
        if (info.year) {
          years.add(info.year);
        }
      });
    }
  });
  
  // 转换为数组并排序
  const sortedYears = Array.from(years).sort((a, b) => b - a); // 降序排列，最新的年份在前
  
  // 清空现有选项（保留第一个默认选项）
  enrollmentYearSelect.innerHTML = '<option value="">请选择入学年份</option>';
  
  // 生成年份选项
  sortedYears.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = `${year}年`;
    enrollmentYearSelect.appendChild(option);
  });
}

// 学校选择变化处理
function onSchoolChange() {
  const schoolSelect = document.getElementById('school-register');
  const enrollmentYearSelect = document.getElementById('enrollment-year-register');
  const classSelect = document.getElementById('class-register');
  
  if (!schoolSelect || !enrollmentYearSelect || !classSelect) return;
  
  const selectedSchoolOption = schoolSelect.options[schoolSelect.selectedIndex];
  const selectedYearOption = enrollmentYearSelect.options[enrollmentYearSelect.selectedIndex];
  
  // 未选择学校
  if (!selectedSchoolOption || !selectedSchoolOption.value) {
    classSelect.disabled = true;
    classSelect.innerHTML = '<option value="">请先选择学校</option>';
    return;
  }
  
  // 未选择入学年份
  if (!selectedYearOption || !selectedYearOption.value) {
    classSelect.disabled = true;
    classSelect.innerHTML = '<option value="">请先选择入学年份</option>';
    return;
  }
  
  // 查找选中的学校配置
  const selectedSchool = state.schools.find(school => school.name === selectedSchoolOption.value);
  if (!selectedSchool || !selectedSchool.classInfo) {
    classSelect.disabled = true;
    classSelect.innerHTML = '<option value="">未找到班级配置</option>';
    return;
  }
  
  // 查找对应年份的班级数
  const enrollmentYear = parseInt(selectedYearOption.value);
  const classInfo = selectedSchool.classInfo.find(info => info.year === enrollmentYear);
  
  if (!classInfo || !classInfo.classCount) {
    classSelect.disabled = true;
    classSelect.innerHTML = '<option value="">该年份暂无班级配置</option>';
    return;
  }
  
  // 获取班级数量
  const classCount = classInfo.classCount;
  
  // 清空班级选项
  classSelect.innerHTML = '<option value="">请选择班级</option>';
  
  // 生成班级选项
  for (let i = 1; i <= classCount; i++) {
    const option = document.createElement('option');
    option.value = `${i}班`;
    option.textContent = `${i}班`;
    classSelect.appendChild(option);
  }
  
  // 启用班级选择
  classSelect.disabled = false;
}

// 检查自动登录，如果已登录则跳转到首页
function checkAutoLogin() {
  const savedUser = localStorage.getItem('forumUser');
  if (savedUser) {
    window.location.href = 'index.html';
  }
}

// 加载图形验证码
async function loadCaptcha(type) {
  try {
    const response = await fetch('/api/captcha');
    if (!response.ok) throw new Error('加载验证码失败');

    // 从响应头获取 captchaId（不再从 JSON body 获取，防止 SVG 文本被解析）
    const captchaId = response.headers.get('X-Captcha-Id');
    if (!captchaId) throw new Error('验证码ID缺失');
    state.captchaKeys[type] = captchaId;

    // 将 SVG 响应转为 blob URL，以图片形式显示（避免 innerHTML 注入风险）
    const svgText = await response.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const imgEl = document.getElementById(`captcha-img-${type}`);
    if (imgEl) {
      // 回收旧 blob URL
      const oldImg = imgEl.querySelector('img');
      if (oldImg && oldImg.src.startsWith('blob:')) {
        URL.revokeObjectURL(oldImg.src);
      }
      imgEl.innerHTML = `<img src="${url}" alt="验证码" style="width:150px;height:52px;cursor:pointer;" title="点击刷新验证码">`;
    }

    // 清空输入框
    const inputEl = document.getElementById(`captcha-code-${type}`);
    if (inputEl) inputEl.value = '';
  } catch (error) {
    console.error('加载验证码失败:', error);
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 表单切换
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(tab => {
    tab.addEventListener('click', () => {
      // 更新活动标签
      tabButtons.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 隐藏所有表单
      document.getElementById('login-form').classList.remove('active');
      document.getElementById('register-form').classList.remove('active');
      document.getElementById('admin-login-form').classList.remove('active');
      
      // 显示对应表单
      if (tab.dataset.tab === 'login') {
        document.getElementById('login-form').classList.add('active');
      } else if (tab.dataset.tab === 'register') {
        document.getElementById('register-form').classList.add('active');
      } else if (tab.dataset.tab === 'admin-login') {
        document.getElementById('admin-login-form').classList.add('active');
      }

      // QQ 快捷登录仅在用户登录/注册 tab 显示（管理员 tab 隐藏）
      const qqSection = document.getElementById('qq-login-section');
      if (qqSection) {
        qqSection.style.display = (tab.dataset.tab === 'admin-login') ? 'none' : '';
      }
    });
  });

  // 登录确认按钮
  if (dom.loginBtn) {
    dom.loginBtn.addEventListener('click', loginUser);
  }

  // 注册确认按钮
  if (dom.registerBtn) {
    dom.registerBtn.addEventListener('click', registerUser);
  }

  // 获取验证码按钮
  if (dom.sendVerificationCodeBtn) {
    dom.sendVerificationCodeBtn.addEventListener('click', sendVerificationCode);
  }

  // 登录页面获取验证码按钮
  if (dom.sendLoginVerificationCodeBtn) {
    dom.sendLoginVerificationCodeBtn.addEventListener('click', sendLoginVerificationCode);
  }

  // 管理员登录确认按钮
  if (dom.adminLoginBtn) {
    dom.adminLoginBtn.addEventListener('click', loginAdmin);
  }

  // 管理员获取验证码按钮
  if (dom.sendAdminVerificationCodeBtn) {
    dom.sendAdminVerificationCodeBtn.addEventListener('click', sendAdminVerificationCode);
  }

  // 学校选择变化事件
  if (dom.schoolRegister) {
    dom.schoolRegister.addEventListener('change', onSchoolChange);
  }

  // 入学年份变化事件
  if (dom.enrollmentYearRegister) {
    dom.enrollmentYearRegister.addEventListener('change', onSchoolChange);
  }

  // 密码强度检测
  if (dom.passwordRegister) {
    dom.passwordRegister.addEventListener('input', checkPasswordStrength);
  }

  // 图形验证码点击刷新
  ['login', 'register', 'admin'].forEach(type => {
    const img = document.getElementById(`captcha-img-${type}`);
    if (img) {
      img.addEventListener('click', () => loadCaptcha(type));
      img.style.cursor = 'pointer';
    }
  });

  // 回车键支持
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const activeForm = document.querySelector('.form-section.active');
      if (!activeForm) return;
      if (activeForm.id === 'login-form') {
        loginUser();
      } else if (activeForm.id === 'register-form') {
        registerUser();
      } else if (activeForm.id === 'admin-login-form') {
        loginAdmin();
      }
    }
  });
}

// 发送验证码
let verificationCodeTimer = null;
let countdownSeconds = 60;

async function sendVerificationCode() {
  const email = dom.emailRegister?.value.trim();
  
  if (!email) {
    showNotification('请输入邮箱地址', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (dom.sendVerificationCodeBtn) {
    dom.sendVerificationCodeBtn.disabled = true;
    dom.sendVerificationCodeBtn.classList.add('loading');
    dom.sendVerificationCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';
  }
  
  try {
    // 附带图形验证码防止滥用（注册表单使用 register 验证码）
    const captchaId = state.captchaKeys.register;
    const captchaCode = document.getElementById('captcha-code-register')?.value.trim() || '';

    const response = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, captchaId, captchaCode })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '发送验证码失败');
    }

    const data = await response.json();
    if (data.success) {
      showNotification('验证码已发送到您的邮箱，请查收', 'success');
      startCountdown();
    }
  } catch (error) {
    console.error('发送验证码失败:', error);
    showNotification(error.message || '发送验证码失败，请稍后重试', 'error');
    
    // 图形验证码为一次性，失败后必须刷新，否则下一次请求必然再次失败
    loadCaptcha('register');
    
    if (dom.sendVerificationCodeBtn) {
      dom.sendVerificationCodeBtn.disabled = false;
      dom.sendVerificationCodeBtn.classList.remove('loading');
      dom.sendVerificationCodeBtn.innerHTML = '获取验证码';
    }
  }
}

// 开始倒计时
function startCountdown() {
  if (verificationCodeTimer) clearInterval(verificationCodeTimer);
  countdownSeconds = 60;
  
  if (dom.sendVerificationCodeBtn) {
    dom.sendVerificationCodeBtn.disabled = true;
    dom.sendVerificationCodeBtn.classList.remove('loading');
    dom.sendVerificationCodeBtn.innerHTML = `${countdownSeconds}秒后重试`;
  }
  
  verificationCodeTimer = setInterval(() => {
    countdownSeconds--;
    
    if (countdownSeconds <= 0) {
      clearInterval(verificationCodeTimer);
      verificationCodeTimer = null;
      
      if (dom.sendVerificationCodeBtn) {
        dom.sendVerificationCodeBtn.disabled = false;
        dom.sendVerificationCodeBtn.innerHTML = '获取验证码';
      }
    } else {
      if (dom.sendVerificationCodeBtn) {
        dom.sendVerificationCodeBtn.innerHTML = `${countdownSeconds}秒后重试`;
      }
    }
  }, 1000);
}

// 登录页面发送验证码
let loginVerificationCodeTimer = null;
let loginCountdownSeconds = 60;

async function sendLoginVerificationCode() {
  const email = dom.emailLogin?.value.trim();
  
  if (!email) {
    showNotification('请输入邮箱地址', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (dom.sendLoginVerificationCodeBtn) {
    dom.sendLoginVerificationCodeBtn.disabled = true;
    dom.sendLoginVerificationCodeBtn.classList.add('loading');
    dom.sendLoginVerificationCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';
  }
  
  try {
    // 附带图形验证码防止滥用
    const captchaId = state.captchaKeys.login;
    const captchaCode = document.getElementById('captcha-code-login')?.value.trim() || '';

    const response = await fetch('/api/send-login-verification-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, captchaId, captchaCode })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '发送验证码失败');
    }

    const data = await response.json();
    if (data.success) {
      showNotification('验证码已发送到您的邮箱，请查收', 'success');
      startLoginCountdown();
    }
  } catch (error) {
    console.error('发送验证码失败:', error);
    showNotification(error.message || '发送验证码失败，请稍后重试', 'error');
    
    if (dom.sendLoginVerificationCodeBtn) {
      dom.sendLoginVerificationCodeBtn.disabled = false;
      dom.sendLoginVerificationCodeBtn.classList.remove('loading');
      dom.sendLoginVerificationCodeBtn.innerHTML = '获取验证码';
    }
  }
}

// 登录页面开始倒计时
function startLoginCountdown() {
  if (loginVerificationCodeTimer) clearInterval(loginVerificationCodeTimer);
  loginCountdownSeconds = 60;
  
  if (dom.sendLoginVerificationCodeBtn) {
    dom.sendLoginVerificationCodeBtn.disabled = true;
    dom.sendLoginVerificationCodeBtn.classList.remove('loading');
    dom.sendLoginVerificationCodeBtn.innerHTML = `${loginCountdownSeconds}秒后重试`;
  }
  
  loginVerificationCodeTimer = setInterval(() => {
    loginCountdownSeconds--;
    
    if (loginCountdownSeconds <= 0) {
      clearInterval(loginVerificationCodeTimer);
      loginVerificationCodeTimer = null;
      
      if (dom.sendLoginVerificationCodeBtn) {
        dom.sendLoginVerificationCodeBtn.disabled = false;
        dom.sendLoginVerificationCodeBtn.innerHTML = '获取验证码';
      }
    } else {
      if (dom.sendLoginVerificationCodeBtn) {
        dom.sendLoginVerificationCodeBtn.innerHTML = `${loginCountdownSeconds}秒后重试`;
      }
    }
  }, 1000);
}

// 管理员页面发送验证码
let adminVerificationCodeTimer = null;
let adminCountdownSeconds = 60;

async function sendAdminVerificationCode() {
  const email = dom.emailAdmin?.value.trim();
  
  if (!email) {
    showNotification('请输入邮箱地址', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (dom.sendAdminVerificationCodeBtn) {
    dom.sendAdminVerificationCodeBtn.disabled = true;
    dom.sendAdminVerificationCodeBtn.classList.add('loading');
    dom.sendAdminVerificationCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';
  }
  
  try {
    // 附带图形验证码防止滥用（注册表单使用 register 验证码）
    const captchaId = state.captchaKeys.register;
    const captchaCode = document.getElementById('captcha-code-register')?.value.trim() || '';

    const response = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, captchaId, captchaCode })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '发送验证码失败');
    }

    const data = await response.json();
    if (data.success) {
      showNotification('验证码已发送到您的邮箱，请查收', 'success');
      startAdminCountdown();
    }
  } catch (error) {
    console.error('发送验证码失败:', error);
    showNotification(error.message || '发送验证码失败，请稍后重试', 'error');
    
    if (dom.sendAdminVerificationCodeBtn) {
      dom.sendAdminVerificationCodeBtn.disabled = false;
      dom.sendAdminVerificationCodeBtn.classList.remove('loading');
      dom.sendAdminVerificationCodeBtn.innerHTML = '获取验证码';
    }
  }
}

// 管理员页面开始倒计时
function startAdminCountdown() {
  if (adminVerificationCodeTimer) clearInterval(adminVerificationCodeTimer);
  adminCountdownSeconds = 60;
  
  if (dom.sendAdminVerificationCodeBtn) {
    dom.sendAdminVerificationCodeBtn.disabled = true;
    dom.sendAdminVerificationCodeBtn.classList.remove('loading');
    dom.sendAdminVerificationCodeBtn.innerHTML = `${adminCountdownSeconds}秒后重试`;
  }
  
  adminVerificationCodeTimer = setInterval(() => {
    adminCountdownSeconds--;
    
    if (adminCountdownSeconds <= 0) {
      clearInterval(adminVerificationCodeTimer);
      adminVerificationCodeTimer = null;
      
      if (dom.sendAdminVerificationCodeBtn) {
        dom.sendAdminVerificationCodeBtn.disabled = false;
        dom.sendAdminVerificationCodeBtn.innerHTML = '获取验证码';
      }
    } else {
      if (dom.sendAdminVerificationCodeBtn) {
        dom.sendAdminVerificationCodeBtn.innerHTML = `${adminCountdownSeconds}秒后重试`;
      }
    }
  }, 1000);
}

// 用户注册
async function registerUser() {
  // 获取表单值
  const qq = dom.qqRegister?.value.trim();
  const username = dom.usernameRegister?.value.trim();
  const password = dom.passwordRegister?.value;
  const confirmPassword = dom.confirmPassword?.value;
  const email = dom.emailRegister?.value.trim();
  const verificationCode = dom.verificationCode?.value.trim();
  const school = dom.schoolRegister?.value;
  const enrollmentYear = parseInt(dom.enrollmentYearRegister?.value);
  const className = dom.classRegister?.value;
  const birthday = document.getElementById('birthday-register')?.value || null;
  const gender = document.getElementById('gender-register')?.value || '';
  const captchaId = state.captchaKeys.register;
  const captchaCode = document.getElementById('captcha-code-register')?.value.trim();
  
  // 验证输入
  if (!qq) {
    showNotification('QQ号不能为空', 'error');
    return;
  }
  
  if (!username) {
    showNotification('用户名不能为空', 'error');
    return;
  }
  
  if (!password) {
    showNotification('密码不能为空', 'error');
    return;
  }
  
  if (password !== confirmPassword) {
    showNotification('两次输入的密码不一致', 'error');
    return;
  }
  
  if (!email) {
    showNotification('邮箱不能为空', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (!verificationCode) {
    showNotification('请输入验证码', 'error');
    return;
  }
  
  if (!captchaCode) {
    showNotification('请输入图形验证码', 'error');
    return;
  }
  
  if (!school || !enrollmentYear || !className) {
    showNotification('请选择学校、入学年份和班级', 'error');
    return;
  }
  
  if (dom.registerBtn) {
    dom.registerBtn.disabled = true;
    dom.registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 注册中...';
  }
  
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        qq,
        username,
        password,
        email,
        verificationCode,
        school,
        enrollmentYear,
        className,
        birthday,
        gender,
        captchaId,
        captchaCode
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '注册失败');
    }
    
    const data = await response.json();
    if (data.success) {
      state.currentUser = data.user;
      localStorage.setItem('forumUser', JSON.stringify(data.user));
      // 令牌由服务端写入 HttpOnly Cookie（JS 读不到，XSS 偷不走），前端不再落 localStorage
      
      showNotification(`注册成功，欢迎 ${data.user.username}！正在跳转...`, 'success');
      
      // 延迟跳转，让用户看到提示
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
    }
  } catch (error) {
    console.error('注册失败:', error);
    showNotification(error.message || '注册失败，请稍后重试', 'error');
    loadCaptcha('register'); // 刷新图形验证码
  } finally {
    if (dom.registerBtn) {
      dom.registerBtn.disabled = false;
      dom.registerBtn.innerHTML = '立即注册';
    }
  }
}

// 用户登录
async function loginUser() {
  const email = dom.emailLogin?.value.trim();
  const qq = dom.qqLogin?.value.trim();
  const password = dom.passwordLogin?.value;
  const verificationCode = dom.verificationCodeLogin?.value.trim();
  const captchaId = state.captchaKeys.login;
  const captchaCode = document.getElementById('captcha-code-login')?.value.trim();
  
  if (!email) {
    showNotification('邮箱不能为空', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (!qq) {
    showNotification('QQ号不能为空', 'error');
    return;
  }
  
  if (!password) {
    showNotification('密码不能为空', 'error');
    return;
  }
  
  if (!verificationCode) {
    showNotification('验证码不能为空', 'error');
    return;
  }
  
  if (!captchaCode) {
    showNotification('请输入图形验证码', 'error');
    return;
  }
  
  if (dom.loginBtn) {
    dom.loginBtn.disabled = true;
    dom.loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登录中...';
  }
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        qq,
        password,
        verificationCode,
        captchaId,
        captchaCode
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '登录失败');
    }

    const data = await response.json();
    if (data.success) {
      // 添加管理员标记到用户信息
      const userData = data.user;
      if (data.isAdmin) {
        userData.isAdmin = true;
      }

      state.currentUser = userData;
      localStorage.setItem('forumUser', JSON.stringify(userData));
      // 令牌由服务端写入 HttpOnly Cookie（access/refresh/admin 三件套），前端不再保存
      
      // 检查是否是管理员
      if (userData.isAdmin) {
        showNotification(`管理员 ${userData.username} 登录成功！正在跳转到管理后台...`, 'success');
      } else {
        showNotification(`欢迎回来，${userData.username}！正在跳转...`, 'success');
      }
      
      // 新设备登录提示走站内消息（消息页可见），不再弹窗
      // 延迟跳转：普通登录一律进入首页
      // （管理员账号在普通 tab 登录也进首页，避免被强制拉进管理后台；
      //   管理后台请通过首页导航栏"管理后台"入口进入，或使用管理员登录 tab）
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
    }
  } catch (error) {
    console.error('登录失败:', error);
    showNotification(error.message || '登录失败，请检查输入信息', 'error');
    loadCaptcha('login'); // 刷新图形验证码
  } finally {
    if (dom.loginBtn) {
      dom.loginBtn.disabled = false;
      dom.loginBtn.innerHTML = '立即登录';
    }
  }
}

// 管理员登录
async function loginAdmin() {
  const email = dom.emailAdmin?.value.trim();
  const qq = dom.qqAdmin?.value.trim();
  const password = dom.passwordAdmin?.value;
  const verificationCode = dom.verificationCodeAdmin?.value.trim();
  const captchaId = state.captchaKeys.admin;
  const captchaCode = document.getElementById('captcha-code-admin')?.value.trim();
  
  if (!email) {
    showNotification('管理员邮箱不能为空', 'error');
    return;
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showNotification('请输入有效的邮箱地址', 'error');
    return;
  }
  
  if (!qq) {
    showNotification('管理员QQ号不能为空', 'error');
    return;
  }
  
  if (!password) {
    showNotification('管理员密码不能为空', 'error');
    return;
  }
  
  if (!verificationCode) {
    showNotification('验证码不能为空', 'error');
    return;
  }
  
  if (!captchaCode) {
    showNotification('请输入图形验证码', 'error');
    return;
  }
  
  if (dom.adminLoginBtn) {
    dom.adminLoginBtn.disabled = true;
    dom.adminLoginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证中...';
  }
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        qq,
        password,
        verificationCode,
        captchaId,
        captchaCode
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '登录失败');
    }

    const data = await response.json();
    if (data.success) {
      // 检查是否是管理员
      if (!data.isAdmin) {
        throw new Error('您不是管理员，无法访问后台管理');
      }

      // 添加管理员标记到用户信息
      const userData = data.user;
      userData.isAdmin = true;
      
      state.currentUser = userData;
      localStorage.setItem('forumUser', JSON.stringify(userData));
      // 令牌由服务端写入 HttpOnly Cookie（含 admin token），前端不再保存
      
      showNotification(`管理员 ${userData.username} 登录成功！正在跳转到管理后台...`, 'success');
      
      // 新设备登录提示走站内消息，不再弹窗
      // 延迟跳转到管理后台
      setTimeout(() => {
        window.location.href = 'admin.html';
      }, 1500);
    }
  } catch (error) {
    console.error('管理员登录失败:', error);
    showNotification(error.message || '管理员登录失败，请检查QQ号和密码', 'error');
    loadCaptcha('admin'); // 刷新图形验证码
  } finally {
    if (dom.adminLoginBtn) {
      dom.adminLoginBtn.disabled = false;
      dom.adminLoginBtn.innerHTML = '管理员登录';
    }
  }
}

// 密码强度检测
function checkPasswordStrength() {  const password = dom.passwordRegister?.value || '';
  const strengthMeter = document.getElementById('password-strength-register');
  const strengthText = document.getElementById('password-strength-text');
  
  if (!strengthMeter || !strengthText) return;
  
  // 计算密码强度
  let strength = 0;
  let tips = [];
  
  // 长度检查
  if (password.length >= 6) {
    strength++;
  } else {
    tips.push('至少6位');
  }
  
  if (password.length >= 10) {
    strength++;
  }
  
  // 包含大写字母
  if (/[A-Z]/.test(password)) {
    strength++;
  } else {
    tips.push('大写字母');
  }
  
  // 包含小写字母
  if (/[a-z]/.test(password)) {
    strength++;
  } else {
    tips.push('小写字母');
  }
  
  // 包含数字
  if (/[0-9]/.test(password)) {
    strength++;
  } else {
    tips.push('数字');
  }
  
  // 包含特殊字符
  if (/[^A-Za-z0-9]/.test(password)) {
    strength++;
  } else {
    tips.push('特殊字符');
  }
  
  // 更新强度条
  let width = 0;
  let color = '';
  let text = '';
  
  if (password.length === 0) {
    width = 0;
    color = '#e0e0e0';
    text = '请输入密码';
  } else if (strength <= 2) {
    width = 25;
    color = '#f44336';
    text = '弱 - 建议包含: ' + tips.slice(0, 3).join('、');
  } else if (strength <= 4) {
    width = 50;
    color = '#ff9800';
    text = '中等 - 建议包含: ' + tips.slice(0, 2).join('、');
  } else if (strength <= 5) {
    width = 75;
    color = '#4caf50';
    text = '较强';
  } else {
    width = 100;
    color = '#2e7d32';
    text = '强';
  }
  
  strengthMeter.style.width = width + '%';
  strengthMeter.style.backgroundColor = color;
  strengthText.textContent = text;
  strengthText.style.color = color;
}

// 消息通知函数
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification-message ${type}`;
  
  notification.innerHTML = `
    <i class="fas fa-${
      type === 'success' ? 'check-circle' : 
      type === 'error' ? 'exclamation-circle' : 'info-circle'
    }"></i>
    <span>${message}</span>
  `;
  
  if (dom.notificationArea) {
    dom.notificationArea.appendChild(notification);
    
    // 添加动画效果
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);
    
    // 自动移除通知
    setTimeout(() => {
      notification.classList.remove('show');
      notification.classList.add('hide');
      
      // 等待动画完成再移除元素
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  }
}

