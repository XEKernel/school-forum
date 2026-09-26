// 简洁版编辑页面功能
const simpleEditManager = {
  // 状态
  state: {
    selectedImages: [],
    md: null, // markdown-it 实例
    isEditMode: false,
    editPostId: null,
    existingImages: [], // 已有的图片
    deletedImages: [], // 要删除的图片
    config: null // 配置信息
  },
  
  // DOM元素
  dom: {
    backBtn: document.getElementById('back-btn'),
    submitPostBtn: document.getElementById('submit-post'),
    contentInput: document.getElementById('content'),
    previewArea: document.getElementById('preview-area'),
    charCount: document.getElementById('char-count'),
    previewStatus: document.getElementById('preview-status'),
    imageUpload: document.getElementById('image-upload'),
    imageUploadArea: document.getElementById('image-upload-area'),
    imagePreview: document.getElementById('image-preview'),
    textFileUpload: document.getElementById('text-file-upload'),
    textUploadArea: document.getElementById('text-upload-area'),
    textFileInfo: document.getElementById('text-file-info'),
    textFileName: document.getElementById('text-file-name'),
    removeTextFileBtn: document.getElementById('remove-text-file'),
    pageTitle: document.querySelector('.simple-header-left h1')
  },
  
  // 初始化
  init: async function() {
    await this.loadConfig();
    await this.loadCategories();
    this.initializeMarkdownRenderer();
    await this.checkLoginStatus();
    this.checkEditMode();
    this.setupEventListeners();
    this.setupEditor();
    this.setupUpload();
    this.updatePreview();
  },
  
  // 加载分类列表
  loadCategories: async function() {
    try {
      const response = await fetch('/api/categories');
      const data = await response.json();
      
      if (data.success && data.categories) {
        const categorySelect = document.getElementById('post-category');
        if (categorySelect) {
          // 只显示启用的分类
          const activeCategories = data.categories.filter(c => c.isActive);
          categorySelect.innerHTML = '<option value="">不选择栏目（发布到广场）</option>';
          activeCategories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = `${cat.icon ? cat.icon.replace('fa-', '') : '📁'} ${cat.name}`;
            categorySelect.appendChild(option);
          });
        }
      }
    } catch (error) {
      console.error('加载分类列表失败:', error);
    }
  },
  
  // 加载配置
  loadConfig: async function() {
    // 设置默认配置
    this.state.config = {
      contentLimits: {
        post: 50000,
        comment: 500
      },
      upload: {
        maxFiles: 20,
        maxFileSize: 32 * 1024 * 1024
      }
    };
    
    // 获取公开配置
    try {
      const response = await fetch('/api/config/public');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          this.state.config = data.config;
        }
      }
    } catch (error) {
      console.warn('加载配置失败，使用默认配置:', error);
    }
  },
  
  // 检查是否是编辑模式
  checkEditMode: function() {
    const urlParams = new URLSearchParams(window.location.search);
    const editPostId = urlParams.get('edit');
    
    if (editPostId) {
      this.state.isEditMode = true;
      this.state.editPostId = editPostId;
      this.loadPostForEdit(editPostId);
      
      // 更新页面标题
      if (this.dom.pageTitle) {
        this.dom.pageTitle.innerHTML = '<i class="fas fa-edit"></i> 编辑帖子';
      }
      
      // 更新按钮文本
      if (this.dom.submitPostBtn) {
        this.dom.submitPostBtn.innerHTML = '<i class="fas fa-save"></i> 保存修改';
      }
    }
  },
  
  // 加载帖子用于编辑
  loadPostForEdit: async function(postId) {
    try {
      const response = await fetch(`/api/posts/${postId}`);
      
      if (!response.ok) {
        throw new Error('加载帖子失败');
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || '加载帖子失败');
      }
      
      const post = data.post;
      
      // 检查是否是帖子作者
      if (userManager.state.currentUser && post.userId !== userManager.state.currentUser.id) {
        utils.showNotification('您没有权限编辑此帖子', 'error');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1500);
        return;
      }
      
      // 填充内容
      if (this.dom.contentInput) {
        this.dom.contentInput.value = post.content || '';
        this.updateCharCount();
        this.updatePreview();
      }
      
      // 加载已有图片
      if (post.images && post.images.length > 0) {
        this.state.existingImages = post.images;
        this.renderExistingImages(post.images);
      }
      
      // 设置可见性
      const visibility = post.visibility || 'public';
      const visibilityRadio = document.querySelector(`input[name="post-visibility"][value="${visibility}"]`);
      if (visibilityRadio) {
        visibilityRadio.checked = true;
      }
      
      // 设置栏目
      if (post.categoryId) {
        const categorySelect = document.getElementById('post-category');
        if (categorySelect) {
          categorySelect.value = post.categoryId;
        }
      }
      
      // 设置评论开关
      const commentsEnabledCheckbox = document.getElementById('post-comments-enabled');
      if (commentsEnabledCheckbox) {
        commentsEnabledCheckbox.checked = post.commentsEnabled !== false;
      }
      
      utils.showNotification('帖子内容已加载', 'info');
    } catch (error) {
      console.error('加载帖子失败:', error);
      utils.showNotification(error.message || '加载帖子失败', 'error');
    }
  },
  
  // 渲染已有图片
  renderExistingImages: function(images) {
    if (!this.dom.imagePreview) return;
    
    images.forEach(image => {
      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item existing-image';
      previewItem.dataset.url = image.url;
      
      // 使用 data 属性替代 onclick 避免 XSS
      previewItem.innerHTML = `
        <img src="${this.escapeHtml(image.url)}" alt="${this.escapeHtml(image.originalname || '图片')}">
        <button type="button" class="remove-btn" data-image-url="${this.escapeHtml(image.url)}">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      this.dom.imagePreview.appendChild(previewItem);
    });
  },
  
  // 移除已有图片
  removeExistingImage: function(imageUrl) {
    // 添加到删除列表
    this.state.deletedImages.push(imageUrl);
    
    // 从现有图片列表中移除
    this.state.existingImages = this.state.existingImages.filter(img => img.url !== imageUrl);
    
    // 从预览中移除
    const previewItem = this.dom.imagePreview.querySelector(`[data-url="${imageUrl}"]`);
    if (previewItem) {
      previewItem.remove();
    }
    
    utils.showNotification('图片已标记为删除', 'info');
  },
  
  // 初始化 markdown 渲染器
  initializeMarkdownRenderer: function() {
    // 检查 markdown-it 是否已加载（支持多种可能的全局变量名）
    const markdownItGlobal = window.markdownit || window.markdownIt || window.markdown_it || window.MarkdownIt;
    
    if (!markdownItGlobal) {
      console.warn('markdown-it 未加载，等待加载...');
      setTimeout(() => this.initializeMarkdownRenderer(), 100);
      return;
    }

    try {
      // 创建 markdown-it 实例（支持表格 + 代码高亮）
      const hljsGlobal = window.hljs;
      this.state.md = markdownItGlobal({
        html: false, // 禁用原始 HTML 防 XSS
        linkify: true, // 自动将 URL 转换为链接
        typographer: true, // 启用 typographer 扩展
        highlight: hljsGlobal ? function(str, lang) {
          if (lang && hljsGlobal.getLanguage(lang)) {
            try {
              return hljsGlobal.highlight(str, { language: lang }).value;
            } catch (e) { /* 高亮失败回退默认 */ }
          }
          try {
            return hljsGlobal.highlightAuto(str).value;
          } catch (e) {
            return '';
          }
        } : null
      });

      console.log('Markdown 渲染器初始化完成（支持表格与代码高亮）');
    } catch (error) {
      console.error('初始化 markdown 渲染器失败:', error);
    }
  },

  // HTML转义函数
  escapeHtml: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 检查登录状态（委托给 userManager）
  checkLoginStatus: async function() {
    // 通过 userManager 初始化并等待完成
    if (userManager && typeof userManager.initAsync === 'function') {
      await userManager.initAsync();
    }
    
    const currentUser = userManager?.state?.currentUser;
    
    if (currentUser) {
      this.enableUploadAreas();
      this.enableSubmitButton();
    } else {
      this.disableUploadAreas();
      this.disableSubmitButton();
      utils.showNotification('请先登录后再发布帖子', 'error');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1500);
    }
  },
  
  // 启用上传区域
  enableUploadAreas: function() {
    // 图片上传区域
    if (this.dom.imageUploadArea && this.dom.imageUpload) {
      this.dom.imageUploadArea.classList.remove('disabled');
      this.dom.imageUploadArea.title = '点击或拖拽图片到这里';
      this.dom.imageUpload.disabled = false;
    }
    
    // 文本文件上传区域
    if (this.dom.textUploadArea && this.dom.textFileUpload) {
      this.dom.textUploadArea.classList.remove('disabled');
      this.dom.textUploadArea.title = '点击上传文本文件';
      this.dom.textFileUpload.disabled = false;
    }
  },
  
  // 禁用上传区域
  disableUploadAreas: function() {
    // 图片上传区域
    if (this.dom.imageUploadArea && this.dom.imageUpload) {
      this.dom.imageUploadArea.classList.add('disabled');
      this.dom.imageUploadArea.title = '请先登录后再上传图片';
      this.dom.imageUpload.disabled = true;
    }
    
    // 文本文件上传区域
    if (this.dom.textUploadArea && this.dom.textFileUpload) {
      this.dom.textUploadArea.classList.add('disabled');
      this.dom.textUploadArea.title = '请先登录后再上传文件';
      this.dom.textFileUpload.disabled = true;
    }
  },
  
  // 启用提交按钮
  enableSubmitButton: function() {
    if (this.dom.submitPostBtn) {
      this.dom.submitPostBtn.disabled = false;
    }
  },
  
  // 禁用提交按钮
  disableSubmitButton: function() {
    if (this.dom.submitPostBtn) {
      this.dom.submitPostBtn.disabled = true;
    }
  },
  
  // 设置事件监听器
  setupEventListeners: function() {
    // 返回按钮
    if (this.dom.backBtn) {
      this.dom.backBtn.addEventListener('click', () => {
        if (this.state.isEditMode) {
          window.location.href = `post-detail.html?id=${this.state.editPostId}`;
        } else {
          window.location.href = 'index.html';
        }
      });
    }
    
    // 提交按钮
    if (this.dom.submitPostBtn) {
      this.dom.submitPostBtn.addEventListener('click', () => {
        if (this.state.isEditMode) {
          this.updatePost();
        } else {
          this.submitNewPost();
        }
      });
    }

    // 图片预览区域 - 移除按钮事件委托（避免 XSS）
    if (this.dom.imagePreview) {
      this.dom.imagePreview.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-btn');
        if (!removeBtn) return;
        
        const imageUrl = removeBtn.dataset.imageUrl;
        const imageId = removeBtn.dataset.imageId;
        
        if (imageUrl) {
          // 已上传的图片：通过 URL 移除
          this.removeExistingImage(imageUrl);
        } else if (imageId) {
          // 新上传的图片：通过 ID 移除
          this.removeImage(imageId);
        }
      });
    }
  },
  
  // 设置编辑器
  setupEditor: function() {
    if (!this.dom.contentInput) return;
    
    // Markdown 工具栏
    this.setupMarkdownToolbar();
    
    // 输入事件监听
    this.dom.contentInput.addEventListener('input', () => {
      this.updateCharCount();
      this.updatePreview();
      this.autoSaveDraft();
    });
    
    // 恢复草稿
    this.restoreDraft();
    
    // 初始字符计数
    this.updateCharCount();
  },

  // Markdown 快捷工具栏
  setupMarkdownToolbar: function() {
    const textarea = this.dom.contentInput;
    document.querySelectorAll('.md-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const md = btn.dataset.md;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const sel = textarea.value.substring(start, end);
        
        let insertion;
        if (md === '```') {
          insertion = sel ? `\n\`\`\`\n${sel}\n\`\`\`\n` : '\n```\n\n```\n';
        } else if (md.includes('text') && md.includes('url')) {
          insertion = sel ? `[${sel}](url)` : md;
        } else if (md.includes('alt') && md.includes('url')) {
          insertion = sel ? `![${sel}](url)` : md;
        } else if (md === '---') {
          insertion = '\n---\n';
        } else {
          insertion = sel ? `${md}${sel}${md}` : md;
        }
        
        textarea.setRangeText(insertion, start, end, 'end');
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
      });
    });
  },

  // 更新字符计数
  updateCharCount: function() {
    if (!this.dom.contentInput || !this.dom.charCount) return;
    
    const content = this.dom.contentInput.value;
    const charCount = content.length;
    
    this.dom.charCount.textContent = charCount;
  },
  
  // 更新预览
  updatePreview: function() {
    if (!this.dom.contentInput || !this.dom.previewArea) return;
    
    const content = this.dom.contentInput.value;
    
    if (!content.trim()) {
      this.dom.previewArea.innerHTML = `
        <div class="empty-preview">
          <i class="fas fa-file-alt"></i>
          <p>预览将在这里显示</p>
          <small>开始输入内容以查看预览效果</small>
        </div>
      `;
      this.updatePreviewStatus('等待输入');
      return;
    }
    
    // 渲染Markdown
    const html = this.renderMarkdown(content);
    this.dom.previewArea.innerHTML = html;
    
    // 渲染 MathJax 公式（使用防抖）
    if (this.mathjaxTimeout) {
      clearTimeout(this.mathjaxTimeout);
    }
    this.mathjaxTimeout = setTimeout(() => {
      if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
        MathJax.typesetPromise([this.dom.previewArea]).catch((err) => console.error('MathJax typeset failed:', err));
      }
    }, 300);
    
    // 更新状态
    this.updatePreviewStatus('已更新');
  },
  
  // 更新预览状态
  updatePreviewStatus: function(status) {
    if (this.dom.previewStatus) {
      this.dom.previewStatus.textContent = status;
    }
  },


  
  // 渲染Markdown
  renderMarkdown: function(text) {
    if (!text) return '';
    
    // 检测并转换 HTML 内容为 Markdown 代码块（实时预览时处理）
    let processedText = text;
    if (typeof utils !== 'undefined' && utils.detectAndEscapeHtml) {
      processedText = utils.detectAndEscapeHtml(text);
    }
    
    // 如果 markdown-it 未初始化，使用简单转义
    if (!this.state.md) {
      return '<p>' + this.escapeHtml(processedText) + '</p>';
    }
    
    try {
      // 保护公式不被 markdown 处理
      const { protectedText, placeholders } = this.protectMathFormulas(processedText);
      
      // 使用 markdown-it 渲染
      const html = this.state.md.render(protectedText);
      
      // 恢复公式
      return this.restoreMathFormulas(html, placeholders);
    } catch (error) {
      console.error('Markdown 渲染失败:', error);
      return '<p>' + this.escapeHtml(processedText) + '</p>';
    }
  },

  // 保护数学公式不被 markdown 处理
  protectMathFormulas: function(text) {
    const placeholders = [];
    let index = 0;
    
    // 替换函数
    const replaceWithPlaceholder = (match) => {
      const placeholder = `MATHJAXPH${index}PH`;
      placeholders.push({ placeholder, formula: match });
      index++;
      return placeholder;
    };
    
    // 按顺序处理各种公式格式
    // 1. 独立公式块 $$...$$ (先处理长的，避免被 $...$ 部分匹配)
    let protectedText = text.replace(/\$\$[\s\S]*?\$\$/g, replaceWithPlaceholder);
    // 2. 独立公式块 \[...\]
    protectedText = protectedText.replace(/\\[[\s\S]*?\\]/g, replaceWithPlaceholder);
    // 3. 行内公式 $...$ (非贪婪，排除 $$)
    protectedText = protectedText.replace(/\$(?!\$)([^\$\n]+?)\$/g, replaceWithPlaceholder);
    // 4. 行内公式 \(...\)
    protectedText = protectedText.replace(/\\\([\s\S]*?\\\)/g, replaceWithPlaceholder);
    
    return { protectedText, placeholders };
  },

  // 恢复数学公式
  restoreMathFormulas: function(html, placeholders) {
    let result = html;
    placeholders.forEach(({ placeholder, formula }) => {
      // 安全恢复：公式原文是用户输入，必须 HTML 转义后插入（防注入），
      // 且用函数式替换避免 replacement 字符串中的 $ 序列被展开
      const safeFormula = this.escapeHtml(formula);
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedPlaceholder, 'g'), () => safeFormula);
    });
    return result;
  },
  
  // 设置上传
  setupUpload: function() {
    this.setupImageUpload();
    this.setupTextFileUpload();
  },
  
  // 设置图片上传
  setupImageUpload: function() {
    if (!this.dom.imageUploadArea || !this.dom.imageUpload) return;
    
    // 点击上传区域
    this.dom.imageUploadArea.addEventListener('click', () => {
      if (!this.dom.imageUploadArea.classList.contains('disabled')) {
        this.dom.imageUpload.click();
      }
    });
    
    // 文件选择变化
    this.dom.imageUpload.addEventListener('change', (e) => {
      this.handleImageSelection(e.target.files);
      e.target.value = '';
    });
    
    // 拖拽功能
    this.dom.imageUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.dom.imageUploadArea.classList.contains('disabled')) {
        this.dom.imageUploadArea.classList.add('dragover');
      }
    });
    
    this.dom.imageUploadArea.addEventListener('dragleave', () => {
      this.dom.imageUploadArea.classList.remove('dragover');
    });
    
    this.dom.imageUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dom.imageUploadArea.classList.remove('dragover');
      
      if (!this.dom.imageUploadArea.classList.contains('disabled')) {
        this.handleImageSelection(e.dataTransfer.files);
      }
    });
  },
  
  // 处理图片选择
  handleImageSelection: function(files) {
    if (!files || files.length === 0) return;
    
    const maxFiles = this.state.config?.upload?.maxFiles || 20;
    const maxFileSize = this.state.config?.upload?.maxFileSize || 10 * 1024 * 1024;
    const totalImages = this.state.selectedImages.length + this.state.existingImages.length;
    const remainingSlots = maxFiles - totalImages;
    if (remainingSlots <= 0) {
      utils.showNotification(`最多只能上传${maxFiles}张图片`, 'error');
      return;
    }
    
    const filesArray = Array.from(files).slice(0, remainingSlots);
    
    filesArray.forEach(file => {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/avif', 'image/heic', 'image/heif'];
      if (!allowedTypes.includes(file.type)) {
        utils.showNotification(`文件 "${file.name}" 不是支持的图片格式`, 'error');
        return;
      }
      
      if (file.size > maxFileSize) {
        const sizeMB = Math.round(maxFileSize / (1024 * 1024));
        utils.showNotification(`图片 "${file.name}" 超过${sizeMB}MB限制`, 'error');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = {
          file: file,
          previewUrl: e.target.result,
          id: Date.now() + Math.random().toString(36).substr(2, 9)
        };
        
        this.state.selectedImages.push(imageData);
        this.renderImagePreview(imageData);
        
        utils.showNotification(`已添加图片: ${file.name}`, 'success');
      };
      
      reader.readAsDataURL(file);
    });
  },
  
  // 渲染图片预览
  renderImagePreview: function(imageData) {
    if (!this.dom.imagePreview) return;
    
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    previewItem.dataset.id = imageData.id;
    
    previewItem.innerHTML = `
      <img src="${imageData.previewUrl}" alt="预览图片">
      <button type="button" class="remove-btn" data-image-id="${imageData.id}">
        <i class="fas fa-times"></i>
      </button>
    `;
    
    this.dom.imagePreview.appendChild(previewItem);
  },
  
  // 移除图片
  removeImage: function(imageId) {
    this.state.selectedImages = this.state.selectedImages.filter(img => img.id !== imageId);
    
    const previewItem = this.dom.imagePreview.querySelector(`[data-id="${imageId}"]`);
    if (previewItem) {
      previewItem.remove();
    }
    
    utils.showNotification('已移除图片', 'info');
  },
  
  // 设置文本文件上传
  setupTextFileUpload: function() {
    if (!this.dom.textUploadArea || !this.dom.textFileUpload) return;
    
    // 点击上传区域
    this.dom.textUploadArea.addEventListener('click', () => {
      if (!this.dom.textUploadArea.classList.contains('disabled')) {
        this.dom.textFileUpload.click();
      }
    });
    
    // 文件选择变化
    this.dom.textFileUpload.addEventListener('change', (e) => {
      this.handleTextFileSelection(e.target.files[0]);
    });
    
    // 移除文本文件按钮
    if (this.dom.removeTextFileBtn) {
      this.dom.removeTextFileBtn.addEventListener('click', () => {
        this.removeTextFile();
      });
    }
  },
  
  // 处理文本文件选择
  handleTextFileSelection: function(file) {
    if (!file) return;
    
    const allowedTypes = ['.txt', '.md'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedTypes.includes(fileExt)) {
      utils.showNotification('只支持.txt和.md格式的文件', 'error');
      return;
    }
    
    if (file.size > 1024 * 1024) {
      utils.showNotification('文件大小不能超过1MB', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      
      if (this.dom.contentInput) {
        this.dom.contentInput.value = content;
        this.updateCharCount();
        this.updatePreview();
      }
      
      this.showTextFileInfo(file.name, file.size);
      utils.showNotification(`已加载文件: ${file.name}`, 'success');
    };
    
    reader.readAsText(file, 'UTF-8');
  },
  
  // 显示文本文件信息
  showTextFileInfo: function(filename, filesize) {
    if (!this.dom.textFileInfo || !this.dom.textFileName) return;
    
    const sizeStr = filesize < 1024 ? 
      `${filesize} B` : 
      filesize < 1024 * 1024 ? 
        `${(filesize / 1024).toFixed(1)} KB` : 
        `${(filesize / (1024 * 1024)).toFixed(1)} MB`;
    
    this.dom.textFileName.textContent = `${filename} (${sizeStr})`;
    this.dom.textFileInfo.style.display = 'flex';
  },
  
  // 移除文本文件
  removeTextFile: function() {
    if (this.dom.textFileInfo) {
      this.dom.textFileInfo.style.display = 'none';
    }
    
    if (this.dom.textFileUpload) {
      this.dom.textFileUpload.value = '';
    }
    
    utils.showNotification('已移除文本文件', 'info');
  },
  
  // 更新帖子
  updatePost: async function() {
    const content = this.dom.contentInput?.value;
    
    // 获取可见性设置
    const visibilityRadio = document.querySelector('input[name="post-visibility"]:checked');
    const visibility = visibilityRadio ? visibilityRadio.value : 'public';
    
    // 禁用按钮防止重复提交
    if (this.dom.submitPostBtn) {
      this.dom.submitPostBtn.disabled = true;
      this.dom.submitPostBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
    }
    
    try {
      // 验证输入
      if (!userManager.state.currentUser) {
        throw new Error('请先登录');
      }
      
      // 计算总图片数
      const totalImages = this.state.selectedImages.length + this.state.existingImages.length;
      
      // 验证内容
      if (totalImages === 0) {
        if (!content || content.trim().length === 0) {
          throw new Error('帖子内容不能为空');
        }
      }
      
      const maxPostLength = this.state.config?.contentLimits?.post || 50000;
      if (content && content.length > maxPostLength) {
        throw new Error(`帖子内容过长，最多${maxPostLength}个字符`);
      }
      
      // 检测并转换 HTML 内容为 Markdown 代码块
      const processedContent = typeof utils !== 'undefined' && utils.detectAndEscapeHtml 
        ? utils.detectAndEscapeHtml(content || '') 
        : content;
      
      // 创建FormData对象
      const formData = new FormData();
      formData.append('userId', userManager.state.currentUser.id);
      formData.append('content', processedContent);
      formData.append('deletedImages', JSON.stringify(this.state.deletedImages));
      formData.append('visibility', visibility);
      
      // 添加栏目ID
      const categorySelect = document.getElementById('post-category');
      if (categorySelect) {
        formData.append('categoryId', categorySelect.value || '');
      }
      
      // 添加评论开关
      const commentsEnabledCheckbox = document.getElementById('post-comments-enabled');
      formData.append('commentsEnabled', commentsEnabledCheckbox ? commentsEnabledCheckbox.checked : 'true');
      
      // 添加新图片文件
      this.state.selectedImages.forEach((image) => {
        formData.append('images', image.file);
      });
      
      // 发送请求（FormData 不需要 Content-Type，让浏览器自动设置；令牌在 HttpOnly Cookie 中自动携带）
      const response = await fetch(`/api/posts/${this.state.editPostId}`, {
        method: 'PUT',
        body: formData
      });
      
      // 检查响应类型
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('服务器返回了无效的响应格式');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || '保存失败');
      }
      
      if (data.success) {
        const visibilityText = visibility === 'public' ? '' : 
          visibility === 'followers' ? '（仅粉丝可见）' : '（仅自己可见）';
        utils.showNotification(`帖子修改成功${visibilityText}！`, 'success');
        
        // 延迟跳转到帖子详情页
        setTimeout(() => {
          window.location.href = `post-detail.html?id=${this.state.editPostId}`;
        }, 1500);
      }
    } catch (error) {
      console.error('修改失败:', error);
      if (typeof utils !== 'undefined' && utils.showNotification) {
        utils.showNotification(error.message || '修改失败，请稍后重试', 'error');
      } else {
        alert(error.message || '修改失败，请稍后重试');
      }
    } finally {
      // 重新启用按钮
      if (this.dom.submitPostBtn) {
        this.dom.submitPostBtn.disabled = false;
        this.dom.submitPostBtn.innerHTML = '<i class="fas fa-save"></i> 保存修改';
      }
    }
  },
  
  // 提交新帖子
  submitNewPost: async function() {
    const content = this.dom.contentInput?.value;
    
    // 获取可见性设置
    const visibilityRadio = document.querySelector('input[name="post-visibility"]:checked');
    const visibility = visibilityRadio ? visibilityRadio.value : 'public';
    
    // 禁用按钮防止重复提交
    if (this.dom.submitPostBtn) {
      this.dom.submitPostBtn.disabled = true;
      this.dom.submitPostBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发布中...';
    }
    
    try {
      // 验证输入
      if (!userManager.state.currentUser) {
        throw new Error('请先登录后再发帖');
      }
      
      // 验证图片数量
      const maxFiles = this.state.config?.upload?.maxFiles || 20;
      if (this.state.selectedImages.length > maxFiles) {
        throw new Error(`最多只能上传${maxFiles}张图片`);
      }
      
      // 获取配置中的帖子长度限制
      const maxPostLength = this.state.config?.contentLimits?.post || 50000;
      
      // 验证内容
      if (this.state.selectedImages.length === 0) {
        // 没有图片时，需要验证文本内容
        if (!content) {
          throw new Error('帖子内容不能为空');
        }
        
        if (content.trim().length === 0) {
          throw new Error('帖子内容不能为空或只包含空白字符');
        }
        
        if (content.length > maxPostLength) {
          throw new Error(`帖子内容过长，最多${maxPostLength}个字符`);
        }
      } else {
        // 有图片时，如果提供了内容，验证内容长度
        if (content && content.length > 0) {
          if (content.length > maxPostLength) {
            throw new Error(`帖子内容过长，最多${maxPostLength}个字符`);
          }
        }
      }
      
      // 检测并转换 HTML 内容为 Markdown 代码块
      const processedContent = typeof utils !== 'undefined' && utils.detectAndEscapeHtml 
        ? utils.detectAndEscapeHtml(content) 
        : content;
      
      // 准备数据
      const school = userManager.state.currentUser.school;
      const grade = userManager.state.currentUser.grade;
      const className = userManager.state.currentUser.className;
      const username = userManager.state.currentUser.username;
      
      // 创建FormData对象
      const formData = new FormData();
      formData.append('userId', userManager.state.currentUser.id);
      formData.append('username', username);
      formData.append('school', school);
      formData.append('grade', grade);
      formData.append('className', className);
      formData.append('content', processedContent);
      formData.append('anonymous', 'false');
      formData.append('title', '');
      formData.append('tags', '');
      formData.append('visibility', visibility);
      
      // 添加栏目ID
      const categorySelect = document.getElementById('post-category');
      if (categorySelect && categorySelect.value) {
        formData.append('categoryId', categorySelect.value);
      }
      
      // 添加评论开关
      const commentsEnabledCheckboxNewPost = document.getElementById('post-comments-enabled');
      formData.append('commentsEnabled', commentsEnabledCheckboxNewPost ? commentsEnabledCheckboxNewPost.checked : 'true');
      
      // 添加图片文件
      this.state.selectedImages.forEach((image) => {
        formData.append('images', image.file);
      });
      
      // 发布请求（FormData 不需要 Content-Type；令牌在 HttpOnly Cookie 中自动携带）
      const response = await fetch('/api/posts', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '发布失败');
      }
      
      const data = await response.json();
      if (data.success) {
        const visibilityText = visibility === 'public' ? '' : 
          visibility === 'followers' ? '（仅粉丝可见）' : '（仅自己可见）';
        utils.showNotification(`帖子发布成功${visibilityText}${this.state.selectedImages.length > 0 ? '，包含' + this.state.selectedImages.length + '张图片' : ''}！`, 'success');
        
        // 清空表单
        if (this.dom.contentInput) this.dom.contentInput.value = '';
        this.state.selectedImages = [];
        if (this.dom.imagePreview) this.dom.imagePreview.innerHTML = '';
        this.removeTextFile();
        this.clearDraft(); // 清除草稿
        this.updateCharCount();
        this.updatePreview();
        
        // 延迟跳转
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1500);
      }
    } catch (error) {
      console.error('发布失败:', error);
      if (typeof utils !== 'undefined' && utils.showNotification) {
        utils.showNotification(error.message || '发布失败，请稍后重试', 'error');
      } else {
        alert(error.message || '发布失败，请稍后重试');
      }
    } finally {
      // 重新启用按钮
      if (this.dom.submitPostBtn) {
        this.dom.submitPostBtn.disabled = false;
        this.dom.submitPostBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 发布帖子';
      }
    }
  },

  // ==================== 草稿自动保存 ====================
  draftKey: 'post_draft_' + (new URLSearchParams(window.location.search).get('edit') || 'new'),

  autoSaveDraft: function() {
    try {
      const content = this.dom.contentInput?.value || '';
      if (content.trim().length > 10) {
        const draft = {
          content,
          anonymous: this.dom.anonymousCheckbox?.checked || false,
          visibility: this.dom.visibilitySelect?.value || 'public',
          categoryId: this.dom.categorySelect?.value || '',
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(this.draftKey, JSON.stringify(draft));
      }
    } catch(e) { /* 静默失败 */ }
  },

  restoreDraft: function() {
    try {
      const draft = JSON.parse(localStorage.getItem(this.draftKey));
      if (draft && draft.content && !this.state.isEditMode) {
        // 草稿超过7天则清除
        if (Date.now() - new Date(draft.savedAt).getTime() > 7 * 86400000) {
          localStorage.removeItem(this.draftKey);
          return;
        }
        if (confirm('发现未发布的草稿，是否恢复？')) {
          if (this.dom.contentInput) this.dom.contentInput.value = draft.content;
          if (this.dom.anonymousCheckbox) this.dom.anonymousCheckbox.checked = draft.anonymous;
          if (draft.categoryId && this.dom.categorySelect) {
            this.dom.categorySelect.value = draft.categoryId;
          }
          this.updateCharCount();
          this.updatePreview();
        } else {
          localStorage.removeItem(this.draftKey);
        }
      }
    } catch(e) { /* 静默失败 */ }
  },

  clearDraft: function() {
    localStorage.removeItem(this.draftKey);
  }
};

// 当DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('edit-simple.js DOMContentLoaded');
  console.log('utils 可用性检查:', typeof utils);
  console.log('window.utils 可用性检查:', typeof window.utils);
  simpleEditManager.init();
});
