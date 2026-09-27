// 黑名单页面脚本
(function() {
  const blacklistManager = {
    state: {
      blockedList: [],
      currentPage: 1,
      totalPages: 1,
      total: 0,
      limit: 20
    },

    async init() {
      const currentUser = window.userManager ? window.userManager.state.currentUser : null;
      if (!currentUser) {
        window.location.href = 'login.html';
        return;
      }
      
      await this.loadBlockedList();
      this.setupEventListeners();
    },

    async loadBlockedList(page = 1) {
      const currentUser = window.userManager ? window.userManager.state.currentUser : null;
      if (!currentUser) return;
      
      const listContainer = document.getElementById('blocked-list');
      if (!listContainer) return;
      
      listContainer.innerHTML = `
        <div class="loading-spinner">
          <i class="fas fa-spinner fa-spin"></i>
          <p>加载中...</p>
        </div>
      `;
      
      try {
        // 携带 Authorization：服务端按 JWT 身份返回（params 中的 userId 仅用于兼容，被忽略）
        const response = await fetch(
          `/api/blocked/${currentUser.id}?page=${page}&limit=${this.state.limit}`,
          { headers: (userManager && userManager.getAuthHeaders) ? userManager.getAuthHeaders() : {} }
        );
        const data = await response.json();
        
        if (data.success) {
          this.state.blockedList = data.data.list || [];
          this.state.currentPage = data.data.pagination?.currentPage || 1;
          this.state.totalPages = data.data.pagination?.totalPages || 1;
          this.state.total = data.data.pagination?.total || 0;
          
          this.renderBlockedList();
          this.renderPagination();
          this.updateCount();
        } else {
          listContainer.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-exclamation-circle"></i>
              <h3>加载失败</h3>
              <p>${data.message || '请稍后重试'}</p>
            </div>
          `;
        }
      } catch (error) {
        console.error('加载黑名单失败:', error);
        if (listContainer) {
          listContainer.innerHTML = `
            <div class="empty-state">
              <i class="fas fa-exclamation-circle"></i>
              <h3>加载失败</h3>
              <p>网络错误，请稍后重试</p>
            </div>
          `;
        }
      }
    },

    renderBlockedList() {
      const listContainer = document.getElementById('blocked-list');
      if (!listContainer) return;
      
      if (this.state.blockedList.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-user-slash"></i>
            <h3>黑名单为空</h3>
            <p>您还没有拉黑任何用户</p>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = this.state.blockedList.map(user => {
        // 转义防 XSS（用户名可能含引号/HTML；unblock 不再内联拼接用户名）
        const esc = (s) => utils.escapeHtml(s);
        const safeId = esc(user.id);
        const safeName = esc(user.username || '');
        return `
        <div class="blocked-item" data-user-id="${safeId}">
          <img 
            src="${esc(user.avatar || '/images/default-avatar.svg')}" 
            alt="${safeName}" 
            class="blocked-avatar"
          >
          <div class="blocked-info">
            <div class="blocked-username">${safeName}</div>
            <div class="blocked-meta">
              ${esc(user.school || '')} ${esc(user.grade || '')} ${esc(user.className || '')}
              ${user.blockedAt ? '· 拉黑于 ' + this.formatDate(user.blockedAt) : ''}
            </div>
          </div>
          <div class="blocked-actions">
            <button class="unblock-btn" data-uid="${safeId}" data-uname="${safeName}" data-action="blacklistManager.unblockUser" data-arg-from="data-uid" data-arg2-from="data-uname">
              <i class="fas fa-unlock"></i> 解除拉黑
            </button>
          </div>
        </div>
      `;
      }).join('');
    },

    renderPagination() {
      const pagination = document.getElementById('pagination');
      const prevBtn = document.getElementById('prev-page');
      const nextBtn = document.getElementById('next-page');
      const pageInfo = document.getElementById('page-info');
      
      if (this.state.totalPages <= 1) {
        if (pagination) pagination.style.display = 'none';
        return;
      }
      
      if (pagination) pagination.style.display = 'flex';
      if (prevBtn) prevBtn.disabled = this.state.currentPage <= 1;
      if (nextBtn) nextBtn.disabled = this.state.currentPage >= this.state.totalPages;
      if (pageInfo) pageInfo.textContent = `第 ${this.state.currentPage} / ${this.state.totalPages} 页`;
    },

    updateCount() {
      const countEl = document.getElementById('blocked-count');
      if (countEl) countEl.textContent = `共 ${this.state.total} 人`;
    },

    async unblockUser(blockedId, username) {
      const currentUser = window.userManager ? window.userManager.state.currentUser : null;
      if (!currentUser) return;
      
      if (!confirm(`确定要解除对 ${username} 的拉黑吗？`)) {
        return;
      }
      
      try {
        const response = await fetch('/api/unblock', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            blockerId: currentUser.id,
            blockedId: blockedId
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          if (window.utils) window.utils.showNotification('已解除拉黑', 'success');
          await this.loadBlockedList(this.state.currentPage);
        } else {
          if (window.utils) window.utils.showNotification(data.message || '操作失败', 'error');
        }
      } catch (error) {
        console.error('解除拉黑失败:', error);
        if (window.utils) window.utils.showNotification('网络错误，请稍后重试', 'error');
      }
    },

    formatDate(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },

    setupEventListeners() {
      const prevBtn = document.getElementById('prev-page');
      const nextBtn = document.getElementById('next-page');
      
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          if (this.state.currentPage > 1) {
            this.loadBlockedList(this.state.currentPage - 1);
          }
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (this.state.currentPage < this.state.totalPages) {
            this.loadBlockedList(this.state.currentPage + 1);
          }
        });
      }
    }
  };

  // 导出到全局
  window.blacklistManager = blacklistManager;

  document.addEventListener('DOMContentLoaded', async function() {
    if (typeof window.userManager !== 'undefined') {
      if (window.userManager.initAsync) {
        await window.userManager.initAsync();
      } else {
        window.userManager.init();
      }
      window.userManager.setupEventListeners();
    }
    await blacklistManager.init();
  });
})();
