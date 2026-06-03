var API = new URL('../api.php', window.location.href).href;
var tg = window.Telegram ? window.Telegram.WebApp : null;
var sellerData = null; // { restaurant, products, categories, orders, stats }
var sellerCategories = [];

function apiHeaders(json) {
  var h = json ? { 'Content-Type': 'application/json' } : {};
  if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
  return h;
}

function fetchApi(action, data) {
  var url = API + '?action=' + action;
  var opts = { method: data ? 'POST' : 'GET', headers: apiHeaders(!!data) };
  if (data) opts.body = JSON.stringify(data);
  return fetch(url, opts).then(function(r) { return r.json(); }).catch(function() { return { success: false }; });
}

function sellerToast(msg, type) {
  var t = document.getElementById('adminToast');
  t.textContent = msg;
  t.style.borderColor = type === 'error' ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.4)';
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(function() { t.classList.add('hidden'); }, 2800);
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) { return Number(n).toLocaleString('uz-UZ') + " so'm"; }

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

function showSection(name) {
  document.querySelectorAll('.seller-section').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-link').forEach(function(el) { el.classList.remove('active'); });
  var sec = document.getElementById('section-' + name);
  var nav = document.getElementById('snav-' + name);
  if (sec) sec.classList.add('active');
  if (nav) nav.classList.add('active');
  var titles = { dashboard: 'Dashboard', orders: 'Buyurtmalar', products: 'Mahsulotlar', restoran: 'Restoran' };
  var mTitle = document.getElementById('sellerMobileTitle');
  if (mTitle) mTitle.textContent = titles[name] || 'Sotuvchi Panel';
  // Sidebar close on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  if (name === 'orders') renderSellerOrders();
  if (name === 'products') renderSellerProducts();
  if (name === 'restoran') renderRestInfo();
}

// ── INIT ──
window.addEventListener('load', function() {
  if (tg) {
    try { tg.ready(); tg.expand(); } catch(e) {}
    var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (u) {
      var nameEl = document.getElementById('sellerName');
      if (nameEl) nameEl.textContent = u.first_name || 'Sotuvchi';
      if (u.photo_url) {
        document.getElementById('sellerAvatarWrap').innerHTML =
          '<img src="' + u.photo_url + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">';
      }
    }
  }
  loadSellerData();
  setInterval(loadSellerData, 30000);
});

function loadSellerData() {
  fetchApi('seller_get_data').then(function(res) {
    if (!res.success) {
      if (res.data === 'Access denied') {
        document.getElementById('mainContent').innerHTML =
          '<div style="text-align:center;padding:60px 20px"><div style="font-size:52px">🔒</div>' +
          '<h2 style="margin:12px 0">Ruxsat yo\'q</h2>' +
          '<p style="color:var(--text-dim)">Sizga sotuvchi roli berilmagan. Admin bilan bog\'laning.</p></div>';
        return;
      }
      if (res.data === 'Restoran topilmadi') {
        document.getElementById('noRestWrap').style.display = 'block';
        document.querySelectorAll('.seller-section').forEach(function(el) { el.style.display = 'none'; });
        return;
      }
      sellerToast('Ma\'lumot yuklanmadi: ' + (res.data || ''), 'error');
      return;
    }
    sellerData = res.data;
    sellerCategories = sellerData.categories || [];
    updateDashboard();
    updatePendingBadge();
    // Update dashboard orders
    renderDashOrders();
  });
}

function updateDashboard() {
  var s = sellerData.stats || {};
  var rest = sellerData.restaurant || {};
  document.getElementById('sellerRestName').textContent = '🏪 ' + (rest.name || '');
  document.getElementById('sViews').textContent = s.views || 0;
  document.getElementById('sTotalOrders').textContent = s.total_orders || 0;
  document.getElementById('sTotalRevenue').textContent = fmt(s.total_revenue || 0);
  document.getElementById('sProducts').textContent = (sellerData.products || []).length;
}

function updatePendingBadge() {
  var orders = sellerData.orders || [];
  var pendingCount = orders.filter(function(o) { return o.status === 'new'; }).length;
  var badge = document.getElementById('sellerPendingBadge');
  if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount > 0 ? 'flex' : 'none'; }
}

function renderDashOrders() {
  var el = document.getElementById('dashOrdersList');
  if (!el) return;
  var orders = (sellerData.orders || []).filter(function(o) { return o.status === 'new' || o.status === 'confirmed'; }).slice(0, 5);
  if (!orders.length) { el.innerHTML = '<div class="empty-state" style="padding:30px"><p style="color:var(--text-dim)">Yangi buyurtmalar yo\'q</p></div>'; return; }
  el.innerHTML = orders.map(renderOrderCard).join('');
}

function renderSellerOrders() {
  var el = document.getElementById('sellerOrdersList');
  if (!el || !sellerData) return;
  var filter = (document.getElementById('sellerOrderFilter') || {}).value || '';
  var orders = sellerData.orders || [];
  if (filter) orders = orders.filter(function(o) { return o.status === filter; });
  if (!orders.length) { el.innerHTML = '<div class="empty-state" style="padding:30px"><p>Buyurtmalar yo\'q</p></div>'; return; }
  el.innerHTML = orders.map(renderOrderCard).join('');
}

function renderOrderCard(o) {
  var items = JSON.parse(o.items || '[]');
  var itemText = items.map(function(i) { return esc(i.name) + ' ×' + i.qty; }).join(', ');
  var statusMap = { new: 'Yangi', confirmed: 'Qabul', cooking: 'Tayyorlanmoqda', delivered: 'Yetkazildi', cancelled: 'Bekor' };
  var date = o.created_at ? new Date(o.created_at.replace(' ', 'T')).toLocaleString('ru-RU') : '';
  return '<div class="order-card" onclick="showOrderDetail(' + o.id + ')">' +
    '<div class="order-card-top">' +
      '<span class="order-card-id">#' + o.id + '</span>' +
      '<span class="order-status-badge status-' + o.status + '">' + (statusMap[o.status] || o.status) + '</span>' +
      '<span class="order-card-total">' + fmt(o.my_total || 0) + '</span>' +
    '</div>' +
    '<div class="order-card-items">' + itemText + '</div>' +
    '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">' + esc(date) + '</div>' +
  '</div>';
}

var _ordersById = {};
function showOrderDetail(orderId) {
  var orders = sellerData ? sellerData.orders || [] : [];
  var o = orders.find(function(x) { return x.id == orderId; });
  if (!o) return;
  _ordersById[orderId] = o;
  var items = JSON.parse(o.items || '[]');
  var itemsHtml = items.map(function(i) {
    return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">' +
      '<span>' + esc(i.name) + ' <span style="color:var(--text-dim)">×' + i.qty + '</span></span>' +
      '<span style="font-weight:600">' + fmt(i.price * i.qty) + '</span></div>';
  }).join('');
  var statusMap = { new:'Yangi', confirmed:'Qabul', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };
  document.getElementById('sellerOrderDetailBody').innerHTML =
    '<div style="padding:16px 20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-size:18px;font-weight:700">#' + o.id + '</div>' +
        '<span class="order-status-badge status-' + o.status + '">' + (statusMap[o.status] || o.status) + '</span>' +
      '</div>' +
      '<div style="font-size:13px;display:grid;gap:6px;margin-bottom:14px">' +
        '<div><span style="color:var(--text-dim)">Telefon: </span>' + esc(o.phone || '—') + '</div>' +
        '<div><span style="color:var(--text-dim)">Manzil: </span>' + esc(o.address || '—') + '</div>' +
        (o.note ? '<div><span style="color:var(--text-dim)">Izoh: </span>' + esc(o.note) + '</div>' : '') +
      '</div>' +
      itemsHtml +
      '<div style="display:flex;justify-content:space-between;padding-top:10px;font-size:16px;font-weight:700">' +
        '<span>Jami (mening ulushim)</span><span style="color:var(--accent)">' + fmt(o.my_total || 0) + '</span>' +
      '</div>' +
      '<div style="margin-top:16px">' +
        '<label style="font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase">Holatni o\'zgartirish</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' +
          (o.status === 'new'       ? '<button class="btn-primary" onclick="updateOrder(' + o.id + ',\'confirmed\')">✅ Qabul qilish</button>' : '') +
          (o.status === 'confirmed' ? '<button class="btn-primary" onclick="updateOrder(' + o.id + ',\'cooking\')">👨‍🍳 Tayyorlanmoqda</button>' : '') +
          (o.status === 'cooking'   ? '<button class="btn-primary" onclick="updateOrder(' + o.id + ',\'delivered\')">🚚 Yetkazildi</button>' : '') +
          (!['delivered','cancelled'].includes(o.status) ? '<button class="btn-cancel" style="border:1px solid var(--border)" onclick="updateOrder(' + o.id + ',\'cancelled\')">❌ Bekor</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  document.getElementById('sellerOrderModal').classList.remove('hidden');
}

function updateOrder(orderId, status) {
  fetchApi('seller_update_order', { order_id: orderId, status: status }).then(function(res) {
    if (res.success) {
      sellerToast('Buyurtma #' + orderId + ' yangilandi ✓', 'success');
      document.getElementById('sellerOrderModal').classList.add('hidden');
      loadSellerData();
    } else {
      sellerToast('Xatolik: ' + (res.data || ''), 'error');
    }
  });
}

// ── PRODUCTS ──
function renderSellerProducts() {
  var el = document.getElementById('sellerProductsList');
  if (!el || !sellerData) return;
  var prods = sellerData.products || [];
  if (!prods.length) { el.innerHTML = '<div class="empty-state" style="padding:30px"><p>Mahsulotlar yo\'q. Qo\'shing!</p></div>'; return; }
  el.innerHTML = prods.map(function(p) {
    var avail = parseInt(p.available);
    return '<div class="product-row">' +
      '<div class="product-row-img">' + (p.image ? '<img src="'+esc(p.image)+'" onerror="this.style.display=\'none\'">' : '🍽️') + '</div>' +
      '<div class="product-row-info">' +
        '<div class="product-row-name">' + esc(p.name) + '</div>' +
        '<div class="product-row-price">' + fmt(p.price) + '</div>' +
        '<div class="product-row-avail ' + (avail ? 'avail-on' : 'avail-off') + '">' + (avail ? '● Mavjud' : '● Mavjud emas') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn-icon btn-edit" onclick="editSellerProduct(' + p.id + ')">' + iconEdit() + '</button>' +
        '<button class="btn-icon btn-delete" onclick="deleteSellerProduct(' + p.id + ',' + '"' + esc(p.name) + '"' + ')">' + iconTrash() + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function showSellerProductModal() {
  document.getElementById('sellerProdModalTitle').textContent = 'Yangi mahsulot';
  document.getElementById('sellerProdId').value = '';
  ['sellerProdName', 'sellerProdDesc', 'sellerProdPrice', 'sellerProdImage'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('sellerProdAvailGroup').style.display = 'none';
  fillSellerCatSelect();
  document.getElementById('sellerProductModal').classList.remove('hidden');
}

function editSellerProduct(id) {
  var p = (sellerData.products || []).find(function(x) { return x.id == id; });
  if (!p) return;
  document.getElementById('sellerProdModalTitle').textContent = p.name;
  document.getElementById('sellerProdId').value = p.id;
  document.getElementById('sellerProdName').value = p.name || '';
  document.getElementById('sellerProdDesc').value = p.description || '';
  document.getElementById('sellerProdPrice').value = p.price || '';
  document.getElementById('sellerProdImage').value = p.image || '';
  document.getElementById('sellerProdAvail').checked = parseInt(p.available) === 1;
  document.getElementById('sellerProdAvailGroup').style.display = 'block';
  fillSellerCatSelect(p.category_id);
  document.getElementById('sellerProductModal').classList.remove('hidden');
}

function fillSellerCatSelect(selectedId) {
  var sel = document.getElementById('sellerProdCat');
  sel.innerHTML = '';
  sellerCategories.forEach(function(c) {
    var o = document.createElement('option');
    o.value = c.id; o.textContent = (c.icon || '') + ' ' + c.name;
    if (selectedId && c.id == selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function closeSellerProductModal() { document.getElementById('sellerProductModal').classList.add('hidden'); }

function saveSellerProduct() {
  var id = document.getElementById('sellerProdId').value;
  var name = document.getElementById('sellerProdName').value.trim();
  var price = parseFloat(document.getElementById('sellerProdPrice').value) || 0;
  if (!name) return sellerToast('Nomi kerak!', 'error');
  if (price <= 0) return sellerToast("To'g'ri narx kiriting!", 'error');
  var data = {
    name: name,
    description: document.getElementById('sellerProdDesc').value.trim(),
    price: price,
    image: document.getElementById('sellerProdImage').value.trim(),
    category_id: document.getElementById('sellerProdCat').value,
  };
  if (id) {
    data.id = parseInt(id);
    data.available = document.getElementById('sellerProdAvail').checked ? 1 : 0;
    fetchApi('seller_edit_product', data).then(function(res) {
      if (res.success) { sellerToast('Yangilandi ✓', 'success'); closeSellerProductModal(); loadSellerData(); }
      else sellerToast('Xatolik: ' + (res.data || ''), 'error');
    });
  } else {
    fetchApi('seller_add_product', data).then(function(res) {
      if (res.success) { sellerToast("Qo'shildi ✓", 'success'); closeSellerProductModal(); loadSellerData(); }
      else sellerToast('Xatolik: ' + (res.data || ''), 'error');
    });
  }
}

function deleteSellerProduct(id, name) {
  if (!confirm('"' + name + '" ni o\'chirmoqchimisiz?')) return;
  fetchApi('seller_delete_product', { id: id }).then(function(res) {
    if (res.success) { sellerToast("O'chirildi", 'success'); loadSellerData(); }
    else sellerToast('Xatolik!', 'error');
  });
}

// ── RESTORAN ──
function renderRestInfo() {
  var el = document.getElementById('sellerRestInfo');
  if (!el || !sellerData) return;
  var r = sellerData.restaurant || {};
  el.innerHTML =
    '<div style="display:grid;gap:12px">' +
      '<div class="form-group"><label>Nomi</label><div style="padding:10px;background:var(--bg3);border-radius:8px;font-weight:600">' + esc(r.name || '—') + '</div></div>' +
      '<div class="form-group"><label>Manzil</label><div style="padding:10px;background:var(--bg3);border-radius:8px">' + esc(r.address || '—') + '</div></div>' +
      '<div class="form-group"><label>Telefon</label><div style="padding:10px;background:var(--bg3);border-radius:8px">' + esc(r.phone || '—') + '</div></div>' +
      '<div class="form-group"><label>Holati</label><div>' + (parseInt(r.is_active) ? '<span style="color:#22c55e;font-weight:600">✅ Faol</span>' : '<span style="color:#f87171">❌ Faol emas</span>') + '</div></div>' +
    '</div>' +
    '<p style="font-size:12px;color:var(--text-dim);margin-top:16px">Ma\'lumotlarni o\'zgartirish uchun admin bilan bog\'laning.</p>';
}

// ── CREATE RESTAURANT ──
function showCreateRestModal() {
  document.getElementById('createRestModal').classList.remove('hidden');
}

function createRestaurant() {
  var name    = document.getElementById('newRestName').value.trim();
  var address = document.getElementById('newRestAddress').value.trim();
  var phone   = document.getElementById('newRestPhone').value.trim();
  if (!name || !phone) return sellerToast('Nomi va telefon majburiy!', 'error');
  fetchApi('rest_create', { name: name, address: address, phone: phone }).then(function(res) {
    if (res.success) {
      sellerToast("Restoran yaratildi! Admin tasdiqlaydi.", 'success');
      document.getElementById('createRestModal').classList.add('hidden');
      loadSellerData();
    } else {
      sellerToast('Xatolik: ' + (res.data || ''), 'error');
    }
  });
}

// ── ICONS ──
function iconEdit() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconTrash() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
