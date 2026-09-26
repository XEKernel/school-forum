/**
 * 错误页共用初始化（原为各错误页 HTML 末尾的内联 <script>）
 * CSP 收紧后内联脚本不再执行，因此抽成外部文件，执行时机保持一致。
 */
document.addEventListener('DOMContentLoaded', function () {
  // 初始化用户管理
  if (typeof userManager !== 'undefined') {
    userManager.init();
    userManager.setupEventListeners();
  }
});