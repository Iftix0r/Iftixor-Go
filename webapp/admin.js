var API = 'https://iftixorgo.bigsaver.ru/api.php';
var categories = [];
var allUsers = [];

// ── INIT ──
window.addEventListener('load', function() {
  loadDashboard();
  // Auto-refresh every 30s
  setInterval(function() {
    var active = document.querySelector('.tab-content.active');
    if (active && active.id === 'content-dashboard') loadDashboard();
    if (active && active.id === 'content-orders') loadOrders();
  }, 30000);

  // Broadcast preview
  var bMsg = document.getElementById('broadcastMsg');
  if (bMsg) bMsg.addEventListener('input', function() {
    var p = document.getElementById('broadcastPreview');
    p.textContent = this.value || 'Matn kiriting...';
  });
});

// ── TABS ──
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-link').forEach(function(el) { el.classList.remove('active'); });
  var c = document.getElementById('content-' + name);
  var t = document.getElementById('tab-' + name);
  if (c) c.classList.add('active');
  if (t) t.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  else if (name === 'orders') loadOrders();
  else if (name === 'users') loadUsers();
  else if (name === 'products') loadProducts();
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

// ── DASHBOARD ──
function loadDashboard() {
  get('admin_stats').then(function(res) {
    if (!res.success) return;
    var d = res.data;
    setText('sTodayOrders', d.today_orders);
    setText('sTodayRevenue', fmt(d.today_revenue));
    setText('sTotalUsers', d.total_users);
    setText('sPending', d.pending_orders);
    setText('sTotalOrders', d.total_orders);
    setText('sTotalRevenue', fmt(d.total_revenue));
    var badge = document.getElementById('pendingBadge');
    if (badge) { badge.textContent = d.pending_orders; badge.style.display = d.pending_orders > 0 ? 'flex' : 'none'; }
  });
  get('admin_orders&status=new&limit=10').then(function(res) {
    var el = document.getElementById('recentOrders');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = emptyState('Yangi buyurtmalar yo\'q', iconCheck());
      return;
    }
    el.innerHTML = res.data.map(renderOrderRow).join('');
  });
}

// ── ORDERS ──
function loadOrders() {
  var filter = document.getElementById('orderFilter');
  var status = filter ? filter.value : '';
  var url = 'admin_orders&limit=100' + (status ? '&status=' + status : '');
  get(url).then(function(res) {
    var el = document.getElementById('ordersList');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = emptyState('Buyurtmalar topilmadi', iconBox());
      return;
    }
    el.innerHTML = '<div class="orders-list">' + res.data.map(renderOrderRow).join('') + '</div>';
  });
}

function renderOrderRow(o) {
  var name = ((o.first_name || '') + ' ' + (o.last_name || '')).trim() || 'Noma\'lum';
  var uname = o.username ? '@' + o.username : '';
  var items = (o.items || []).map(function(i) { return i.name + ' ×' + i.qty; }).join(' · ');
  var date = o.created_at ? new Date(o.created_at).toLocaleString('uz-UZ') : '';
  var photo = o.photo_url
    ? '<img src="' + o.photo_url + '" class="order-avatar" onerror="this.src=\''+avatarUrl(o.first_name)+'\'">'
    : '<img src="' + avatarUrl(o.first_name) + '" class="order-avatar">';

  var statusMap = { new:'Yangi', confirmed:'Qabul', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };

  return '<div class="order-row">' +
    photo +
    '<div class="order-details">' +
      '<div class="order-top">' +
        '<span class="order-id">#' + o.id + '</span>' +
        '<span class="badge badge-' + o.status + '">' + (statusMap[o.status] || o.status) + '</span>' +
        '<span class="order-amount">' + fmt(o.total) + '</span>' +
      '</div>' +
      '<div class="order-client">' + name + (uname ? ' <span class="order-uname">' + uname + '</span>' : '') + '</div>' +
      '<div class="order-items-text">' + (items || '—') + '</div>' +
      '<div class="order-meta">' +
        '<span>' + iconPhone() + (o.phone || '—') + '</span>' +
        '<span>' + iconPin() + (o.address || '—') + '</span>' +
        '<span>' + iconClock() + date + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="order-ctrl">' +
      '<select onchange="updateOrderStatus(' + o.id + ', this.value)" class="status-select">' +
        '<option value="">Holat</option>' +
        '<option value="confirmed">✓ Qabul</option>' +
        '<option value="cooking">⏳ Tayyorlash</option>' +
        '<option value="delivered">✓ Yetkazildi</option>' +
        '<option value="cancelled">✕ Bekor</option>' +
      '</select>' +
    '</div>' +
  '</div>';
}

function updateOrderStatus(id, status) {
  if (!status) return;
  post('admin_update_order', { order_id: id, status: status }).then(function(res) {
    if (res.success) {
      adminToast('Buyurtma #' + id + ' yangilandi');
      loadOrders(); loadDashboard();
    } else adminToast('Xatolik!');
  });
}

// ── USERS ──
var searchTimer = null;
function searchUsers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function() {
    var q = (document.getElementById('userSearch').value || '').toLowerCase();
    var filtered = q ? allUsers.filter(function(u) {
      return ((u.first_name || '') + ' ' + (u.last_name || '') + ' ' + (u.username || '') + ' ' + (u.phone || '')).toLowerCase().includes(q);
    }) : allUsers;
    renderUsers(filtered);
  }, 300);
}

function loadUsers() {
  get('admin_users').then(function(res) {
    if (!res.success || !res.data) return;
    allUsers = res.data;
    setText('usersCount', 'Jami: ' + allUsers.length + ' ta foydalanuvchi');
    renderUsers(allUsers);
  });
}

function renderUsers(list) {
  var el = document.getElementById('usersList');
  if (!list.length) { el.innerHTML = emptyState('Foydalanuvchilar topilmadi', iconUsers()); return; }
  el.innerHTML = '<div class="users-grid">' + list.map(function(u) {
    var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'Noma\'lum';
    var photo = u.photo_url
      ? '<img src="' + u.photo_url + '" class="user-card-photo" onerror="this.src=\''+avatarUrl(u.first_name)+'\'">'
      : '<img src="' + avatarUrl(u.first_name) + '" class="user-card-photo">';
    var hasPhone = u.phone ? '<span class="user-tag tag-green">' + u.phone + '</span>' : '';
    var hasAddr = u.address ? '<span class="user-tag tag-blue">' + u.address.substring(0,20) + (u.address.length>20?'…':'') + '</span>' : '';
    return '<div class="user-card" onclick="showUserDetail(' + u.id + ')">' +
      photo +
      '<div class="user-card-info">' +
        '<div class="user-card-name">' + name + '</div>' +
        '<div class="user-card-meta">' + (u.username ? '@' + u.username : 'ID: ' + u.id) + '</div>' +
        '<div class="user-card-tags">' + hasPhone + hasAddr + '</div>' +
      '</div>' +
      '<svg class="user-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="9 18 15 12 9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
    '</div>';
  }).join('') + '</div>';
}

function showUserDetail(userId) {
  var u = allUsers.find(function(x) { return x.id == userId; });
  if (!u) return;
  var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'Noma\'lum';
  var photo = u.photo_url
    ? '<img src="' + u.photo_url + '" class="umodal-photo" onerror="this.src=\''+avatarUrl(u.first_name)+'\'">'
    : '<img src="' + avatarUrl(u.first_name) + '" class="umodal-photo">';

  document.getElementById('userModalBody').innerHTML =
    '<div class="umodal-header">' + photo +
      '<div class="umodal-name">' + name + '</div>' +
      '<div class="umodal-username">' + (u.username ? '@' + u.username : '') + '</div>' +
    '</div>' +
    '<div class="umodal-rows">' +
      uRow('Telegram ID', u.id) +
      uRow('Ism', name) +
      uRow('Username', u.username ? '@'+u.username : '—') +
      uRow('Telefon', u.phone || '—') +
      uRow('Manzil', u.address || '—') +
      uRow('Til', u.language_code || '—') +
      uRow('Qo\'shilgan', u.created_at ? new Date(u.created_at).toLocaleDateString('uz-UZ') : '—') +
    '</div>' +
    '<div style="padding:0 20px 16px;display:flex;gap:8px">' +
      '<a href="https://t.me/' + (u.username || '') + '" target="_blank" class="btn-primary" style="flex:1;text-align:center;text-decoration:none;' + (!u.username?'opacity:.4;pointer-events:none':'') + '">Telegram</a>' +
      '<a href="tel:' + (u.phone||'') + '" class="btn-sm" style="' + (!u.phone?'opacity:.4;pointer-events:none':'') + '">Qo\'ng\'iroq</a>' +
    '</div>';
  document.getElementById('userModal').classList.remove('hidden');
}

function uRow(label, val) {
  return '<div class="umodal-row"><span class="umodal-label">' + label + '</span><span class="umodal-val">' + val + '</span></div>';
}

function closeUserModal() { document.getElementById('userModal').classList.add('hidden'); }

// ── PRODUCTS ──
function loadProducts() {
  get('admin_categories').then(function(res) { if (res.success && res.data) categories = res.data; });
  get('admin_products').then(function(res) {
    var el = document.getElementById('productsList');
    if (!res.success || !res.data || !res.data.length) { el.innerHTML = emptyState('Mahsulotlar yo\'q', iconBox()); return; }
    el.innerHTML = '<div class="products-grid">' + res.data.map(function(p) {
      var avail = parseInt(p.available);
      var img = p.image
        ? '<img src="'+p.image+'" class="pac-img" onerror="this.style.display=\'none\'">'
        : '<div class="pac-img-placeholder">' + iconFood() + '</div>';
      return '<div class="product-admin-card">' +
        img +
        '<div class="pac-body">' +
          '<div class="pac-top">' +
            '<span class="pac-cat">' + (p.category_name || '') + '</span>' +
            '<span class="pac-avail ' + (avail ? 'avail-yes' : 'avail-no') + '">' + (avail ? 'Mavjud' : 'Yo\'q') + '</span>' +
          '</div>' +
          '<div class="pac-name">' + p.name + '</div>' +
          '<div class="pac-desc">' + (p.description || '') + '</div>' +
          '<div class="pac-footer">' +
            '<div class="pac-price">' + fmt(p.price) + '</div>' +
            '<div class="pac-actions">' +
              '<button class="btn-icon btn-edit" onclick=\'editProduct(' + JSON.stringify(p) + ')\'>' + iconEdit() + '</button>' +
              '<button class="btn-icon btn-delete" onclick="deleteProduct(' + p.id + ')">' + iconTrash() + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  });
}

function showAddProduct() {
  document.getElementById('productModalTitle').textContent = 'Yangi mahsulot';
  document.getElementById('editProductId').value = '';
  ['prodName','prodDesc','prodPrice','prodImage'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('prodAvailGroup').style.display = 'none';
  fillCatSelect();
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(p) {
  document.getElementById('productModalTitle').textContent = p.name;
  document.getElementById('editProductId').value = p.id;
  document.getElementById('prodName').value = p.name || '';
  document.getElementById('prodDesc').value = p.description || '';
  document.getElementById('prodPrice').value = p.price || '';
  document.getElementById('prodImage').value = p.image || '';
  document.getElementById('prodAvailable').checked = parseInt(p.available) === 1;
  document.getElementById('prodAvailGroup').style.display = 'block';
  fillCatSelect(p.category_id);
  document.getElementById('productModal').classList.remove('hidden');
}

function fillCatSelect(selectedId) {
  var sel = document.getElementById('prodCat');
  sel.innerHTML = '';
  categories.forEach(function(c) {
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.icon + ' ' + c.name;
    if (selectedId && c.id == selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

function saveProduct() {
  var id = document.getElementById('editProductId').value;
  var data = {
    category_id: document.getElementById('prodCat').value,
    name: document.getElementById('prodName').value.trim(),
    description: document.getElementById('prodDesc').value.trim(),
    price: parseInt(document.getElementById('prodPrice').value) || 0,
    image: document.getElementById('prodImage').value.trim(),
  };
  if (!data.name || !data.price) return adminToast('Nom va narxni kiriting!');
  if (id) {
    data.id = parseInt(id);
    data.available = document.getElementById('prodAvailable').checked ? 1 : 0;
    post('admin_edit_product', data).then(function(res) {
      if (res.success) { adminToast('Mahsulot yangilandi'); closeProductModal(); loadProducts(); }
    });
  } else {
    post('admin_add_product', data).then(function(res) {
      if (res.success) { adminToast('Mahsulot qo\'shildi'); closeProductModal(); loadProducts(); }
    });
  }
}

function deleteProduct(id) {
  if (!confirm('Bu mahsulotni o\'chirmoqchimisiz?')) return;
  post('admin_delete_product', { id: id }).then(function(res) {
    if (res.success) { adminToast('Mahsulot o\'chirildi'); loadProducts(); }
  });
}

// ── BROADCAST ──
function sendBroadcast() {
  var msg = (document.getElementById('broadcastMsg').value || '').trim();
  if (!msg) return adminToast('Xabar kiriting!');
  if (!confirm('Barcha foydalanuvchilarga yuborasizmi?')) return;
  var btn = document.getElementById('broadcastBtn');
  btn.disabled = true; btn.textContent = 'Yuborilmoqda...';
  post('admin_broadcast', { message: msg }).then(function(res) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Barchaga yuborish';
    var r = document.getElementById('broadcastResult');
    r.style.display = 'block';
    if (res.success) {
      r.className = 'broadcast-result success';
      r.textContent = res.data.sent + '/' + res.data.total + ' foydalanuvchiga yuborildi';
      document.getElementById('broadcastMsg').value = '';
    } else {
      r.className = 'broadcast-result error';
      r.textContent = 'Xatolik yuz berdi!';
    }
  });
}

// ── HELPERS ──
function fmt(n) { return Number(n).toLocaleString('uz-UZ') + " so'm"; }
function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
function avatarUrl(name) { return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name||'?') + '&background=ff6b35&color=fff&size=80&bold=true'; }
function emptyState(msg, icon) { return '<div class="empty-state">' + icon + '<p>' + msg + '</p></div>'; }

function adminToast(msg) {
  var t = document.getElementById('adminToast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(function() { t.classList.add('hidden'); }, 2500);
}

function post(action, data) {
  return fetch(API + '?action=' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  }).then(function(r) { return r.json(); }).catch(function() { return { success: false }; });
}
function get(action) {
  return fetch(API + '?action=' + action).then(function(r) { return r.json(); }).catch(function() { return { success: false }; });
}

// ── SVG ICONS ──
function iconCheck() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="9 12 11 14 15 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'; }
function iconBox() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconUsers() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconFood() { return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconEdit() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconTrash() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconPhone() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M22 16.92v3a2 2 0 01-2.18 2A19.79 19.79 0 013.07 9.81 2 2 0 012.08 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconPin() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconClock() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'; }
