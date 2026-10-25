(function () {
  const config = window.CASHFLOW_SUPABASE_CONFIG || {
    url: 'https://fgjckvrvoaripvgsegfd.supabase.co',
    anonKey: 'sb_publishable_xsq8qPXWLEgTGX2ZIbdWGQ_EE6hJDy2'
  };
  const baseUrl = String(config.url || '').replace(/\/$/, '');
  const anonKey = config.anonKey || '';
  const evidenceBucket = 'cashflow-evidence';
  const reimbursementBucket = 'reimbursement-receipts';
  const maximumEvidenceSize = 10 * 1024 * 1024;
  const state = { branches: [], cashAccounts: [], transactions: [], approvals: [], reimbursements: [] };
  const appView = document.querySelector('#appView');
  const appShell = document.querySelector('#appShell');
  const authShell = document.querySelector('#authShell');
  const loginForm = document.querySelector('#loginForm');
  const authError = document.querySelector('#authError');
  const title = document.querySelector('#pageTitle');
  const statusLabel = document.querySelector('#supabaseStatus');
  const statusDot = document.querySelector('#supabaseStatusDot');
  const modal = document.querySelector('#modalBackdrop');
  const modalForm = document.querySelector('#masterForm');
  const toast = document.querySelector('#toast');
  let authSession = null;
  let currentUser = { id: '', name: '', role: '' };
  let activeView = 'dashboard';
  let toastTimer;

  try {
    authSession = JSON.parse(sessionStorage.getItem('cashflow-auth-session') || 'null');
  } catch {
    sessionStorage.removeItem('cashflow-auth-session');
  }

  const viewTitles = {
    dashboard: 'Dashboard',
    'cash-accounts': 'Akun Kas',
    branches: 'Cabang',
    transactions: 'Semua Transaksi',
    'new-transaction': 'Buat Transaksi',
    reimbursements: 'Reimbursement',
    approval: 'Menunggu Persetujuan',
    'approval-history': 'Riwayat Persetujuan',
    reports: 'Laporan Kas'
  };
  const transactionTypes = {
    'cash-in': 'Kas Masuk',
    'cash-out': 'Kas Keluar',
    'cash-transfer': 'Transfer Kas',
    'petty-topup': 'Top-Up Petty Cash',
    'petty-expense': 'Pengeluaran Petty Cash',
    'petty-replenishment': 'Replenishment Petty Cash',
    'cash-request': 'Permintaan Kas'
  };
  const approvalRequired = new Set(['cash-out', 'petty-expense', 'cash-request']);
  const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const reportFilters = { startDate: `${localDate().slice(0, 7)}-01`, endDate: localDate(), branchId: '', accountId: '' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function formatMoney(value) {
    return money.format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      .format(new Date(`${value.slice(0, 10)}T00:00:00`));
  }

  function formatCurrentDate(date = new Date()) {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function setConnectionStatus(connected, message = '') {
    statusLabel.textContent = connected ? 'Supabase terhubung' : 'Supabase tidak terhubung';
    statusLabel.title = message || statusLabel.textContent;
    statusDot.style.backgroundColor = connected ? '#46c596' : '#e66c6c';
  }

  function headers(extra = {}) {
    if (!baseUrl || !anonKey) throw new Error('Konfigurasi Supabase belum lengkap.');
    return { apikey: anonKey, Authorization: `Bearer ${authSession?.access_token || anonKey}`, ...extra };
  }

  function storeSession(session) {
    authSession = session;
    sessionStorage.setItem('cashflow-auth-session', JSON.stringify(session));
    const user = session.user || {};
    const metadata = user.app_metadata || {};
    if (!user.id || !['employee', 'approver', 'finance_manager'].includes(metadata.role)) {
      throw new Error('Akun belum dikonfigurasi dengan role Supabase Auth yang valid.');
    }
    const name = metadata.full_name || user.user_metadata?.full_name || user.email || 'Pengguna';
    currentUser = { id: user.id, name, role: metadata.role || '' };
    document.querySelector('#currentUserName').textContent = name;
    document.querySelector('#currentUserRole').textContent = ({
      finance_manager: 'Finance Manager',
      approver: 'Approver',
      employee: 'Karyawan'
    })[currentUser.role] || 'Pengguna';
    document.querySelector('#userAvatar').textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function clearSession() {
    authSession = null;
    currentUser = { id: '', name: '', role: '' };
    sessionStorage.removeItem('cashflow-auth-session');
  }

  async function authFetch(path, options = {}) {
    if (!baseUrl || !anonKey) throw new Error('Konfigurasi Supabase belum lengkap.');
    return fetch(`${baseUrl}/auth/v1/${path}`, {
      ...options,
      headers: { apikey: anonKey, 'Content-Type': 'application/json', ...options.headers }
    });
  }

  async function refreshSessionIfNeeded() {
    if (!authSession?.access_token) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
    const expiration = Number(authSession.expires_at || 0);
    if (!authSession.refresh_token || (expiration && expiration > Math.floor(Date.now() / 1000) + 60)) return;
    const response = await authFetch('token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Sesi login kedaluwarsa: ${details}`);
    }
    const refreshed = await response.json();
    storeSession({
      ...refreshed,
      user: refreshed.user || authSession.user,
      expires_at: refreshed.expires_at || Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600)
    });
  }

  async function submitLogin(event) {
    event.preventDefault();
    authError.hidden = true;
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(loginForm).entries());
      const response = await authFetch('token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: values.email, password: values.password })
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Login gagal (${response.status}): ${details}`);
      }
      const session = await response.json();
      storeSession({
        ...session,
        expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600)
      });
      authShell.hidden = true;
      appShell.hidden = false;
      await loadData();
      render('dashboard');
    } catch (error) {
      authShell.hidden = false;
      appShell.hidden = true;
      authError.textContent = error.message;
      authError.hidden = false;
      clearSession();
    } finally {
      submitButton.disabled = false;
    }
  }

  async function request(path, options = {}) {
    await refreshSessionIfNeeded();
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      headers: headers(options.headers)
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Supabase ${response.status}: ${details}`);
    }
    const prefer = options.headers?.Prefer || '';
    return response.status === 204 || /return=minimal/i.test(prefer) ? null : response.json();
  }

  async function loadRows(table, order) {
    const pageSize = 1000;
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const query = new URLSearchParams({ select: '*', order, limit: String(pageSize), offset: String(offset) });
      const page = await request(`${table}?${query}`);
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  function accountFromRow(row) {
    return {
      ...row,
      type: row.account_type,
      openingBalance: Number(row.opening_balance) || 0,
      minimumBalance: Number(row.minimum_balance) || 0,
      maximumBalance: Number(row.maximum_balance) || 0,
      status: row.is_active ? 'Active' : 'Inactive'
    };
  }

  function branchFromRow(row) {
    return { ...row, status: row.is_active ? 'Active' : 'Inactive' };
  }

  function transactionFromRow(row) {
    return {
      ...row,
      date: row.transaction_date,
      branchId: row.branch_id,
      sourceCashAccountId: row.source_cash_account_id,
      cashAccountId: row.cash_account_id,
      categoryId: row.category_id,
      createdBy: row.created_by || ''
    };
  }

  async function loadData() {
    const [branches, accounts, transactions, approvals, reimbursements] = await Promise.all([
      loadRows('branches', 'name.asc'),
      loadRows('cash_accounts', 'name.asc'),
      loadRows('transactions', 'transaction_date.desc.nullslast,id.desc'),
      loadRows('approvals', 'created_at.desc,id.desc'),
      loadRows('reimbursements', 'created_at.desc,id.desc')
    ]);
    state.branches = branches.map(branchFromRow);
    state.cashAccounts = accounts.map(accountFromRow);
    state.transactions = transactions
      .filter((row) => Object.hasOwn(transactionTypes, row.type))
      .map(transactionFromRow);
    state.approvals = approvals;
    state.reimbursements = reimbursements;
    setConnectionStatus(true);
    render(activeView);
  }

  function accountName(id) {
    return state.cashAccounts.find((account) => account.id === id)?.name || id || '-';
  }

  function branchName(id) {
    return state.branches.find((branch) => branch.id === id)?.name || id || '-';
  }

  function transactionBranchId(transaction) {
    const cashAccount = state.cashAccounts.find((account) => account.id === transaction.cash_account_id);
    const sourceAccount = state.cashAccounts.find((account) => account.id === transaction.source_cash_account_id);
    return cashAccount?.branch_id || sourceAccount?.branch_id || transaction.branch_id;
  }

  function statusBadge(status) {
    const cssStatus = String(status || '').toLowerCase().replaceAll(' ', '-');
    return `<span class="status ${escapeHtml(cssStatus)}">${escapeHtml(status || '-')}</span>`;
  }

  function movement(transaction, accountId) {
    if (!['Approved', 'Posted'].includes(transaction.status)) return 0;
    const amount = Number(transaction.amount) || 0;
    if (['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(transaction.type)) {
      if (transaction.cash_account_id === accountId) return amount;
      if (transaction.source_cash_account_id === accountId) return -amount;
      return 0;
    }
    if (transaction.cash_account_id !== accountId) return 0;
    if (transaction.type === 'cash-in') return amount;
    if (['cash-out', 'petty-expense'].includes(transaction.type)) return -amount;
    return 0;
  }

  function balance(account) {
    return account.openingBalance + state.transactions.reduce((total, row) => total + movement(row, account.id), 0);
  }

  function renderMinimumBalanceAlerts() {
    const monitoredAccounts = state.cashAccounts.filter((account) => account.is_active && account.minimumBalance > 0);
    const alerts = monitoredAccounts.map((account) => {
      const currentBalance = balance(account);
      const belowMinimum = currentBalance < account.minimumBalance;
      const shortfall = Math.max(0, account.minimumBalance - currentBalance);
      return `<tr class="${belowMinimum ? 'minimum-warning-row' : ''}">
        <td><strong>${escapeHtml(account.name)}</strong></td><td>${escapeHtml(branchName(account.branch_id))}</td>
        <td>${formatMoney(currentBalance)}</td><td>${formatMoney(account.minimumBalance)}</td>
        <td>${formatMoney(shortfall)}</td>
        <td><span class="minimum-indicator ${belowMinimum ? 'below' : 'safe'}">${belowMinimum ? 'Di bawah minimum' : 'Aman'}</span></td>
      </tr>`;
    }).join('');
    return `<section class="panel minimum-alert-panel"><div class="panel-header"><div><h3>Peringatan Saldo Kas Minimum</h3><p>Saldo aktual memperhitungkan transaksi Approved/Posted dan transfer antar-akun.</p></div></div>
      ${monitoredAccounts.length ? `<div class="table-wrap"><table class="data-table minimum-alert-table"><thead><tr><th>Akun Kas</th><th>Cabang</th><th>Saldo Saat Ini</th><th>Batas Minimum</th><th>Kekurangan</th><th>Status</th></tr></thead><tbody>${alerts}</tbody></table></div>` : '<div class="empty-state">Belum ada akun aktif dengan batas saldo minimum. Atur batasnya di Data Inti → Akun Kas.</div>'}
    </section>`;
  }

  function dailyCashflow() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - 6 + index);
      return {
        date: localDate(date),
        label: new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(date),
        incoming: 0,
        outgoing: 0
      };
    });
    const totalsByDate = new Map(days.map((day) => [day.date, day]));

    state.transactions.forEach((transaction) => {
      if (!['Approved', 'Posted'].includes(transaction.status)) return;
      const day = totalsByDate.get(String(transaction.transaction_date || '').slice(0, 10));
      if (!day) return;
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === 'cash-in') day.incoming += amount;
      if (['cash-out', 'petty-expense'].includes(transaction.type)) day.outgoing += amount;
    });

    return days;
  }

  function renderCashflowChart() {
    const days = dailyCashflow();
    const maximum = Math.max(0, ...days.flatMap((day) => [day.incoming, day.outgoing]));
    const scale = maximum || 1;
    const totalIncoming = days.reduce((total, day) => total + day.incoming, 0);
    const totalOutgoing = days.reduce((total, day) => total + day.outgoing, 0);
    const bars = days.map((day) => `<div class="bar-group">
      <div class="bar in" style="height:${day.incoming ? Math.max(3, day.incoming / scale * 100) : 0}%" title="Pemasukan ${day.label}: ${formatMoney(day.incoming)}"></div>
      <div class="bar out" style="height:${day.outgoing ? Math.max(3, day.outgoing / scale * 100) : 0}%" title="Pengeluaran ${day.label}: ${formatMoney(day.outgoing)}"></div>
      <small>${escapeHtml(day.label)}</small>
    </div>`).join('');
    return `<div class="panel cashflow-panel">
      <div class="panel-header"><div><h3>Pemasukan &amp; Pengeluaran</h3><p>7 hari terakhir · hanya transaksi Approved atau Posted</p></div></div>
      <div class="chart cashflow-chart" role="img" aria-label="Grafik 7 hari terakhir. Total pemasukan ${escapeHtml(formatMoney(totalIncoming))}, total pengeluaran ${escapeHtml(formatMoney(totalOutgoing))}.">${bars}</div>
      <div class="legend"><span><i class="cashflow-legend-in"></i>Pemasukan</span><span><i class="cashflow-legend-out"></i>Pengeluaran</span></div>
    </div>`;
  }

  function transactionRows(rows) {
    if (!rows.length) return '<tr><td colspan="9" class="empty-state">Belum ada transaksi.</td></tr>';
    return rows.map((row) => `<tr>
      <td><strong>${escapeHtml(row.id)}</strong></td>
      <td>${formatDate(row.transaction_date || row.date)}</td>
      <td>${escapeHtml(transactionTypes[row.type] || row.type)}</td>
      <td>${escapeHtml(accountName(row.cash_account_id || row.cashAccountId))}</td>
      <td>${escapeHtml(row.category || '-')}</td>
      <td>${formatMoney(row.amount)}</td>
      <td>${statusBadge(row.status)}</td>
      <td>${escapeHtml(row.description || row.requester || '-')}</td>
      <td>${evidenceAction(row)}</td>
    </tr>`).join('');
  }

  function table(rows) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>ID</th><th>Tanggal</th><th>Jenis</th><th>Akun Kas</th><th>Kategori</th><th>Nominal</th><th>Status</th><th>Keterangan</th><th>Bukti</th>
    </tr></thead><tbody>${transactionRows(rows)}</tbody></table></div>`;
  }

  function evidenceAction(transaction) {
    if (!transaction.evidence_path) return '-';
    return `<div class="evidence-cell"><span>${escapeHtml(transaction.evidence_name || 'Bukti transaksi')}</span><button type="button" class="button-secondary" data-view-evidence data-bucket="${evidenceBucket}" data-path="${escapeHtml(transaction.evidence_path)}" data-name="${escapeHtml(transaction.evidence_name || 'Bukti transaksi')}" data-mime="${escapeHtml(transaction.evidence_mime_type || '')}">Lihat / Unduh</button></div>`;
  }

  function reimbursementEvidenceAction(reimbursement) {
    return `<div class="evidence-cell"><span>${escapeHtml(reimbursement.receipt_original_name || 'Bukti reimbursement')}</span><button type="button" class="button-secondary" data-view-evidence data-bucket="${reimbursementBucket}" data-path="${escapeHtml(reimbursement.receipt_storage_path)}" data-name="${escapeHtml(reimbursement.receipt_original_name || 'Bukti reimbursement')}" data-mime="${escapeHtml(reimbursement.receipt_mime_type || '')}">Lihat / Unduh</button></div>`;
  }

  function canApprove() {
    return ['approver', 'finance_manager'].includes(currentUser.role);
  }

  function renderDashboard() {
    const pending = state.transactions.filter((row) => row.status === 'Pending').length;
    const pendingReimbursements = state.reimbursements.filter((row) => ['Submitted', 'Under Review'].includes(row.status)).length;
    const currentBalance = state.cashAccounts.reduce((total, account) => total + balance(account), 0);
    const recent = state.transactions.slice(0, 8);
    const branchBalances = state.branches.filter((branch) => branch.is_active).map((branch) => {
      const accounts = state.cashAccounts.filter((account) => account.branch_id === branch.id);
      const total = accounts.reduce((sum, account) => sum + balance(account), 0);
      return `<article class="metric-card branch-balance-card"><span class="label">Saldo ${escapeHtml(branch.name)}</span><div class="value">${formatMoney(total)}</div><small>${accounts.length} akun kas</small></article>`;
    }).join('');
    return `<div class="welcome"><div><span class="eyebrow">RINGKASAN KAS</span><h2>Selamat datang, ${escapeHtml(currentUser.name)}</h2><p>Ringkasan akun kas dan transaksi terbaru.</p></div><div class="welcome-actions"><span class="date-pill" id="dashboardDate">${escapeHtml(formatCurrentDate())}</span><button class="button-primary" data-go="new-transaction">＋ Buat Transaksi</button></div></div>
      <div class="metrics">
        <article class="metric-card"><span class="label">Saldo Seluruh Akun</span><div class="value">${formatMoney(currentBalance)}</div></article>
        <article class="metric-card"><span class="label">Akun Kas Aktif</span><div class="value">${state.cashAccounts.filter((account) => account.is_active).length}</div></article>
        <article class="metric-card"><span class="label">Reimbursement Menunggu</span><div class="value">${pendingReimbursements}</div></article>
        <article class="metric-card"><span class="label">Menunggu Approval</span><div class="value">${pending}</div></article>
      </div>
      <section class="branch-balances-section"><div class="panel-header"><div><h3>Saldo per Cabang</h3><p>Saldo awal ditambah transaksi Approved/Posted, termasuk transfer antar-akun.</p></div></div><div class="branch-balances">${branchBalances || '<div class="empty-state">Belum ada cabang aktif.</div>'}</div></section>
      ${renderMinimumBalanceAlerts()}
      ${renderCashflowChart()}
      <div class="panel"><div class="panel-header"><div><h3>Transaksi Terbaru</h3><p>Saldo hanya menghitung transaksi Approved atau Posted.</p></div></div>${table(recent)}</div>`;
  }

  const masterFields = {
    'cash-accounts': [
      ['code', 'Kode akun', 'text', true], ['name', 'Nama akun', 'text', true],
      ['branch_id', 'Cabang', 'branch', true],
      ['account_type', 'Jenis akun', 'select', ['Petty Cash', 'Cash', 'Bank']],
      ['location', 'Lokasi', 'text'], ['custodian', 'Penanggung jawab', 'text'],
      ['opening_balance', 'Saldo awal', 'number', true], ['minimum_balance', 'Saldo minimum', 'number'],
      ['maximum_balance', 'Saldo maksimum', 'number']
    ],
    branches: [
      ['code', 'Kode cabang', 'text', true], ['name', 'Nama cabang', 'text', true],
      ['location', 'Lokasi', 'text']
    ]
  };

  function renderMaster(view) {
    const isAccounts = view === 'cash-accounts';
    const records = isAccounts ? state.cashAccounts : state.branches;
    const columns = isAccounts
      ? [['code', 'Kode'], ['name', 'Nama'], ['branch_id', 'Cabang'], ['account_type', 'Jenis'], ['opening_balance', 'Saldo Awal'], ['minimum_balance', 'Saldo Minimum'], ['status', 'Status']]
      : [['code', 'Kode'], ['name', 'Nama'], ['location', 'Lokasi'], ['status', 'Status']];
    const canManage = currentUser.role === 'finance_manager';
    const displayValue = (row, key) => key === 'status' ? statusBadge(row.status)
      : key === 'branch_id' ? escapeHtml(branchName(row.branch_id))
        : key.endsWith('balance') ? formatMoney(row[key]) : escapeHtml(row[key] || '-');
    return `<div class="section-head"><div><span class="eyebrow">DATA INTI</span><h2>${viewTitles[view]}</h2></div>${canManage ? `<button class="button-primary" data-add-master="${view}">＋ Tambah</button>` : ''}</div>
      <div class="panel"><div class="panel-header"><p>${records.length} data tersimpan di Supabase</p></div><div class="table-wrap"><table class="data-table"><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>Aksi</th></tr></thead><tbody>
      ${records.length ? records.map((row) => `<tr>${columns.map(([key]) => `<td>${displayValue(row, key)}</td>`).join('')}<td>${canManage ? `<button class="button-secondary" data-edit-master="${view}" data-id="${escapeHtml(row.id)}">Edit</button> <button class="button-secondary danger-button" data-delete-master="${view}" data-id="${escapeHtml(row.id)}">Hapus</button>` : '-'}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-state">Belum ada data.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function renderTransactionForm() {
    const defaultBranch = state.branches.find((branch) => branch.is_active)?.id || '';
    const branchOptions = state.branches.filter((branch) => branch.is_active)
      .map((branch) => `<option value="${escapeHtml(branch.id)}" ${branch.id === defaultBranch ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('');
    const accountOptions = state.cashAccounts.filter((account) => account.is_active && account.branch_id === defaultBranch)
      .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
    return `<div class="section-head"><div><span class="eyebrow">TRANSAKSI KAS</span><h2>Buat Transaksi</h2></div></div>
      <form class="panel transaction-form" id="transactionForm"><div class="panel-header"><div><h3>Informasi Transaksi</h3><p>Pengeluaran dan permintaan kas memerlukan approval.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="type">Jenis transaksi</label><select id="type" name="type" required>${Object.entries(transactionTypes).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>
        <div class="field"><label for="transaction_date">Tanggal</label><input id="transaction_date" name="transaction_date" type="date" value="${localDate()}" required></div>
        <div class="field"><label for="branch_id">Cabang</label><select id="branch_id" name="branch_id" required><option value="">Pilih cabang</option>${branchOptions}</select></div>
        <div class="field"><label for="cash_account_id">Akun kas</label><select id="cash_account_id" name="cash_account_id"><option value="">Pilih akun</option>${accountOptions}</select></div>
        <div class="field"><label for="source_cash_account_id">Akun sumber (transfer/top-up)</label><select id="source_cash_account_id" name="source_cash_account_id"><option value="">Pilih akun sumber</option>${accountOptions}</select></div>
        <div class="field"><label for="category">Kategori</label><input id="category" name="category" type="text" maxlength="120"></div>
        <div class="field"><label for="amount">Nominal (Rp)</label><input id="amount" name="amount" type="number" min="1" step="0.01" required></div>
        <div class="field"><label for="requester">Pemohon</label><input id="requester" name="requester" type="text" value="${escapeHtml(currentUser.name)}"></div>
        <div class="field"><label for="vendor">Vendor</label><input id="vendor" name="vendor" type="text"></div>
        <div class="field full"><label for="description">Keterangan</label><input id="description" name="description" type="text"></div>
        <div class="field full"><label for="evidence">Bukti transaksi (opsional)</label><input id="evidence" name="evidence" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"><small class="field-help">PDF, JPG, JPEG, atau PNG · Maksimal 10 MB</small></div>
        <div class="form-actions"><button class="button-primary">Simpan Transaksi</button></div>
      </div></form>`;
  }

  function renderTransactions() {
    return `<div class="section-head"><div><span class="eyebrow">TRANSAKSI KAS</span><h2>Semua Transaksi</h2></div><button class="button-primary" data-go="new-transaction">＋ Buat Transaksi</button></div><div class="panel">${table(state.transactions)}</div>`;
  }

  function renderApprovals(history = false) {
    if (history) {
      const approvalsTable = state.approvals.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Penyetuju</th><th>Keputusan</th><th>Catatan</th><th>Waktu</th></tr></thead><tbody>${state.approvals.map((row) => `<tr><td>${escapeHtml(row.transaction_id || row.reimbursement_id || '-')}</td><td>${escapeHtml(row.approver_name_snapshot || row.approver_id || '-')}</td><td>${statusBadge(row.action)}</td><td>${escapeHtml(row.notes || '-')}</td><td>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Belum ada riwayat persetujuan.</div>';
      return `<div class="section-head"><div><span class="eyebrow">APPROVAL</span><h2>Riwayat Persetujuan</h2></div></div><div class="panel">${approvalsTable}</div>`;
    }
    if (!canApprove()) return '<div class="section-head"><div><span class="eyebrow">APPROVAL</span><h2>Menunggu Persetujuan</h2></div></div><div class="panel"><div class="empty-state">Akses approval hanya tersedia untuk Approver dan Finance Manager.</div></div>';
    const transactions = state.transactions.filter((row) => row.status === 'Pending');
    const reimbursements = state.reimbursements.filter((row) => ['Submitted', 'Under Review'].includes(row.status));
    const transactionRowsMarkup = transactions.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(transactionTypes[row.type] || row.type)}</td><td>${escapeHtml(row.requester || row.created_by || '-')}</td><td>${formatMoney(row.amount)}</td><td>${escapeHtml(row.description || '-')}</td><td>${evidenceAction(row)}</td><td><button class="button-primary" data-decision="Approved" data-kind="transaction" data-id="${escapeHtml(row.id)}">Setujui</button> <button class="button-secondary" data-decision="Rejected" data-kind="transaction" data-id="${escapeHtml(row.id)}">Tolak</button> <button class="button-secondary" data-decision="Revision Requested" data-kind="transaction" data-id="${escapeHtml(row.id)}">Minta revisi</button></td></tr>`).join('');
    const reimbursementRowsMarkup = reimbursements.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.employee_name)}</td><td>${escapeHtml(row.department)}</td><td>${formatDate(row.expense_date)}</td><td>${formatMoney(row.amount)}</td><td>${escapeHtml(row.description)}</td><td>${reimbursementEvidenceAction(row)}</td><td><button class="button-primary" data-decision="Approved" data-kind="reimbursement" data-id="${escapeHtml(row.id)}">Setujui</button> <button class="button-secondary" data-decision="Rejected" data-kind="reimbursement" data-id="${escapeHtml(row.id)}">Tolak</button> <button class="button-secondary" data-decision="Revision Requested" data-kind="reimbursement" data-id="${escapeHtml(row.id)}">Minta revisi</button></td></tr>`).join('');
    return `<div class="section-head"><div><span class="eyebrow">APPROVAL</span><h2>Menunggu Persetujuan</h2></div></div>
      <div class="panel"><div class="panel-header"><h3>Transaksi kas</h3></div>${transactions.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Jenis</th><th>Pemohon</th><th>Nominal</th><th>Keterangan</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${transactionRowsMarkup}</tbody></table></div>` : '<div class="empty-state">Tidak ada transaksi kas yang menunggu approval.</div>'}</div>
      <div class="panel"><div class="panel-header"><h3>Reimbursement</h3></div>${reimbursements.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Pengajuan</th><th>Pemohon</th><th>Departemen</th><th>Tanggal</th><th>Nominal</th><th>Keterangan</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${reimbursementRowsMarkup}</tbody></table></div>` : '<div class="empty-state">Tidak ada reimbursement yang menunggu review.</div>'}</div>`;
  }

  function renderReimbursements() {
    const canPay = currentUser.role === 'finance_manager';
    const accounts = state.cashAccounts.filter((account) => account.is_active);
    const rows = state.reimbursements.map((row) => {
      const canSubmit = row.owner_id === currentUser.id && row.status === 'Draft';
      const paymentOptions = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
      const payment = canPay && row.status === 'Approved'
        ? `<select id="paymentAccount-${escapeHtml(row.id)}" aria-label="Akun pembayaran">${paymentOptions}</select> <button class="button-primary" data-pay-reimbursement="${escapeHtml(row.id)}">Bayar</button>`
        : '';
      const retryUpload = canSubmit ? `<input type="file" data-retry-receipt accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" aria-label="Pilih bukti reimbursement"><button class="button-primary" data-retry-receipt="${escapeHtml(row.id)}">Unggah & Ajukan</button>` : '';
      return `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.employee_name)}</td><td>${escapeHtml(row.department)}</td><td>${formatDate(row.expense_date)}</td><td>${escapeHtml(row.expense_category)}</td><td>${formatMoney(row.amount)}</td><td>${statusBadge(row.status)}</td><td>${escapeHtml(row.description)}</td><td>${reimbursementEvidenceAction(row)}</td><td>${retryUpload}${payment}</td></tr>`;
    }).join('');
    return `<div class="section-head"><div><span class="eyebrow">REIMBURSEMENT</span><h2>Pengajuan Reimbursement</h2></div></div>
      <form class="panel transaction-form" id="reimbursementForm"><div class="panel-header"><div><h3>Pengajuan baru</h3><p>Bukti wajib diunggah sebelum pengajuan dikirim.</p></div></div><div class="form-grid">
      <div class="field"><label for="reimbursementEmployee">Nama karyawan</label><input id="reimbursementEmployee" name="employee_name" value="${escapeHtml(currentUser.name)}" required maxlength="150"></div>
      <div class="field"><label for="reimbursementDepartment">Departemen</label><input id="reimbursementDepartment" name="department" required maxlength="150"></div>
      <div class="field"><label for="reimbursementDate">Tanggal pengeluaran</label><input id="reimbursementDate" name="expense_date" type="date" value="${localDate()}" required></div>
      <div class="field"><label for="reimbursementCategory">Kategori</label><input id="reimbursementCategory" name="expense_category" required maxlength="120"></div>
      <div class="field"><label for="reimbursementAmount">Nominal (Rp)</label><input id="reimbursementAmount" name="amount" type="number" min="1" step="0.01" required></div>
      <div class="field full"><label for="reimbursementDescription">Keterangan</label><textarea id="reimbursementDescription" name="description" required maxlength="2000"></textarea></div>
      <div class="field full"><label for="reimbursementReceipt">Bukti (PDF, JPG, PNG, atau WebP; maks. 10 MB)</label><input id="reimbursementReceipt" name="receipt" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required></div>
      <div class="form-actions"><button class="button-primary">Simpan dan Ajukan</button></div></div></form>
      <div class="panel"><div class="panel-header"><h3>Daftar pengajuan</h3></div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Pemohon</th><th>Departemen</th><th>Tanggal</th><th>Kategori</th><th>Nominal</th><th>Status</th><th>Keterangan</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state">Belum ada reimbursement.</div>'}</div>`;
  }

  function renderReports() {
    const rows = reportRows();
    const incoming = rows.reduce((total, row) => total + (row.type === 'cash-in' ? Number(row.amount) : 0), 0);
    const outgoing = rows.reduce((total, row) => total + (['cash-out', 'petty-expense'].includes(row.type) ? Number(row.amount) : 0), 0);
    const accounts = reportAccounts();
    const internalMovement = cashTransferMovement(accounts, reportFilters.startDate, reportFilters.endDate);
    const opening = cashBalanceAt(accounts, reportFilters.startDate, false);
    const closing = cashBalanceAt(accounts, reportFilters.endDate, true);
    const netChange = incoming - outgoing + internalMovement;
    const selectedAccount = state.cashAccounts.find((account) => account.id === reportFilters.accountId);
    const accountOptions = state.cashAccounts
      .filter((account) => !reportFilters.branchId || account.branch_id === reportFilters.branchId)
      .map((account) => `<option value="${escapeHtml(account.id)}" ${account.id === reportFilters.accountId ? 'selected' : ''}>${escapeHtml(account.name)}</option>`).join('');
    const branchOptions = state.branches.map((branch) => `<option value="${escapeHtml(branch.id)}" ${branch.id === reportFilters.branchId ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('');
    const details = rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Cabang</th><th>Uraian</th><th>Akun Kas</th><th>Kategori</th><th>Penerimaan</th><th>Pengeluaran</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${formatDate(row.transaction_date)}</td><td>${escapeHtml(branchName(transactionBranchId(row)))}</td>
      <td>${escapeHtml(row.description || transactionTypes[row.type])}</td><td>${escapeHtml(accountName(row.cash_account_id))}</td>
      <td>${escapeHtml(row.category || '-')}</td><td>${row.type === 'cash-in' ? formatMoney(row.amount) : '-'}</td>
      <td>${['cash-out', 'petty-expense'].includes(row.type) ? formatMoney(row.amount) : '-'}</td><td>${statusBadge(row.status)}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Tidak ada arus kas eksternal yang valid pada filter ini.</div>';
    return `<div class="section-head"><div><span class="eyebrow">LAPORAN</span><h2>Laporan Arus Kas</h2></div><button class="button-primary" type="button" data-export-csv>⬇ Ekspor CSV</button></div>
      <form class="panel report-filters" id="reportFilters"><div class="field"><label for="reportStartDate">Tanggal awal</label><input id="reportStartDate" name="startDate" type="date" value="${escapeHtml(reportFilters.startDate)}" required></div>
      <div class="field"><label for="reportEndDate">Tanggal akhir</label><input id="reportEndDate" name="endDate" type="date" value="${escapeHtml(reportFilters.endDate)}" required></div>
      <div class="field"><label for="reportBranch">Cabang</label><select id="reportBranch" name="branchId"><option value="">Seluruh perusahaan</option>${branchOptions}</select></div>
      <div class="field"><label for="reportAccount">Akun kas</label><select id="reportAccount" name="accountId"><option value="">Seluruh akun</option>${accountOptions}</select></div>
      <div class="form-actions"><button class="button-primary">Terapkan Filter</button></div></form>
      <div class="metrics"><article class="metric-card"><span class="label">Penerimaan Kas</span><div class="value">${formatMoney(incoming)}</div></article><article class="metric-card"><span class="label">Pengeluaran Kas</span><div class="value">${formatMoney(outgoing)}</div></article><article class="metric-card"><span class="label">Perubahan Saldo Kas</span><div class="value">${formatMoney(netChange)}</div></article><article class="metric-card"><span class="label">Jumlah Transaksi Valid</span><div class="value">${rows.length}</div></article></div>
      <div class="panel statement-panel"><div class="panel-header"><div><h3>Laporan Arus Kas Langsung</h3><p>${escapeHtml(formatDate(reportFilters.startDate))} – ${escapeHtml(formatDate(reportFilters.endDate))} · ${escapeHtml(reportFilters.branchId ? branchName(reportFilters.branchId) : 'Seluruh perusahaan')}${selectedAccount ? ` · ${escapeHtml(selectedAccount.name)}` : ''}</p></div></div>
      <div class="statement-lines"><div><span>Saldo kas awal periode</span><strong>${formatMoney(opening)}</strong></div><div><span>Penerimaan kas</span><strong>${formatMoney(incoming)}</strong></div><div><span>Pengeluaran kas</span><strong>(${formatMoney(outgoing)})</strong></div><div><span>Transfer antar-akun internal (neto)</span><strong>${formatMoney(internalMovement)}</strong></div><div class="statement-total"><span>Kenaikan (penurunan) kas bersih</span><strong>${formatMoney(netChange)}</strong></div><div class="statement-total"><span>Saldo kas akhir periode${selectedAccount ? ` · ${escapeHtml(selectedAccount.name)}` : ''}</span><strong>${formatMoney(closing)}</strong></div></div>
      <p class="report-note">Hanya transaksi berstatus Approved atau Posted yang dihitung. Transfer/top-up antar-akun dikecualikan dari penerimaan dan pengeluaran perusahaan; saldo awal/akhir tetap memperhitungkan pergerakan akun kas.</p></div>
      <div class="panel"><div class="panel-header"><div><h3>Rincian Arus Kas</h3><p>Pengeluaran hanya dihitung untuk kas keluar dan petty cash expense; permintaan tertunda dan transaksi internal tidak dimasukkan.</p></div></div>${details}</div>`;
  }

  function reportRows() {
    return state.transactions.filter((row) => {
      const date = String(row.transaction_date || '').slice(0, 10);
      if (!['Approved', 'Posted'].includes(row.status)
        || !['cash-in', 'cash-out', 'petty-expense'].includes(row.type)
        || date < reportFilters.startDate || date > reportFilters.endDate) return false;
      if (reportFilters.branchId && transactionBranchId(row) !== reportFilters.branchId) return false;
      if (reportFilters.accountId && row.cash_account_id !== reportFilters.accountId) return false;
      return true;
    });
  }

  function reportAccounts() {
    return state.cashAccounts.filter((account) => (!reportFilters.branchId || account.branch_id === reportFilters.branchId)
      && (!reportFilters.accountId || account.id === reportFilters.accountId));
  }

  function cashTransferMovement(accounts, startDate, endDate) {
    const selectedIds = new Set(accounts.map((account) => account.id));
    return state.transactions.reduce((total, transaction) => {
      const date = String(transaction.transaction_date || '').slice(0, 10);
      if (!['Approved', 'Posted'].includes(transaction.status)
        || !['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(transaction.type)
        || date < startDate || date > endDate) return total;
      return total + [...selectedIds].reduce((accountTotal, accountId) => accountTotal + movement(transaction, accountId), 0);
    }, 0);
  }

  function cashBalanceAt(accounts, date, inclusive) {
    const selectedIds = new Set(accounts.map((account) => account.id));
    return accounts.reduce((total, account) => total + account.openingBalance, 0)
      + state.transactions.reduce((total, transaction) => {
        const transactionDate = String(transaction.transaction_date || '').slice(0, 10);
        if (inclusive ? transactionDate > date : transactionDate >= date) return total;
        return total + [...selectedIds].reduce((accountTotal, accountId) => accountTotal + movement(transaction, accountId), 0);
      }, 0);
  }

  function exportReportCsv() {
    const rows = reportRows();
    const incoming = rows.reduce((total, row) => total + (row.type === 'cash-in' ? Number(row.amount) : 0), 0);
    const outgoing = rows.reduce((total, row) => total + (['cash-out', 'petty-expense'].includes(row.type) ? Number(row.amount) : 0), 0);
    const accounts = reportAccounts();
    const internalMovement = cashTransferMovement(accounts, reportFilters.startDate, reportFilters.endDate);
    const netChange = incoming - outgoing + internalMovement;
    const statementRows = [
      ['Laporan Arus Kas Langsung', '', '', '', '', '', '', '', '', ''],
      ['Periode', reportFilters.startDate, reportFilters.endDate, '', '', '', ''],
      ['Cabang', reportFilters.branchId ? branchName(reportFilters.branchId) : 'Seluruh perusahaan', '', '', '', '', ''],
      ['Akun kas', reportFilters.accountId ? accountName(reportFilters.accountId) : 'Seluruh akun', '', '', '', '', ''],
      ['Saldo kas awal periode', '', '', '', '', cashBalanceAt(accounts, reportFilters.startDate, false), ''],
      ['Penerimaan kas', '', '', '', '', incoming, ''],
      ['Pengeluaran kas', '', '', '', '', outgoing, ''],
      ['Transfer antar-akun internal (neto)', '', '', '', '', internalMovement, ''],
      ['Kenaikan (penurunan) kas bersih', '', '', '', '', netChange, ''],
      ['Saldo kas akhir periode', '', '', '', '', cashBalanceAt(accounts, reportFilters.endDate, true), ''],
      ['', '', '', '', '', '', ''],
      ['Rincian Arus Kas', 'Tanggal', 'Cabang', 'ID Transaksi', 'Jenis', 'Nominal (Rp)', 'Akun Kas', 'Kategori', 'Status', 'Keterangan']
    ];
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (typeof value !== 'number' && /^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const details = rows.map((row) => [
      '', row.transaction_date, branchName(transactionBranchId(row)), row.id, transactionTypes[row.type] || row.type,
      Number(row.amount), accountName(row.cash_account_id), row.category, row.status, row.description
    ]);
    const csv = [
      ['Bagian laporan', 'Tanggal mulai', 'Tanggal akhir', 'ID transaksi', 'Jenis', 'Nominal (Rp)', 'Akun kas', 'Kategori', 'Status', 'Keterangan'],
      ...statementRows,
      ...details
    ].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-arus-kas-${localDate()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`CSV berhasil diekspor (${rows.length} transaksi valid).`);
  }

  function render(view = activeView) {
    activeView = view;
    title.textContent = viewTitles[view] || 'CashFlow';
    document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    appView.innerHTML = view === 'dashboard' ? renderDashboard()
      : ['cash-accounts', 'branches'].includes(view) ? renderMaster(view)
      : view === 'new-transaction' ? renderTransactionForm()
      : view === 'transactions' ? renderTransactions()
      : view === 'reimbursements' ? renderReimbursements()
      : view === 'approval' ? renderApprovals()
      : view === 'approval-history' ? renderApprovals(true)
      : renderReports();
  }

  function fieldMarkup(field, record) {
    const [name, label, type, optionsOrRequired] = field;
    const required = typeof optionsOrRequired === 'boolean' ? optionsOrRequired : false;
    const options = Array.isArray(optionsOrRequired) ? optionsOrRequired : [];
    const value = record?.[name] ?? (type === 'branch' ? state.branches.find((branch) => branch.is_active)?.id : '');
    const input = type === 'branch'
      ? `<select name="${name}" id="master-${name}" required><option value="">Pilih cabang</option>${state.branches.filter((branch) => branch.is_active || branch.id === value).map((branch) => `<option value="${escapeHtml(branch.id)}" ${branch.id === value ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('')}</select>`
      : type === 'select'
      ? `<select name="${name}" id="master-${name}" ${required ? 'required' : ''}>${options.map((option) => `<option ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`
      : `<input name="${name}" id="master-${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" step="0.01"' : ''}>`;
    return `<div class="field"><label for="master-${name}">${label}</label>${input}</div>`;
  }

  function openMasterModal(view, id = '') {
    if (currentUser.role !== 'finance_manager') return showToast('Hanya Finance Manager yang dapat mengelola data inti.');
    const accountMode = view === 'cash-accounts';
    const branchMode = view === 'branches';
    const records = accountMode ? state.cashAccounts : state.branches;
    const record = records.find((item) => item.id === id);
    const label = accountMode ? 'Akun Kas' : 'Cabang';
    document.querySelector('#modalTitle').textContent = `${record ? 'Edit' : 'Tambah'} ${label}`;
    modalForm.dataset.view = view;
    modalForm.dataset.id = id;
    modalForm.innerHTML = `<div class="form-grid">${masterFields[view].map((field) => fieldMarkup(field, record)).join('')}
      ${record ? `<div class="field"><label for="master-is_active">Status</label><select name="is_active" id="master-is_active"><option value="true" ${record.is_active ? 'selected' : ''}>Aktif</option><option value="false" ${!record.is_active ? 'selected' : ''}>Tidak aktif</option></select></div>` : ''}
      <div class="form-actions"><button type="button" class="button-secondary" data-close-modal>Batal</button><button class="button-primary">Simpan</button></div></div>`;
    modal.hidden = false;
  }

  async function saveMaster(event) {
    event.preventDefault();
    const view = modalForm.dataset.view;
    const id = modalForm.dataset.id;
    const accountMode = view === 'cash-accounts';
    const values = Object.fromEntries(new FormData(modalForm).entries());
    const row = accountMode ? {
      id: id || makeId('CASH'),
      code: values.code,
      name: values.name,
      branch_id: values.branch_id,
      account_type: values.account_type,
      location: values.location || null,
      custodian: values.custodian || null,
      opening_balance: Number(values.opening_balance || 0),
      minimum_balance: Number(values.minimum_balance || 0),
      maximum_balance: Number(values.maximum_balance || 0),
      is_active: values.is_active ? values.is_active === 'true' : true
    } : {
      id: id || makeId('BR'),
      code: values.code,
      name: values.name,
      location: values.location || null,
      is_active: values.is_active ? values.is_active === 'true' : true
    };
    try {
      const tableName = accountMode ? 'cash_accounts' : 'branches';
      const url = id ? `${tableName}?on_conflict=id` : tableName;
      await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: id ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' },
        body: JSON.stringify(row)
      });
      modal.hidden = true;
      await loadData();
      render(view);
      showToast('Data berhasil disimpan.');
    } catch (error) {
      showToast(`Gagal menyimpan data: ${error.message}`);
    }
  }

  async function deleteMaster(view, id) {
    if (currentUser.role !== 'finance_manager') return showToast('Hanya Finance Manager yang dapat mengelola data inti.');
    const tableName = view === 'cash-accounts' ? 'cash_accounts' : 'branches';
    if (!window.confirm('Hapus data ini? Akun/kategori yang dipakai transaksi tidak dapat dihapus.')) return;
    try {
      await request(`${tableName}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      await loadData();
      render(view);
      showToast('Data berhasil dihapus.');
    } catch (error) {
      showToast(`Gagal menghapus data: ${error.message}`);
    }
  }

  function validateEvidence(file) {
    if (!file) return '';
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const expectedMimeTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
    if (!expectedMimeTypes[extension] || expectedMimeTypes[extension] !== file.type.toLowerCase()) {
      return 'Bukti transaksi harus berupa file PDF, JPG, JPEG, atau PNG yang valid.';
    }
    if (!file.size || file.size > maximumEvidenceSize) {
      return 'Ukuran bukti transaksi harus lebih dari 0 byte dan tidak boleh melebihi 10 MB.';
    }
    return '';
  }

  async function uploadEvidence(file, transactionId) {
    const extension = file.name.split('.').pop().toLowerCase();
    const uniqueId = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const path = `${currentUser.id}/${transactionId}/${uniqueId}.${extension}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${baseUrl}/storage/v1/object/${evidenceBucket}/${encodedPath}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': file.type, 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Supabase Storage ${response.status}: ${details}`);
    }
    return path;
  }

  async function viewEvidence(path, name, mimeType, bucket = evidenceBucket) {
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${baseUrl}/storage/v1/object/sign/${bucket}/${encodedPath}`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 300 })
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase Storage ${response.status}: ${details}`);
      }
      const result = await response.json();
      if (!result.signedURL) throw new Error('Supabase Storage tidak mengembalikan tautan bukti.');
      const signedUrl = /^https?:\/\//i.test(result.signedURL)
        ? result.signedURL
        : result.signedURL.startsWith('/storage/v1/')
          ? `${baseUrl}${result.signedURL}`
          : `${baseUrl}/storage/v1/${result.signedURL.replace(/^\/+/, '')}`;
      const downloadUrl = new URL(signedUrl);
      downloadUrl.searchParams.set('download', name);
      const preview = mimeType === 'application/pdf'
        ? `<iframe class="evidence-pdf" src="${escapeHtml(signedUrl)}" title="Pratinjau ${escapeHtml(name)}"></iframe>`
        : mimeType.startsWith('image/')
          ? `<img class="evidence-image" src="${escapeHtml(signedUrl)}" alt="Pratinjau ${escapeHtml(name)}">`
          : '<p class="report-note">Pratinjau tidak tersedia untuk tipe file ini.</p>';
      document.querySelector('#modalTitle').textContent = 'Bukti Transaksi';
      modalForm.innerHTML = `<div class="evidence-preview"><p><strong>${escapeHtml(name)}</strong></p>${preview}<div class="evidence-actions"><a class="button-primary" href="${escapeHtml(signedUrl)}" target="_blank" rel="noopener">Buka</a><a class="button-secondary" href="${escapeHtml(downloadUrl.href)}" target="_blank" rel="noopener">Unduh</a><button type="button" class="button-secondary" data-close-modal>Tutup</button></div></div>`;
      modal.hidden = false;
    } catch (error) {
      showToast(`Gagal membuka bukti transaksi: ${error.message}`);
    }
  }

  async function createTransaction(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const type = values.type;
    const requiresApproval = approvalRequired.has(type);
    const branch = state.branches.find((item) => item.id === values.branch_id && item.is_active);
    if (!branch) return showToast('Pilih cabang yang aktif.');
    const account = state.cashAccounts.find((item) => item.id === values.cash_account_id && item.branch_id === branch.id && item.is_active);
    const sourceAccount = state.cashAccounts.find((item) => item.id === values.source_cash_account_id && item.branch_id === branch.id && item.is_active);
    if (['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type)
      && values.cash_account_id === values.source_cash_account_id) {
      return showToast('Akun sumber dan tujuan transfer harus berbeda.');
    }
    if (['cash-out', 'petty-expense', 'cash-in', 'cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type) && !values.cash_account_id) {
      return showToast('Pilih akun kas untuk transaksi ini.');
    }
    if (values.cash_account_id && !account) return showToast('Akun kas harus aktif dan berasal dari cabang yang dipilih.');
    if (['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type) && !values.source_cash_account_id) {
      return showToast('Pilih akun sumber untuk transaksi ini.');
    }
    if (values.source_cash_account_id && !sourceAccount) return showToast('Akun sumber harus aktif dan berasal dari cabang yang dipilih.');
    const evidenceFile = form.querySelector('#evidence')?.files?.[0];
    const evidenceError = validateEvidence(evidenceFile);
    if (evidenceError) return showToast(evidenceError);
    const row = {
      id: makeId(({ 'cash-in': 'CIN', 'cash-out': 'COUT', 'cash-transfer': 'TRF', 'petty-topup': 'PCT', 'petty-expense': 'PCV', 'petty-replenishment': 'PCR', 'cash-request': 'REQ' })[type]),
      type,
      transaction_date: values.transaction_date,
      branch_id: branch.id,
      source_cash_account_id: values.source_cash_account_id || null,
      cash_account_id: values.cash_account_id || null,
      category: values.category || null,
      vendor: values.vendor || null,
      requester: values.requester || null,
      amount: Number(values.amount),
      description: values.description || null,
      status: requiresApproval || currentUser.role !== 'finance_manager' ? 'Pending' : 'Posted',
      created_by: currentUser.name,
      created_by_user_id: currentUser.id
    };
    const submitButton = form.querySelector('button[type="submit"], .form-actions button');
    if (submitButton) submitButton.disabled = true;
    let evidencePath = '';
    if (evidenceFile) {
      try {
        evidencePath = await uploadEvidence(evidenceFile, row.id);
        row.evidence_path = evidencePath;
        row.evidence_name = evidenceFile.name;
        row.evidence_mime_type = evidenceFile.type;
      } catch (error) {
        if (submitButton) submitButton.disabled = false;
        showToast(`Gagal mengunggah bukti transaksi. Transaksi belum disimpan: ${error.message}`);
        return;
      }
    }
    let savedTransaction;
    try {
      const insertedRows = await request('transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(row)
      });
      savedTransaction = insertedRows?.find((insertedRow) => insertedRow.id === row.id);
      if (!savedTransaction) {
        throw new Error('Supabase tidak mengembalikan transaksi yang baru disimpan.');
      }
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      const evidenceNotice = evidencePath ? ` Bukti sudah tersimpan di Storage pada ${evidencePath} dan tidak dihapus otomatis.` : '';
      showToast(`Gagal menyimpan transaksi: ${error.message}.${evidenceNotice}`);
      return;
    }

    try {
      await loadData();
      render('transactions');
    } catch (error) {
      showToast(`Transaksi ${savedTransaction.id} tersimpan, tetapi daftar gagal dimuat ulang: ${error.message}`);
      return;
    }
    showToast(`Transaksi ${savedTransaction.id} berhasil disimpan${row.status === 'Pending' ? ' dan menunggu approval' : ''}.`);
  }

  async function decide(targetKind, targetId, action) {
    if (!canApprove()) return showToast('Akses approval hanya tersedia untuk Approver dan Finance Manager.');
    const target = targetKind === 'transaction'
      ? state.transactions.find((row) => row.id === targetId)
      : state.reimbursements.find((row) => row.id === targetId);
    if (!target) return showToast('Data yang akan diputuskan tidak ditemukan.');
    const notes = window.prompt('Masukkan catatan keputusan (wajib):');
    if (notes === null) return;
    if (!notes.trim() || notes.length > 2000) return showToast('Catatan wajib diisi dan maksimal 2.000 karakter.');
    let decisionSaved = false;
    try {
      await request('rpc/cashflow_record_approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_target_kind: targetKind,
          p_target_id: targetId,
          p_action: action,
          p_notes: notes.trim()
        })
      });
      decisionSaved = true;
      try {
        await loadData();
        render('approval');
      } catch (error) {
        showToast(`Keputusan untuk ${targetId} tersimpan, tetapi daftar gagal dimuat ulang: ${error.message}`);
        return;
      }
      showToast(`${targetKind === 'transaction' ? 'Transaksi' : 'Reimbursement'} ${targetId} berhasil diperbarui.`);
    } catch (error) {
      showToast(decisionSaved
        ? `Keputusan tersimpan, tetapi terjadi kesalahan setelahnya: ${error.message}`
        : `Gagal menyimpan keputusan: ${error.message}`);
    }
  }

  function validateReceipt(file) {
    const extension = file?.name.split('.').pop()?.toLowerCase() || '';
    const allowed = {
      pdf: ['application/pdf'],
      jpg: ['image/jpeg'],
      jpeg: ['image/jpeg'],
      png: ['image/png'],
      webp: ['image/webp']
    };
    if (!file || !allowed[extension]?.includes(file.type.toLowerCase())) {
      return 'Bukti reimbursement harus berupa PDF, JPG, JPEG, PNG, atau WebP yang valid.';
    }
    if (!file.size || file.size > maximumEvidenceSize) {
      return 'Ukuran bukti reimbursement harus lebih dari 0 byte dan tidak boleh melebihi 10 MB.';
    }
    return '';
  }

  async function uploadReceipt(file, path) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${baseUrl}/storage/v1/object/${reimbursementBucket}/${encodedPath}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': file.type, 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Supabase Storage ${response.status}: ${details}`);
    }
  }

  async function createReimbursement(event) {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form).entries());
    const file = form.querySelector('#reimbursementReceipt')?.files?.[0];
    const validationError = validateReceipt(file);
    if (validationError) return showToast(validationError);
    const extension = file.name.split('.').pop().toLowerCase();
    const id = makeId('RBP');
    const path = `${currentUser.id}/${id}.${extension}`;
    const draft = {
      id,
      owner_id: currentUser.id,
      employee_name: values.employee_name.trim(),
      department: values.department.trim(),
      expense_date: values.expense_date,
      expense_category: values.expense_category.trim(),
      amount: Number(values.amount),
      description: values.description.trim(),
      receipt_storage_path: path,
      receipt_original_name: file.name,
      receipt_mime_type: file.type,
      receipt_size_bytes: file.size,
      status: 'Draft'
    };
    const submitButton = form.querySelector('button[type="submit"], .form-actions button');
    if (submitButton) submitButton.disabled = true;
    let draftSaved = false;
    try {
      const created = await request('reimbursements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(draft)
      });
      if (!created?.some((row) => row.id === id)) throw new Error('Draft reimbursement tidak tersimpan di Supabase.');
      draftSaved = true;
      try {
        await uploadReceipt(file, path);
      } catch (error) {
        try {
          await loadData();
          render('reimbursements');
        } catch (reloadError) {
          showToast(`Draft ${id} tersimpan, tetapi bukti gagal diunggah dan belum diajukan: ${error.message}. Daftar gagal dimuat ulang: ${reloadError.message}`);
          return;
        }
        showToast(`Draft ${id} tersimpan, tetapi bukti gagal diunggah dan belum diajukan: ${error.message}`);
        return;
      }
      try {
        await request('rpc/cashflow_submit_reimbursement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_reimbursement_id: id })
        });
      } catch (error) {
        showToast(`Bukti tersimpan, tetapi reimbursement ${id} belum diajukan: ${error.message}`);
        return;
      }
      try {
        await loadData();
        render('reimbursements');
      } catch (error) {
        showToast(`Reimbursement ${id} sudah diajukan, tetapi daftar gagal dimuat ulang: ${error.message}`);
        return;
      }
      showToast(`Reimbursement ${id} berhasil diajukan.`);
    } catch (error) {
      showToast(draftSaved
        ? `Draft reimbursement ${id} tersimpan, tetapi proses pengajuan gagal: ${error.message}`
        : `Gagal menyimpan draft reimbursement ${id}: ${error.message}`);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function retryReimbursementReceipt(id, button) {
    const file = button.closest('td')?.querySelector('input[type="file"]')?.files?.[0];
    const validationError = validateReceipt(file);
    if (validationError) return showToast(validationError);
    const extension = file.name.split('.').pop().toLowerCase();
    const path = `${currentUser.id}/${id}-${makeId('RECEIPT')}.${extension}`;
    try {
      await request(`reimbursements?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          receipt_storage_path: path,
          receipt_original_name: file.name,
          receipt_mime_type: file.type,
          receipt_size_bytes: file.size
        })
      });
      await uploadReceipt(file, path);
      await request('rpc/cashflow_submit_reimbursement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_reimbursement_id: id })
      });
      try {
        await loadData();
        render('reimbursements');
      } catch (error) {
        showToast(`Reimbursement ${id} sudah diajukan, tetapi daftar gagal dimuat ulang: ${error.message}`);
        return;
      }
      showToast(`Reimbursement ${id} berhasil diajukan.`);
    } catch (error) {
      showToast(`Bukti reimbursement ${id} belum berhasil diajukan: ${error.message}`);
    }
  }

  async function payReimbursement(id, button) {
    const accountId = button.closest('td')?.querySelector('select')?.value;
    if (!accountId) return showToast('Pilih akun kas untuk pembayaran reimbursement.');
    try {
      const transactionId = await request('rpc/cashflow_pay_reimbursement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_reimbursement_id: id, p_cash_account_id: accountId })
      });
      try {
        await loadData();
        render('reimbursements');
      } catch (error) {
        showToast(`Pembayaran tersimpan sebagai transaksi ${transactionId}, tetapi daftar gagal dimuat ulang: ${error.message}`);
        return;
      }
      showToast(`Reimbursement ${id} dibayar melalui transaksi ${transactionId}.`);
    } catch (error) {
      showToast(`Gagal membayar reimbursement ${id}: ${error.message}`);
    }
  }

  appView.addEventListener('submit', (event) => {
    if (event.target.id === 'transactionForm') createTransaction(event);
    if (event.target.id === 'reimbursementForm') createReimbursement(event);
    if (event.target.id === 'reportFilters') {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target).entries());
      if (values.startDate > values.endDate) return showToast('Tanggal awal tidak boleh melewati tanggal akhir.');
      reportFilters.startDate = values.startDate;
      reportFilters.endDate = values.endDate;
      reportFilters.branchId = values.branchId;
      reportFilters.accountId = values.accountId;
      render('reports');
    }
  });
  appView.addEventListener('change', (event) => {
    if (event.target.id === 'branch_id') {
      const branchId = event.target.value;
      const options = state.cashAccounts.filter((account) => account.is_active && account.branch_id === branchId)
        .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
      ['cash_account_id', 'source_cash_account_id'].forEach((id) => {
        const select = document.querySelector(`#${id}`);
        if (select) select.innerHTML = `<option value="">Pilih akun${id === 'source_cash_account_id' ? ' sumber' : ''}</option>${options}`;
      });
    }
    if (event.target.id === 'reportBranch') {
      const accountSelect = document.querySelector('#reportAccount');
      if (accountSelect) {
        const options = state.cashAccounts.filter((account) => !event.target.value || account.branch_id === event.target.value)
          .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
        accountSelect.innerHTML = `<option value="">Seluruh akun</option>${options}`;
      }
    }
  });
  modalForm.addEventListener('submit', saveMaster);
  appView.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.go) render(button.dataset.go);
    if (button.dataset.addMaster) openMasterModal(button.dataset.addMaster);
    if (button.dataset.editMaster) openMasterModal(button.dataset.editMaster, button.dataset.id);
    if (button.dataset.deleteMaster) deleteMaster(button.dataset.deleteMaster, button.dataset.id);
    if (button.dataset.decision) decide(button.dataset.kind, button.dataset.id, button.dataset.decision);
    if (button.dataset.retryReceipt) retryReimbursementReceipt(button.dataset.retryReceipt, button);
    if (button.dataset.payReimbursement) payReimbursement(button.dataset.payReimbursement, button);
    if (button.hasAttribute('data-view-evidence')) {
      viewEvidence(button.dataset.path, button.dataset.name, button.dataset.mime || '', button.dataset.bucket || evidenceBucket);
    }
    if (button.hasAttribute('data-export-csv')) exportReportCsv();
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-close-modal]')) modal.hidden = true;
  });
  document.querySelector('#modalClose').addEventListener('click', () => { modal.hidden = true; });
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => render(button.dataset.view)));
  document.querySelectorAll('.nav-group-toggle').forEach((button) => button.addEventListener('click', () => {
    const group = button.closest('.nav-group');
    const expanded = group.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(expanded));
  }));
  document.querySelector('#menuToggle').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
  document.querySelector('#sidebarClose').addEventListener('click', () => document.querySelector('#sidebar').classList.remove('open'));

  loginForm.addEventListener('submit', submitLogin);
  document.querySelector('#logoutButton').addEventListener('click', async () => {
    try {
      await refreshSessionIfNeeded();
      const response = await authFetch('logout', { method: 'POST', headers: { Authorization: `Bearer ${authSession.access_token}` } });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase ${response.status}: ${details}`);
      }
    } catch (error) {
      showToast(`Sesi lokal ditutup, tetapi logout Supabase gagal: ${error.message}`);
    }
    clearSession();
    appShell.hidden = true;
    authShell.hidden = false;
    loginForm.reset();
    authError.hidden = true;
    state.branches = [];
    state.cashAccounts = [];
    state.transactions = [];
    state.approvals = [];
    state.reimbursements = [];
  });
  setInterval(() => {
    const dateLabel = document.querySelector('#dashboardDate');
    if (dateLabel) dateLabel.textContent = formatCurrentDate();
  }, 60_000);
  (async function bootstrapAuth() {
    if (!authSession?.access_token) {
      authShell.hidden = false;
      return;
    }
    try {
      await refreshSessionIfNeeded();
      const response = await authFetch('user', { headers: { Authorization: `Bearer ${authSession.access_token}` } });
      if (!response.ok) throw new Error('Sesi tidak valid atau sudah kedaluwarsa.');
      const user = await response.json();
      storeSession({ ...authSession, user });
      authShell.hidden = true;
      appShell.hidden = false;
    } catch (error) {
      clearSession();
      authShell.hidden = false;
      authError.textContent = error.message;
      authError.hidden = false;
      return;
    }
    try {
      await loadData();
      render('dashboard');
    } catch (error) {
      setConnectionStatus(false, error.message);
      showToast(`Gagal memuat data Supabase: ${error.message}`);
    }
  })();
})();
