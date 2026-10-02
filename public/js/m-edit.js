/* 移动端发帖 / 编辑帖子页 */
(function () {
  'use strict';

  var editId = new URLSearchParams(location.search).get('id') || '';
  var isEdit = !!editId;
  var picked = [];          // 新选择的文件 [{ file, url }]
  var existing = [];        // 编辑模式：原有图片 [{ url }]
  var deleted = [];         // 编辑模式：被移除的原有图片 url
  var MAX = 9;

  function $(id) { return document.getElementById(id); }

  // ---------- 图片压缩（与桌面版策略一致：>500KB 且超宽才压） ----------
  function compressImage(file, maxWidth, quality) {
    maxWidth = maxWidth || 1920;
    quality = quality || 0.8;
    if (!file || !file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
    if (file.type === 'image/gif') return Promise.resolve(file); // GIF 压缩会丢帧
    if (file.size < 500 * 1024) return Promise.resolve(file);

    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (!blob) return resolve(file);
            resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }));
          }, file.type, quality);
        };
        img.onerror = function () { resolve(file); };
        img.src = e.target.result;
      };
      reader.onerror = function () { resolve(file); };
      reader.readAsDataURL(file);
    });
  }

  // ---------- 图片选择网格 ----------
  function renderPicker() {
    var html = '';
    existing.forEach(function (im, i) {
      html += '<div class="m-pick" data-kind="old" data-i="' + i + '">' +
        '<img src="' + mApp.escape(im.url) + '" alt="图片">' +
        '<button type="button" class="m-pick-del" data-del>' +
        '<i class="fas fa-xmark"></i></button></div>';
      if (i === 0) {} // 保持顺序
    });
    picked.forEach(function (p, i) {
      html += '<div class="m-pick" data-kind="new" data-i="' + i + '">' +
        '<img src="' + p.url + '" alt="图片">' +
        '<button type="button" class="m-pick-del" data-del>' +
        '<i class="fas fa-xmark"></i></button></div>';
    });
    $('m-picker').innerHTML = html;

    var total = existing.length + picked.length;
    $('m-img-hint').textContent = total ? (total + ' / ' + MAX + ' 张') : ('最多 ' + MAX + ' 张');
  }

  async function onPick(files) {
    var room = MAX - existing.length - picked.length;
    if (room <= 0) { mApp.toast('最多 ' + MAX + ' 张图片', 'warning'); return; }
    var list = Array.prototype.slice.call(files).slice(0, room);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!/^image\//.test(f.type)) { mApp.toast('仅支持图片文件', 'warning'); continue; }
      var cf = await compressImage(f);
      picked.push({ file: cf, url: URL.createObjectURL(cf) });
    }
    renderPicker();
  }

  // ---------- 栏目 ----------
  async function loadCategories(selected) {
    try {
      var d = await mApp.api.get('/api/categories', { silent: true });
      var cats = ((d && d.categories) || []).filter(function (c) { return c.isActive !== false; });
      $('m-category').innerHTML = '<option value="">不选择栏目</option>' + cats.map(function (c) {
        return '<option value="' + mApp.escape(c.id) + '">' + mApp.escape(c.name) + '</option>';
      }).join('');
      if (selected) $('m-category').value = selected;
    } catch (e) { /* 栏目加载失败不阻塞发帖 */ }
  }

  // ---------- 编辑模式：载入原帖 ----------
  async function loadPost() {
    try {
      var d = await mApp.api.get('/api/posts/' + encodeURIComponent(editId), { silent: true });
      var post = d && d.post;
      if (!post) throw new Error('帖子不存在');
      if (!mApp.auth.user || post.userId !== mApp.auth.user.id) {
        mApp.toast('只能编辑自己的帖子', 'error');
        setTimeout(function () { location.href = 'm-post.html?id=' + encodeURIComponent(editId); }, 900);
        return;
      }
      $('m-title').textContent = '编辑帖子';
      $('m-submit').textContent = '保存';
      $('m-editor-input').value = post.content || '';
      // 编辑接口不支持改匿名/栏目外的字段：匿名开关仅新建时可用
      $('m-anon-row').style.display = 'none';
      existing = (post.images || []).map(function (im) {
        return typeof im === 'string' ? { url: im } : { url: im.url };
      }).filter(function (im) { return im.url; });
      renderPicker();
      await loadCategories();
    } catch (e) {
      mApp.toast((e && e.message) || '帖子加载失败', 'error');
      setTimeout(function () { location.href = 'm-index.html'; }, 900);
    }
  }

  // ---------- 提交 ----------
  async function submit() {
    if (!mApp.auth.isLoggedIn()) {
      location.href = 'm-login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var content = $('m-editor-input').value.trim();
    if (!content && picked.length === 0 && existing.length === 0) {
      mApp.toast('请输入内容或添加图片', 'warning');
      return;
    }
    if (content.length > 10000) { mApp.toast('内容过长，最多 10000 字', 'warning'); return; }

    var btn = $('m-submit');
    btn.disabled = true;
    var old = btn.textContent;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    var fd = new FormData();
    fd.append('content', content);
    fd.append('categoryId', $('m-category').value || '');
    if (isEdit) {
      fd.append('deletedImages', JSON.stringify(deleted));
    } else {
      fd.append('anonymous', $('m-anon').checked ? 'true' : 'false');
    }
    picked.forEach(function (p) { fd.append('images', p.file, p.file.name); });

    try {
      var d;
      if (isEdit) {
        d = await mApp.api.put('/api/posts/' + encodeURIComponent(editId), fd);
        mApp.toast('保存成功', 'success');
        setTimeout(function () { location.href = 'm-post.html?id=' + encodeURIComponent(editId); }, 800);
      } else {
        d = await mApp.api.post('/api/posts', fd);
        var np = d && (d.post || d.data);
        var nid = np && np.id;
        mApp.toast('发布成功', 'success');
        setTimeout(function () {
          location.href = nid ? ('m-post.html?id=' + encodeURIComponent(nid)) : 'm-index.html';
        }, 800);
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // ---------- 初始化 ----------
  document.addEventListener('DOMContentLoaded', async function () {
    $('m-back').addEventListener('click', function () {
      if (picked.length || $('m-editor-input').value.trim() || deleted.length) {
        if (!confirm('放弃未保存的内容？')) return;
      }
      if (history.length > 1) history.back();
      else location.href = 'm-index.html';
    });

    $('m-file').addEventListener('change', function (e) {
      onPick(e.target.files);
      e.target.value = '';
    });

    $('m-picker').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (!del) return;
      var cell = del.closest('.m-pick');
      var kind = cell.getAttribute('data-kind');
      var i = parseInt(cell.getAttribute('data-i'), 10);
      if (kind === 'new') {
        if (picked[i] && picked[i].url) URL.revokeObjectURL(picked[i].url);
        picked.splice(i, 1);
      } else {
        var url = existing[i].url;
        deleted.push(url);
        existing.splice(i, 1);
      }
      renderPicker();
    });

    $('m-submit').addEventListener('click', submit);

    await mApp.auth.init();
    if (!mApp.auth.isLoggedIn()) {
      mApp.toast('请先登录后再发帖', 'warning');
      setTimeout(function () {
        location.href = 'm-login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
      }, 800);
      return;
    }

    if (isEdit) await loadPost();
    else await loadCategories();

    renderPicker();
  });
})();