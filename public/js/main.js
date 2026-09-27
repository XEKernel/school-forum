// 主应用文件 - 协调各个模块
const app = {
  // 初始化应用
  init: function() {
    console.log('app.init: 开始初始化应用');
    
    // 初始化用户管理（必须最先执行）
    if (typeof userManager !== 'undefined') {
      console.log('app.init: 初始化用户管理器');
      userManager.init();
      userManager.setupEventListeners();
    }
    
    // 初始化帖子管理（依赖用户管理器）
    if (typeof postsManager !== 'undefined') {
      console.log('app.init: 初始化帖子管理器');
      postsManager.init();
    }
    
    // 初始化统计数据
    if (typeof statsManager !== 'undefined') {
      statsManager.init();
    }

    // 初始化栏目管理器
    if (typeof categoryManager !== 'undefined') {
      console.log('app.init: 初始化栏目管理器');
      categoryManager.init().then(() => {
        // 加载完成后渲染首页侧边栏栏目列表
        categoryManager.renderSidebarCategoryList();
      });
    }

    // 初始化公告
    this.initAnnouncements();
    
    // 启动自动刷新
    if (typeof utils !== 'undefined' && utils.startAutoRefresh) {
      utils.startAutoRefresh();
    }
    
    // 初始化图片模态框事件
    this.setupImageModal();
    
    console.log('校园论坛应用初始化完成');
  },
  
  // 初始化公告
  initAnnouncements: async function() {
    try {
      const response = await fetch('/api/announcements/active');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      
      if (data.success && data.announcements && data.announcements.length > 0) {
        this.renderAnnouncements(data.announcements);
      }
    } catch (error) {
      console.error('加载公告失败:', error);
    }
  },
  
  // 渲染公告
  renderAnnouncements: function(announcements) {
    // 渲染顶部横幅公告
    const topAnnouncement = announcements.find(a => a.displayPosition === 'top');
    if (topAnnouncement) {
      this.renderTopBanner(topAnnouncement);
    }
    
    // 渲染列表公告
    const listAnnouncements = announcements.filter(a => a.displayPosition === 'list');
    if (listAnnouncements.length > 0) {
      this.renderListAnnouncements(listAnnouncements);
    }
    
    // 渲染弹窗公告
    const popupAnnouncement = announcements.find(a => a.displayPosition === 'popup');
    if (popupAnnouncement) {
      this.showPopupAnnouncement(popupAnnouncement);
    }
  },
  
  // 渲染顶部横幅
  renderTopBanner: function(announcement) {
    const banner = document.getElementById('announcement-banner');
    const title = document.getElementById('announcement-banner-title');
    const message = document.getElementById('announcement-banner-message');
    
    if (banner && title && message) {
      banner.className = `announcement-banner type-${announcement.type}`;
      title.textContent = announcement.title;
      message.textContent = announcement.content.length > 100 ? 
        announcement.content.substring(0, 100) + '...' : announcement.content;
      banner.style.display = 'flex';
    }
  },
  
  // 渲染列表公告
  renderListAnnouncements: function(announcements) {
    const container = document.getElementById('announcements-list');
    const itemsContainer = document.getElementById('announcements-items');
    
    if (container && itemsContainer) {
      itemsContainer.innerHTML = announcements.map(announcement => `
        <div class="announcement-item type-${announcement.type}">
          <div class="announcement-item-header">
            <i class="fas fa-bullhorn"></i>
            <span class="announcement-item-title">${this.escapeHtml(announcement.title)}</span>
            ${announcement.isPinned ? '<i class="fas fa-thumbtack pinned"></i>' : ''}
          </div>
          <div class="announcement-item-content">${this.escapeHtml(announcement.content)}</div>
          <div class="announcement-item-time">
            <i class="fas fa-clock"></i>
            ${this.formatDate(announcement.createdAt)}
          </div>
        </div>
      `).join('');
      
      container.style.display = 'block';
    }
  },
  
  // 显示弹窗公告
  showPopupAnnouncement: function(announcement) {
    // 检查是否已经显示过
    const popupKey = `announcement_popup_${announcement._id}`;
    if (sessionStorage.getItem(popupKey)) {
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'announcement-popup-modal';
    modal.innerHTML = `
      <div class="announcement-popup-content type-${announcement.type}">
        <div class="announcement-popup-header">
          <h3><i class="fas fa-bullhorn"></i> ${this.escapeHtml(announcement.title)}</h3>
          <button class="announcement-popup-close" data-action="utils.removeClosest" data-arg-from="this" data-arg2=".announcement-popup-modal">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="announcement-popup-body">
          ${this.escapeHtml(announcement.content)}
        </div>
        <div class="announcement-popup-footer">
          <label class="dont-show-again">
            <input type="checkbox" data-on="change" data-action="utils.setSessionFlag" data-arg="${popupKey}">
            不再提示
          </label>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  },
  
  // HTML转义
  escapeHtml: function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  // 格式化日期
  formatDate: function(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    
    return date.toLocaleDateString('zh-CN');
  },
  
  // 设置图片模态框事件
  setupImageModal: function() {
    const modal = document.getElementById('image-modal');
    if (!modal) return;
    
    // 添加关闭事件
    const closeBtn = modal.querySelector('.image-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    
    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }
};

// 关闭公告横幅
function closeAnnouncementBanner() {
  const banner = document.getElementById('announcement-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

// 当DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});