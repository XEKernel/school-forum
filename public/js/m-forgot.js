/* 移动端找回密码页 */
(function () {
  'use strict';

  var captchaId = null;
  var counting = false;

  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }

  async function loadCaptcha() {
    var img = $('fg-captcha-img');
    try {
      var res = await fetch('/api/captcha', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('验证码加载失败');
      captchaId = res.headers.get('X-Captcha-Id');
      var svg = await res.text();
      var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      if (img.dataset.blob) URL.revokeObjectURL(img.dataset.blob);
      img.dataset.blob = url;
      img.src = url;
    } catch (e) {
      mApp.toast('图形验证码加载失败，请点击图片重试', 'error');
    }
  }

  async function sendCode() {
    if (counting) return;
    var qq = val('fg-qq');
    var email = val('fg-email');
    var capCode = val('fg-captcha-code');

    if (!qq) return mApp.toast('请输入QQ号', 'warning');
    if (!email) return mApp.toast('请输入邮箱', 'warning');
    if (!capCode) return mApp.toast('请先输入图形验证码', 'warning');

    var btn = $('fg-send');
    btn.disabled = true;
    try {
      await mApp.api.post('/api/forgot-password/send-code', {
        qq: qq, email: email, captchaId: captchaId, captchaCode: capCode
      });
      mApp.toast('验证码已发送到邮箱', 'success');

      counting = true;
      var left = 60;
      btn.textContent = left + 's 后重发';
      var timer = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          counting = false;
          btn.disabled = false;
          btn.textContent = '获取验证码';
        } else {
          btn.textContent = left + 's 后重发';
        }
      }, 1000);
    } catch (e) {
      loadCaptcha();
      $('fg-captcha-code').value = '';
      btn.disabled = false;
    }
  }

  async function submit(e) {
    e.preventDefault();
    var qq = val('fg-qq');
    var email = val('fg-email');
    var code = val('fg-code');
    var newPassword = val('fg-password');

    if (!qq) return mApp.toast('请输入QQ号', 'warning');
    if (!email) return mApp.toast('请输入邮箱', 'warning');
    if (!code) return mApp.toast('请输入邮箱验证码', 'warning');
    if (!newPassword) return mApp.toast('请输入新密码', 'warning');

    var btn = $('fg-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中…';
    try {
      await mApp.api.post('/api/forgot-password/reset', {
        qq: qq, email: email, verificationCode: code, newPassword: newPassword
      });
      mApp.toast('密码已重置，请用新密码登录', 'success');
      setTimeout(function () { location.href = 'm-login.html'; }, 1200);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '重置密码';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-login.html';
    });
    $('fg-back-login').addEventListener('click', function () { location.href = 'm-login.html'; });
    $('fg-captcha-img').addEventListener('click', loadCaptcha);
    $('fg-send').addEventListener('click', sendCode);
    $('m-form').addEventListener('submit', submit);
    loadCaptcha();
  });
})();