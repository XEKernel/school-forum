/**
 * QQ 授权回调处理页
 * 流程：QQ 授权 → 服务端 /api/auth/qq/callback 处理 → 302 到本页 ?state=xxx
 * 本页读取 state → GET /api/auth/qq/result 获取最终结果：
 *   - 登录成功（needProfile=false）→ 存 token 跳首页
 *   - 新用户（needProfile=true）→ 跳 qq-register.html 补全资料
 *   - 绑定场景（type=bind）→ 显示绑定结果
 *   - error 参数 → 显示错误
 */
(function () {
  const $ = (id) => document.getElementById(id);

  function setStatus(title, subtitle, html, showBack) {
    if (title) $('callback-title').textContent = title;
    if (subtitle) $('callback-subtitle').textContent = subtitle;
    if (html !== undefined) $('callback-status').innerHTML = html;
    if (showBack) $('callback-back').style.display = '';
  }

  function errorHtml(message) {
    return `
      <div class="qq-callback-result error">
        <i class="fas fa-exclamation-circle"></i>
        <p>${escapeHtml(message)}</p>
        <a href="login.html" class="login-button" style="text-align:center;text-decoration:none;">返回登录页</a>
      </div>`;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 保存登录态（与 auth.js 一致）
  // 令牌由服务端写入 HttpOnly Cookie，前端只保存展示用的用户信息
  function saveAuth(data) {
    localStorage.setItem('forumUser', JSON.stringify(data.user));
  }

  async function main() {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') || '';
    const error = params.get('error');
    const message = params.get('message') || '';

    // 服务端回调出错
    if (error) {
      setStatus('QQ 授权失败', '未能完成 QQ 授权', errorHtml(message || 'QQ授权失败，请重试'), true);
      return;
    }

    if (!state) {
      setStatus('QQ 授权失败', '缺少授权参数', errorHtml('授权参数缺失，请重新从登录页发起'), true);
      return;
    }

    // 获取处理结果
    try {
      const resp = await fetch(`/api/auth/qq/result?state=${encodeURIComponent(state)}`);
      const data = await resp.json();

      if (!data.success) {
        setStatus('QQ 授权失败', '授权会话已过期', errorHtml(data.message || '请重新从登录页发起 QQ 登录'), true);
        return;
      }

      const result = data.result || {};

      // ===== 绑定场景 =====
      if (data.type === 'bind') {
        if (result.bound) {
          setStatus('QQ 绑定成功', '您的账号已绑定 QQ', `
            <div class="qq-callback-result success">
              <i class="fas fa-check-circle"></i>
              <p>${result.same ? '该 QQ 已绑定当前账号' : 'QQ 绑定成功，可通过 QQ 快捷登录'}</p>
              <div class="qq-bound-user">
                <img src="${escapeHtml(result.avatar || '')}" alt="" data-on="error" data-action="utils.hideSelf" data-arg-from="this">
                <span>${escapeHtml(result.nickname || '')}</span>
              </div>
              <a href="settings.html" class="login-button" style="text-align:center;text-decoration:none;">返回设置页</a>
            </div>`, true);
        } else {
          setStatus('QQ 绑定失败', '无法完成绑定', errorHtml(result.error || '绑定失败，请重试'), true);
        }
        return;
      }

      // ===== 登录场景：新用户需补全资料 =====
      if (result.needProfile) {
        window.location.href = `qq-register.html?state=${encodeURIComponent(state)}`;
        return;
      }

      // ===== 登录成功 =====
      if (result.user && result.token) {
        saveAuth(result);
        // 新设备提示走站内消息，不弹窗
        window.location.href = 'index.html';
        return;
      }

      setStatus('QQ 登录失败', '未获取到有效的登录结果', errorHtml('登录结果无效，请重新尝试'), true);
    } catch (e) {
      console.error('QQ 回调处理失败:', e);
      setStatus('QQ 授权失败', '网络或服务器错误', errorHtml('处理 QQ 授权时出错，请重试'), true);
    }
  }

  document.addEventListener('DOMContentLoaded', main);
})();
