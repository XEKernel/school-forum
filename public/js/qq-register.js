/**
 * QQ 快捷登录 - 新用户补全资料页
 * 流程：qq-callback.js 检测到 needProfile → 跳转到本页 ?state=xxx
 * 本页读取 state → 获取 QQ 预填信息（昵称/头像）→ 用户补全学校班级等 → 提交注册
 */
(function () {
  let qqState = '';
  let schools = [];

  const $ = (id) => document.getElementById(id);

  function showNotification(message, type = 'info') {
    const area = $('notificationArea');
    if (!area) return;
    const n = document.createElement('div');
    n.className = `notification-message ${type}`;
    n.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i><span>${escapeHtml(message)}</span>`;
    area.appendChild(n);
    setTimeout(() => n.classList.add('show'), 10);
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 3000);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 加载学校配置
  async function loadSchools() {
    try {
      const resp = await fetch('/api/schools');
      const data = await resp.json();
      if (data.success && data.schools) {
        schools = data.schools;
        const schoolSelect = $('school-qq');
        schools.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.name;
          opt.textContent = s.name;
          schoolSelect.appendChild(opt);
        });
        initEnrollmentYears();
      }
    } catch (e) {
      console.error('加载学校配置失败:', e);
    }
  }

  // 初始化入学年份（近6年）
  function initEnrollmentYears() {
    const select = $('enrollment-year-qq');
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 5; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = `${y}年`;
      select.appendChild(opt);
    }
  }

  // 学校/年份变化 → 加载班级
  function onSchoolOrYearChange() {
    const schoolSelect = $('school-qq');
    const yearSelect = $('enrollment-year-qq');
    const classSelect = $('class-qq');

    if (!schoolSelect.value || !yearSelect.value) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">请先选择学校与年份</option>';
      return;
    }

    const selectedSchool = schools.find(s => s.name === schoolSelect.value);
    if (!selectedSchool || !selectedSchool.classInfo) {
      classSelect.disabled = true;
      classSelect.innerHTML = '<option value="">该学校暂无班级配置</option>';
      return;
    }

    // classInfo: { "2024": ["1班","2班"], ... } 按年份
    const classes = selectedSchool.classInfo[yearSelect.value] ||
                    selectedSchool.classInfo[String(yearSelect.value)] ||
                    [];
    classSelect.innerHTML = '<option value="">请选择班级</option>';
    if (classes.length === 0) {
      // 无该年份配置，回退为自由输入
      classSelect.disabled = false;
      classSelect.innerHTML = '<option value="">该年份无预置班级，请输入班级</option>';
      const manual = document.createElement('option');
      manual.value = '__manual__';
      manual.textContent = '手动输入班级';
      classSelect.appendChild(manual);
      return;
    }
    classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      classSelect.appendChild(opt);
    });
    classSelect.disabled = false;
  }

  // 班级手动输入
  function ensureManualClassInput() {
    const classSelect = $('class-qq');
    if (classSelect.value === '__manual__') {
      const manual = prompt('请输入您的班级（如：3班）', '');
      if (manual && manual.trim()) {
        const opt = document.createElement('option');
        opt.value = manual.trim();
        opt.textContent = manual.trim();
        classSelect.appendChild(opt);
        classSelect.value = manual.trim();
      } else {
        classSelect.selectedIndex = 0;
      }
    }
  }

  // 初始化：读取 QQ 预填信息
  async function init() {
    const params = new URLSearchParams(window.location.search);
    qqState = params.get('state') || '';
    if (!qqState) {
      showNotification('授权会话缺失，请重新登录', 'error');
      setTimeout(() => { window.location.href = 'login.html'; }, 1500);
      return;
    }

    try {
      const resp = await fetch(`/api/auth/qq/result?state=${encodeURIComponent(qqState)}`);
      const data = await resp.json();
      if (!data.success || !data.prefill) {
        showNotification(data.message || '授权会话已过期，请重新登录', 'error');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return;
      }

      // 填 QQ 昵称/头像
      const nickname = data.prefill.nickname || '';
      if (nickname) {
        $('qq-nickname').textContent = nickname;
        $('username-qq').value = nickname;
      }
      const avatar = data.prefill.avatar || '';
      if (avatar) {
        const img = $('qq-avatar');
        img.src = avatar;
        img.style.display = '';
      }
      if (data.prefill.gender === 'male' || data.prefill.gender === 'female') {
        $('gender-qq').value = data.prefill.gender;
      }
    } catch (e) {
      console.error('获取 QQ 信息失败:', e);
      showNotification('获取 QQ 信息失败，请重试', 'error');
      setTimeout(() => { window.location.href = 'login.html'; }, 1500);
      return;
    }

    await loadSchools();
    $('school-qq').addEventListener('change', onSchoolOrYearChange);
    $('enrollment-year-qq').addEventListener('change', onSchoolOrYearChange);
    $('class-qq').addEventListener('change', ensureManualClassInput);
    $('confirm-qq-register').addEventListener('click', submit);
  }

  // 提交补全资料
  async function submit() {
    const username = $('username-qq').value.trim();
    const school = $('school-qq').value;
    const enrollmentYear = $('enrollment-year-qq').value;
    let className = $('class-qq').value;
    const birthday = $('birthday-qq').value || null;
    const gender = $('gender-qq').value || '';

    if (!username) return showNotification('请输入用户名', 'error');
    if (!school) return showNotification('请选择学校', 'error');
    if (!enrollmentYear) return showNotification('请选择入学年份', 'error');
    if (!className) return showNotification('请选择或输入班级', 'error');

    const btn = $('confirm-qq-register');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 注册中...';

    try {
      const resp = await fetch('/api/auth/qq/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: qqState, username, school, enrollmentYear, className, birthday, gender })
      });
      const data = await resp.json();

      if (!data.success) {
        showNotification(data.message || '注册失败，请重试', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fab fa-qq"></i> 完成注册并登录';
        return;
      }

      // 保存登录态（令牌由服务端写入 HttpOnly Cookie，前端只留展示用用户信息）
      localStorage.setItem('forumUser', JSON.stringify(data.user));

      showNotification(`注册成功，欢迎 ${data.user.username}！`, 'success');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } catch (e) {
      console.error('QQ 注册失败:', e);
      showNotification('注册失败，请检查网络后重试', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fab fa-qq"></i> 完成注册并登录';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
