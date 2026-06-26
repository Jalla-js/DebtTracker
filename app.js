const STORAGE_KEY = 'debtTrackerDataV2';
const LEGACY_STORAGE_KEY = 'debtTrackerData';
const THEME_KEY = 'debtTrackerTheme';

const state = {
  data: { people: [] },
  route: { name: 'dashboard', params: {} },
  search: '',
  sort: 'largest',
  currentSheet: null,
  confirmAction: null,
  noteTimer: null,
  undoArchive: null
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initTheme();
  bindEvents();
  closeConfirm();
  state.data = normalizeRoot(loadData());
  seedIfNeeded();
  ensureHash();
  parseRoute();
  render();
});

function cacheDom() {
  ['viewRoot','routeTitle','routeEyebrow','grandTotal','heroSubtext','heroChips','globalSearch','sortSelect','fabBtn','archiveQuickBtn','backBtn','themeToggle','sheetBackdrop','sheet','sheetTitle','sheetEyebrow','sheetCloseBtn','cancelSheetBtn','debtForm','modeInput','personIdInput','groupPersonIdInput','debtIdInput','personNameInput','avatarInput','groupInput','amountInput','dateInput','notesInput','paymentBackdrop','paymentSheet','paymentForm','paymentDebtId','paymentAmountInput','paymentDateInput','paymentCloseBtn','cancelPaymentBtn','toastRegion','confirmBackdrop','confirmText','confirmOkBtn','confirmCancelBtn']
    .forEach(id => el[id] = document.getElementById(id));
  el.navButtons = Array.from(document.querySelectorAll('[data-nav]'));
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
}

function bindEvents() {
  window.addEventListener('hashchange', () => {
    parseRoute();
    render();
  });
  el.globalSearch.addEventListener('input', e => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });
  el.sortSelect.addEventListener('change', e => {
    state.sort = e.target.value;
    render();
  });
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

function ensureHash() {
  if (!location.hash) location.hash = '#/dashboard';
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name = 'dashboard', param] = hash.split('/');
  state.route = { name, params: { id: param || null } };
}

function goTo(hash) { location.hash = hash; }

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) return migrateLegacy(JSON.parse(legacyRaw));
  } catch (_) {}
  return { people: [] };
}

function migrateLegacy(oldData) {
  const people = Array.isArray(oldData) ? oldData.map(person => ({
    id: person.id || uid(),
    name: person.name || 'Unnamed',
    avatar: initials(person.name || 'U'),
    createdAt: new Date().toISOString(),
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
      id: item.id || uid(),
      originalAmount: toMoney(item.amount || 0),
      remainingAmount: toMoney(item.amount || 0),
      notes: '',
      createdAt: item.createdAt || new Date().toISOString(),
      status: 'active',
      archivedAt: null,
      payments: []
    });
  });
  return Array.from(map.values());
}

function normalizeRoot(root) {
  const normalized = { people: Array.isArray(root?.people) ? root.people.map(normalizePerson) : [] };
  return normalized;
}

function normalizePerson(person) {
  return {
    id: person?.id || uid(),
    name: (person?.name || 'Unnamed').trim(),
    avatar: normalizeAvatar(person?.avatar, person?.name),
    createdAt: person?.createdAt || new Date().toISOString(),
    groups: Array.isArray(person?.groups) ? person.groups.map(normalizeGroup).filter(Boolean) : []
  };
}

function normalizeGroup(group) {
  const debts = Array.isArray(group?.debts) ? group.debts.map(normalizeDebt).filter(Boolean) : [];
  if (!debts.length && !group?.groupName) return null;
  return {
    id: group?.id || uid(),
    groupName: (group?.groupName || 'General').trim() || 'General',
    createdAt: group?.createdAt || new Date().toISOString(),
    debts
  };
}

function normalizeDebt(debt) {
  const originalAmount = toMoney(debt?.originalAmount ?? debt?.amount ?? 0);
  const payments = Array.isArray(debt?.payments) ? debt.payments.map(p => ({ amount: toMoney(p.amount), date: p.date || new Date().toISOString() })) : [];
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = debt?.remainingAmount != null ? toMoney(debt.remainingAmount) : Math.max(0, toMoney(originalAmount - paid));
  const status = debt?.status || (remainingAmount <= 0 ? 'completed' : 'active');
  return {
    id: debt?.id || uid(),
    originalAmount,
    remainingAmount,
    notes: debt?.notes || '',
    createdAt: debt?.createdAt || new Date().toISOString(),
    status,
    archivedAt: debt?.archivedAt || (status === 'completed' ? new Date().toISOString() : null),
    payments
  };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function seedIfNeeded() {
  if (state.data.people.length) return;
  state.data.people = [];
  saveData();
}

function render() {
  const meta = computeMeta();
  updateHeader(meta);
  updateNav();
  const route = state.route.name;
  if (route === 'dashboard') renderDashboard(meta);
  else if (route === 'person') renderPerson(meta);
  else if (route === 'group') renderGroup(meta);
  else if (route === 'payment') renderPayment(meta);
  else if (route === 'archive') renderArchive(meta);
  else goTo('#/dashboard');
}

function updateHeader(meta) {
  animateCurrency(el.grandTotal, meta.totalOutstanding);
  const titleMap = {
    dashboard: ['People overview', 'Debt Tracker'],
    person: ['Person details', meta.currentPerson?.name || 'Person'],
    group: ['Debt group', meta.currentGroup?.groupName || 'Group'],
    payment: ['Payment detail', 'Debt detail'],
    archive: ['Completed debts', 'Archive']
  };
  const [eyebrow, title] = titleMap[state.route.name] || titleMap.dashboard;
  el.routeEyebrow.textContent = eyebrow;
  el.routeTitle.textContent = title;
  el.backBtn.hidden = state.route.name === 'dashboard';
  el.heroSubtext.textContent = state.route.name === 'archive'
    ? `${meta.completedCount} completed debt${meta.completedCount === 1 ? '' : 's'} saved permanently.`
    : `${meta.activePeopleCount} people, ${meta.activeDebtCount} active debt${meta.activeDebtCount === 1 ? '' : 's'}, ${meta.completedCount} archived.`;
  el.heroChips.innerHTML = `
    <span class="stat-chip">Active £${meta.totalOutstanding.toFixed(2)}</span>
    <span class="stat-chip">Paid £${meta.totalPaid.toFixed(2)}</span>
    <span class="stat-chip">Groups ${meta.groupCount}</span>
  `;
}

function updateNav() {
  el.navButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.nav === `#/${state.route.name}`));
}

function renderDashboard(meta) {
  const people = getFilteredPeople();
  el.viewRoot.innerHTML = `
    <section class="screen">
      <div class="section-card">
        <div class="section-head"><div><div class="eyebrow">Snapshot</div><h2 class="section-title">Overview</h2></div></div>
        <div class="kpi-grid stagger">
          <div class="kpi-card"><span class="muted">Outstanding</span><div class="value">${money(meta.totalOutstanding)}</div></div>
          <div class="kpi-card"><span class="muted">Paid so far</span><div class="value">${money(meta.totalPaid)}</div></div>
          <div class="kpi-card"><span class="muted">People</span><div class="value">${meta.activePeopleCount}</div></div>
          <div class="kpi-card"><span class="muted">Archive</span><div class="value">${meta.completedCount}</div></div>
        </div>
      </div>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">People</div><h2 class="section-title">Who owes money</h2></div><button class="pill-btn" type="button" data-action="add-debt">Add debt</button></div>
        ${people.length ? `<div class="people-list stagger">${people.map(renderPersonCard).join('')}</div>` : renderEmpty('No active matches', 'Try a different search or add a new debt.')}
      </section>
    </section>
  `;
  bindDashboardActions();
}

function renderPerson(meta) {
  const person = meta.currentPerson;
  if (!person) return goTo('#/dashboard');
  const activeGroups = getActiveGroups(person).filter(groupMatchesSearch);
  el.viewRoot.innerHTML = `
    <section class="screen">
      <section class="section-card">
        <div class="row-between">
          <div class="person-left">
            ${renderAvatar(person)}
            <div class="inline-stack">
              <div class="person-name">${escapeHtml(person.name)}</div>
              <div class="muted">${activeGroups.length} group${activeGroups.length === 1 ? '' : 's'} active</div>
            </div>
          </div>
          <div class="person-total">${money(personOutstanding(person))}</div>
        </div>
      </section>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Grouped debts</div><h2 class="section-title">Reasons</h2></div><button class="pill-btn" type="button" data-action="add-debt" data-person="${person.id}">Add debt</button></div>
        ${activeGroups.length ? `<div class="group-list stagger">${activeGroups.map(group => renderGroupCard(person, group)).join('')}</div>` : renderEmpty('No groups yet', 'Add a debt for this person to create a group.')}
      </section>
    </section>
  `;
  bindDashboardActions();
}

function renderGroup(meta) {
  const { currentPerson: person, currentGroup: group } = meta;
  if (!person || !group) return goTo('#/dashboard');
  const debts = getActiveDebts(group).filter(debtMatchesSearch.bind(null, person, group));
  el.viewRoot.innerHTML = `
    <section class="screen">
      <section class="section-card">
        <div class="row-between">
          <div class="inline-stack">
            <div class="eyebrow">${escapeHtml(person.name)}</div>
            <h2 class="section-title">${escapeHtml(group.groupName)}</h2>
          </div>
          <div class="group-total">${money(groupOutstanding(group))}</div>
        </div>
        <div class="meta-row"><span>${debts.length} item${debts.length === 1 ? '' : 's'}</span><span>Created ${formatDate(group.createdAt)}</span></div>
      </section>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Individual debts</div><h2 class="section-title">Items</h2></div><button class="pill-btn" type="button" data-action="add-debt" data-person="${person.id}" data-group="${group.id}">Add debt</button></div>
        ${debts.length ? `<div class="debt-list stagger">${debts.map(debt => renderDebtCard(person, group, debt)).join('')}</div>` : renderEmpty('No debt items', 'Add a new item inside this group.')}
      </section>
    </section>
  `;
  bindDashboardActions();
  bindSwipes();
}

function renderPayment(meta) {
  const { currentPerson: person, currentGroup: group, currentDebt: debt } = meta;
  if (!person || !group || !debt) return goTo('#/dashboard');
  const paid = debt.originalAmount - debt.remainingAmount;
  const progress = debt.originalAmount ? Math.min(100, (paid / debt.originalAmount) * 100) : 0;
  el.viewRoot.innerHTML = `
    <section class="screen">
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">${escapeHtml(person.name)} · ${escapeHtml(group.groupName)}</div><h2 class="section-title">Debt detail</h2></div><div class="debt-amount">${money(debt.remainingAmount)}</div></div>
        <div class="progress-shell">
          <div class="meta-row"><span>Original ${money(debt.originalAmount)}</span><span>Paid ${money(paid)}</span><span>Status ${debt.status}</span></div>
          <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
        </div>
      </section>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Notes</div><h2 class="section-title">Live notes</h2></div><span class="notes-status" id="notesStatus">Autosaves instantly</span></div>
        <textarea class="notes-editor" id="detailNotes" placeholder="Add context, reminders, or payment details">${escapeHtml(debt.notes)}</textarea>
      </section>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Actions</div><h2 class="section-title">Manage debt</h2></div></div>
        <div class="action-grid">
          <button class="primary-btn" type="button" data-action="part-pay" data-debt="${debt.id}">Part pay</button>
          <button class="pill-btn" type="button" data-action="pay-off" data-debt="${debt.id}">Pay off</button>
          <button class="ghost-btn" type="button" data-action="edit-debt" data-debt="${debt.id}">Edit</button>
          <button class="danger-btn" type="button" data-action="archive-debt" data-debt="${debt.id}">Archive</button>
        </div>
      </section>
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Payment history</div><h2 class="section-title">Timeline</h2></div></div>
        ${debt.payments.length ? `<div class="payment-list stagger">${debt.payments.slice().reverse().map(payment => `
          <div class="payment-row">
            <div class="inline-stack"><span class="meta-strong">${money(payment.amount)}</span><span class="muted">${formatDate(payment.date, true)}</span></div>
            <span class="summary-tag">Recorded</span>
          </div>`).join('')}</div>` : renderEmpty('No payments yet', 'Use Part pay or Pay off to record progress.')}
      </section>
    </section>
  `;
  bindPaymentDetail(debt);
}

function renderArchive(meta) {
  const items = getArchivedDebts().filter(item => archiveMatchesSearch(item));
  el.viewRoot.innerHTML = `
    <section class="screen">
      <section class="section-card">
        <div class="section-head"><div><div class="eyebrow">Archive</div><h2 class="section-title">Completed debts</h2></div></div>
        ${items.length ? `<div class="archive-list stagger">${items.map(item => `
          <article class="archive-card">
            <div class="row-between"><div class="inline-stack"><div class="debt-title">${escapeHtml(item.person.name)} · ${escapeHtml(item.group.groupName)}</div><div class="muted">Completed ${formatDate(item.debt.archivedAt || item.debt.createdAt, true)}</div></div><div class="debt-amount">${money(item.debt.originalAmount)}</div></div>
            <div class="meta-row"><span>Paid in full</span><span>${item.debt.payments.length} payment${item.debt.payments.length === 1 ? '' : 's'}</span><span>${item.debt.notes ? 'Has notes' : 'No notes'}</span></div>
            <div class="summary-tags"><button class="pill-btn" type="button" data-action="restore-debt" data-debt="${item.debt.id}">Restore</button><button class="ghost-btn" type="button" data-action="open-payment" data-debt="${item.debt.id}">Open</button></div>
          </article>
        `).join('')}</div>` : renderEmpty('Archive is empty', 'Completed debts will appear here instead of being deleted.')}
      </section>
    </section>
  `;
  bindArchiveActions();
}

function bindDashboardActions() {
  document.querySelectorAll('[data-person-card]').forEach(node => node.addEventListener('click', () => goTo(`#/person/${node.dataset.personCard}`)));
  document.querySelectorAll('[data-group-card]').forEach(node => node.addEventListener('click', () => goTo(`#/group/${node.dataset.groupCard}`)));
  document.querySelectorAll('[data-debt-card]').forEach(node => node.addEventListener('click', e => {
    if (e.target.closest('[data-action]')) return;
    goTo(`#/payment/${node.dataset.debtCard}`);
  }));
  document.querySelectorAll('[data-action="add-debt"]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openDebtSheet({ personId: btn.dataset.person || '', groupId: btn.dataset.group || '' });
  }));
}

function bindArchiveActions() {
  document.querySelectorAll('[data-action="restore-debt"]').forEach(btn => btn.addEventListener('click', () => restoreDebt(btn.dataset.debt)));
  document.querySelectorAll('[data-action="open-payment"]').forEach(btn => btn.addEventListener('click', () => goTo(`#/payment/${btn.dataset.debt}`)));
}

function bindPaymentDetail(debt) {
  const notes = document.getElementById('detailNotes');
  const status = document.getElementById('notesStatus');
  if (notes) {
    notes.addEventListener('input', e => {
      clearTimeout(state.noteTimer);
      status.textContent = 'Saving…';
      state.noteTimer = setTimeout(() => {
        const found = findDebtById(debt.id);
        if (!found) return;
        found.debt.notes = e.target.value;
        saveData();
        status.textContent = 'Saved just now';
      }, 180);
    });
  }
  document.querySelector('[data-action="part-pay"]')?.addEventListener('click', () => openPaymentSheet(debt.id));
  document.querySelector('[data-action="pay-off"]')?.addEventListener('click', () => payOffDebt(debt.id));
  document.querySelector('[data-action="edit-debt"]')?.addEventListener('click', () => openDebtSheet({ debtId: debt.id }));
  document.querySelector('[data-action="archive-debt"]')?.addEventListener('click', () => confirmAction('Archive this debt? It will move to the archive and remain restorable.', () => archiveDebt(debt.id)));
}

function bindSwipes() {
  document.querySelectorAll('.swipe-item').forEach(item => attachSwipe(item));
}

function attachSwipe(item) {
  const card = item.querySelector('.swipe-card');
  const bgLeft = item.querySelector('.swipe-bg.left');
  const bgRight = item.querySelector('.swipe-bg.right');
  let startX = 0, currentX = 0, dragging = false;
  const max = 112;

  item.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    currentX = 0;
    card.style.transition = 'none';
    item.setPointerCapture(e.pointerId);
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
    if (!dragging) return;
    dragging = false;
    card.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
    const debtId = item.dataset.debtCard;
    if (currentX <= -86) {
      card.style.transform = 'translateX(-120px)';
      setTimeout(() => { archiveDebt(debtId, true); }, 120);
    } else if (currentX >= 86) {
      card.style.transform = 'translateX(120px)';
      setTimeout(() => { openDebtSheet({ debtId }); }, 120);
      setTimeout(() => resetSwipe(), 180);
    } else resetSwipe();
    if (pointerId != null) item.releasePointerCapture(pointerId);
  }

  function resetSwipe() {
    card.style.transform = 'translateX(0)';
    bgLeft.style.opacity = '0';
    bgRight.style.opacity = '0';
  }

  item.addEventListener('pointerup', e => finish(e.pointerId));
  item.addEventListener('pointercancel', e => finish(e.pointerId));
}

function openDebtSheet({ personId = '', groupId = '', debtId = '' } = {}) {
  closeSheets(false);
  const foundDebt = debtId ? findDebtById(debtId) : null;
  const person = foundDebt?.person || findPerson(personId);
  const group = foundDebt?.group || findGroupById(groupId)?.group;
  el.modeInput.value = debtId ? 'edit' : 'create';
  el.debtIdInput.value = debtId || '';
  el.personIdInput.value = person?.id || '';
  el.groupPersonIdInput.value = group?.id || '';
  el.sheetEyebrow.textContent = debtId ? 'Edit' : 'Create';
  el.sheetTitle.textContent = debtId ? 'Edit debt' : 'Add debt';
  el.personNameInput.value = person?.name || '';
  el.avatarInput.value = person?.avatar || '';
  el.groupInput.value = group?.groupName || '';
  el.amountInput.value = foundDebt ? foundDebt.debt.originalAmount.toFixed(2) : '';
  el.notesInput.value = foundDebt?.debt.notes || '';
  el.dateInput.value = isoDate(foundDebt?.debt.createdAt || new Date().toISOString());
  el.personNameInput.disabled = !!foundDebt;
  el.avatarInput.disabled = !!foundDebt;
  openSheet(el.sheetBackdrop, el.sheet, el.personNameInput.disabled ? el.groupInput : el.personNameInput);
}

function openPaymentSheet(debtId) {
  const found = findDebtById(debtId);
  if (!found || found.debt.status !== 'active') return;
  el.paymentDebtId.value = debtId;
  el.paymentAmountInput.value = '';
  el.paymentDateInput.value = isoDate(new Date().toISOString());
  openSheet(el.paymentBackdrop, el.paymentSheet, el.paymentAmountInput);
}

function openSheet(backdrop, sheet, focusTarget) {
  state.currentSheet = backdrop.id;
  backdrop.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  setTimeout(() => focusTarget?.focus(), 80);
}

function closeSheets(resetDebt = true) {
  [el.sheet, el.paymentSheet].forEach(sheet => sheet.classList.remove('is-open'));
  setTimeout(() => {
    el.sheetBackdrop.hidden = true;
    el.paymentBackdrop.hidden = true;
  }, 180);
  if (resetDebt) {
    el.debtForm.reset();
    el.paymentForm.reset();
    el.personNameInput.disabled = false;
    el.avatarInput.disabled = false;
  }
  state.currentSheet = null;
}

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
    cleanEmptyGroups();
    saveData();
    closeSheets();
    render();
    toast('Debt updated.');
    return;
  }

  const personName = el.personNameInput.value.trim();
  if (!personName) return toast('Enter a person name.');
  let person = el.personIdInput.value ? findPerson(el.personIdInput.value) : findPersonByName(personName);
  if (!person) {
    person = {
      id: uid(),
      name: personName,
      avatar: normalizeAvatar(el.avatarInput.value.trim(), personName),
      createdAt: new Date().toISOString(),
      groups: []
    };
    state.data.people.push(person);
  } else {
    person.avatar = normalizeAvatar(el.avatarInput.value.trim() || person.avatar, person.name);
  }
  let group = person.groups.find(g => g.id === el.groupPersonIdInput.value) || person.groups.find(g => g.groupName.toLowerCase() === groupName.toLowerCase());
  if (!group) {
    group = { id: uid(), groupName, createdAt: date, debts: [] };
    person.groups.push(group);
  } else {
    group.groupName = groupName;
  }
  group.debts.push({ id: uid(), originalAmount: amount, remainingAmount: amount, notes: el.notesInput.value.trim(), createdAt: date, status: 'active', archivedAt: null, payments: [] });
  saveData();
  closeSheets();
  render();
  toast('Debt saved.');
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
    found.debt.remainingAmount = 0;
    found.debt.status = 'completed';
    found.debt.archivedAt = new Date().toISOString();
    toast('Debt fully paid and archived.');
  } else {
    toast('Payment recorded.');
  }
  saveData();
  closeSheets();
  if (found.debt.status === 'completed') goTo('#/archive');
  else render();
}

function payOffDebt(debtId) {
  const found = findDebtById(debtId);
  if (!found || found.debt.remainingAmount <= 0) return;
  confirmAction(`Pay off ${money(found.debt.remainingAmount)} and archive this debt?`, () => {
    found.debt.payments.push({ amount: found.debt.remainingAmount, date: new Date().toISOString() });
    found.debt.remainingAmount = 0;
    found.debt.status = 'completed';
    found.debt.archivedAt = new Date().toISOString();
    saveData();
    goTo('#/archive');
    toast('Debt paid off.');
  });
}

function archiveDebt(debtId, silent = false) {
  const found = findDebtById(debtId);
  if (!found) return;
  const snapshot = JSON.parse(JSON.stringify(found.debt));
  found.debt.status = 'completed';
  found.debt.archivedAt = new Date().toISOString();
  if (found.debt.remainingAmount > 0 && found.debt.notes) found.debt.notes = found.debt.notes;
  saveData();
  render();
  if (!silent) toast('Debt archived.', 'Undo', () => restoreSnapshot(debtId, snapshot));
  else toast('Archived with swipe.', 'Undo', () => restoreSnapshot(debtId, snapshot));
}

function restoreSnapshot(debtId, snapshot) {
  const found = findDebtById(debtId);
  if (!found) return;
  found.debt = Object.assign(found.debt, snapshot, { status: snapshot.remainingAmount <= 0 ? 'completed' : 'active' });
  if (found.debt.status === 'active') found.debt.archivedAt = null;
  saveData();
  render();
}

function restoreDebt(debtId) {
  const found = findDebtById(debtId);
  if (!found) return;
  found.debt.status = found.debt.remainingAmount <= 0 ? 'completed' : 'active';
  if (found.debt.remainingAmount > 0) found.debt.archivedAt = null;
  else return toast('This debt is fully paid. Edit it to reopen.');
  saveData();
  render();
  toast('Debt restored to active.');
}

function confirmAction(message, action) {
  state.confirmAction = action;
  el.confirmText.textContent = message;
  el.confirmBackdrop.hidden = false;
  el.confirmBackdrop.classList.remove('hidden');
}

function closeConfirm() {
  state.confirmAction = null;
  el.confirmBackdrop.hidden = true;
  el.confirmBackdrop.classList.add('hidden');
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

function computeMeta() {
  const people = state.data.people;
  const activeDebts = [];
  const archived = [];
  let totalOutstanding = 0;
  let totalPaid = 0;
  let groupCount = 0;
  people.forEach(person => {
    person.groups.forEach(group => {
      groupCount += 1;
      group.debts.forEach(debt => {
        totalPaid += debt.payments.reduce((sum, p) => sum + p.amount, 0);
        if (debt.status === 'active') {
          activeDebts.push({ person, group, debt });
          totalOutstanding += debt.remainingAmount;
        } else archived.push({ person, group, debt });
      });
    });
  });
  const current = state.route.params.id ? findDebtGroupPersonById(state.route.params.id) : {};
  return {
    totalOutstanding: toMoney(totalOutstanding),
    totalPaid: toMoney(totalPaid),
    activePeopleCount: people.filter(p => personOutstanding(p) > 0).length,
    activeDebtCount: activeDebts.length,
    completedCount: archived.length,
    groupCount,
    currentPerson: current.person || findPerson(state.route.params.id),
    currentGroup: current.group,
    currentDebt: current.debt
  };
}

function getFilteredPeople() {
  let people = state.data.people.filter(person => personOutstanding(person) > 0);
  if (state.search) people = people.filter(personMatchesSearch);
  return people.sort(sortPeople);
}

function getActiveGroups(person) { return person.groups.filter(group => getActiveDebts(group).length > 0); }
function getActiveDebts(group) { return group.debts.filter(debt => debt.status === 'active'); }
function getArchivedDebts() {
  return state.data.people.flatMap(person => person.groups.flatMap(group => group.debts.filter(debt => debt.status === 'completed').map(debt => ({ person, group, debt }))));
}

function renderPersonCard(person) {
  const groups = getActiveGroups(person);
  return `
    <article class="person-card card-tappable" data-person-card="${person.id}">
      <div class="person-head">
        <div class="person-left">
          ${renderAvatar(person)}
          <div class="inline-stack"><div class="person-name">${escapeHtml(person.name)}</div><div class="muted">${groups.length} group${groups.length === 1 ? '' : 's'}</div></div>
        </div>
        <div class="person-total">${money(personOutstanding(person))}</div>
      </div>
      <div class="summary-tags">${groups.slice(0, 4).map(group => `<span class="summary-tag">${escapeHtml(group.groupName)} · ${money(groupOutstanding(group))}</span>`).join('')}</div>
      <div class="meta-row"><span>${groups.reduce((sum, group) => sum + getActiveDebts(group).length, 0)} debt item${groups.length === 1 ? '' : 's'}</span><span>Updated ${formatDate(newestPersonDate(person))}</span></div>
    </article>
  `;
}

function renderGroupCard(person, group) {
  return `
    <article class="group-card card-tappable" data-group-card="${group.id}">
      <div class="row-between"><div class="group-name">${escapeHtml(group.groupName)}</div><div class="group-total">${money(groupOutstanding(group))}</div></div>
      <div class="meta-row"><span>${getActiveDebts(group).length} item${getActiveDebts(group).length === 1 ? '' : 's'}</span><span>${escapeHtml(person.name)}</span><span class="list-arrow">Open</span></div>
    </article>
  `;
}

function renderDebtCard(person, group, debt) {
  return `
    <article class="swipe-item" data-debt-card="${debt.id}">
      <div class="swipe-bg right">Edit</div>
      <div class="swipe-bg left">Archive</div>
      <div class="debt-card swipe-card card-tappable" data-debt-card="${debt.id}">
        <div class="row-between"><div class="debt-title">${escapeHtml(group.groupName)}</div><div class="debt-amount">${money(debt.remainingAmount)}</div></div>
        <div class="muted">${escapeHtml(truncate(debt.notes || 'No notes yet', 76))}</div>
        <div class="meta-row"><span>Created ${formatDate(debt.createdAt)}</span><span>Original ${money(debt.originalAmount)}</span><span class="list-arrow">Details</span></div>
      </div>
    </article>
  `;
}

function renderAvatar(person) {
  const value = person.avatar || initials(person.name);
  const emoji = /\p{Extended_Pictographic}/u.test(value);
  return emoji
    ? `<div class="avatar emoji">${escapeHtml(value)}</div>`
    : `<div class="avatar">${escapeHtml(value.slice(0, 2).toUpperCase())}</div>`;
}

function renderEmpty(title, text) {
  return `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"></path></svg></div><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(text)}</p></div>`;
}

function findPerson(id) { return state.data.people.find(person => person.id === id); }
function findPersonByName(name) { return state.data.people.find(person => person.name.toLowerCase() === name.toLowerCase()); }
function findGroupById(id) {
  for (const person of state.data.people) {
    const group = person.groups.find(g => g.id === id);
    if (group) return { person, group };
  }
  return null;
}
function findDebtById(id) {
  for (const person of state.data.people) {
    for (const group of person.groups) {
      const debt = group.debts.find(d => d.id === id);
      if (debt) return { person, group, debt };
    }
  }
  return null;
}
function findDebtGroupPersonById(id) {
  return findDebtById(id) || findGroupById(id) || { person: findPerson(id) };
}

function cleanEmptyGroups() {
  state.data.people.forEach(person => person.groups = person.groups.filter(group => group.debts.length));
}

function personOutstanding(person) {
  return toMoney(person.groups.reduce((sum, group) => sum + groupOutstanding(group), 0));
}
function groupOutstanding(group) {
  return toMoney(group.debts.filter(debt => debt.status === 'active').reduce((sum, debt) => sum + debt.remainingAmount, 0));
}
function newestPersonDate(person) {
  return person.groups.flatMap(g => g.debts.map(d => d.createdAt)).sort().reverse()[0] || person.createdAt;
}

function personMatchesSearch(person) {
  const q = state.search;
  if (!q) return true;
  return person.name.toLowerCase().includes(q) || person.groups.some(group => group.groupName.toLowerCase().includes(q) || group.debts.some(debt => (debt.notes || '').toLowerCase().includes(q)));
}
function groupMatchesSearch(group) {
  const q = state.search;
  if (!q) return true;
  return group.groupName.toLowerCase().includes(q) || group.debts.some(debt => (debt.notes || '').toLowerCase().includes(q));
}
function debtMatchesSearch(person, group, debt) {
  const q = state.search;
  if (!q) return true;
  return person.name.toLowerCase().includes(q) || group.groupName.toLowerCase().includes(q) || (debt.notes || '').toLowerCase().includes(q);
}
function archiveMatchesSearch(item) {
  const q = state.search;
  if (!q) return true;
  return item.person.name.toLowerCase().includes(q) || item.group.groupName.toLowerCase().includes(q) || (item.debt.notes || '').toLowerCase().includes(q);
}

function sortPeople(a, b) {
  if (state.sort === 'alpha') return a.name.localeCompare(b.name);
  if (state.sort === 'newest') return new Date(newestPersonDate(b)) - new Date(newestPersonDate(a));
  return personOutstanding(b) - personOutstanding(a);
}

function normalizeAvatar(value, name) {
  const trimmed = (value || '').trim();
  return trimmed || initials(name || 'U');
}
function initials(name) {
  return (name || 'U').split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
}
function uid() {
  return (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
function money(value) { return `£${toMoney(value).toFixed(2)}`; }
function toMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function formatDate(value, withTime = false) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? {} : {}) }).format(date);
}
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }
function truncate(text, len) { return text.length > len ? `${text.slice(0, len - 1)}…` : text; }
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, actionLabel, action) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ''}`;
  if (actionLabel && action) node.querySelector('button').addEventListener('click', () => { action(); node.remove(); });
  el.toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function animateCurrency(node, target) {
  const start = Number(node.dataset.value || 0);
  const end = Number(target || 0);
  const startTime = performance.now();
  const duration = 500;
  node.dataset.value = end;
  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = money(start + (end - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
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
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}
