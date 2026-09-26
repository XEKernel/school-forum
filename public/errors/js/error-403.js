/**
 * 403 页交互（原为 403.html 内联 <script>，CSP 收紧后抽成外部文件）
 *
 * 说明：原实现读的是 localStorage 里的 'token' / 'user'，这两个键在本项目里
 * 并不存在（登录态用的是 'forumUser'，令牌已改为 HttpOnly Cookie、前端读不到），
 * 因此「当前用户」永远显示未登录。这里统一改读 'forumUser'，并去掉无意义的令牌判据。
 */
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtmlLocal = (value) => String(value).replace(/[&<>"']/g, c => ESCAPE_MAP[c]);

function getSavedUser() {
  try {
    const raw = localStorage.getItem('forumUser');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function renderUserInfo() {
  const userData = getSavedUser();
  const userInfo = document.getElementById('userInfo');
  if (!userInfo) return;
  if (userData) {
    userInfo.innerHTML = `
            <i class="fas fa-user"></i>
            <span>当前用户: ${escapeHtmlLocal(userData.username || '未知用户')}</span>
            <span style="color: var(--error-color); margin-left: 10px;">(非管理员)</span>
          `;
  } else {
    userInfo.innerHTML = `
            <i class="fas fa-user-times"></i>
            <span>未登录</span>
          `;
  }
}

// 检查用户登录状态
function checkLoginStatus() {
  try {
    const userData = getSavedUser();

    if (userData) {
      // 用户已登录，但可能不是管理员
      renderUserInfo();

      // 提供重新登录选项
      if (confirm('您当前不是管理员账号。是否要重新登录？')) {
        localStorage.removeItem('forumUser');
        window.location.href = '../login.html';
      }
    } else {
      // 用户未登录，跳转到登录页面
      window.location.href = '../login.html';
    }
  } catch (error) {
    console.error('检查登录状态时出错:', error);
    window.location.href = '../login.html';
  }
}

// 页面加载时渲染用户信息
document.addEventListener('DOMContentLoaded', function () {
  try {
    renderUserInfo();
  } catch (error) {
    console.error('初始化用户信息时出错:', error);
  }
});

// 自动跳转到登录页面的倒计时
let redirectTimer = null;
function startRedirectTimer() {
  let seconds = 10;
  const timerElement = document.createElement('div');
  timerElement.style.cssText = `
        margin-top: 15px;
        font-size: 14px;
        color: var(--text-light);
      `;
  document.querySelector('.error-actions').parentNode.insertBefore(timerElement, document.querySelector('.error-actions'));

  redirectTimer = setInterval(() => {
    seconds--;
    timerElement.innerHTML = `<i class="fas fa-clock"></i> ${seconds}秒后自动跳转到登录页面...`;

    if (seconds <= 0) {
      clearInterval(redirectTimer);
      window.location.href = '../login.html';
    }
  }, 1000);
}

// 如果用户未登录，启动倒计时
setTimeout(() => {
  if (!getSavedUser()) {
    startRedirectTimer();
  }
}, 5000);