// ==========================================================================
// APP CLIENT JS - PHARMACY CREDIT & DUES COLLECTION TRACKER
// ==========================================================================

// Global Session Variables
let token = localStorage.getItem('mediwave_token') || null;
let currentUser = JSON.parse(localStorage.getItem('mediwave_user')) || null;
let activeView = 'login';
let vendors = [];
let credits = [];
let audits = [];
let systemRules = { escalationDays: 30, creditLimit: 150000, archiveDays: 15 };

// Pagination & Filtering state
let ledgerCurrentPage = 1;
const ledgerItemsPerPage = 15;
let ledgerStatusFilter = 'all';
let ledgerSearchQuery = '';
let ledgerRepFilter = '';
let selectedCreditId = null;

// Chart Instances
let agingChartInstance = null;
let trendChartInstance = null;

// Anchor Date Mock (June 24, 2026)
const MOCK_TODAY = new Date('2026-06-24');

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// Primary Initializer
async function initApp() {
  bindAuthentication();
  bindNavigation();
  bindLedgerControls();
  bindSmartForm();
  bindDiagnostics();
  bindDrawer();

  // Automatic authentication bypass to grant full Admin access to everyone
  if (!token || !currentUser) {
    token = 'mock-jwt-token-for-user-id-1-role-admin';
    currentUser = { id: 1, email: 'admin@gmail.com', name: 'Sahitya Reddy', role: 'admin' };
    localStorage.setItem('mediwave_token', token);
    localStorage.setItem('mediwave_user', JSON.stringify(currentUser));
  }

  try {
    // Validate session via healthcheck or simple fetch
    await loadInitialData();
    showLayout();
  } catch (err) {
    console.warn("Session expired or server unavailable. Redirecting to login gate.");
    logout();
  }
}

// ==========================================================================
// API REQUEST HELPER WITH RBAC HEADERS
// ==========================================================================
async function apiCall(endpoint, options = {}) {
  const url = `https://mediwave-pharmacy-credit-tracker.onrender.com${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  const data = await response.json();

  if (!response.ok) {
    throw {
      success: false,
      message: data.message || `API Error: ${response.status}`,
      code: response.status
    };
  }

  return data;
}

// Load static/dynamic data from API
async function loadInitialData() {
  try {
    // 1. Fetch system configs
    const config = await apiCall('/api/config');
    systemRules = config;

    // 2. Fetch Telangana vendors
    vendors = await apiCall('/api/vendors');
    populateVendorDropdown();

    // 3. Fetch credits
    await refreshCreditsList();

    // 4. If admin, fetch activity audits & user rep list
    if (currentUser.role === 'admin') {
      audits = await apiCall('/api/audit');
      await populateRepsDropdown();
    }
  } catch (err) {
    console.error("Failed to load initial workspace data:", err);
    throw err;
  }
}

async function refreshCreditsList() {
  credits = await apiCall('/api/credits');
}

// ==========================================================================
// SESSION AUTHENTICATION CONTROLLER
// ==========================================================================
function bindAuthentication() {
  const loginForm = document.getElementById('login-form');
  const loginErrorBox = document.getElementById('login-error');
  const loginErrorText = document.getElementById('login-error-text');
  
  const signupForm = document.getElementById('signup-form');
  const signupErrorBox = document.getElementById('signup-error');
  const tipToggle = document.getElementById('seed-tip-toggle');
  const seedDetails = document.getElementById('seed-details');

  // Form toggles
  document.getElementById('auth-switch-btn').addEventListener('click', () => {
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    loginErrorBox.style.display = 'none';
    signupErrorBox.style.display = 'none';
  });

  document.getElementById('auth-switch-back-btn').addEventListener('click', () => {
    signupForm.style.display = 'none';
    loginForm.style.display = 'block';
    loginErrorBox.style.display = 'none';
    signupErrorBox.style.display = 'none';
  });

  // Credentials seeding drawer toggle
  tipToggle.addEventListener('click', () => {
    seedDetails.style.display = seedDetails.style.display === 'none' ? 'block' : 'none';
  });

  // Login handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorBox.style.display = 'none';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const response = await apiCall('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      // Save session credentials
      token = response.token;
      currentUser = response.user;
      localStorage.setItem('mediwave_token', token);
      localStorage.setItem('mediwave_user', JSON.stringify(currentUser));

      loginForm.reset();
      
      // Load tables, metrics & render charts
      await loadInitialData();
      showLayout();
    } catch (err) {
      loginErrorText.textContent = "Wrong credentials. Please check your email and password.";
      loginErrorBox.style.display = 'flex';
    }
  });

  // Sign up handler
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupErrorBox.style.display = 'none';

    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    try {
      const response = await apiCall('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });

      // Success feedback
      signupErrorBox.style.background = 'var(--success-bg)';
      signupErrorBox.style.borderColor = 'var(--success-border)';
      signupErrorBox.style.color = '#86efac';
      signupErrorBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> Registration successful! You can now log in.`;
      signupErrorBox.style.display = 'flex';

      signupForm.reset();

      // Automatically switch back to login form after 2 seconds
      setTimeout(() => {
        signupForm.style.display = 'none';
        loginForm.style.display = 'block';
        signupErrorBox.style.display = 'none';
      }, 2000);

    } catch (err) {
      signupErrorBox.style.background = 'var(--danger-bg)';
      signupErrorBox.style.borderColor = 'var(--danger-border)';
      signupErrorBox.style.color = '#fca5a5';
      signupErrorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message || "Registration failed."}`;
      signupErrorBox.style.display = 'flex';
    }
  });

  // Logout binder
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
  });
}

function logout() {
  localStorage.removeItem('mediwave_token');
  localStorage.removeItem('mediwave_user');
  // Auto-reload to immediately re-authenticate with default credentials
  window.location.reload();
}

function showLayout() {
  document.getElementById('login-gate').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  // Apply visual RBAC sidebar items
  const sidebar = document.getElementById('sidebar');
  if (currentUser.role === 'admin') {
    sidebar.classList.add('rbac-admin');
    sidebar.classList.remove('rbac-user');
    
    // Unhide admin links
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    document.querySelectorAll('.user-only').forEach(el => el.style.display = 'none');
    
    document.getElementById('workspace-badge-text').textContent = 'Administrator Portal';
    document.getElementById('workspace-badge').className = 'active-badge admin-badge';
    
    switchView('admin-dashboard');
  } else {
    sidebar.classList.add('rbac-user');
    sidebar.classList.remove('rbac-admin');
    
    // Hide admin links
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.user-only').forEach(el => el.style.display = '');
    
    document.getElementById('workspace-badge-text').textContent = 'Field Representative';
    document.getElementById('workspace-badge').className = 'active-badge user-badge';
    
    switchView('user-workspace');
  }

  // Update profile badges
  document.getElementById('sidebar-user-name').textContent = currentUser.name;
  document.getElementById('sidebar-user-role').textContent = currentUser.role === 'admin' ? 'System Controller' : 'Field Accounts Officer';
  document.getElementById('sidebar-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
}

// ==========================================================================
// SPA NAVIGATION ROUTER & SECURITY GUARD
// ==========================================================================
function bindNavigation() {
  const menuItems = document.querySelectorAll('.sidebar-item');
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-view');
      switchView(target);
    });
  });

  // Mobile drawer toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.style.left === '0px') {
      sidebar.style.left = '-260px';
    } else {
      sidebar.style.left = '0px';
    }
  });

  // Safe return buttons on 403 page
  document.getElementById('btn-forbidden-return').addEventListener('click', () => {
    if (currentUser.role === 'admin') {
      switchView('admin-dashboard');
    } else {
      switchView('user-workspace');
    }
  });
}

function switchView(viewName) {
  // --- SECURITY GUARD LOGIC ---
  if (currentUser.role !== 'admin' && (viewName === 'admin-dashboard' || viewName === 'admin-settings')) {
    // Non-admin attempting to view management boards -> Trigger 403
    document.getElementById('forbidden-user-role').textContent = currentUser.role.toUpperCase();
    viewName = 'forbidden';
  }

  activeView = viewName;

  // Sync sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch panels
  document.querySelectorAll('.view').forEach(panel => {
    if (panel.id === `${viewName}-view`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  // Header Titles Mapping
  const titleMapping = {
    'admin-dashboard': 'Global Operations Center',
    'user-workspace': 'Field Collection Desk',
    'credits-ledger': 'Credits Outstanding Registry',
    'admin-settings': 'Global Billing Engine Configuration',
    'forbidden': 'Security Exception'
  };

  document.getElementById('current-view-title').textContent = titleMapping[viewName] || 'Workspace';
  document.getElementById('breadcrumb-current').textContent = viewName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // View specific loaders
  if (viewName === 'admin-dashboard') {
    renderAdminDashboard();
  } else if (viewName === 'credits-ledger') {
    renderLedgerRegistry();
  } else if (viewName === 'admin-settings') {
    populateAdminSettingsForm();
  } else if (viewName === 'user-workspace') {
    resetSmartForm();
  }
}

// ==========================================================================
// CONTROLLER DESK (ADMIN VIEW) OPERATIONS
// ==========================================================================
function renderAdminDashboard() {
  // Update Metrics
  let totalCredit = 0;
  let overdueCredit = 0;
  let overdueCount = 0;
  let escalatedCredit = 0;
  let escalatedCount = 0;
  let totalPayments = 0;

  credits.forEach(c => {
    const outstanding = c.amount_due - (c.amount_recovered || 0);
    totalCredit += c.amount_due;
    totalPayments += (c.amount_recovered || 0);

    if (c.status === 'Active') {
      const days = parseInt(c.days_overdue) || 0;
      if (days > 0) {
        overdueCredit += outstanding;
        overdueCount++;
      }
      if (c.escalation_flag === 1) {
        escalatedCredit += outstanding;
        escalatedCount++;
      }
    }
  });

  document.getElementById('stat-total-credit').textContent = formatCurrency(totalCredit);
  document.getElementById('stat-overdue-credit').textContent = formatCurrency(overdueCredit);
  document.getElementById('stat-overdue-count').textContent = `${overdueCount} accounts overdue`;
  
  document.getElementById('stat-escalated-credit').textContent = formatCurrency(escalatedCredit);
  document.getElementById('stat-escalated-count').textContent = `${escalatedCount} cases escalated`;

  // Recovery conversion velocity
  const recoveryRate = totalCredit > 0 ? ((totalPayments / totalCredit) * 100).toFixed(1) : '0.0';
  document.getElementById('stat-recovery-rate').textContent = `${recoveryRate}%`;

  // Draw Intelligence Charts
  renderAgingBucketsChart();
  renderTrendChart();

  // Draw activity audits
  renderActivityStream();
}

function renderAgingBucketsChart() {
  const agingCtx = document.getElementById('adminAgingChart').getContext('2d');
  
  // Calculate buckets
  let bucket1 = 0; // 0-30 days
  let bucket2 = 0; // 31-60 days
  let bucket3 = 0; // 61-90 days
  let bucket4 = 0; // 90+ days

  credits.forEach(c => {
    if (c.status !== 'Active') return;
    const days = parseInt(c.days_overdue) || 0;
    const outstanding = c.amount_due - (c.amount_recovered || 0);

    if (days > 0 && days <= 30) bucket1 += outstanding;
    else if (days > 30 && days <= 60) bucket2 += outstanding;
    else if (days > 60 && days <= 90) bucket3 += outstanding;
    else if (days > 90) bucket4 += outstanding;
  });

  if (agingChartInstance) {
    agingChartInstance.destroy();
  }

  agingChartInstance = new Chart(agingCtx, {
    type: 'bar',
    data: {
      labels: ['0-30 Days', '31-60 Days', '61-90 Days', '90+ Days'],
      datasets: [{
        label: 'Outstanding Exposure (INR)',
        data: [bucket1, bucket2, bucket3, bucket4],
        backgroundColor: [
          'rgba(20, 184, 166, 0.45)', // primary (teal)
          'rgba(245, 158, 11, 0.45)', // warning (amber)
          'rgba(239, 68, 68, 0.45)',  // danger (red)
          'rgba(239, 68, 68, 0.8)'    // deep danger (red)
        ],
        borderColor: [
          '#14b8a6',
          '#f59e0b',
          '#ef4444',
          '#b91c1c'
        ],
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 11, weight: '500' } }
        }
      }
    }
  });
}

function renderTrendChart() {
  const trendCtx = document.getElementById('adminTrendChart').getContext('2d');

  // Trend analysis mapping payments from last 30 days
  // Since we pre-seed static entries, let's create a visual mock line of daily payment entries
  const dailyRecoveries = {};
  const today = new Date(MOCK_TODAY);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dailyRecoveries[key] = 0;
  }

  credits.forEach(c => {
    if (c.payments && Array.isArray(c.payments)) {
      c.payments.forEach(p => {
        const key = p.payment_date;
        if (dailyRecoveries[key] !== undefined) {
          dailyRecoveries[key] += p.amount_paid;
        }
      });
    }
  });

  const labels = Object.keys(dailyRecoveries).map(k => {
    const date = new Date(k);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });
  const data = Object.values(dailyRecoveries);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Funds Recovered (₹)',
        data: data,
        fill: true,
        backgroundColor: 'rgba(20, 184, 166, 0.05)',
        borderColor: '#14b8a6',
        borderWidth: 2,
        tension: 0.3,
        pointBackgroundColor: '#14b8a6',
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 9 }, maxTicksLimit: 7 }
        }
      }
    }
  });
}

function renderActivityStream() {
  const stream = document.getElementById('admin-activity-stream');
  stream.innerHTML = '';

  if (audits.length === 0) {
    stream.innerHTML = `
      <div style="text-align:center; padding:24px; color:var(--text-muted);">
        <i class="fa-solid fa-list-check" style="font-size:20px; margin-bottom:8px;"></i>
        <p style="font-size:11px;">Activity log is currently empty.</p>
      </div>
    `;
    return;
  }

  audits.slice(0, 15).forEach(a => {
    const div = document.createElement('div');
    div.className = 'alert-item alert-info';
    
    // Choose theme based on keywords
    if (a.message.toLowerCase().includes('limit') || a.message.toLowerCase().includes('error') || a.message.toLowerCase().includes('exception')) {
      div.className = 'alert-item alert-danger';
    } else if (a.message.toLowerCase().includes('payment') || a.message.toLowerCase().includes('cleared')) {
      div.className = 'alert-item alert-success';
    } else if (a.message.toLowerCase().includes('rule') || a.message.toLowerCase().includes('config')) {
      div.className = 'alert-item alert-warning';
    }

    const t = new Date(a.time);
    const stamp = t.toLocaleDateString('en-IN') + ' ' + t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div class="alert-item-icon">
        <i class="${div.className.includes('success') ? 'fa-solid fa-receipt' : div.className.includes('danger') ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info'}"></i>
      </div>
      <div class="alert-item-content">
        <p style="margin-bottom:2px; font-weight:500;">${a.message}</p>
        <div class="alert-item-time"><i class="fa-regular fa-clock"></i> ${stamp}</div>
      </div>
    `;

    stream.appendChild(div);
  });
}

// ==========================================================================
// REGISTRY LEDGER CONTROLS (SHARED/GUARDED VIEW)
// ==========================================================================
function bindLedgerControls() {
  const tabs = document.querySelectorAll('#ledger-status-tabs .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      ledgerStatusFilter = tab.getAttribute('data-filter');
      ledgerCurrentPage = 1;
      renderLedgerRegistry();
    });
  });

  document.getElementById('ledger-search-bar').addEventListener('input', (e) => {
    ledgerSearchQuery = e.target.value;
    ledgerCurrentPage = 1;
    renderLedgerRegistry();
  });

  document.getElementById('filter-rep-id').addEventListener('change', (e) => {
    ledgerRepFilter = e.target.value;
    ledgerCurrentPage = 1;
    renderLedgerRegistry();
  });

  document.getElementById('ledger-prev').addEventListener('click', () => {
    if (ledgerCurrentPage > 1) {
      ledgerCurrentPage--;
      renderLedgerRegistry();
    }
  });

  document.getElementById('ledger-next').addEventListener('click', () => {
    ledgerCurrentPage++;
    renderLedgerRegistry();
  });

  // Export buttons
  document.getElementById('btn-export-ledger').addEventListener('click', exportLedgerCsv);
  document.getElementById('btn-admin-export-csv').addEventListener('click', exportLedgerCsv);
}

function renderLedgerRegistry() {
  const tbody = document.getElementById('ledger-table-body');
  const emptyBox = document.getElementById('ledger-empty-state');
  
  tbody.innerHTML = '';

  // Determine filters and visual boundaries
  // Non-admins only see credits assigned to them or created by them!
  let filtered = credits.filter(c => {
    // 1. RBAC Guard: If user is standard representative, filter only their assigned records!
    if (currentUser.role !== 'admin') {
      if (c.assigned_to_user_id !== currentUser.id) {
        return false;
      }
    }

    // 2. Status Filter
    if (ledgerStatusFilter === 'active' && c.status !== 'Active') return false;
    if (ledgerStatusFilter === 'completed' && c.status !== 'Completed') return false;
    if (ledgerStatusFilter === 'archived' && c.status !== 'Archived') return false;
    
    if (ledgerStatusFilter === 'overdue') {
      const days = parseInt(c.days_overdue) || 0;
      if (days <= 0 || c.status !== 'Active') return false;
    }

    // 3. Representative dropdown filter (Admin only)
    if (currentUser.role === 'admin' && ledgerRepFilter) {
      if (c.assigned_to_user_id !== parseInt(ledgerRepFilter)) {
        return false;
      }
    }

    // 4. Search text filter
    if (ledgerSearchQuery) {
      const query = ledgerSearchQuery.toLowerCase();
      const vendorName = c.vendor ? c.vendor.name.toLowerCase() : '';
      const invoiceNo = c.invoice_number.toLowerCase();
      return vendorName.includes(query) || invoiceNo.includes(query);
    }

    return true;
  });

  // Sorting: Overdue & escalated items first, then newer items
  filtered.sort((a, b) => {
    if (a.escalation_flag !== b.escalation_flag) return b.escalation_flag - a.escalation_flag;
    const daysA = parseInt(a.days_overdue) || 0;
    const daysB = parseInt(b.days_overdue) || 0;
    if (daysA !== daysB) return daysB - daysA;
    return b.id - a.id;
  });

  const total = filtered.length;
  const pagesCount = Math.ceil(total / ledgerItemsPerPage) || 1;
  if (ledgerCurrentPage > pagesCount) ledgerCurrentPage = pagesCount;

  const startIdx = (ledgerCurrentPage - 1) * ledgerItemsPerPage;
  const endIdx = Math.min(startIdx + ledgerItemsPerPage, total);
  const items = filtered.slice(startIdx, endIdx);

  // Pagination updates
  document.getElementById('ledger-pagination-info').textContent = 
    total > 0 ? `Showing ${startIdx + 1} to ${endIdx} of ${total} records` : 'Showing 0 to 0 of 0 records';

  document.getElementById('ledger-prev').disabled = ledgerCurrentPage === 1;
  document.getElementById('ledger-next').disabled = ledgerCurrentPage === pagesCount;

  if (total === 0) {
    emptyBox.style.display = 'flex';
    document.getElementById('ledger-table').style.display = 'none';
    return;
  }

  emptyBox.style.display = 'none';
  document.getElementById('ledger-table').style.display = 'table';

  items.forEach(c => {
    const tr = document.createElement('tr');
    
    // Vendor cell
    const vendorCell = `
      <div style="font-weight: 600; color:var(--text-primary); font-size: 13.5px;">${c.vendor ? c.vendor.name : 'Unknown Vendor'}</div>
      <div style="font-size: 11px; color: var(--text-muted);">${c.vendor ? `${c.vendor.city}, TS` : ''}</div>
    `;

    // Days Overdue style
    const days = parseInt(c.days_overdue) || 0;
    let daysStyle = 'color: var(--text-secondary);';
    if (days > 0) {
      daysStyle = 'color: var(--danger); font-weight: 700;';
    }

    // Badge styling
    let badgeClass = 'active';
    if (c.status === 'Completed') badgeClass = 'completed';
    if (c.status === 'Archived') badgeClass = 'archived';
    if (c.status === 'Active' && c.escalation_flag === 1) badgeClass = 'escalated';

    const statusBadge = `<span class="badge ${badgeClass}">${c.status === 'Active' && c.escalation_flag === 1 ? 'Escalated' : c.status}</span>`;
    const escBadge = `<span class="escalation-flag ${c.escalation_flag === 1 ? 'yes' : 'no'}">${c.escalation_flag === 1 ? 'YES' : 'NO'}</span>`;

    const outstanding = c.amount_due - (c.amount_recovered || 0);

    tr.innerHTML = `
      <td>${vendorCell}</td>
      <td style="font-family: var(--font-display); font-weight: 500;">${c.invoice_number}</td>
      <td>${formatDate(c.invoice_date)}</td>
      <td>${formatDate(c.due_date)}</td>
      <td><span style="${daysStyle}">${days > 0 ? `${days} Days` : '0 Days'}</span></td>
      <td><span style="font-size: 12px; font-weight: 500;">${c.assigned_rep_name || 'Unassigned'}</span></td>
      <td>${escBadge}</td>
      <td>${statusBadge}</td>
      <td style="font-weight:700; color:var(--primary); text-align:right; font-family: var(--font-display);">₹${outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td style="text-align: right;">
        <button class="btn btn-secondary btn-sm" onclick="openCreditDrawer(${c.id})"><i class="fa-solid fa-folder-open"></i> Open</button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

// Custom Date Formatter
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
}

// CSV Exporter
function exportLedgerCsv() {
  let csv = 'Invoice Number,Vendor Name,City,Invoice Date,Due Date,Amount Due,Amount Recovered,Days Overdue,Escalation Flag,Assigned Rep,Status\n';

  credits.forEach(c => {
    // Apply scope filter if user is not admin
    if (currentUser.role !== 'admin' && c.assigned_to_user_id !== currentUser.id) {
      return;
    }

    const row = [
      c.invoice_number,
      `"${c.vendor ? c.vendor.name.replace(/"/g, '""') : 'Unknown'}"`,
      c.vendor ? c.vendor.city : 'Unknown',
      c.invoice_date,
      c.due_date,
      c.amount_due,
      c.amount_recovered || 0,
      c.days_overdue,
      c.escalation_flag === 1 ? 'YES' : 'NO',
      c.assigned_rep_name || 'Unassigned',
      c.status
    ].join(',');
    csv += row + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `Mediwave_Pharmacy_Ledger_Export_${MOCK_TODAY.toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================================================
// FIELD WORKSPACE - SMART DATA ENTRY FORM (USER VIEW)
// ==========================================================================
function bindSmartForm() {
  const form = document.getElementById('user-credit-form');
  const vendorSelect = document.getElementById('field-vendor-id');
  const invoiceInput = document.getElementById('field-invoice-no');
  const dateInput = document.getElementById('field-invoice-date');
  const dueInput = document.getElementById('field-due-date');
  const amountInput = document.getElementById('field-amount-due');

  // Input triggers for validation indicator boxes
  vendorSelect.addEventListener('change', validateFormRealTime);
  invoiceInput.addEventListener('input', validateFormRealTime);
  dateInput.addEventListener('change', validateFormRealTime);
  dueInput.addEventListener('change', validateFormRealTime);
  amountInput.addEventListener('input', validateFormRealTime);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateFormRealTime(true)) return;

    const payload = {
      vendor_id: parseInt(vendorSelect.value),
      invoice_number: invoiceInput.value.trim(),
      invoice_date: dateInput.value,
      due_date: dueInput.value,
      amount_due: parseFloat(amountInput.value)
    };

    try {
      await apiCall('/api/credits', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // Show floating validation summary success state
      const summaryBox = document.getElementById('validation-summary-box');
      summaryBox.className = 'validation-status-box ready';
      summaryBox.innerHTML = `
        <div class="status-title"><i class="fa-solid fa-circle-check"></i> Registered Successfully!</div>
        <p>Outstanding credit logged under your representative ID.</p>
      `;

      form.reset();
      resetSmartForm();

      // Refresh credits list
      await refreshCreditsList();
      
      // Delay navigation back to ledger view for 1.5s
      setTimeout(() => {
        switchView('credits-ledger');
      }, 1200);

    } catch (err) {
      alert(`API Error logging credit: ${err.message}`);
    }
  });
}

function validateFormRealTime(isSubmit = false) {
  const vendorSelect = document.getElementById('field-vendor-id');
  const invoiceInput = document.getElementById('field-invoice-no');
  const dateInput = document.getElementById('field-invoice-date');
  const dueInput = document.getElementById('field-due-date');
  const amountInput = document.getElementById('field-amount-due');

  const ruleVendor = document.getElementById('guard-rule-vendor');
  const ruleInvoice = document.getElementById('guard-rule-invoice');
  const ruleDates = document.getElementById('guard-rule-dates');
  const ruleAmount = document.getElementById('guard-rule-amount');
  const summaryBox = document.getElementById('validation-summary-box');

  // Input Errors Mapping
  let passVendor = false;
  let passInvoice = false;
  let passDates = false;
  let passAmount = false;

  // 1. Vendor check
  if (vendorSelect.value) {
    passVendor = true;
    ruleVendor.className = 'guard-rule pass';
    ruleVendor.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    document.getElementById('err-vendor').style.display = 'none';
    vendorSelect.classList.remove('input-error');
  } else {
    ruleVendor.className = 'guard-rule fail';
    ruleVendor.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    if (isSubmit) {
      document.getElementById('err-vendor').textContent = 'Please choose a valid pharmacy vendor.';
      document.getElementById('err-vendor').style.display = 'block';
      vendorSelect.classList.add('input-error');
    }
  }

  // 2. Invoice Check (follow sequence pattern e.g., INV-YEAR-SERIAL)
  const invPattern = /^[a-zA-Z0-9\-]{4,20}$/;
  if (invPattern.test(invoiceInput.value.trim())) {
    passInvoice = true;
    ruleInvoice.className = 'guard-rule pass';
    ruleInvoice.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    document.getElementById('err-invoice-no').style.display = 'none';
    invoiceInput.classList.remove('input-error');
  } else {
    ruleInvoice.className = 'guard-rule fail';
    ruleInvoice.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    if (isSubmit || invoiceInput.value.length > 0) {
      document.getElementById('err-invoice-no').textContent = 'Invoice number must be alphanumeric (4-20 chars).';
      document.getElementById('err-invoice-no').style.display = 'block';
      invoiceInput.classList.add('input-error');
    }
  }

  // 3. Due Date bounds check
  if (dateInput.value && dueInput.value) {
    const start = new Date(dateInput.value);
    const due = new Date(dueInput.value);
    if (due >= start) {
      passDates = true;
      ruleDates.className = 'guard-rule pass';
      ruleDates.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      document.getElementById('err-due-date').style.display = 'none';
      dueInput.classList.remove('input-error');
    } else {
      ruleDates.className = 'guard-rule fail';
      ruleDates.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
      document.getElementById('err-due-date').textContent = 'Due date must occur on or after invoice issuance date.';
      document.getElementById('err-due-date').style.display = 'block';
      dueInput.classList.add('input-error');
    }
  } else {
    ruleDates.className = 'guard-rule';
    ruleDates.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-question"></i>';
    if (isSubmit) {
      dueInput.classList.add('input-error');
      document.getElementById('err-due-date').textContent = 'Please fill out both invoice and due dates.';
      document.getElementById('err-due-date').style.display = 'block';
    }
  }

  // 4. Principal Amount Cap check
  const amt = parseFloat(amountInput.value) || 0;
  if (amt > 0 && amt <= systemRules.creditLimit) {
    passAmount = true;
    ruleAmount.className = 'guard-rule pass';
    ruleAmount.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    document.getElementById('err-amount-due').style.display = 'none';
    amountInput.classList.remove('input-error');
  } else {
    ruleAmount.className = 'guard-rule fail';
    ruleAmount.querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    if (amt > systemRules.creditLimit) {
      document.getElementById('err-amount-due').textContent = `Single credit cap exception: Max allowed is ₹${systemRules.creditLimit.toLocaleString()}`;
      document.getElementById('err-amount-due').style.display = 'block';
      amountInput.classList.add('input-error');
    } else if (isSubmit || amountInput.value.length > 0) {
      document.getElementById('err-amount-due').textContent = 'Invoice amount must be greater than zero.';
      document.getElementById('err-amount-due').style.display = 'block';
      amountInput.classList.add('input-error');
    }
  }

  // Validation Summary Updates
  const allPass = passVendor && passInvoice && passDates && passAmount;
  if (allPass) {
    summaryBox.className = 'validation-status-box ready';
    summaryBox.innerHTML = `
      <div class="status-title"><i class="fa-solid fa-circle-check"></i> Form Verification Clean</div>
      <p>All inputs pass local business rules checks. Ready for server submission.</p>
    `;
  } else {
    summaryBox.className = 'validation-status-box error';
    summaryBox.innerHTML = `
      <div class="status-title"><i class="fa-solid fa-circle-xmark"></i> Constraints Unmet</div>
      <p>Please resolve the validation alerts marked on form fields to submit invoice registration.</p>
    `;
  }

  return allPass;
}

function resetSmartForm() {
  document.getElementById('user-credit-form').reset();
  
  // Set default dates
  const todayStr = MOCK_TODAY.toISOString().split('T')[0];
  document.getElementById('field-invoice-date').value = todayStr;
  
  const dueDefault = new Date(MOCK_TODAY);
  dueDefault.setDate(dueDefault.getDate() + 15);
  document.getElementById('field-due-date').value = dueDefault.toISOString().split('T')[0];

  // Reset rule indicators
  document.getElementById('guard-rule-vendor').className = 'guard-rule';
  document.getElementById('guard-rule-vendor').querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-question"></i>';
  document.getElementById('guard-rule-invoice').className = 'guard-rule';
  document.getElementById('guard-rule-invoice').querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-question"></i>';
  document.getElementById('guard-rule-dates').className = 'guard-rule';
  document.getElementById('guard-rule-dates').querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-question"></i>';
  document.getElementById('guard-rule-amount').className = 'guard-rule';
  document.getElementById('guard-rule-amount').querySelector('.status-icon').innerHTML = '<i class="fa-solid fa-circle-question"></i>';

  const summaryBox = document.getElementById('validation-summary-box');
  summaryBox.className = 'validation-status-box';
  summaryBox.innerHTML = `
    <div class="status-title">Status: Awaiting input</div>
    <p>Ensure all asterisks marked fields are populated to compile credentials.</p>
  `;

  // Hide inline error logs
  document.getElementById('err-vendor').style.display = 'none';
  document.getElementById('err-invoice-no').style.display = 'none';
  document.getElementById('err-invoice-date').style.display = 'none';
  document.getElementById('err-due-date').style.display = 'none';
  document.getElementById('err-amount-due').style.display = 'none';

  document.querySelectorAll('.input-control').forEach(el => el.classList.remove('input-error'));
}

function populateVendorDropdown() {
  const select = document.getElementById('field-vendor-id');
  select.innerHTML = '<option value="">Select Vendor...</option>';
  vendors.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.city})`;
    select.appendChild(opt);
  });
}

async function populateRepsDropdown() {
  const select = document.getElementById('filter-rep-id');
  if (!select) return;
  select.innerHTML = '<option value="">All Representatives</option>';
  
  try {
    const reps = await apiCall('/api/users?role=user');
    reps.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      select.appendChild(opt);
    });
    // Make filter dropdown visible for admin
    document.querySelectorAll('.filter-dropdown.admin-only').forEach(el => el.style.display = '');
  } catch (err) {
    console.error("Failed to load representatives list:", err);
  }
}

// ==========================================================================
// DETAILS DRAWER & TRANSACTION SETTLEMENT
// ==========================================================================
function bindDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  const closeBtn = document.getElementById('btn-drawer-close');
  const printBtn = document.getElementById('btn-drawer-print');
  const editBtn = document.getElementById('btn-drawer-edit');
  const archiveBtn = document.getElementById('btn-drawer-archive');
  const paymentForm = document.getElementById('drawer-log-payment-form');

  closeBtn.addEventListener('click', closeCreditDrawer);
  backdrop.addEventListener('click', closeCreditDrawer);

  printBtn.addEventListener('click', () => {
    window.print();
  });

  // Archive invoice record (Admin only)
  archiveBtn.addEventListener('click', async () => {
    if (!selectedCreditId) return;
    if (confirm("Confirm moving this completed credit file to archived ledgers?")) {
      try {
        await apiCall(`/api/credits/${selectedCreditId}/archive`, { method: 'PATCH' });
        closeCreditDrawer();
        await refreshCreditsList();
        renderLedgerRegistry();
      } catch (err) {
        alert(`Failed to archive credit file: ${err.message}`);
      }
    }
  });

  // Handle edit details (Admin only - launches prompt/modal overrides)
  editBtn.addEventListener('click', async () => {
    if (!selectedCreditId) return;
    const c = credits.find(item => item.id === selectedCreditId);
    if (!c) return;

    const newAmount = prompt(`Override Invoice Amount (Current: ₹${c.amount_due})`, c.amount_due);
    if (newAmount === null) return;
    const amt = parseFloat(newAmount);
    if (isNaN(amt) || amt <= 0 || amt > systemRules.creditLimit) {
      alert(`Invalid amount. Must be between 0 and ₹${systemRules.creditLimit}`);
      return;
    }

    const newStatus = prompt("Override Status (Active / Completed / Archived)", c.status);
    if (newStatus === null) return;
    if (!['Active', 'Completed', 'Archived'].includes(newStatus)) {
      alert("Invalid status tag. Use Capitalized: Active, Completed, or Archived.");
      return;
    }

    try {
      await apiCall(`/api/credits/${selectedCreditId}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount_due: amt,
          status: newStatus
        })
      });
      await refreshCreditsList();
      openCreditDrawer(selectedCreditId);
      renderLedgerRegistry();
    } catch (err) {
      alert(`Override failed: ${err.message}`);
    }
  });

  // Payment registration inside drawer
  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const amtInput = document.getElementById('drawer-pay-amount');
    const dateInput = document.getElementById('drawer-pay-date');
    const methodSelect = document.getElementById('drawer-pay-method');
    const errText = document.getElementById('err-drawer-pay-amount');

    const amt = parseFloat(amtInput.value) || 0;
    const c = credits.find(item => item.id === selectedCreditId);
    if (!c) return;

    const outstanding = c.amount_due - (c.amount_recovered || 0);

    errText.style.display = 'none';
    amtInput.classList.remove('input-error');

    if (amt <= 0 || amt > outstanding) {
      amtInput.classList.add('input-error');
      errText.textContent = `Amount cannot exceed outstanding ledger: ₹${outstanding.toLocaleString()}`;
      errText.style.display = 'block';
      return;
    }

    try {
      await apiCall(`/api/credits/${selectedCreditId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount_paid: amt,
          payment_date: dateInput.value,
          payment_method: methodSelect.value
        })
      });

      paymentForm.reset();
      
      // Sync list
      await refreshCreditsList();

      // Refresh drawer info
      openCreditDrawer(selectedCreditId);
      renderLedgerRegistry();
    } catch (err) {
      alert(`Failed to register payment: ${err.message}`);
    }
  });
}

function openCreditDrawer(id) {
  selectedCreditId = id;
  const c = credits.find(item => item.id === id);
  if (!c) return;

  const backdrop = document.getElementById('drawer-backdrop');
  const drawer = document.getElementById('invoice-detail-drawer');

  // Fill in drawer text nodes
  document.getElementById('drawer-vendor-name').textContent = c.vendor ? c.vendor.name : 'Unknown';
  document.getElementById('drawer-invoice-sub').textContent = `Invoice Serial: #${c.invoice_number} | Assigned: ${c.assigned_rep_name || 'Unassigned'}`;
  
  // Set badge values
  const outstanding = c.amount_due - (c.amount_recovered || 0);
  let badgeClass = 'active';
  if (c.status === 'Completed') badgeClass = 'completed';
  if (c.status === 'Archived') badgeClass = 'archived';
  if (c.status === 'Active' && c.escalation_flag === 1) badgeClass = 'escalated';

  const statusBadge = document.getElementById('drawer-status-badge');
  statusBadge.className = `badge ${badgeClass}`;
  statusBadge.textContent = c.status === 'Active' && c.escalation_flag === 1 ? 'Escalated' : c.status;

  const escBadge = document.getElementById('drawer-escalation-badge');
  if (c.escalation_flag === 1) {
    escBadge.style.display = 'inline-flex';
    escBadge.textContent = 'ESCALATED CASE';
  } else {
    escBadge.style.display = 'none';
  }

  // Fill cells
  document.getElementById('drawer-invoice-date').textContent = formatDate(c.invoice_date);
  document.getElementById('drawer-due-date').textContent = formatDate(c.due_date);
  document.getElementById('drawer-overdue-days').textContent = c.days_overdue > 0 ? `${c.days_overdue} Days` : '0 Days';
  document.getElementById('drawer-assigned-user').textContent = c.assigned_rep_name || 'Unassigned';

  // Fill balance strip
  document.getElementById('drawer-total-amount').textContent = formatCurrency(c.amount_due);
  document.getElementById('drawer-recovered-amount').textContent = formatCurrency(c.amount_recovered || 0);
  document.getElementById('drawer-outstanding-amount').textContent = formatCurrency(outstanding);

  // Archive buttons settings
  const archiveBtn = document.getElementById('btn-drawer-archive');
  if (currentUser.role === 'admin' && c.status === 'Completed') {
    archiveBtn.style.display = 'inline-flex';
  } else {
    archiveBtn.style.display = 'none';
  }

  // Payment form visibility (Only active invoices, staff/admin role permission check)
  const payArea = document.getElementById('drawer-payment-input-area');
  if (c.status === 'Active') {
    payArea.style.display = 'block';
    // Set default payment date to Mock Today
    document.getElementById('drawer-pay-date').value = MOCK_TODAY.toISOString().split('T')[0];
  } else {
    payArea.style.display = 'none';
  }

  // Payments log
  const pList = document.getElementById('drawer-payment-history-list');
  pList.innerHTML = '';
  if (c.payments && c.payments.length > 0) {
    c.payments.forEach(p => {
      const row = document.createElement('div');
      row.className = 'payment-log-row';
      row.innerHTML = `
        <div class="info-col">
          <strong>${p.payment_method || 'Deposit'}</strong>
          <span>Logged: ${formatDate(p.payment_date)}</span>
        </div>
        <div class="val-col">+ ₹${p.amount_paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      `;
      pList.appendChild(row);
    });
  } else {
    pList.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:8px;">No collection logs found.</div>';
  }

  // Audit Logs details
  const aList = document.getElementById('drawer-audit-logs-list');
  aList.innerHTML = '';
  if (c.audits && c.audits.length > 0) {
    c.audits.forEach(aud => {
      const row = document.createElement('div');
      row.className = 'audit-log-row';
      const t = new Date(aud.time);
      row.innerHTML = `
        <p>${aud.message}</p>
        <span>${t.toLocaleDateString('en-IN')} ${t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      `;
      aList.appendChild(row);
    });
  } else {
    aList.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:8px;">No event traces logged.</div>';
  }

  // Show drawer UI
  backdrop.style.display = 'block';
  setTimeout(() => {
    backdrop.style.opacity = '1';
    drawer.style.right = '0';
  }, 20);
}

function closeCreditDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  const drawer = document.getElementById('invoice-detail-drawer');

  backdrop.style.opacity = '0';
  drawer.style.right = '-550px';
  setTimeout(() => {
    backdrop.style.display = 'none';
  }, 300);
  selectedCreditId = null;
}

// ==========================================================================
// SYSTEM RULES CONFIGURATION & DIAGNOSTICS (ADMIN SETTINGS)
// ==========================================================================
function populateAdminSettingsForm() {
  document.getElementById('rule-escalation-days').value = systemRules.escalationDays;
  document.getElementById('rule-credit-limit').value = systemRules.creditLimit;
  document.getElementById('rule-archive-days').value = systemRules.archiveDays;

  // Populate Admin profile fields
  if (currentUser) {
    document.getElementById('admin-profile-name').value = currentUser.name || '';
    document.getElementById('admin-profile-email').value = currentUser.email || '';
    document.getElementById('admin-profile-password').value = '';
  }
}

function bindDiagnostics() {
  // Profile update form submit
  const profileForm = document.getElementById('admin-profile-form');
  const profileStatus = document.getElementById('admin-profile-status');

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    profileStatus.style.display = 'none';
    profileStatus.className = 'login-error-msg';
    
    const name = document.getElementById('admin-profile-name').value.trim();
    const email = document.getElementById('admin-profile-email').value.trim();
    const password = document.getElementById('admin-profile-password').value;

    try {
      const response = await apiCall('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, email, password })
      });

      // Update cached session
      currentUser = response.user;
      localStorage.setItem('mediwave_user', JSON.stringify(currentUser));
      
      // Update UI displays
      document.getElementById('sidebar-user-name').textContent = currentUser.name;
      document.getElementById('sidebar-avatar').textContent = currentUser.name.charAt(0).toUpperCase();

      // Show success feedback
      profileStatus.style.background = 'var(--success-bg)';
      profileStatus.style.borderColor = 'var(--success-border)';
      profileStatus.style.color = '#86efac';
      profileStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Profile details updated successfully.`;
      profileStatus.style.display = 'flex';

      // Clear password field
      document.getElementById('admin-profile-password').value = '';

    } catch (err) {
      profileStatus.style.background = 'var(--danger-bg)';
      profileStatus.style.borderColor = 'var(--danger-border)';
      profileStatus.style.color = '#fca5a5';
      profileStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message || "Failed to update profile."}`;
      profileStatus.style.display = 'flex';
    }
  });
  // Configs form submit
  document.getElementById('admin-rules-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const esc = parseInt(document.getElementById('rule-escalation-days').value);
    const limit = parseFloat(document.getElementById('rule-credit-limit').value);
    const arch = parseInt(document.getElementById('rule-archive-days').value);

    try {
      const response = await apiCall('/api/config', {
        method: 'PUT',
        body: JSON.stringify({
          escalationDays: esc,
          creditLimit: limit,
          archiveDays: arch
        })
      });

      systemRules = response;
      alert("Billing rules engine configurations updated successfully.");
      
      // Refresh credits list
      await refreshCreditsList();
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
    }
  });

  // Purge audit trail
  document.getElementById('btn-purge-audits').addEventListener('click', async () => {
    if (confirm("WARNING: Confirm purging the security audit trail? This action is permanent and logged.")) {
      try {
        await apiCall('/api/audit', { method: 'DELETE' });
        audits = [];
        alert("Security audit database purged.");
      } catch (err) {
        alert(`Purge failed: ${err.message}`);
      }
    }
  });

  // Reset database diagnostics
  document.getElementById('btn-reset-db').addEventListener('click', async () => {
    if (confirm("CAUTION: Confirm performing a factory database reset? This will seed default values and clear transaction logs.")) {
      try {
        const response = await apiCall('/api/reset', { method: 'POST' });
        alert(response.message || "Database seeded to factory defaults.");
        
        // Refresh session
        await loadInitialData();
        switchView('admin-dashboard');
      } catch (err) {
        alert(`Diagnostics failed: ${err.message}`);
      }
    }
  });
}
