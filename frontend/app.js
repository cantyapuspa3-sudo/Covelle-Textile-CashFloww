(function () {
  const config = window.CASHFLOW_SUPABASE_CONFIG || {
    url: 'https://fgjckvrvoaripvgsegfd.supabase.co',
    anonKey: 'sb_publishable_xsq8qPXWLEgTGX2ZIbdWGQ_EE6hJDy2'
  };
  const baseUrl = String(config.url || '').replace(/\/$/, '');
  const anonKey = config.anonKey || '';
  const currentUser = { id: 'USR-001', name: 'Cantya Puspa' };
  const state = { cashAccounts: [], categories: [], transactions: [], approvals: [] };
  const appView = document.querySelector('#appView');
  const title = document.querySelector('#pageTitle');
  const statusLabel = document.querySelector('#supabaseStatus');
  const statusDot = document.querySelector('#supabaseStatusDot');
  const modal = document.querySelector('#modalBackdrop');
  const modalForm = document.querySelector('#masterForm');
  const toast = document.querySelector('#toast');
  let activeView = 'dashboard';
  let toastTimer;

  const viewTitles = {
    dashboard: 'Dashboard',
    'cash-accounts': 'Akun Kas',
    categories: 'Kategori',
    transactions: 'Semua Transaksi',
    'new-transaction': 'Buat Transaksi',
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
    return { apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...extra };
  }

  async function request(path, options = {}) {
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

  function categoryFromRow(row) {
    return {
      ...row,
      group: row.category_type || '',
      status: row.is_active ? 'Active' : 'Inactive'
    };
  }

  function transactionFromRow(row) {
    return {
      ...row,
      date: row.transaction_date,
      sourceCashAccountId: row.source_cash_account_id,
      cashAccountId: row.cash_account_id,
      categoryId: row.category_id,
      createdBy: row.created_by || ''
    };
  }

  async function loadData() {
    const [accounts, categories, transactions, approvals] = await Promise.all([
      loadRows('cash_accounts', 'name.asc'),
      loadRows('categories', 'name.asc'),
      loadRows('transactions', 'transaction_date.desc.nullslast,id.desc'),
      loadRows('approvals', 'created_at.desc,id.desc')
    ]);
    state.cashAccounts = accounts.map(accountFromRow);
    state.categories = categories.map(categoryFromRow);
    state.transactions = transactions
      .filter((row) => Object.hasOwn(transactionTypes, row.type))
      .map(transactionFromRow);
    state.approvals = approvals;
    setConnectionStatus(true);
    render(activeView);
  }

  function accountName(id) {
    return state.cashAccounts.find((account) => account.id === id)?.name || id || '-';
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
    if (!rows.length) return '<tr><td colspan="8" class="empty-state">Belum ada transaksi.</td></tr>';
    return rows.map((row) => `<tr>
      <td><strong>${escapeHtml(row.id)}</strong></td>
      <td>${formatDate(row.transaction_date || row.date)}</td>
      <td>${escapeHtml(transactionTypes[row.type] || row.type)}</td>
      <td>${escapeHtml(accountName(row.cash_account_id || row.cashAccountId))}</td>
      <td>${escapeHtml(row.category || '-')}</td>
      <td>${formatMoney(row.amount)}</td>
      <td>${statusBadge(row.status)}</td>
      <td>${escapeHtml(row.description || row.requester || '-')}</td>
    </tr>`).join('');
  }

  function table(rows) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>ID</th><th>Tanggal</th><th>Jenis</th><th>Akun Kas</th><th>Kategori</th><th>Nominal</th><th>Status</th><th>Keterangan</th>
    </tr></thead><tbody>${transactionRows(rows)}</tbody></table></div>`;
  }

  function renderDashboard() {
    const pending = state.transactions.filter((row) => row.status === 'Pending').length;
    const currentBalance = state.cashAccounts.reduce((total, account) => total + balance(account), 0);
    const recent = state.transactions.slice(0, 8);
    return `<div class="welcome"><div><span class="eyebrow">RINGKASAN KAS</span><h2>Selamat datang, ${escapeHtml(currentUser.name)}</h2><p>Ringkasan akun kas dan transaksi terbaru.</p></div><div class="welcome-actions"><span class="date-pill" id="dashboardDate">${escapeHtml(formatCurrentDate())}</span><button class="button-primary" data-go="new-transaction">＋ Buat Transaksi</button></div></div>
      <div class="metrics">
        <article class="metric-card"><span class="label">Saldo Seluruh Akun</span><div class="value">${formatMoney(currentBalance)}</div></article>
        <article class="metric-card"><span class="label">Akun Kas Aktif</span><div class="value">${state.cashAccounts.filter((account) => account.is_active).length}</div></article>
        <article class="metric-card"><span class="label">Kategori Aktif</span><div class="value">${state.categories.filter((category) => category.is_active).length}</div></article>
        <article class="metric-card"><span class="label">Menunggu Approval</span><div class="value">${pending}</div></article>
      </div>
      ${renderCashflowChart()}
      <div class="panel"><div class="panel-header"><div><h3>Transaksi Terbaru</h3><p>Saldo hanya menghitung transaksi Approved atau Posted.</p></div></div>${table(recent)}</div>`;
  }

  const masterFields = {
    'cash-accounts': [
      ['code', 'Kode akun', 'text', true], ['name', 'Nama akun', 'text', true],
      ['account_type', 'Jenis akun', 'select', ['Petty Cash', 'Cash', 'Bank']],
      ['location', 'Lokasi', 'text'], ['custodian', 'Penanggung jawab', 'text'],
      ['opening_balance', 'Saldo awal', 'number', true], ['minimum_balance', 'Saldo minimum', 'number'],
      ['maximum_balance', 'Saldo maksimum', 'number']
    ],
    categories: [
      ['code', 'Kode kategori', 'text'], ['name', 'Nama kategori', 'text', true],
      ['category_type', 'Kelompok', 'text']
    ]
  };

  function renderMaster(view) {
    const isAccounts = view === 'cash-accounts';
    const records = isAccounts ? state.cashAccounts : state.categories;
    const columns = isAccounts
      ? [['code', 'Kode'], ['name', 'Nama'], ['account_type', 'Jenis'], ['opening_balance', 'Saldo Awal'], ['status', 'Status']]
      : [['code', 'Kode'], ['name', 'Nama'], ['category_type', 'Kelompok'], ['status', 'Status']];
    return `<div class="section-head"><div><span class="eyebrow">DATA INTI</span><h2>${viewTitles[view]}</h2></div><button class="button-primary" data-add-master="${view}">＋ Tambah</button></div>
      <div class="panel"><div class="panel-header"><p>${records.length} data tersimpan di Supabase</p></div><div class="table-wrap"><table class="data-table"><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>Aksi</th></tr></thead><tbody>
      ${records.length ? records.map((row) => `<tr>${columns.map(([key]) => `<td>${key === 'status' ? statusBadge(row.status) : key.endsWith('balance') ? formatMoney(row[key]) : escapeHtml(row[key] || '-')}</td>`).join('')}<td><button class="button-secondary" data-edit-master="${view}" data-id="${escapeHtml(row.id)}">Edit</button> <button class="button-secondary danger-button" data-delete-master="${view}" data-id="${escapeHtml(row.id)}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Belum ada data.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function renderTransactionForm() {
    const accountOptions = state.cashAccounts.filter((account) => account.is_active)
      .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
    const categoryOptions = state.categories.filter((category) => category.is_active)
      .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('');
    return `<div class="section-head"><div><span class="eyebrow">TRANSAKSI KAS</span><h2>Buat Transaksi</h2></div></div>
      <form class="panel transaction-form" id="transactionForm"><div class="panel-header"><div><h3>Informasi Transaksi</h3><p>Pengeluaran dan permintaan kas memerlukan approval.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="type">Jenis transaksi</label><select id="type" name="type" required>${Object.entries(transactionTypes).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>
        <div class="field"><label for="transaction_date">Tanggal</label><input id="transaction_date" name="transaction_date" type="date" value="${localDate()}" required></div>
        <div class="field"><label for="cash_account_id">Akun kas</label><select id="cash_account_id" name="cash_account_id"><option value="">Pilih akun</option>${accountOptions}</select></div>
        <div class="field"><label for="source_cash_account_id">Akun sumber (transfer/top-up)</label><select id="source_cash_account_id" name="source_cash_account_id"><option value="">Pilih akun sumber</option>${accountOptions}</select></div>
        <div class="field"><label for="category">Kategori</label><select id="category" name="category"><option value="">Pilih kategori</option>${categoryOptions}</select></div>
        <div class="field"><label for="amount">Nominal (Rp)</label><input id="amount" name="amount" type="number" min="1" step="0.01" required></div>
        <div class="field"><label for="requester">Pemohon</label><input id="requester" name="requester" type="text" value="${escapeHtml(currentUser.name)}"></div>
        <div class="field"><label for="vendor">Vendor</label><input id="vendor" name="vendor" type="text"></div>
        <div class="field full"><label for="description">Keterangan</label><input id="description" name="description" type="text"></div>
        <div class="form-actions"><button class="button-primary">Simpan Transaksi</button></div>
      </div></form>`;
  }

  function renderTransactions() {
    return `<div class="section-head"><div><span class="eyebrow">TRANSAKSI KAS</span><h2>Semua Transaksi</h2></div><button class="button-primary" data-go="new-transaction">＋ Buat Transaksi</button></div><div class="panel">${table(state.transactions)}</div>`;
  }

  function renderApprovals(history = false) {
    const rows = history
      ? state.approvals
      : state.transactions.filter((transaction) => transaction.status === 'Pending');
    if (history) {
      const approvalsTable = rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Penyetuju</th><th>Keputusan</th><th>Catatan</th><th>Waktu</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.transaction_id)}</td><td>${escapeHtml(row.approver_name_snapshot || row.approver_id || '-')}</td><td>${statusBadge(row.action)}</td><td>${escapeHtml(row.notes || '-')}</td><td>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Belum ada riwayat persetujuan.</div>';
      return `<div class="section-head"><div><span class="eyebrow">APPROVAL</span><h2>Riwayat Persetujuan</h2></div></div><div class="panel">${approvalsTable}</div>`;
    }
    const approvalsTable = rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaksi</th><th>Jenis</th><th>Pemohon</th><th>Nominal</th><th>Keterangan</th><th>Aksi</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(transactionTypes[row.type] || row.type)}</td><td>${escapeHtml(row.requester || row.created_by || '-')}</td><td>${formatMoney(row.amount)}</td><td>${escapeHtml(row.description || '-')}</td><td><button class="button-primary" data-decision="Approved" data-id="${escapeHtml(row.id)}">Setujui</button> <button class="button-secondary" data-decision="Rejected" data-id="${escapeHtml(row.id)}">Tolak</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Tidak ada transaksi yang menunggu approval.</div>';
    return `<div class="section-head"><div><span class="eyebrow">APPROVAL</span><h2>Menunggu Persetujuan</h2></div></div><div class="panel">${approvalsTable}</div>`;
  }

  function renderReports() {
    const approved = state.transactions.filter((row) => ['Approved', 'Posted'].includes(row.status));
    const incoming = approved.reduce((total, row) => total + (row.type === 'cash-in' ? Number(row.amount) : 0), 0);
    const outgoing = approved.reduce((total, row) => total + (['cash-out', 'petty-expense'].includes(row.type) ? Number(row.amount) : 0), 0);
    return `<div class="section-head"><div><span class="eyebrow">LAPORAN</span><h2>Laporan Kas</h2></div><button class="button-primary" type="button" data-export-csv>⬇ Ekspor CSV</button></div>
      <div class="metrics"><article class="metric-card"><span class="label">Penerimaan Approved/Posted</span><div class="value">${formatMoney(incoming)}</div></article><article class="metric-card"><span class="label">Pengeluaran Approved</span><div class="value">${formatMoney(outgoing)}</div></article><article class="metric-card"><span class="label">Jumlah Transaksi</span><div class="value">${state.transactions.length}</div></article><article class="metric-card"><span class="label">Saldo Seluruh Akun</span><div class="value">${formatMoney(state.cashAccounts.reduce((total, account) => total + balance(account), 0))}</div></article></div>
      <div class="panel"><div class="panel-header"><div><h3>Rincian Transaksi</h3><p>Laporan dihitung dari tabel transaksi dan akun kas.</p></div></div>${table(state.transactions)}</div>`;
  }

  function exportReportCsv() {
    const columns = [
      ['ID Transaksi', (row) => row.id],
      ['Tanggal', (row) => row.transaction_date || row.date],
      ['Jenis Transaksi', (row) => transactionTypes[row.type] || row.type],
      ['Akun Kas', (row) => accountName(row.cash_account_id || row.cashAccountId)],
      ['Akun Sumber', (row) => accountName(row.source_cash_account_id || row.sourceCashAccountId)],
      ['Kategori', (row) => row.category],
      ['Vendor', (row) => row.vendor],
      ['Pemohon', (row) => row.requester],
      ['Nominal (Rp)', (row) => row.amount],
      ['Status', (row) => row.status],
      ['Keterangan', (row) => row.description],
      ['Dibuat Oleh', (row) => row.created_by || row.createdBy]
    ];
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [
      columns.map(([label]) => csvCell(label)).join(','),
      ...state.transactions.map((row) => columns.map(([, getValue]) => csvCell(getValue(row))).join(','))
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-kas-${localDate()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`CSV berhasil diekspor (${state.transactions.length} transaksi).`);
  }

  function render(view = activeView) {
    activeView = view;
    title.textContent = viewTitles[view] || 'CashFlow';
    document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    appView.innerHTML = view === 'dashboard' ? renderDashboard()
      : ['cash-accounts', 'categories'].includes(view) ? renderMaster(view)
      : view === 'new-transaction' ? renderTransactionForm()
      : view === 'transactions' ? renderTransactions()
      : view === 'approval' ? renderApprovals()
      : view === 'approval-history' ? renderApprovals(true)
      : renderReports();
  }

  function fieldMarkup(field, record) {
    const [name, label, type, optionsOrRequired] = field;
    const required = typeof optionsOrRequired === 'boolean' ? optionsOrRequired : false;
    const options = Array.isArray(optionsOrRequired) ? optionsOrRequired : [];
    const value = record?.[name] ?? '';
    const input = type === 'select'
      ? `<select name="${name}" id="master-${name}" ${required ? 'required' : ''}>${options.map((option) => `<option ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`
      : `<input name="${name}" id="master-${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" step="0.01"' : ''}>`;
    return `<div class="field"><label for="master-${name}">${label}</label>${input}</div>`;
  }

  function openMasterModal(view, id = '') {
    const accountMode = view === 'cash-accounts';
    const record = (accountMode ? state.cashAccounts : state.categories).find((item) => item.id === id);
    document.querySelector('#modalTitle').textContent = `${record ? 'Edit' : 'Tambah'} ${accountMode ? 'Akun Kas' : 'Kategori'}`;
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
      account_type: values.account_type,
      location: values.location || null,
      custodian: values.custodian || null,
      opening_balance: Number(values.opening_balance || 0),
      minimum_balance: Number(values.minimum_balance || 0),
      maximum_balance: Number(values.maximum_balance || 0),
      is_active: values.is_active ? values.is_active === 'true' : true
    } : {
      id: id || makeId('CAT'),
      code: values.code || null,
      name: values.name,
      category_type: values.category_type || null,
      is_active: values.is_active ? values.is_active === 'true' : true
    };
    try {
      const tableName = accountMode ? 'cash_accounts' : 'categories';
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
    const tableName = view === 'cash-accounts' ? 'cash_accounts' : 'categories';
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

  async function createTransaction(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const type = values.type;
    const requiresApproval = approvalRequired.has(type);
    if (['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type)
      && values.cash_account_id === values.source_cash_account_id) {
      return showToast('Akun sumber dan tujuan transfer harus berbeda.');
    }
    if (['cash-out', 'petty-expense', 'cash-in', 'cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type) && !values.cash_account_id) {
      return showToast('Pilih akun kas untuk transaksi ini.');
    }
    if (['cash-transfer', 'petty-topup', 'petty-replenishment'].includes(type) && !values.source_cash_account_id) {
      return showToast('Pilih akun sumber untuk transaksi ini.');
    }
    const row = {
      id: makeId(({ 'cash-in': 'CIN', 'cash-out': 'COUT', 'cash-transfer': 'TRF', 'petty-topup': 'PCT', 'petty-expense': 'PCV', 'petty-replenishment': 'PCR', 'cash-request': 'REQ' })[type]),
      type,
      transaction_date: values.transaction_date,
      source_cash_account_id: values.source_cash_account_id || null,
      cash_account_id: values.cash_account_id || null,
      category: values.category || null,
      vendor: values.vendor || null,
      requester: values.requester || null,
      amount: Number(values.amount),
      description: values.description || null,
      status: requiresApproval ? 'Pending' : 'Posted',
      created_by: currentUser.name
    };
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
      showToast(`Gagal menyimpan transaksi: ${error.message}`);
      return;
    }

    let approvalError;
    if (requiresApproval) {
      try {
        await request('approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            transaction_id: savedTransaction.id,
            approver_id: null,
            action: 'Pending',
            notes: 'Menunggu keputusan approval.'
          })
        });
      } catch (error) {
        approvalError = error;
      }
    }

    try {
      await loadData();
      render('transactions');
    } catch (error) {
      showToast(`Transaksi ${savedTransaction.id} tersimpan, tetapi daftar gagal dimuat ulang: ${error.message}`);
      return;
    }
    if (approvalError) {
      showToast(`Transaksi ${savedTransaction.id} tersimpan, tetapi gagal mencatat approval: ${approvalError.message}`);
    } else {
      showToast(`Transaksi ${savedTransaction.id} berhasil disimpan.`);
    }
  }

  async function decide(transactionId, action) {
    const transaction = state.transactions.find((row) => row.id === transactionId);
    if (!transaction) return showToast('Transaksi tidak ditemukan.');
    if (transaction.created_by?.trim().toLowerCase() === currentUser.name.toLowerCase()
      || transaction.requester?.trim().toLowerCase() === currentUser.name.toLowerCase()) {
      return showToast('Segregation of duties: pembuat/pemohon tidak boleh memutuskan transaksi sendiri.');
    }
    const previousStatus = transaction.status;
    const decisionTime = new Date().toISOString();
    try {
      const updated = await request(`transactions?id=eq.${encodeURIComponent(transactionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: action, updated_at: decisionTime })
      });
      if (!updated?.length) throw new Error('Transaksi tidak ditemukan atau tidak dapat diperbarui.');
      try {
        await request('approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            transaction_id: transactionId,
            approver_id: currentUser.id,
            approver_name_snapshot: currentUser.name,
            action,
            notes: `Keputusan oleh ${currentUser.name}`,
            approved_at: decisionTime
          })
        });
      } catch (error) {
        try {
          await request(`transactions?id=eq.${encodeURIComponent(transactionId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ status: previousStatus, updated_at: new Date().toISOString() })
          });
        } catch (rollbackError) {
          throw new Error(`Riwayat approval gagal disimpan (${error.message}); status transaksi perlu diperiksa (${rollbackError.message}).`);
        }
        throw error;
      }
      await loadData();
      render('approval');
      showToast(`Transaksi ${transactionId} ${action === 'Approved' ? 'disetujui' : 'ditolak'}.`);
    } catch (error) {
      showToast(`Gagal menyimpan keputusan: ${error.message}`);
    }
  }

  appView.addEventListener('submit', (event) => {
    if (event.target.id === 'transactionForm') createTransaction(event);
  });
  modalForm.addEventListener('submit', saveMaster);
  appView.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.go) render(button.dataset.go);
    if (button.dataset.addMaster) openMasterModal(button.dataset.addMaster);
    if (button.dataset.editMaster) openMasterModal(button.dataset.editMaster, button.dataset.id);
    if (button.dataset.deleteMaster) deleteMaster(button.dataset.deleteMaster, button.dataset.id);
    if (button.dataset.decision) decide(button.dataset.id, button.dataset.decision);
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

  render();
  setInterval(() => {
    const dateLabel = document.querySelector('#dashboardDate');
    if (dateLabel) dateLabel.textContent = formatCurrentDate();
  }, 60_000);
  loadData().catch((error) => {
    setConnectionStatus(false, error.message);
    showToast(`Koneksi Supabase gagal: ${error.message}`);
  });
})();
