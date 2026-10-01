/* 移动端登录 / 注册页 */
(function () {
  'use strict';

  var captcha = { login: null, register: null };
  var counting = { login: false, register: false };

  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }

  function redirectTarget() {
    var r = new URLSearchParams(location.search).get('redirect');
    return r || 'm-index.html';
  }

  // ---------- 图形验证码 ----------
  async function loadCaptcha(which) {
    var img = $(which === 'login' ? 'lg-captcha-img' : 'rg-captcha-img');
    try {
      var res = await fetch('/api/captcha', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('验证码加载失败');
      var id = res.headers.get('X-Captcha-Id');
      var svg = await res.text();
      captcha[which] = id;
      var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      if (img.dataset.blob) URL.revokeObjectURL(img.dataset.blob);
      img.dataset.blob = url;
      img.src = url;
    } catch (e) {
      mApp.toast('图形验证码加载失败，请点击图片重试', 'error');
    }
  }

  // ---------- 发送邮箱验证码（带 60s 倒计时） ----------
  async function sendCode(which) {
    if (counting[which]) return;
    var email = val(which === 'login' ? 'lg-email' : 'rg-email');
    var capId = captcha[which];
    var capCode = val(which === 'login' ? 'lg-captcha-code' : 'rg-captcha-code');

    if (!email) { mApp.toast('请先填写邮箱', 'warning'); return; }
    if (!capCode) { mApp.toast('请先输入图形验证码', 'warning'); return; }

    var btn = $(which === 'login' ? 'lg-send' : 'rg-send');
    btn.disabled = true;
    try {
      var url = which === 'login' ? '/api/send-login-verification-code' : '/api/send-verification-code';
      await mApp.api.post(url, { email: email, captchaId: capId, captchaCode: capCode });
      mApp.toast('验证码已发送到邮箱', 'success');

      counting[which] = true;
      var left = 60;
      btn.textContent = left + 's 后重发';
      var timer = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          counting[which] = false;
          btn.disabled = false;
          btn.textContent = '获取验证码';
        } else {
          btn.textContent = left + 's 后重发';
        }
      }, 1000);
    } catch (e) {
      // 图形验证码一次性消费：失败后刷新
      loadCaptcha(which);
      var capInput = $(which === 'login' ? 'lg-captcha-code' : 'rg-captcha-code');
      if (capInput) capInput.value = '';
      btn.disabled = false;
    }
  }

  // ---------- 登录 / 注册提交 ----------
  async function doLogin(e) {
    e.preventDefault();
    var email = val('lg-email');
    var qq = val('lg-qq');
    var password = val('lg-password');
    var code = val('lg-code');

    if (!email) return mApp.toast('请输入邮箱', 'warning');
    if (!qq) return mApp.toast('请输入QQ号', 'warning');
    if (!password) return mApp.toast('请输入密码', 'warning');
    if (!code) return mApp.toast('请输入邮箱验证码', 'warning');

    var btn = $('lg-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登录中…';
    try {
      var data = await mApp.api.post('/api/login', {
        email: email, qq: qq, password: password, verificationCode: code
      });
      var user = (data && data.user) || {};
      if (data && data.isAdmin) user.isAdmin = true;
      localStorage.setItem('forumUser', JSON.stringify(user));
      mApp.toast('登录成功，正在跳转…', 'success');
      setTimeout(function () { location.href = redirectTarget(); }, 800);
    } catch (err) {
      loadCaptcha('login');
      $('lg-captcha-code').value = '';
      btn.disabled = false;
      btn.textContent = '登录';
    }
  }

  async function doRegister(e) {
    e.preventDefault();
    var payload = {
      email: val('rg-email'),
      qq: val('rg-qq'),
      username: val('rg-username'),
      password: val('rg-password'),
      school: val('rg-school'),
      enrollmentYear: val('rg-year'),
      className: val('rg-class'),
      verificationCode: val('rg-code')
    };

    if (!payload.email) return mApp.toast('请输入邮箱', 'warning');
    if (!payload.qq) return mApp.toast('请输入QQ号', 'warning');
    if (!payload.username) return mApp.toast('请输入用户名', 'warning');
    if (!payload.password) return mApp.toast('请输入密码', 'warning');
    if (!payload.school) return mApp.toast('请输入学校名称', 'warning');
    if (!payload.className) return mApp.toast('请输入班级', 'warning');
    if (!payload.verificationCode) return mApp.toast('请输入邮箱验证码', 'warning');

    var btn = $('rg-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 注册中…';
    try {
      var data = await mApp.api.post('/api/register', payload);
      var user = (data && data.user) || {};
      if (user && user.username) {
        localStorage.setItem('forumUser', JSON.stringify(user));
      }
      mApp.toast('注册成功，正在跳转…', 'success');
      setTimeout(function () { location.href = 'm-index.html'; }, 900);
    } catch (err) {
      loadCaptcha('register');
      $('rg-captcha-code').value = '';
      btn.disabled = false;
      btn.textContent = '注册';
    }
  }

  // ---------- QQ 快捷登录 ----------
  async function initQQ() {
    try {
      var res = await fetch('/api/auth/qq/status', { credentials: 'same-origin' });
      var data = await res.json();
      if (data && data.configured) $('m-qq-wrap').style.display = '';
    } catch (e) { /* 未配置则隐藏 */ }
  }

  async function qqLogin() {
    var btn = $('m-qq-login');
    btn.disabled = true;
    try {
      var res = await fetch('/api/auth/qq/authorize-url?type=login', { credentials: 'same-origin' });
      var data = await res.json();
      if (!data.success) throw new Error(data.message || 'QQ 登录未配置');
      location.href = data.url;
    } catch (e) {
      mApp.toast(e.message || 'QQ 登录失败', 'error');
      btn.disabled = false;
    }
  }

  // ---------- 初始化 ----------
  document.addEventListener('DOMContentLoaded', function () {
    // 顶部返回
    $('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-index.html';
    });

    // 切换 登录/注册
    $('m-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      $('m-tabs').querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      $('form-login').style.display = tab === 'login' ? '' : 'none';
      $('form-register').style.display = tab === 'register' ? '' : 'none';
      if (!captcha[tab]) loadCaptcha(tab);
    });

    // 图形验证码点击刷新
    $('lg-captcha-img').addEventListener('click', function () { loadCaptcha('login'); });
    $('rg-captcha-img').addEventListener('click', function () { loadCaptcha('register'); });

    // 发送验证码
    $('lg-send').addEventListener('click', function () { sendCode('login'); });
    $('rg-send').addEventListener('click', function () { sendCode('register'); });

    // 提交
    $('form-login').addEventListener('submit', doLogin);
    $('form-register').addEventListener('submit', doRegister);

    // 忘记密码
    $('lg-forgot').addEventListener('click', function () { location.href = 'm-forgot.html'; });

    // QQ 登录
    $('m-qq-login').addEventListener('click', qqLogin);

    // 入学年份选项
    var now = new Date().getFullYear();
    var opts = '';
    for (var y = now; y >= now - 8; y--) opts += '<option value="' + y + '">' + y + ' 年</option>';
    $('rg-year').innerHTML = opts;
    $('rg-year').value = String(now);

    // 学校候选
    mApp.api.get('/api/schools', { silent: true }).then(function (d) {
      var list = (d && d.schools) || [];
      $('m-schools').innerHTML = list.map(function (s) {
        return '<option value="' + mApp.escape(s.name) + '"></option>';
      }).join('');
    }).catch(function () {});

    // 初始验证码
    loadCaptcha('login');
    initQQ();

    // 外部入口直接打开注册标签（?tab=register 或 ?register=true）
    var qs = new URLSearchParams(location.search);
    if (qs.get('tab') === 'register' || qs.get('register') === 'true') {
      var rBtn = $('m-tabs').querySelector('button[data-tab="register"]');
      if (rBtn) rBtn.click();
    }

    // 已登录则直接回去
    mApp.auth.init().then(function (u) {
      if (u) {
        mApp.toast('你已登录，正在跳转…', 'info');
        setTimeout(function () { location.href = redirectTarget(); }, 700);
      }
    });
  });
})();