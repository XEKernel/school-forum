/**
 * 404 页交互（原为 404.html 内联 <script>，CSP 收紧后抽成外部文件）
 */
function searchForum() {
  const searchTerm = document.getElementById('searchInput').value.trim();
  if (searchTerm) {
    window.location.href = `../index.html?search=${encodeURIComponent(searchTerm)}`;
  }
}

// 允许按Enter键搜索
document.getElementById('searchInput').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    searchForum();
  }
});

// 自动聚焦搜索框
document.getElementById('searchInput').focus();