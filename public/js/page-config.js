/**
 * 页面级配置（原先写在各页 HTML 的内联 <script> 里）
 *
 * 背景：CSP 不再对 script-src 放行 'unsafe-inline'，内联脚本会被浏览器拒绝执行；
 * 这里按当前页面路径注入对应的全局变量，执行时机与原来的内联脚本一致
 * （在 HTML 中该 script 仍位于页面管理器脚本之前，且不是 defer）。
 */
(function () {
  var path = window.location.pathname;

  if (path.endsWith('/message.html')) {
    window.pageManagerName = 'messageManager';
  } else if (path.endsWith('/chat.html')) {
    window.pageManagerName = 'chatManager';
  } else if (path.endsWith('/following.html')) {
    window.pageManagers = ['followingManager'];
  } else if (path.endsWith('/profile.html')) {
    window.pageManagers = ['profileManager'];
  } else if (path.endsWith('/favorites.html')) {
    window.pageManagers = ['favoritesManager'];
  } else if (path.endsWith('/follow-list.html')) {
    window.pageManagers = ['followListManager'];
  }
})();