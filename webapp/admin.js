// ═══════════════════════════════════════════
// IFTIXOR GO — ADMIN PANEL JS
// ═══════════════════════════════════════════

var API = 'https://iftixorgo.bigsaver.ru/api.php';
var categories = [];

// ── INIT ──
window.addEventListener('load', function() {
  loadDashboard();
});

// ── TABS ──
function switchTab(name) {
  // Hide all
  document.querySelectorAll('.tab-content').forEach(function(el) {
    el.classList.remove('active');
  });
  document.querySelectorAll('.nav-link').forEach(function(el) {
    el.classList.remove('active');
  });

  // Show selected
  var content = document.getElementById('content-' + name);
  var tab = document.getElementById('tab-' + name);
  if (content) content.classList.add('active');
  if (tab) tab.classList.add('active');

  // Load data
  if (name === 'dashboard') loadDashboard();
  else if (name === 'orders') loadOrders();
  else if (name === 'users') loadUsers();
  else if (name === 'products') loadProducts();

  // Close sidebar on mobile
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
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

    // Pending badge
    var badge = document.getElementById('pendingBadge');
    if (badge) {
      badge.textContent = d.pending_orders;
      badge.style.display = d.pending_orders > 0 ? 'block' : 'none';
    }
  });

  // Load recent new orders
  get('admin_orders&status=new&limit=10').then(function(res) {
    var el = document.getElementById('recentOrders');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>Yangi buyurtmalar yo\'q</p></div>';
      return;
    }
    el.innerHTML = res.data.map(function(o) { return renderOrderRow(o); }).join('');
  });
}

// ── ORDERS ──
function loadOrders() {
  var filter = document.getElementById('orderFilter');
  var status = filter ? filter.value : '';
  var url = 'admin_orders&limit=50';
  if (status) url += '&status=' + status;

  get(url).then(function(res) {
    var el = document.getElementById('ordersList');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>Buyurtmalar topilmadi</p></div>';
      return;
    }
    el.innerHTML = res.data.map(function(o) { return renderOrderRow(o); }).join('');
  });
}

function renderOrderRow(o) {
  var name = ((o.first_name || '') + ' ' + (o.last_name || '')).trim() || 'Noma\'lum';
  var uname = o.username ? ' @' + o.username : '';
  var itemsText = '';
  if (o.items && o.items.length) {
    itemsText = o.items.map(function(i) { return i.name + ' x' + i.qty; }).join(', ');
  }
  var date = o.created_at ? new Date(o.created_at).toLocaleString('uz-UZ') : '';
  var statusMap = { new: 'Yangi', confirmed: 'Qabul', cooking: 'Tayyorlanmoqda', delivered: 'Yetkazildi', cancelled: 'Bekor' };
  var statusLabel = statusMap[o.status] || o.status;

  return '<div class="order-row">' +
    '<div class="order-id">#' + o.id + '</div>' +
    '<div class="order-details">' +
      '<div class="order-client">' + name + uname + '</div>' +
      '<div class="order-items-text">' + itemsText + '</div>' +
      '<div class="order-meta">' +
        '<span>📞 ' + (o.phone || o.user_phone || '—') + '</span>' +
        '<span>📍 ' + (o.address || '—') + '</span>' +
        '<span>🕐 ' + date + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="order-amount">' + fmt(o.total) + '</div>' +
    '<div class="order-actions">' +
      '<span class="badge badge-' + o.status + '">' + statusLabel + '</span>' +
      '<select onchange="updateOrderStatus(' + o.id + ', this.value)">' +
        '<option value="">Holat o\'zgartirish</option>' +
        '<option value="confirmed">✅ Qabul</option>' +
        '<option value="cooking">👨‍🍳 Tayyorlash</option>' +
        '<option value="delivered">🚚 Yetkazildi</option>' +
        '<option value="cancelled">❌ Bekor</option>' +
      '</select>' +
    '</div>' +
  '</div>';
}

function updateOrderStatus(orderId, status) {
  if (!status) return;
  post('admin_update_order', { order_id: orderId, status: status }).then(function(res) {
    if (res.success) {
      adminToast('✅ Buyurtma #' + orderId + ' yangilandi!');
      loadOrders();
      loadDashboard();
    } else {
      adminToast('❌ Xatolik!');
    }
  });
}

// ── USERS ──
var searchTimer = null;
function searchUsers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUsers, 400);
}

function loadUsers() {
  var search = document.getElementById('userSearch');
  var q = search ? search.value.trim() : '';
  var url = 'admin_users';
  if (q) url += '&search=' + encodeURIComponent(q);

  get(url).then(function(res) {
    var el = document.getElementById('usersList');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Foydalanuvchilar topilmadi</p></div>';
      return;
    }

    var html = '<table class="users-table">' +
      '<thead><tr><th>ID</th><th>Ism</th><th>Username</th><th>Telefon</th><th>Manzil</th></tr></thead>' +
      '<tbody>';

    res.data.forEach(function(u) {
      var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || '—';
      html += '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td>' + name + '</td>' +
        '<td>' + (u.username ? '@' + u.username : '—') + '</td>' +
        '<td>' + (u.phone || '—') + '</td>' +
        '<td>' + (u.address || '—') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  });
}

// ── PRODUCTS ──
function loadProducts() {
  // Load categories first
  get('admin_categories').then(function(res) {
    if (res.success && res.data) categories = res.data;
  });

  get('admin_products').then(function(res) {
    var el = document.getElementById('productsList');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🛍️</div><p>Mahsulotlar yo\'q</p></div>';
      return;
    }

    el.innerHTML = res.data.map(function(p) {
      var avail = parseInt(p.available);
      return '<div class="product-admin-card">' +
        '<div class="pac-header">' +
          '<div class="pac-name">' + p.name + '</div>' +
          '<span class="pac-cat">' + (p.category_name || 'Nomalum') + '</span>' +
        '</div>' +
        '<div class="pac-desc">' + (p.description || 'Tavsif yo\'q') + '</div>' +
        '<div class="pac-footer">' +
          '<div>' +
            '<div class="pac-price">' + fmt(p.price) + '</div>' +
            '<span class="pac-status ' + (avail ? 'available' : 'unavailable') + '">' + (avail ? 'Mavjud' : 'Yo\'q') + '</span>' +
          '</div>' +
          '<div class="pac-actions">' +
            '<button class="btn-edit" onclick=\'editProduct(' + JSON.stringify(p).replace(/'/g, "\\'") + ')\'>✏️ Tahrir</button>' +
            '<button class="btn-delete" onclick="deleteProduct(' + p.id + ')">🗑️</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  });
}

function showAddProduct() {
  document.getElementById('productModalTitle').textContent = 'Yangi mahsulot';
  document.getElementById('editProductId').value = '';
  document.getElementById('prodName').value = '';
  document.getElementById('prodDesc').value = '';
  document.getElementById('prodPrice').value = '';
  document.getElementById('prodImage').value = '';
  document.getElementById('prodAvailGroup').style.display = 'none';

  // Fill categories
  fillCatSelect();
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(p) {
  document.getElementById('productModalTitle').textContent = 'Tahrirlash: ' + p.name;
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
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.icon + ' ' + c.name;
    if (selectedId && c.id == selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function closeProductModal() {
  document.getElementById('productModal').classList.add('hidden');
}

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
      if (res.success) {
        adminToast('✅ Mahsulot yangilandi!');
        closeProductModal();
        loadProducts();
      }
    });
  } else {
    post('admin_add_product', data).then(function(res) {
      if (res.success) {
        adminToast('✅ Mahsulot qo\'shildi!');
        closeProductModal();
        loadProducts();
      }
    });
  }
}

function deleteProduct(id) {
  if (!confirm('Bu mahsulotni o\'chirmoqchimisiz?')) return;
  post('admin_delete_product', { id: id }).then(function(res) {
    if (res.success) {
      adminToast('🗑️ Mahsulot o\'chirildi');
      loadProducts();
    }
  });
}

// ── BROADCAST ──
var broadcastInput = document.getElementById('broadcastMsg');
if (broadcastInput) {
  broadcastInput.addEventListener('input', function() {
    var preview = document.getElementById('broadcastPreview');
    preview.textContent = this.value || 'Matn kiriting...';
  });
}

function sendBroadcast() {
  var msgEl = document.getElementById('broadcastMsg');
  var msg = msgEl ? msgEl.value.trim() : '';
  if (!msg) return adminToast('Xabar matnini kiriting!');
  if (!confirm('Barcha foydalanuvchilarga yuborasizmi?')) return;

  var btn = document.getElementById('broadcastBtn');
  btn.disabled = true;
  btn.textContent = '📤 Yuborilmoqda...';

  post('admin_broadcast', { message: msg }).then(function(res) {
    btn.disabled = false;
    btn.textContent = '📢 Barchaga yuborish';

    var result = document.getElementById('broadcastResult');
    result.style.display = 'block';

    if (res.success) {
      result.className = 'broadcast-result success';
      result.textContent = '✅ ' + res.data.sent + '/' + res.data.total + ' foydalanuvchiga yuborildi!';
      msgEl.value = '';
    } else {
      result.className = 'broadcast-result error';
      result.textContent = '❌ Xatolik yuz berdi!';
    }
  });
}

// ── HELPERS ──
function fmt(n) {
  return Number(n).toLocaleString('uz-UZ') + " so'm";
}

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function adminToast(msg) {
  var t = document.getElementById('adminToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.add('hidden'); }, 2500);
}

function post(action, data) {
  return fetch(API + '?action=' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); }).catch(function() { return { success: false }; });
}

function get(action) {
  return fetch(API + '?action=' + action)
    .then(function(r) { return r.json(); })
    .catch(function() { return { success: false }; });
}
