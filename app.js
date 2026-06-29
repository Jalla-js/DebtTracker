const STORAGE_KEY = 'debtTrackerDataV2';
const LEGACY_STORAGE_KEY = 'debtTrackerData';
const THEME_KEY = 'debtTrackerTheme';

const memoryStore = new Map();

const state = {
  data: { people: [] },
  route: { name: 'dashboard', params: {} },
  search: '',
  sort: 'largest',
  currentSheet: null,
  confirmAction: null,
  noteTimer: null
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initTheme();
  bindEvents();
  state.data = normalizeRoot(loadData());
  seedIfNeeded();
  ensureHash();
  parseRoute();
  render();
});

function cacheDom() {
  ['viewRoot','routeTitle','routeEyebrow','grandTotal','heroSubtext',
   'globalSearch','sortSelect','fabBtn','archiveQuickBtn','backBtn','themeToggle',
   'sheetBackdrop','sheet','sheetTitle','sheetEyebrow','sheetCloseBtn','cancelSheetBtn',
   'debtForm','modeInput','personIdInput','groupPersonIdInput','debtIdInput',
   'personNameInput','avatarInput','groupInput','amountInput','dateInput','notesInput',
   'paymentBackdrop','paymentSheet','paymentForm','paymentDebtId',
   'paymentAmountInput','paymentDateInput','paymentCloseBtn','cancelPaymentBtn',
   'toastRegion','confirmBackdrop','confirmText','confirmOkBtn','confirmCancelBtn'
  ].forEach(id => el[id] = document.getElementById(id));
  el.navButtons = Array.from(document.querySelectorAll('[data-nav]'));
}

function initTheme() {
  const saved = safeStorageGet(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
}

function bindEvents() {
  window.addEventListener('hashchange', () => { parseRoute(); render(); });
  el.globalSearch.addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); render(); });
  el.sortSelect.addEventListener('change', e => { state.sort = e.target.value; render(); });
  el.fabBtn.addEventListener('click', () => openDebtSheet());
  el.archiveQuickBtn.addEventListener('click', () => goTo('#/archive'));
  el.backBtn.addEventListener('click', () => history.length > 1 ? history.back() : goTo('#/dashboard'));
  el.themeToggle.addEventListener('click', toggleTheme);
  el.debtForm.addEventListener('submit', handleDebtSubmit);
  el.paymentForm.addEventListener('submit', handlePaymentSubmit);
  el.sheetCloseBtn.addEventListener('click', closeSheets);
  el.cancelSheetBtn.addEventListener('click', closeSheets);
  el.paymentCloseBtn.addEventListener('click', closeSheets);
  el.cancelPaymentBtn.addEventListener('click', closeSheets);
  el.sheetBackdrop.addEventListener('click', e => { if (e.target === el.sheetBackdrop) closeSheets(); });
  el.paymentBackdrop.addEventListener('click', e => { if (e.target === el.paymentBackdrop) closeSheets(); });
  el.confirmCancelBtn.addEventListener('click', closeConfirm);
  el.confirmOkBtn.addEventListener('click', () => { if (state.confirmAction) state.confirmAction(); closeConfirm(); });
  el.confirmBackdrop.addEventListener('click', e => { if (e.target === el.confirmBackdrop) closeConfirm(); });
  el.navButtons.forEach(btn => btn.addEventListener('click', () => {
    if (btn.id === 'addNavBtn') openDebtSheet();
    else goTo(btn.dataset.nav);
  }));
  document.addEventListener('click', createRipple);
}

function ensureHash() { if (!location.hash) location.hash = '#/dashboard'; }

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name = 'dashboard', param] = hash.split('/');
  state.route = { name, params: { id: param || null } };
}

function goTo(hash) { location.hash = hash; }

/* ─── Storage ─────────────────────────────────── */
function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); }
  catch (_) { return memoryStore.has(key) ? memoryStore.get(key) : null; }
}
function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); }
  catch (_) { memoryStore.set(key, value); }
}

function loadData() {
  try {
    const raw = safeStorageGet(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacyRaw = safeStorageGet(LEGACY_STORAGE_KEY);
    if (legacyRaw) return migrateLegacy(JSON.parse(legacyRaw));
  } catch (_) {}
  return { people: [] };
}

function migrateLegacy(oldData) {
  const people = Array.isArray(oldData) ? oldData.map(person => ({
    id: person.id || uid(), name: person.name || 'Unnamed',
    avatar: initials(person.name || 'U'), createdAt: new Date().toISOString(),
    groups: groupLegacyDebts(person.debts || [])
  })) : [];
  return { people };
}

function groupLegacyDebts(debts) {
  const map = new Map();
  debts.forEach(item => {
    const key = (item.reason || 'General').trim() || 'General';
    if (!map.has(key)) map.set(key, { id: uid(), groupName: key, createdAt: new Date().toISOString(), debts: [] });
    map.get(key).debts.push({
      id: item.id || uid(), originalAmount: toMoney(item.amount || 0),
      remainingAmount: toMoney(item.amount || 0), notes: '',
      createdAt: item.createdAt || new Date().toISOString(),
      status: 'active', archivedAt: null, payments: []
    });
  });
  return Array.from(map.values());
}

function normalizeRoot(root) {
  return { people: Array.isArray(root?.people) ? root.people.map(normalizePerson) : [] };
}
function normalizePerson(person) {
  return {
    id: person?.id || uid(), name: (person?.name || 'Unnamed').trim(),
    avatar: normalizeAvatar(person?.avatar, person?.name),
    createdAt: person?.createdAt || new Date().toISOString(),
    groups: Array.isArray(person?.groups) ? person.groups.map(normalizeGroup).filter(Boolean) : []
  };
}
function normalizeGroup(group) {
  const debts = Array.isArray(group?.debts) ? group.debts.map(normalizeDebt).filter(Boolean) : [];
  if (!debts.length && !group?.groupName) return null;
  return { id: group?.id || uid(), groupName: (group?.groupName || 'General').trim() || 'General', createdAt: group?.createdAt || new Date().toISOString(), debts };
}
function normalizeDebt(debt) {
  const originalAmount = toMoney(debt?.originalAmount ?? debt?.amount ?? 0);
  const payments = Array.isArray(debt?.payments) ? debt.payments.map(p => ({ amount: toMoney(p.amount), date: p.date || new Date().toISOString() })) : [];
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = debt?.remainingAmount != null ? toMoney(debt.remainingAmount) : Math.max(0, toMoney(originalAmount - paid));
  const status = debt?.status || (remainingAmount <= 0 ? 'completed' : 'active');
  return {
    id: debt?.id || uid(), originalAmount, remainingAmount, notes: debt?.notes || '',
    createdAt: debt?.createdAt || new Date().toISOString(), status,
    archivedAt: debt?.archivedAt || (status === 'completed' ? new Date().toISOString() : null), payments
  };
}

function saveData() { safeStorageSet(STORAGE_KEY, JSON.stringify(state.data)); }
function seedIfNeeded() { if (!state.data.people.length) { state.data.people = []; saveData(); } }

/* ─── Routing & render ────────────────────────── */
const routeDepth = { dashboard: 0, archive: 0, person: 1, group: 2, payment: 3 };
let lastRouteDepth = 0;

function render() {
  const meta = computeMeta();
  updateHeader(meta);
  updateNav();
  const route = state.route.name;
  const depth = routeDepth[route] ?? 0;
  const dir = depth >= lastRouteDepth ? 'forward' : 'back';
  lastRouteDepth = depth;
  el.viewRoot.dataset.transition = dir;
  if      (route === 'dashboard') renderDashboard(meta);
  else if (route === 'person')    renderPerson(meta);
  else if (route === 'group')     renderGroup(meta);
  else if (route === 'payment')   renderPayment(meta);
  else if (route === 'archive')   renderArchive(meta);
  else goTo('#/dashboard');
}

function updateHeader(meta) {
  animateCurrency(el.grandTotal, meta.totalOutstanding);
  const titleMap = {
    dashboard: ['People overview', 'Debt Tracker'],
    person:    ['Person',          meta.currentPerson?.name || 'Person'],
    group:     [meta.currentPerson?.name || 'Group', meta.currentGroup?.groupName || 'Group'],
    payment:   ['Debt detail',     meta.currentGroup?.groupName || 'Debt'],
    archive:   ['Completed',       'Archive']
  };
  const [eyebrow, title] = titleMap[state.route.name] || titleMap.dashboard;
  el.routeEyebrow.textContent = eyebrow;
  el.routeTitle.textContent = title;
  el.backBtn.hidden = state.route.name === 'dashboard';
  el.heroSubtext.textContent = state.route.name === 'archive'
    ? `${meta.completedCount} completed`
    : `${meta.activePeopleCount} people · ${meta.activeDebtCount} debts`;
}

function updateNav() {
  el.navButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.nav === `#/${state.route.name}`));
}

/* ─── Dashboard ───────────────────────────────── */
function renderDashboard(meta) {
  const people = getFilteredPeople();
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="section-head">
          <span class="section-title">People</span>
          <button class="primary-btn" type="button" data-action="add-debt">+ Add debt</button>
        </div>
        <div class="kpi-strip">
          <div class="kpi-cell"><span class="kpi-label">Outstanding</span><span class="kpi-value">${money(meta.totalOutstanding)}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Paid back</span><span class="kpi-value">${money(meta.totalPaid)}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Archived</span><span class="kpi-value">${meta.completedCount}</span></div>
        </div>
        ${people.length
          ? `<div class="people-list stagger">${people.map(renderPersonRow).join('')}</div>`
          : renderEmpty('No debts yet', 'Tap + Add debt to get started.')}
      </div>
    </section>`;
  bindDashboardActions();
}

function renderPersonRow(person) {
  const groups = getActiveGroups(person);
  const total = personOutstanding(person);
  return `
    <div class="person-row" data-person-card="${person.id}">
      <div class="row-left">
        ${renderAvatar(person)}
        <div class="inline-stack">
          <span class="person-name">${escapeHtml(person.name)}</span>
          <span class="row-meta">${groups.length} group${groups.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="row-right">
        <span class="row-amount">${money(total)}</span>
      </div>
      <svg class="row-chevron" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
    </div>`;
}

/* ─── Person ──────────────────────────────────── */
function renderPerson(meta) {
  const person = meta.currentPerson;
  if (!person) return goTo('#/dashboard');
  const groups = getActiveGroups(person).filter(groupMatchesSearch);
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="section-head">
          <div style="display:flex;align-items:center;gap:0.75rem">
            ${renderAvatar(person)}
            <span class="section-title">${escapeHtml(person.name)}</span>
          </div>
          <button class="primary-btn" type="button" data-action="add-debt" data-person="${person.id}">+ Add</button>
        </div>
        <div class="kpi-strip">
          <div class="kpi-cell"><span class="kpi-label">Owes</span><span class="kpi-value">${money(personOutstanding(person))}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Groups</span><span class="kpi-value">${groups.length}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Items</span><span class="kpi-value">${groups.reduce((s,g)=>s+getActiveDebts(g).length,0)}</span></div>
        </div>
        ${groups.length
          ? `<div class="group-list stagger">${groups.map(g => renderGroupRow(person, g)).join('')}</div>`
          : renderEmpty('No groups yet', 'Add a debt to create the first group.')}
      </div>
    </section>`;
  bindDashboardActions();
}

function renderGroupRow(person, group) {
  const debts = getActiveDebts(group);
  return `
    <div class="group-row" data-group-card="${group.id}">
      <div class="row-left">
        <div class="inline-stack">
          <span class="group-name">${escapeHtml(group.groupName)}</span>
          <span class="row-meta">${debts.length} item${debts.length===1?'':'s'}</span>
        </div>
      </div>
      <div class="row-right">
        <span class="row-amount">${money(groupOutstanding(group))}</span>
      </div>
      <svg class="row-chevron" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
    </div>`;
}

/* ─── Group ───────────────────────────────────── */
function renderGroup(meta) {
  const { currentPerson: person, currentGroup: group } = meta;
  if (!person || !group) return goTo('#/dashboard');
  const debts = getActiveDebts(group).filter(d => debtMatchesSearch(person, group, d));
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="section-head">
          <span class="section-title">${escapeHtml(group.groupName)}</span>
          <button class="primary-btn" type="button" data-action="add-debt" data-person="${person.id}" data-group="${group.id}">+ Add</button>
        </div>
        <div class="kpi-strip">
          <div class="kpi-cell"><span class="kpi-label">Outstanding</span><span class="kpi-value">${money(groupOutstanding(group))}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Items</span><span class="kpi-value">${debts.length}</span></div>
          <div class="kpi-cell"><span class="kpi-label">Since</span><span class="kpi-value">${formatDateShort(group.createdAt)}</span></div>
        </div>
        ${debts.length
          ? `<div class="debt-list stagger">${debts.map(d => renderDebtRow(person, group, d)).join('')}</div>`
          : renderEmpty('No items', 'Add a debt to this group.')}
      </div>
    </section>`;
  bindDashboardActions();
  bindSwipes();
}

function renderDebtRow(person, group, debt) {
  return `
    <div class="swipe-item" data-debt-card="${debt.id}">
      <div class="swipe-bg right">✏️ Edit</div>
      <div class="swipe-bg left">✓ Archive</div>
      <div class="swipe-card debt-row" data-debt-card="${debt.id}">
        <div class="debt-row-left">
          <span class="debt-title">${escapeHtml(group.groupName)}</span>
          <span class="debt-row-note">${escapeHtml(debt.notes ? truncate(debt.notes,40) : 'No notes · ' + formatDate(debt.createdAt))}</span>
        </div>
        <div class="debt-row-right">
          <span class="row-amount">${money(debt.remainingAmount)}</span>
        </div>
        <svg class="row-chevron" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
      </div>
    </div>`;
}

/* ─── Payment detail ──────────────────────────── */
function renderPayment(meta) {
  const { currentPerson: person, currentGroup: group, currentDebt: debt } = meta;
  if (!person || !group || !debt) return goTo('#/dashboard');
  const paid = debt.originalAmount - debt.remainingAmount;
  const progress = debt.originalAmount ? Math.min(100, (paid / debt.originalAmount) * 100) : 0;
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="debt-detail-hero">
          <span class="debt-detail-who">${escapeHtml(person.name)} · ${escapeHtml(group.groupName)}</span>
          <div class="debt-detail-amount">${money(debt.remainingAmount)}</div>
        </div>
        <div class="progress-wrap">
          <div class="progress-labels">
            <span>Paid ${money(paid)}</span>
            <span>of ${money(debt.originalAmount)}</span>
          </div>
          <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
        </div>
        <div class="action-row">
          <button class="primary-btn" type="button" data-action="part-pay" data-debt="${debt.id}">Part pay</button>
          <button class="ghost-btn" type="button" data-action="pay-off" data-debt="${debt.id}">Pay off</button>
          <button class="ghost-btn" type="button" data-action="edit-debt" data-debt="${debt.id}">Edit</button>
          <button class="danger-btn" type="button" data-action="archive-debt" data-debt="${debt.id}">Archive</button>
        </div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <span class="section-title">Notes</span>
          <span class="notes-status" id="notesStatus">Autosaves</span>
        </div>
        <textarea class="notes-editor" id="detailNotes" placeholder="Add context or reminders…">${escapeHtml(debt.notes)}</textarea>
      </div>

      ${debt.payments.length ? `
      <div class="section-card">
        <div class="section-head"><span class="section-title">Payments</span></div>
        <div class="stagger">
          ${debt.payments.slice().reverse().map(p => `
            <div class="payment-row">
              <div class="inline-stack">
                <span class="payment-amount">${money(p.amount)}</span>
                <span class="payment-date">${formatDate(p.date)}</span>
              </div>
              <span class="payment-badge">Paid</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </section>`;
  bindPaymentDetail(debt);
}

/* ─── Archive ─────────────────────────────────── */
function renderArchive(meta) {
  const items = getArchivedDebts().filter(archiveMatchesSearch);
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="section-head"><span class="section-title">Completed debts</span></div>
        ${items.length
          ? `<div class="archive-list stagger">${items.map(item => `
            <div class="archive-row">
              <div class="row-left">
                ${renderAvatar(item.person)}
                <div class="inline-stack">
                  <span class="person-name">${escapeHtml(item.person.name)}</span>
                  <span class="row-meta">${escapeHtml(item.group.groupName)} · ${formatDate(item.debt.archivedAt||item.debt.createdAt)}</span>
                </div>
              </div>
              <div class="row-right">
                <span class="row-amount" style="color:var(--color-success)">${money(item.debt.originalAmount)}</span>
                <span style="font-size:var(--text-xs);color:var(--color-text-faint)">paid off</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0">
                <button class="ghost-btn" type="button" data-action="restore-debt" data-debt="${item.debt.id}" style="min-height:2rem;padding-inline:0.75rem;font-size:var(--text-xs)">Restore</button>
              </div>
            </div>`).join('')}</div>`
          : renderEmpty('Archive is empty', 'Paid-off debts will appear here.')}
      </div>
    </section>`;
  bindArchiveActions();
}

/* ─── Event binding ───────────────────────────── */
function bindDashboardActions() {
  document.querySelectorAll('[data-person-card]').forEach(node => {
    node.addEventListener('click', () => goTo(`#/person/${node.dataset.personCard}`));
    attachCardSwipe(node, { onRight: () => goTo(`#/person/${node.dataset.personCard}`) });
  });
  document.querySelectorAll('[data-group-card]').forEach(node => {
    node.addEventListener('click', () => goTo(`#/group/${node.dataset.groupCard}`));
    attachCardSwipe(node, { onRight: () => goTo(`#/group/${node.dataset.groupCard}`) });
  });
  document.querySelectorAll('[data-debt-card]').forEach(node => node.addEventListener('click', e => {
    if (e.target.closest('[data-action]')) return;
    goTo(`#/payment/${node.dataset.debtCard}`);
  }));
  document.querySelectorAll('[data-action="add-debt"]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openDebtSheet({ personId: btn.dataset.person || '', groupId: btn.dataset.group || '' });
  }));
}

function attachCardSwipe(node, { onRight, onLeft } = {}) {
  let startX = 0, startY = 0, dx = 0, dy = 0, active = false;
  const max = 70;
  node.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dy = 0; active = true; node.style.transition = 'none';
  }, { passive: true });
  node.addEventListener('touchmove', e => {
    if (!active) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) + 8) { active = false; node.style.transform = ''; return; }
    node.style.transform = `translateX(${Math.max(-max, Math.min(max, dx * 0.55))}px)`;
  }, { passive: true });
  node.addEventListener('touchend', () => {
    if (!active) return; active = false;
    node.style.transition = 'transform 300ms cubic-bezier(0.16,1,0.3,1)';
    node.style.transform = '';
    if (dx > 55 && onRight) { vibrate(8); setTimeout(onRight, 60); }
    else if (dx < -55 && onLeft) { vibrate(8); setTimeout(onLeft, 60); }
  });
}

function bindArchiveActions() {
  document.querySelectorAll('[data-action="restore-debt"]').forEach(btn =>
    btn.addEventListener('click', () => restoreDebt(btn.dataset.debt)));
}

function bindPaymentDetail(debt) {
  const notes = document.getElementById('detailNotes');
  const status = document.getElementById('notesStatus');
  if (notes) {
    notes.addEventListener('input', e => {
      clearTimeout(state.noteTimer);
      if (status) status.textContent = 'Saving…';
      state.noteTimer = setTimeout(() => {
        const found = findDebtById(debt.id);
        if (!found) return;
        found.debt.notes = e.target.value;
        saveData();
        if (status) status.textContent = 'Saved';
      }, 200);
    });
  }
  document.querySelector('[data-action="part-pay"]')?.addEventListener('click', () => openPaymentSheet(debt.id));
  document.querySelector('[data-action="pay-off"]')?.addEventListener('click', () => payOffDebt(debt.id));
  document.querySelector('[data-action="edit-debt"]')?.addEventListener('click', () => openDebtSheet({ debtId: debt.id }));
  document.querySelector('[data-action="archive-debt"]')?.addEventListener('click', () =>
    confirmAction('Archive this debt?', () => archiveDebt(debt.id)));
}

function bindSwipes() {
  document.querySelectorAll('.swipe-item').forEach(item => attachSwipe(item));
}

function attachSwipe(item) {
  const card = item.querySelector('.swipe-card');
  const bgLeft = item.querySelector('.swipe-bg.left');
  const bgRight = item.querySelector('.swipe-bg.right');
  let startX = 0, currentX = 0, dragging = false;
  const max = 100;
  item.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true; startX = e.clientX; currentX = 0;
    card.style.transition = 'none'; item.setPointerCapture(e.pointerId);
  });
  item.addEventListener('pointermove', e => {
    if (!dragging) return;
    currentX = e.clientX - startX;
    const limited = Math.max(-max, Math.min(max, currentX * 0.95));
    card.style.transform = `translateX(${limited}px)`;
    bgLeft.style.opacity = limited < -12 ? '1' : '0';
    bgRight.style.opacity = limited > 12 ? '1' : '0';
  });
  function finish(pointerId) {
    if (!dragging) return; dragging = false;
    card.style.transition = 'transform .22s cubic-bezier(.16,1,.3,1)';
    const debtId = item.dataset.debtCard;
    if (currentX <= -80) {
      card.style.transform = 'translateX(-110px)';
      setTimeout(() => archiveDebt(debtId, true), 110);
    } else if (currentX >= 80) {
      card.style.transform = 'translateX(110px)';
      setTimeout(() => { openDebtSheet({ debtId }); resetSwipe(); }, 110);
    } else resetSwipe();
    if (pointerId != null) item.releasePointerCapture(pointerId);
  }
  function resetSwipe() {
    card.style.transform = 'translateX(0)';
    bgLeft.style.opacity = '0'; bgRight.style.opacity = '0';
  }
  item.addEventListener('pointerup', e => finish(e.pointerId));
  item.addEventListener('pointercancel', e => finish(e.pointerId));
}

/* ─── Sheet open / close ──────────────────────── */
function openDebtSheet({ personId = '', groupId = '', debtId = '' } = {}) {
  // FIX: do NOT call closeSheets() here — it starts a 280ms timer that
  // sets hidden=true and kills the sheet we're about to open.
  // Instead just reset form state synchronously.
  el.debtForm.reset();
  el.personNameInput.disabled = false;
  el.avatarInput.disabled = false;

  const foundDebt = debtId ? findDebtById(debtId) : null;
  const person = foundDebt?.person || findPerson(personId);
  const group  = foundDebt?.group  || findGroupById(groupId)?.group;

  el.modeInput.value          = debtId ? 'edit' : 'create';
  el.debtIdInput.value        = debtId || '';
  el.personIdInput.value      = person?.id || '';
  el.groupPersonIdInput.value = group?.id  || '';
  el.sheetEyebrow.textContent = debtId ? 'Edit' : 'New';
  el.sheetTitle.textContent   = debtId ? 'Edit debt' : 'Add debt';
  el.personNameInput.value    = person?.name || '';
  el.avatarInput.value        = person?.avatar || '';
  el.groupInput.value         = group?.groupName || '';
  el.amountInput.value        = foundDebt ? foundDebt.debt.originalAmount.toFixed(2) : '';
  el.notesInput.value         = foundDebt?.debt.notes || '';
  el.dateInput.value          = isoDate(foundDebt?.debt.createdAt || new Date().toISOString());
  el.personNameInput.disabled = !!foundDebt;
  el.avatarInput.disabled     = !!foundDebt;

  openSheet(el.sheetBackdrop, el.sheet, el.personNameInput.disabled ? el.groupInput : el.personNameInput);
}

function openPaymentSheet(debtId) {
  const found = findDebtById(debtId);
  if (!found || found.debt.status !== 'active') return;
  el.paymentForm.reset();
  el.paymentDebtId.value       = debtId;
  el.paymentAmountInput.value  = '';
  el.paymentDateInput.value    = isoDate(new Date().toISOString());
  openSheet(el.paymentBackdrop, el.paymentSheet, el.paymentAmountInput);
}

function openSheet(backdrop, sheet, focusTarget) {
  // Cancel any pending close timer so it can't fight us
  if (backdrop._closeTimer) { clearTimeout(backdrop._closeTimer); backdrop._closeTimer = null; }
  state.currentSheet = backdrop.id;
  backdrop.hidden = false;
  backdrop.classList.remove('is-hiding');
  sheet.style.transform = '';
  sheet.style.transition = '';
  requestAnimationFrame(() => {
    backdrop.classList.add('is-visible');
    sheet.classList.add('is-open');
  });
  setTimeout(() => focusTarget?.focus(), 80);
  attachSheetDrag(sheet, () => closeSheets());
}

function closeSheets(resetDebt = true) {
  const sheetEls    = [el.sheet, el.paymentSheet];
  const backdropEls = [el.sheetBackdrop, el.paymentBackdrop];

  sheetEls.forEach(s => { s.classList.remove('is-open'); s.style.transform = ''; s.style.transition = ''; });
  backdropEls.forEach(b => {
    b.classList.add('is-hiding');
    b.classList.remove('is-visible');
    b.style.background = '';
    b._closeTimer = setTimeout(() => {
      b.hidden = true;
      b.classList.remove('is-hiding');
      b._closeTimer = null;
    }, 280);
  });

  if (resetDebt) {
    el.debtForm.reset();
    el.paymentForm.reset();
    el.personNameInput.disabled = false;
    el.avatarInput.disabled = false;
  }
  state.currentSheet = null;
}

function attachSheetDrag(sheet, onDismiss) {
  const handle = sheet.querySelector('.sheet-handle');
  if (!handle || handle._dragAttached) return;
  handle._dragAttached = true;
  let startY = 0, currentY = 0, dragging = false;

  function onDown(e) {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    currentY = 0; dragging = true;
    sheet.style.transition = 'none';
    if (!e.touches) { document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }
  }
  function onMove(e) {
    if (!dragging) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    currentY = Math.max(0, clientY - startY);
    sheet.style.transform = `translateY(${currentY}px)`;
    const backdrop = sheet.closest('.sheet-backdrop');
    if (backdrop) backdrop.style.background = `rgba(0,0,0,${0.45 * Math.max(0, 1 - currentY / 300)})`;
  }
  function onUp() {
    if (!dragging) return; dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const backdrop = sheet.closest('.sheet-backdrop');
    if (currentY > 110) {
      sheet.style.transition = 'transform 230ms cubic-bezier(0.4,0,1,1)';
      sheet.style.transform = 'translateY(110%)';
      vibrate(10);
      setTimeout(onDismiss, 210);
    } else {
      sheet.style.transition = 'transform 340ms cubic-bezier(0.16,1,0.3,1)';
      sheet.style.transform = 'translateY(0)';
      if (backdrop) backdrop.style.background = '';
    }
  }
  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: true });
  sheet.addEventListener('touchmove', onMove, { passive: true });
  sheet.addEventListener('touchend', onUp);
}

/* ─── Form handlers ───────────────────────────── */
function handleDebtSubmit(e) {
  e.preventDefault();
  const mode = el.modeInput.value;
  const amount = toMoney(el.amountInput.value);
  const groupName = el.groupInput.value.trim();
  const date = el.dateInput.value ? new Date(el.dateInput.value).toISOString() : new Date().toISOString();
  if (!amount || amount <= 0 || !groupName) return toast('Enter a valid amount and group.');

  if (mode === 'edit') {
    const found = findDebtById(el.debtIdInput.value);
    if (!found) return;
    const paid = found.debt.originalAmount - found.debt.remainingAmount;
    found.group.groupName = groupName;
    found.debt.originalAmount = amount;
    found.debt.remainingAmount = Math.max(0, toMoney(amount - paid));
    found.debt.notes = el.notesInput.value.trim();
    found.debt.createdAt = date;
    found.debt.status = found.debt.remainingAmount <= 0 ? 'completed' : 'active';
    if (found.debt.status === 'completed') found.debt.archivedAt = found.debt.archivedAt || new Date().toISOString();
    cleanEmptyGroups(); saveData(); closeSheets(); render(); toast('Debt updated.');
    return;
  }

  const personName = el.personNameInput.value.trim();
  if (!personName) return toast('Enter a person name.');
  let person = el.personIdInput.value ? findPerson(el.personIdInput.value) : findPersonByName(personName);
  if (!person) {
    person = { id: uid(), name: personName, avatar: normalizeAvatar(el.avatarInput.value.trim(), personName), createdAt: new Date().toISOString(), groups: [] };
    state.data.people.push(person);
  } else {
    person.avatar = normalizeAvatar(el.avatarInput.value.trim() || person.avatar, person.name);
  }
  let group = person.groups.find(g => g.id === el.groupPersonIdInput.value) || person.groups.find(g => g.groupName.toLowerCase() === groupName.toLowerCase());
  if (!group) { group = { id: uid(), groupName, createdAt: date, debts: [] }; person.groups.push(group); }
  else { group.groupName = groupName; }
  group.debts.push({ id: uid(), originalAmount: amount, remainingAmount: amount, notes: el.notesInput.value.trim(), createdAt: date, status: 'active', archivedAt: null, payments: [] });
  saveData(); closeSheets(); render(); toast('Debt saved.'); vibrate(12);
}

function handlePaymentSubmit(e) {
  e.preventDefault();
  const found = findDebtById(el.paymentDebtId.value);
  if (!found) return;
  const amount = toMoney(el.paymentAmountInput.value);
  if (!amount || amount <= 0) return toast('Enter a valid payment.');
  if (amount > found.debt.remainingAmount) return toast('Payment exceeds remaining balance.');
  found.debt.payments.push({ amount, date: new Date(el.paymentDateInput.value || new Date().toISOString()).toISOString() });
  found.debt.remainingAmount = toMoney(found.debt.remainingAmount - amount);
  if (found.debt.remainingAmount <= 0) {
    found.debt.remainingAmount = 0; found.debt.status = 'completed'; found.debt.archivedAt = new Date().toISOString();
    toast('Fully paid! Moved to archive.'); vibrate([10, 50, 10]);
  } else { toast('Payment recorded.'); vibrate(12); }
  saveData(); closeSheets();
  if (found.debt.status === 'completed') goTo('#/archive'); else render();
}

function payOffDebt(debtId) {
  const found = findDebtById(debtId);
  if (!found || found.debt.remainingAmount <= 0) return;
  confirmAction(`Pay off ${money(found.debt.remainingAmount)} and archive?`, () => {
    found.debt.payments.push({ amount: found.debt.remainingAmount, date: new Date().toISOString() });
    found.debt.remainingAmount = 0; found.debt.status = 'completed'; found.debt.archivedAt = new Date().toISOString();
    saveData(); goTo('#/archive'); toast('Paid off!');
  });
}

function archiveDebt(debtId, silent = false) {
  const found = findDebtById(debtId);
  if (!found) return;
  const snapshot = JSON.parse(JSON.stringify(found.debt));
  found.debt.status = 'completed'; found.debt.archivedAt = new Date().toISOString();
  saveData(); render();
  toast('Archived.', 'Undo', () => restoreSnapshot(debtId, snapshot));
}

function restoreSnapshot(debtId, snapshot) {
  const found = findDebtById(debtId);
  if (!found) return;
  Object.assign(found.debt, snapshot, { status: snapshot.remainingAmount <= 0 ? 'completed' : 'active' });
  if (found.debt.status === 'active') found.debt.archivedAt = null;
  saveData(); render();
}

function restoreDebt(debtId) {
  const found = findDebtById(debtId);
  if (!found) return;
  if (found.debt.remainingAmount <= 0) return toast('Fully paid — edit to reopen.');
  found.debt.status = 'active'; found.debt.archivedAt = null;
  saveData(); render(); toast('Restored.');
}

function confirmAction(message, action) {
  state.confirmAction = action;
  el.confirmText.textContent = message;
  el.confirmBackdrop.hidden = false;
  el.confirmBackdrop.classList.remove('is-hiding');
  requestAnimationFrame(() => el.confirmBackdrop.classList.add('is-visible'));
}

function closeConfirm() {
  state.confirmAction = null;
  el.confirmBackdrop.classList.add('is-hiding');
  el.confirmBackdrop.classList.remove('is-visible');
  setTimeout(() => { el.confirmBackdrop.hidden = true; el.confirmBackdrop.classList.remove('is-hiding'); }, 260);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  safeStorageSet(THEME_KEY, next);
}

/* ─── Data helpers ────────────────────────────── */
function computeMeta() {
  const people = state.data.people;
  let totalOutstanding = 0, totalPaid = 0, groupCount = 0;
  const activeDebts = [], archived = [];
  people.forEach(person => person.groups.forEach(group => {
    groupCount++;
    group.debts.forEach(debt => {
      totalPaid += debt.payments.reduce((s, p) => s + p.amount, 0);
      if (debt.status === 'active') { activeDebts.push({ person, group, debt }); totalOutstanding += debt.remainingAmount; }
      else archived.push({ person, group, debt });
    });
  }));
  const current = state.route.params.id ? findDebtGroupPersonById(state.route.params.id) : {};
  return {
    totalOutstanding: toMoney(totalOutstanding), totalPaid: toMoney(totalPaid),
    activePeopleCount: people.filter(p => personOutstanding(p) > 0).length,
    activeDebtCount: activeDebts.length, completedCount: archived.length, groupCount,
    currentPerson: current.person || findPerson(state.route.params.id),
    currentGroup: current.group, currentDebt: current.debt
  };
}

function getFilteredPeople() {
  let people = state.data.people.filter(p => personOutstanding(p) > 0);
  if (state.search) people = people.filter(personMatchesSearch);
  return people.sort(sortPeople);
}
function getActiveGroups(person) { return person.groups.filter(g => getActiveDebts(g).length > 0); }
function getActiveDebts(group) { return group.debts.filter(d => d.status === 'active'); }
function getArchivedDebts() {
  return state.data.people.flatMap(p => p.groups.flatMap(g => g.debts.filter(d => d.status === 'completed').map(d => ({ person: p, group: g, debt: d }))));
}

function findPerson(id) { return state.data.people.find(p => p.id === id); }
function findPersonByName(name) { return state.data.people.find(p => p.name.toLowerCase() === name.toLowerCase()); }
function findGroupById(id) {
  for (const p of state.data.people) { const g = p.groups.find(g => g.id === id); if (g) return { person: p, group: g }; }
  return null;
}
function findDebtById(id) {
  for (const p of state.data.people) for (const g of p.groups) { const d = g.debts.find(d => d.id === id); if (d) return { person: p, group: g, debt: d }; }
  return null;
}
function findDebtGroupPersonById(id) { return findDebtById(id) || findGroupById(id) || { person: findPerson(id) }; }
function cleanEmptyGroups() { state.data.people.forEach(p => p.groups = p.groups.filter(g => g.debts.length)); }
function personOutstanding(person) { return toMoney(person.groups.reduce((s, g) => s + groupOutstanding(g), 0)); }
function groupOutstanding(group) { return toMoney(group.debts.filter(d => d.status === 'active').reduce((s, d) => s + d.remainingAmount, 0)); }
function newestPersonDate(person) { return person.groups.flatMap(g => g.debts.map(d => d.createdAt)).sort().reverse()[0] || person.createdAt; }

function personMatchesSearch(person) {
  const q = state.search; if (!q) return true;
  return person.name.toLowerCase().includes(q) || person.groups.some(g => g.groupName.toLowerCase().includes(q) || g.debts.some(d => (d.notes||'').toLowerCase().includes(q)));
}
function groupMatchesSearch(group) {
  const q = state.search; if (!q) return true;
  return group.groupName.toLowerCase().includes(q) || group.debts.some(d => (d.notes||'').toLowerCase().includes(q));
}
function debtMatchesSearch(person, group, debt) {
  const q = state.search; if (!q) return true;
  return person.name.toLowerCase().includes(q) || group.groupName.toLowerCase().includes(q) || (debt.notes||'').toLowerCase().includes(q);
}
function archiveMatchesSearch(item) {
  const q = state.search; if (!q) return true;
  return item.person.name.toLowerCase().includes(q) || item.group.groupName.toLowerCase().includes(q) || (item.debt.notes||'').toLowerCase().includes(q);
}
function sortPeople(a, b) {
  if (state.sort === 'name') return a.name.localeCompare(b.name);
  if (state.sort === 'recent' || state.sort === 'newest') return new Date(newestPersonDate(b)) - new Date(newestPersonDate(a));
  if (state.sort === 'oldest') return new Date(newestPersonDate(a)) - new Date(newestPersonDate(b));
  if (state.sort === 'smallest') return personOutstanding(a) - personOutstanding(b);
  return personOutstanding(b) - personOutstanding(a);
}

/* ─── Rendering helpers ───────────────────────── */
function renderAvatar(person) {
  const value = person.avatar || initials(person.name);
  const emoji = /\p{Extended_Pictographic}/u.test(value);
  return emoji
    ? `<div class="avatar emoji">${escapeHtml(value)}</div>`
    : `<div class="avatar">${escapeHtml(value.slice(0,2).toUpperCase())}</div>`;
}

function renderEmpty(title, text) {
  return `<div class="empty-state">
    <div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg></div>
    <h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>
  </div>`;
}

/* ─── Utility ─────────────────────────────────── */
function normalizeAvatar(value, name) { return (value||'').trim() || initials(name||'U'); }
function initials(name) { return (name||'U').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase(); }
function uid() { return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function money(value) { return `£${toMoney(value).toFixed(2)}`; }
function toMoney(value) { return Math.round((Number(value)||0)*100)/100; }
function formatDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(value));
}
function formatDateShort(value) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' }).format(new Date(value));
}
function isoDate(value) { return new Date(value).toISOString().slice(0,10); }
function truncate(text, len) { return text.length > len ? `${text.slice(0, len-1)}…` : text; }
function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function vibrate(ms=8) { try { navigator.vibrate?.(ms); } catch(_) {} }

function toast(message, actionLabel, action) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ''}`;
  if (actionLabel && action) node.querySelector('button').addEventListener('click', () => { action(); node.remove(); });
  el.toastRegion.appendChild(node);
  const timer = setTimeout(() => dismissToast(node), 3200);
  let startX=0, dx=0, swiping=false;
  node.addEventListener('touchstart', e => { startX=e.touches[0].clientX; dx=0; swiping=true; node.style.transition='none'; }, { passive:true });
  node.addEventListener('touchmove', e => { if(!swiping)return; dx=e.touches[0].clientX-startX; node.style.transform=`translateX(${dx}px)`; node.style.opacity=String(Math.max(0,1-Math.abs(dx)/140)); }, { passive:true });
  node.addEventListener('touchend', () => { swiping=false; if(Math.abs(dx)>60){ clearTimeout(timer); dismissToast(node); } else { node.style.transition=''; node.style.transform=''; node.style.opacity=''; } });
}
function dismissToast(node) { node.classList.add('toast-out'); setTimeout(() => node.remove(), 220); }

function animateCurrency(node, target) {
  const start = Number(node.dataset.value || 0), end = Number(target||0);
  const startTime = performance.now(), duration = 450;
  node.dataset.value = end;
  function step(now) {
    const p = Math.min(1, (now-startTime)/duration);
    const eased = 1 - Math.pow(1-p, 3);
    node.textContent = money(start + (end-start)*eased);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function createRipple(e) {
  const target = e.target.closest('button');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size/2}px`;
  ripple.style.top  = `${e.clientY - rect.top  - size/2}px`;
  target.style.position = target.style.position || 'relative';
  target.style.overflow = target.style.overflow || 'hidden';
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}
