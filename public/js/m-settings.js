/* 移动端设置页：资料/头像/密码/邮箱/QQ/通知/隐私/导出/注销 */
(function () {
  'use strict';

  var user = null;
  var VIS_LABELS = { public: '公开可见', followers: '仅粉丝可见', self: '仅自己可见' };
  var VIS_FIELDS = [
    ['gender', '性别'], ['birthday', '生日'], ['school', '学校'],
    ['signature', '个性签名'], ['joinDate', '加入时间'], ['lastLogin', '最近登录']
  ];
  var NOTIFY_FIELDS = [
    ['like', '点赞通知'], ['comment', '评论通知'], ['commentReply', '评论回复通知'],
    ['commentLike', '评论被点赞'], ['follow', '新粉丝通知']
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return mApp.escape(s); }
  function input(id) { var el = $(id); return el ? el.value.trim() : ''; }

  function saveLocalUser(patch) {
    var raw = JSON.parse(localStorage.getItem('forumUser') || '{}');
    Object.assign(raw, patch);
    localStorage.setItem('forumUser', JSON.stringify(raw));
    user = raw;
    mApp.auth.user = raw;
  }

  // ---------- 顶部资料卡 ----------
  function renderCard() {
    var name = user.username || '用户';
    var img = $('set-avatar-img');
    if (user.avatar) {
      img.style.backgroundImage = 'url(\'' + user.avatar + '\')';
      img.textContent = '';
    } else {
      img.style.backgroundImage = '';
      img.textContent = name.slice(0, 1);
    }
    $('set-name').textContent = name;
    $('set-sub').textContent = [user.school, user.grade, user.className].filter(Boolean).join(' · ') || '校园论坛用户';
    $('set-email-val').textContent = user.email || '';
  }

  // ---------- 头像上传 ----------
  async function uploadAvatar(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { mApp.toast('请选择图片文件', 'warning'); return; }
    var f = await mApp.compressImage(file, 800, 0.85);
    var fd = new FormData();
    fd.append('avatar', f);
    try {
      var d = await mApp.api.post('/api/users/' + encodeURIComponent(user.id) + '/avatar', fd);
      var newAvatar = (d && d.user && d.user.avatar) || (d && d.avatar) || null;
      if (newAvatar) saveLocalUser({ avatar: newAvatar });
      renderCard();
      mApp.toast('头像已更新', 'success');
    } catch (e) { /* 已提示 */ }
  }

  // ---------- 编辑资料 ----------
  function editProfileSheet() {
    var years = '';
    var now = new Date().getFullYear();
    for (var y = now; y >= now - 10; y--) {
      years += '<option value="' + y + '"' + (user.enrollmentYear === y ? ' selected' : '') + '>' + y + ' 年</option>';
    }
    var gender = user.gender || '';
    var html =
      '<div class="m-field"><label class="m-label">用户名</label>' +
        '<input class="m-input" id="ep-username" maxlength="20" value="' + esc(user.username || '') + '"></div>' +
      '<div class="m-field"><label class="m-label">学校</label>' +
        '<input class="m-input" id="ep-school" maxlength="50" value="' + esc(user.school || '') + '"></div>' +
      '<div class="m-field"><label class="m-label">入学年份</label>' +
        '<select class="m-input" id="ep-year">' + years + '</select></div>' +
      '<div class="m-field"><label class="m-label">班级</label>' +
        '<input class="m-input" id="ep-class" maxlength="30" value="' + esc(user.className || '') + '"></div>' +
      '<div class="m-field"><label class="m-label">性别</label>' +
        '<select class="m-input" id="ep-gender">' +
          '<option value="">不设置</option>' +
          '<option value="male"' + (gender === 'male' ? ' selected' : '') + '>男</option>' +
          '<option value="female"' + (gender === 'female' ? ' selected' : '') + '>女</option>' +
        '</select></div>' +
      '<div class="m-field"><label class="m-label">生日</label>' +
        '<input class="m-input" id="ep-birthday" type="date" value="' + esc(user.birthday || '') + '"></div>' +
      '<div class="m-field"><label class="m-label">个性签名</label>' +
        '<input class="m-input" id="ep-signature" maxlength="100" value="' +
          esc((user.settings && user.settings.signature) || '') + '"></div>' +
      '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="ep-save">保存资料</button></div>';

    var s = mApp.sheet('编辑资料', html);
    s.body.querySelector('#ep-save').addEventListener('click', async function () {
      var update = {};
      if (input('ep-username') !== (user.username || '')) update.username = input('ep-username');
      if (input('ep-school') !== (user.school || '')) update.school = input('ep-school');
      var yr = parseInt(input('ep-year'), 10);
      if (yr && yr !== user.enrollmentYear) update.enrollmentYear = yr;
      if (input('ep-class') !== (user.className || '')) update.className = input('ep-class');
      if (input('ep-gender') !== (user.gender || '')) update.gender = input('ep-gender');
      if (input('ep-birthday') !== (user.birthday || '')) update.birthday = input('ep-birthday') || null;

      var sig = input('ep-signature');
      var oldSig = (user.settings && user.settings.signature) || '';
      if (sig !== oldSig) {
        update.settings = Object.assign({}, user.settings || {}, { signature: sig });
      }

      if (!Object.keys(update).length) { mApp.toast('没有检测到任何更改', 'info'); return; }

      var btn = s.body.querySelector('#ep-save');
      btn.disabled = true;
      try {
        await mApp.api.put('/api/users/' + encodeURIComponent(user.id), update);
        saveLocalUser(update);
        renderCard();
        s.close();
        mApp.toast('资料已保存', 'success');
      } catch (e) { btn.disabled = false; }
    });
  }

  // ---------- 修改密码（三步） ----------
  function passwordSheet() {
    var current = null;
    var html =
      '<div id="pw-step1">' +
        '<div class="m-field"><label class="m-label">当前密码</label>' +
        '<input class="m-input" id="pw-cur" type="password" placeholder="请输入当前密码"></div>' +
        '<p class="m-hint" style="margin-top:8px">验证通过后会向你的邮箱发送验证码</p>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="pw-to2">下一步</button></div>' +
      '</div>' +
      '<div id="pw-step2" style="display:none">' +
        '<div class="m-field"><label class="m-label">邮箱验证码</label>' +
        '<input class="m-input" id="pw-code" inputmode="numeric" maxlength="8" placeholder="请输入收到的验证码"></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="pw-to3">验证</button></div>' +
      '</div>' +
      '<div id="pw-step3" style="display:none">' +
        '<div class="m-field"><label class="m-label">新密码</label>' +
        '<input class="m-input" id="pw-new" type="password" placeholder="至少 8 位，含大小写字母和数字"></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="pw-save">修改密码</button></div>' +
      '</div>';

    var s = mApp.sheet('修改密码', html);
    var B = function (id) { return s.body.querySelector(id); };

    B('#pw-to2').addEventListener('click', async function () {
      current = input('pw-cur');
      if (!current) { mApp.toast('请输入当前密码', 'warning'); return; }
      this.disabled = true;
      try {
        await mApp.api.post('/api/send-password-change-code', { currentPassword: current });
        mApp.toast('验证码已发送到邮箱', 'success');
        B('#pw-step1').style.display = 'none';
        B('#pw-step2').style.display = '';
      } catch (e) { /* 已提示 */ }
      this.disabled = false;
    });

    B('#pw-to3').addEventListener('click', async function () {
      var code = input('pw-code');
      if (!code) { mApp.toast('请输入验证码', 'warning'); return; }
      this.disabled = true;
      try {
        await mApp.api.post('/api/verify-password-change-code', { verificationCode: code });
        B('#pw-step2').style.display = 'none';
        B('#pw-step3').style.display = '';
      } catch (e) { /* 已提示 */ }
      this.disabled = false;
    });

    B('#pw-save').addEventListener('click', async function () {
      var np = input('pw-new');
      if (!np) { mApp.toast('请输入新密码', 'warning'); return; }
      this.disabled = true;
      try {
        await mApp.api.post('/api/change-password', { currentPassword: current, newPassword: np });
        mApp.toast('密码修改成功', 'success');
        s.close();
      } catch (e) { this.disabled = false; }
    });
  }

  // ---------- 修改邮箱（两步） ----------
  function emailSheet() {
    var newEmail = null;
    var html =
      '<div id="em-step1">' +
        '<div class="m-field"><label class="m-label">当前密码</label>' +
        '<input class="m-input" id="em-pw" type="password" placeholder="请输入当前密码"></div>' +
        '<div class="m-field"><label class="m-label">新邮箱</label>' +
        '<input class="m-input" id="em-new" type="email" placeholder="新邮箱地址"></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="em-to2">发送验证码</button></div>' +
      '</div>' +
      '<div id="em-step2" style="display:none">' +
        '<p class="m-hint" style="margin-bottom:10px" id="em-tip"></p>' +
        '<div class="m-field"><label class="m-label">邮箱验证码</label>' +
        '<input class="m-input" id="em-code" inputmode="numeric" maxlength="8" placeholder="请输入收到的验证码"></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="em-save">确认更换</button></div>' +
      '</div>';

    var s = mApp.sheet('修改邮箱', html);
    var B = function (id) { return s.body.querySelector(id); };

    B('#em-to2').addEventListener('click', async function () {
      var pw = input('em-pw');
      var em = input('em-new');
      if (!pw) { mApp.toast('请输入当前密码', 'warning'); return; }
      if (!em) { mApp.toast('请输入新邮箱', 'warning'); return; }
      this.disabled = true;
      try {
        await mApp.api.post('/api/send-email-change-code', { currentPassword: pw, newEmail: em });
        newEmail = em;
        B('#em-tip').textContent = '验证码已发送到 ' + em;
        B('#em-step1').style.display = 'none';
        B('#em-step2').style.display = '';
        mApp.toast('验证码已发送', 'success');
      } catch (e) { /* 已提示 */ }
      this.disabled = false;
    });

    B('#em-save').addEventListener('click', async function () {
      var code = input('em-code');
      if (!code) { mApp.toast('请输入验证码', 'warning'); return; }
      this.disabled = true;
      try {
        var d = await mApp.api.post('/api/verify-email-change', { verificationCode: code, newEmail: newEmail });
        saveLocalUser({ email: (d && d.user && d.user.email) || newEmail });
        renderCard();
        mApp.toast('邮箱已更换', 'success');
        s.close();
      } catch (e) { this.disabled = false; }
    });
  }

  // ---------- QQ 绑定 ----------
  async function loadQqStatus() {
    try {
      var d = await mApp.api.get('/api/auth/qq/bind-status', { silent: true });
      var txt = !d.configured ? '未配置' : (d.qqBound ? '已绑定' : '未绑定');
      $('set-qq-val').textContent = txt;
      return d;
    } catch (e) {
      $('set-qq-val').textContent = '查询失败';
      return null;
    }
  }

  async function toggleQq() {
    var st = await loadQqStatus();
    if (!st) return;
    if (!st.configured) { mApp.toast('本站未配置 QQ 登录', 'info'); return; }

    if (st.qqBound) {
      if (!confirm('确定要解除 QQ 绑定吗？解绑后将无法使用 QQ 快捷登录。')) return;
      try {
        await mApp.api.post('/api/auth/qq/unbind', {});
        mApp.toast('已解除绑定', 'success');
        loadQqStatus();
      } catch (e) { /* 已提示 */ }
      return;
    }

    try {
      var res = await fetch('/api/auth/qq/authorize-url-bind?type=bind', { credentials: 'same-origin' });
      var d = await res.json();
      if (!d.success) throw new Error(d.message || '绑定失败');
      location.href = d.url;
    } catch (e) {
      mApp.toast(e.message || 'QQ 绑定失败', 'error');
    }
  }

  // ---------- 通知设置 ----------
  function renderNotify() {
    var n = (user.settings && user.settings.notifications) || {};
    $('set-notify').innerHTML = NOTIFY_FIELDS.map(function (f) {
      var on = n[f[0]] !== false;
      return '<div class="m-row">' +
        '<span class="m-row-label">' + f[1] + '</span>' +
        '<label class="m-switch"><input type="checkbox" data-notify="' + f[0] + '"' +
        (on ? ' checked' : '') + '><span></span></label>' +
      '</div>';
    }).join('');
  }

  async function saveNotify() {
    var n = {};
    $('set-notify').querySelectorAll('input[data-notify]').forEach(function (cb) {
      n[cb.getAttribute('data-notify')] = cb.checked;
    });
    try {
      await mApp.api.post('/api/user/notification-settings', n);
      var settings = Object.assign({}, user.settings || {});
      settings.notifications = n;
      saveLocalUser({ settings: settings });
      mApp.toast('通知设置已保存', 'success');
    } catch (e) {
      renderNotify();
    }
  }

  // ---------- 隐私设置 ----------
  function renderPrivacy() {
    var p = (user.settings && user.settings.privacy) || {};
    $('set-privacy').innerHTML =
      '<div class="m-row"><span class="m-row-label">隐藏黑名单用户的帖子</span>' +
        '<label class="m-switch"><input type="checkbox" id="pv-posts"' + (p.hideBlockedPosts ? ' checked' : '') +
        '><span></span></label></div>' +
      '<div class="m-row"><span class="m-row-label">隐藏黑名单用户的评论</span>' +
        '<label class="m-switch"><input type="checkbox" id="pv-comments"' + (p.hideBlockedComments ? ' checked' : '') +
        '><span></span></label></div>';

    $('set-range').value = p.postDisplayRange || 'all';

    var pv = p.profileVisibility || {};
    $('set-visibility').innerHTML = VIS_FIELDS.map(function (f) {
      var cur = pv[f[0]] || 'public';
      var opts = Object.keys(VIS_LABELS).map(function (k) {
        return '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + VIS_LABELS[k] + '</option>';
      }).join('');
      return '<div class="m-row"><span class="m-row-label">' + f[1] + '</span>' +
        '<select class="m-input" data-vis="' + f[0] + '" style="width:auto;height:36px;padding:0 26px 0 10px">' +
        opts + '</select></div>';
    }).join('');
  }

  async function savePrivacy() {
    var pv = {};
    $('set-visibility').querySelectorAll('select[data-vis]').forEach(function (sel) {
      pv[sel.getAttribute('data-vis')] = sel.value;
    });
    var payload = {
      hideBlockedPosts: $('pv-posts').checked,
      hideBlockedComments: $('pv-comments').checked,
      postDisplayRange: $('set-range').value || 'all',
      profileVisibility: pv
    };
    var btn = $('set-save-privacy');
    btn.disabled = true;
    try {
      await mApp.api.post('/api/user/privacy-settings', payload);
      var settings = Object.assign({}, user.settings || {});
      settings.privacy = payload;
      saveLocalUser({ settings: settings });
      mApp.toast('隐私设置已保存', 'success');
    } catch (e) { /* 已提示 */ }
    btn.disabled = false;
  }

  // ---------- 数据导出 ----------
  var EXPORT_ITEMS = [
    ['profile', '个人资料'], ['posts', '我的帖子'], ['favorites', '我的收藏'],
    ['follows', '关注关系'], ['messages', '私信记录'], ['notifications', '通知记录'],
    ['settings', '设置项']
  ];

  function exportSheet() {
    var html = EXPORT_ITEMS.map(function (it) {
      return '<div class="m-row"><span class="m-row-label">' + it[1] + '</span>' +
        '<label class="m-switch"><input type="checkbox" data-export="' + it[0] + '" checked>' +
        '<span></span></label></div>';
    }).join('') +
      '<p class="m-hint" style="margin-top:10px">导出为 JSON 文件，包含你选择的数据</p>' +
      '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="ex-go">导出</button></div>';

    var s = mApp.sheet('导出我的数据', html);
    s.body.querySelector('#ex-go').addEventListener('click', async function () {
      var include = [];
      s.body.querySelectorAll('input[data-export]').forEach(function (cb) {
        if (cb.checked) include.push(cb.getAttribute('data-export'));
      });
      if (!include.length) { mApp.toast('请至少选择一项', 'warning'); return; }

      this.disabled = true;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 导出中…';
      try {
        var res = await fetch('/api/user/export-data?include=' + encodeURIComponent(include.join(',')),
          { credentials: 'same-origin' });
        if (!res.ok) {
          var err = null;
          try { err = await res.json(); } catch (e) { /* 忽略 */ }
          throw new Error((err && err.message) || '导出失败');
        }
        var data = await res.json();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '校园论坛数据导出-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 1500);
        mApp.toast('导出完成，请查看下载文件', 'success');
        s.close();
      } catch (e) {
        mApp.toast(e.message || '导出失败', 'error');
        this.disabled = false;
        this.textContent = '导出';
      }
    });
  }

  // ---------- 注销账号 ----------
  function deleteSheet() {
    var pw = null;
    var html =
      '<div class="m-announce" style="margin-bottom:12px">' +
        '<i class="fas fa-triangle-exclamation"></i><div>' +
        '<b>注销后无法恢复</b>账号将无法登录，请谨慎操作。</div></div>' +
      '<div id="dl-step1">' +
        '<div class="m-field"><label class="m-label">当前密码</label>' +
        '<input class="m-input" id="dl-pw" type="password" placeholder="请输入当前密码"></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="dl-to2">发送验证码</button></div>' +
      '</div>' +
      '<div id="dl-step2" style="display:none">' +
        '<div class="m-field"><label class="m-label">邮箱验证码</label>' +
        '<input class="m-input" id="dl-code" inputmode="numeric" maxlength="8" placeholder="请输入收到的验证码"></div>' +
        '<div class="m-row" style="margin-top:6px"><span class="m-row-label">保留我发布的帖子和评论</span>' +
          '<label class="m-switch"><input type="checkbox" id="dl-keep"><span></span></label></div>' +
        '<div class="m-sheet-foot"><button class="m-btn m-btn-primary m-btn-block" id="dl-go"' +
          ' style="background:var(--m-error);box-shadow:none">确认注销</button></div>' +
      '</div>';

    var s = mApp.sheet('注销账号', html);
    var B = function (id) { return s.body.querySelector(id); };

    B('#dl-to2').addEventListener('click', async function () {
      pw = input('dl-pw');
      if (!pw) { mApp.toast('请输入当前密码', 'warning'); return; }
      this.disabled = true;
      try {
        await mApp.api.post('/api/send-deletion-code', { password: pw });
        mApp.toast('验证码已发送到邮箱', 'success');
        B('#dl-step1').style.display = 'none';
        B('#dl-step2').style.display = '';
      } catch (e) { /* 已提示 */ }
      this.disabled = false;
    });

    B('#dl-go').addEventListener('click', async function () {
      var code = input('dl-code');
      if (!code) { mApp.toast('请输入验证码', 'warning'); return; }
      if (!confirm('最后确认：真的要注销账号吗？')) return;
      this.disabled = true;
      try {
        await mApp.api.post('/api/delete-account', {
          password: pw, verificationCode: code, keepData: B('#dl-keep').checked
        });
        localStorage.removeItem('forumUser');
        mApp.toast('账号已注销', 'success');
        setTimeout(function () { location.href = 'm-login.html'; }, 1200);
      } catch (e) { this.disabled = false; }
    });
  }

  // ---------- 初始化 ----------
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('m-back').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = 'm-profile.html';
    });

    mApp.auth.init().then(async function (u) {
      if (!u) {
        mApp.toast('请先登录后进入设置', 'warning');
        setTimeout(function () {
          location.href = 'm-login.html?redirect=' + encodeURIComponent('/m-settings.html');
        }, 800);
        return;
      }
      user = u;

      // 本地资料不全时（缺少 settings/email 等），从服务端补全
      if (!user.settings || !user.email) {
        try {
          var d = await mApp.api.get('/api/user/profile/' + encodeURIComponent(user.id), { silent: true });
          if (d && d.user) {
            saveLocalUser(d.user);
            user = mApp.auth.user;
          }
        } catch (e) { /* 补全失败则用现有资料渲染 */ }
      }

      renderCard();
      renderNotify();
      renderPrivacy();
      loadQqStatus();

      // 头像
      $('set-avatar-file').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        uploadAvatar(f);
      });

      $('set-edit-profile').addEventListener('click', editProfileSheet);
      $('set-password').addEventListener('click', passwordSheet);
      $('set-email').addEventListener('click', emailSheet);
      $('set-qq').addEventListener('click', toggleQq);
      $('set-save-privacy').addEventListener('click', savePrivacy);
      $('set-export').addEventListener('click', exportSheet);
      $('set-delete').addEventListener('click', deleteSheet);

      // 通知开关：改动即保存
      $('set-notify').addEventListener('change', function (e) {
        if (e.target.closest('input[data-notify]')) saveNotify();
      });
    });
  });
})();