/**
 * 维护页（原为 maintenance.html 内联 <script>，CSP 收紧后抽成外部文件）
 */
// 从服务器获取维护消息
fetch('/api/maintenance-message')
  .then(res => res.json())
  .then(data => {
    if (data.success && data.message) {
      document.getElementById('maintenance-text').textContent = data.message;
    }
  })
  .catch(() => {
    // 使用默认消息
  });