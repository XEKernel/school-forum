/**
 * 502 页交互（原为 502.html 内联 <script>，CSP 收紧后抽成外部文件）
 */
function retryConnection() {
  const retryBtn = document.querySelector('.retry-button');
  const originalText = retryBtn.innerHTML;

  // 显示重试状态
  retryBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在重试...';
  retryBtn.disabled = true;

  // 模拟重试过程
  setTimeout(() => {
    // 检查服务器状态
    fetch('/health')
      .then(response => {
        if (response.ok) {
          // 服务器恢复正常，刷新页面
          window.location.reload();
        } else {
          throw new Error('服务器仍未就绪');
        }
      })
      .catch(() => {
        // 显示错误信息
        alert('服务器暂时无法连接，请稍后再试。');
        retryBtn.innerHTML = originalText;
        retryBtn.disabled = false;
      });
  }, 2000);
}

// 自动检测服务器状态
function checkServerStatus() {
  fetch('/health')
    .then(response => {
      if (response.ok) {
        // 服务器正常，自动刷新
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    })
    .catch(() => {
      // 服务器仍然不可用，继续显示错误页面
      console.log('服务器状态检查失败');
    });
}

// 每30秒检查一次服务器状态
setInterval(checkServerStatus, 30000);

// 页面加载后立即检查一次
setTimeout(checkServerStatus, 5000);