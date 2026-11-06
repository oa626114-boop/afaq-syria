(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { api: localStorage.getItem('afaq_wallet_api_base') || '', token: sessionStorage.getItem('afaq_wallet_token') || '', member: null, summary: null, mode: 'login' };
  const fmt = (n, digits = 6) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
  const message = (id, text, error = false) => { const el = $(id); if (el) { el.textContent = text; el.classList.toggle('error', !!error); } };
  function toast(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
  function base() { return state.api.replace(/\/+$/, ''); }
  async function api(path, options = {}) {
    if (!base()) throw new Error('يرجى ضبط رابط Worker أولاً من زر الإعدادات.');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(base() + path, { ...options, headers });
    let data; try { data = await response.json(); } catch { throw new Error(`استجابة غير صالحة من الخادم (${response.status})`); }
    if (!response.ok || data.ok === false) {
      if (response.status === 401) clearSession();
      throw new Error(data.error || `تعذر إكمال الطلب (${response.status})`);
    }
    return data;
  }
  function clearSession() { state.token = ''; state.member = null; sessionStorage.removeItem('afaq_wallet_token'); $('walletPanel').hidden = true; $('authPanel').hidden = false; $('walletNav').hidden = true; document.body.classList.add('auth-mode'); document.querySelectorAll('[data-action].is-selected').forEach(el => { el.classList.remove('is-selected'); el.removeAttribute('aria-current'); el.querySelector('.tap-indicator')?.remove(); }); }
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach(b => b.classList.toggle('active', b.dataset.authMode === mode));
    $('nameLabel').hidden = mode !== 'register'; $('fullName').required = mode === 'register';
    $('authSubmit').textContent = mode === 'register' ? 'إنشاء حساب آفاق' : 'دخول آمن';
    $('password').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    message('authMessage', '');
  }
  async function authSubmit(e) {
    e.preventDefault();
    const password = $('password').value;
    if (password.length < 10) return message('authMessage', 'كلمة المرور يجب أن تتكون من 10 أحرف على الأقل.', true);
    const registering = state.mode === 'register';
    const body = registering ? { name: $('fullName').value.trim(), email: $('loginId').value.trim(), password } : { login: $('loginId').value.trim(), password };
    const btn = $('authSubmit'); btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
    try {
      const data = await api(registering ? '/api/member/register' : '/api/member/login', { method: 'POST', body: JSON.stringify(body) });
      state.token = data.token; state.member = data.member; sessionStorage.setItem('afaq_wallet_token', data.token);
      $('password').value = ''; await loadWallet(); toast('تم تسجيل الدخول بنجاح');
    } catch (err) { message('authMessage', err.message, true); }
    finally { btn.disabled = false; btn.textContent = registering ? 'إنشاء حساب آفاق' : 'دخول آمن'; }
  }
  function renderSummary(data) {
    state.summary = data;
    $('afaqBalance').textContent = fmt(Number(data.balance_units || 0) / 1_000_000);
    $('miningStatus').textContent = data.mining?.active ? 'نشط' : 'غير نشط';
    $('miningRate').textContent = `المعدل: ${fmt(data.mining?.rate_per_hour || 0, 8)} AFAQ / ساعة`;
    $('miningTitle').textContent = data.mining?.active ? 'التعدين يعمل الآن' : 'ابدأ رحلتك مع AFAQ';
    $('miningDescription').textContent = data.mining?.active ? 'جلسة التعدين نشطة على الخادم. أوقفها عند الانتهاء لاحتساب المكافأة وفق قواعد المنصة.' : 'يتم احتساب المكافآت وفق المعدل الذي يحدده مشرف المنصة بعد تفعيل التعدين.';
    $('miningBtn').textContent = data.mining?.active ? 'إيقاف التعدين واحتساب المكافأة' : (data.mining?.enabled ? 'بدء التعدين' : 'التعدين غير مفعّل حالياً');
    $('miningBtn').disabled = !data.mining?.enabled;
    $('connectionStatus').innerHTML = '<i></i> متصل بالخادم';
  }
  async function loadWallet() {
    const [me, summary] = await Promise.all([api('/api/member/me'), api('/api/wallet/summary')]);
    state.member = me.member; $('memberName').textContent = me.member.name || me.member.email;
    $('memberId').textContent = me.member.member_id || '—';
    renderSummary(summary); $('authPanel').hidden = true; $('walletPanel').hidden = false; $('walletNav').hidden = false; document.body.classList.remove('auth-mode');
    await loadHistory();
  }
  async function refresh() { try { const data = await api('/api/wallet/summary'); renderSummary(data); toast('تم تحديث الرصيد من الخادم'); } catch (e) { toast(e.message); } }
  async function miningAction() {
    const active = !!state.summary?.mining?.active; const btn = $('miningBtn'); btn.disabled = true;
    try {
      const data = await api(`/api/wallet/mining/${active ? 'stop' : 'start'}`, { method: 'POST', body: '{}' });
      if (data.reward_units != null) toast(`تم تسجيل مكافأة ${fmt(data.reward_units / 1_000_000)} AFAQ`);
      else toast(active ? 'تم إنهاء جلسة التعدين' : 'بدأت جلسة التعدين');
      await refresh(); await loadHistory();
    } catch (e) { toast(e.message); }
    finally { btn.disabled = !state.summary?.mining?.enabled; }
  }
  async function loadHistory() {
    try {
      const [mining, transfers] = await Promise.all([api('/api/wallet/mining/history'), api('/api/member/transfers')]);
      const rows = [
        ...(mining.rewards || []).map(x => ({ type: 'مكافأة تعدين', amount: fmt(Number(x.amount_units) / 1_000_000), currency: 'AFAQ', date: x.created_at, direction: 'in' })),
        ...(transfers.transfers || []).map(x => ({ type: x.direction === 'out' ? 'تحويل صادر' : 'تحويل وارد', amount: fmt(x.amount, 2), currency: x.currency, date: x.created_at, direction: x.direction }))
      ].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,30);
      $('todayRewards').textContent = fmt((mining.rewards || []).filter(x => new Date(x.created_at).toDateString() === new Date().toDateString()).reduce((sum,x) => sum + Number(x.amount_units || 0),0) / 1_000_000);
      $('activityList').innerHTML = rows.length ? rows.map(x => `<article class="activity-row"><div><b>${escapeHtml(x.type)}</b><small>${new Date(x.date).toLocaleString('ar')}</small></div><strong class="${x.direction === 'out' ? 'negative' : 'positive'}" dir="ltr">${x.direction === 'out' ? '−' : '+'}${escapeHtml(x.amount)} ${escapeHtml(x.currency)}</strong></article>`).join('') : '<div class="empty"><span>▤</span><b>لا توجد عمليات بعد</b><small>ستظهر العمليات المؤكدة من الخادم هنا.</small></div>';
    } catch (e) { $('activityList').textContent = e.message; }
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  async function transferSubmit(e) {
    e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true;
    const idem = crypto.randomUUID();
    try {
      const data = await api('/api/member/transfer', { method: 'POST', headers: { 'Idempotency-Key': idem }, body: JSON.stringify({ recipient: $('recipient').value.trim(), amount: Number($('transferAmount').value), currency: $('transferCurrency').value, note: $('transferNote').value.trim() }) });
      message('transferMessage', `تم تنفيذ التحويل ${data.transfer.transfer_id} بنجاح.`); e.target.reset(); await loadHistory();
    } catch (err) { message('transferMessage', err.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  async function testConnection() {
    const value = $('apiBaseInput').value.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(value)) return message('apiMessage', 'يجب إدخال رابط HTTPS صحيح.', true);
    $('saveApiBtn').disabled = true;
    try {
      const res = await fetch(value + '/health'); const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.database === 'not_configured' ? 'الخادم لا يتصل بقاعدة D1.' : (data.error || 'فشل فحص الخادم.'));
      state.api = value; localStorage.setItem('afaq_wallet_api_base', value); message('apiMessage', 'الاتصال بالخادم وقاعدة البيانات سليم.');
      if (state.token) await loadWallet();
    } catch (e) { message('apiMessage', e.message, true); }
    finally { $('saveApiBtn').disabled = false; }
  }
  document.querySelectorAll('[data-auth-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.authMode)));
  $('authForm').addEventListener('submit', authSubmit);
  $('passwordToggle').addEventListener('click', () => { const p = $('password'), shown = p.type === 'password'; p.type = shown ? 'text' : 'password'; $('passwordToggle').setAttribute('aria-pressed', String(shown)); $('passwordToggle').setAttribute('aria-label', shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'); });
  $('miningBtn').addEventListener('click', miningAction); $('refreshBtn').addEventListener('click', refresh); $('historyRefresh').addEventListener('click', e => { e.preventDefault(); loadHistory(); });
  $('logoutBtn').addEventListener('click', async () => { try { await api('/api/member/logout', { method: 'POST', body: '{}' }); } catch {} clearSession(); toast('تم تسجيل الخروج'); });
  $('transferForm').addEventListener('submit', transferSubmit); $('transferClose').addEventListener('click', () => $('transferPanel').hidden = true);
  function activateAction(button) {
    document.querySelectorAll('[data-action].is-selected').forEach(el => {
      el.classList.remove('is-selected'); el.removeAttribute('aria-current');
      el.querySelector('.tap-indicator')?.remove();
    });
    button.classList.add('is-selected'); button.setAttribute('aria-current','page');
    const pointer = document.createElement('span');
    pointer.className = 'tap-indicator'; pointer.setAttribute('aria-hidden','true'); pointer.textContent = '👆';
    button.appendChild(pointer);
  }
  document.querySelectorAll('[data-scroll]').forEach(b => b.addEventListener('click', () => { const el = $(b.dataset.scroll); if (el) { el.hidden = false; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => {
    const action = b.dataset.action; activateAction(b);
    if (action === 'wallet') $('balanceCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (action === 'mining') $('miningSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (action === 'transfer') { $('transferPanel').hidden = false; $('transferPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (action === 'history') $('historySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (action === 'refresh') refresh();
    else if (action === 'security') toast('تتم إدارة كلمة المرور والجلسات من حساب آفاق سوريا.');
  }));
  $('settingsOpen').addEventListener('click', () => { $('apiBaseInput').value = state.api; $('settingsDialog').showModal(); });
  $('saveApiBtn').addEventListener('click', testConnection);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', async () => { try { const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); await registration.update(); } catch {} });
  if (state.api) { $('apiBaseInput').value = state.api; if (state.token) loadWallet().catch(e => { clearSession(); message('authMessage', e.message, true); }); }
  setMode('login');
})();