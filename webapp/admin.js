var API = new URL('../api.php', window.location.href).href;
var UPLOAD_API = new URL('../upload.php', window.location.href).href;
var tg = window.Telegram ? window.Telegram.WebApp : null;
var adminId = 0;
var adminReady = false;
var categories = [];
var allUsers = [];

function apiHeaders(json) {
  var h = json ? { 'Content-Type': 'application/json' } : {};
  if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
  return h;
}

function withAdmin(action) {
  return action + '&admin_id=' + adminId;
}

function showAccessDenied(msg) {
  var gate = document.getElementById('adminAccessGate');
  var main = document.getElementById('mainContent');
  if (gate) {
    gate.classList.remove('hidden');
    var p = gate.querySelector('p');
    if (p) p.textContent = msg;
  }
  if (main) main.style.display = 'none';
  var sb = document.getElementById('sidebar');
  if (sb) sb.style.display = 'none';
}

function initAdmin() {
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (u && u.id) {
      adminId = u.id;
      var nameEl = document.querySelector('.admin-name');
      if (nameEl) nameEl.textContent = u.first_name || 'Admin';
    }
  }
  if (!adminId) {
    showAccessDenied('Admin panel faqat Telegram bot orqali ochiladi.');
    return;
  }
  adminReady = true;
  loadDashboard();
}

// ── INIT ──
window.addEventListener('load', function() {
  initAdmin();
  setInterval(function() {
    if (!adminReady) return;
    var active = document.querySelector('.tab-content.active');
    if (active && active.id === 'content-dashboard') loadDashboard();
    if (active && active.id === 'content-orders') loadOrders();
  }, 30000);

  var bMsg = document.getElementById('broadcastMsg');
  if (bMsg) bMsg.addEventListener('input', function() {
    var p = document.getElementById('broadcastPreview');
    p.textContent = this.value || 'Matn kiriting...';
  });
});

// ── TABS ──
function switchTab(name) {
  if (!adminReady) return;
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
  var refreshBtn = document.getElementById('dashRefreshBtn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '...'; }

  get(withAdmin('admin_stats')).then(function(res) {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="23 4 23 10 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Yangilash';
    }
    if (!res.success) {
      if (res.data === 'Unauthorized') {
        showAccessDenied('Sizda admin huquqi yo\'q. ADMIN_IDS ro\'yxatiga ID qo\'shing.');
        return;
      }
      ['sTodayOrders','sTodayRevenue','sTotalUsers','sPending','sTotalOrders','sTotalRevenue','sBlockedUsers'].forEach(function(id){ setText(id, '—'); });
      document.getElementById('recentOrders').innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);font-size:13px">⚠️ Server ulanmadi — F12 Console da xatoni tekshiring</div>';
      // Console da batafsil
      fetch(API + '?action=admin_stats').then(function(r){ return r.text(); }).then(function(t){ console.error('[Admin] admin_stats raw:', t); }).catch(function(e){ console.error('[Admin] fetch error:', e); });
      return;
    }
    var d = res.data;
    setText('sTodayOrders', d.today_orders);
    setText('sTodayRevenue', fmt(d.today_revenue));
    setText('sTotalUsers', d.total_users);
    setText('sPending', d.pending_orders);
    setText('sTotalOrders', d.total_orders);
    setText('sTotalRevenue', fmt(d.total_revenue));
    var badge = document.getElementById('pendingBadge');
    if (badge) { badge.textContent = d.pending_orders; badge.style.display = d.pending_orders > 0 ? 'flex' : 'none'; }
    var blkEl = document.getElementById('sBlockedUsers');
    if (blkEl) blkEl.textContent = d.blocked_users || 0;
  });
  get(withAdmin('admin_orders&status=new&limit=10')).then(function(res) {
    var el = document.getElementById('recentOrders');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = emptyState('Yangi buyurtmalar yo\'q', iconCheck());
      return;
    }
    res.data.forEach(function(o) {
      if (!_allOrders.find(function(x){ return x.id===o.id; })) _allOrders.push(o);
    });
    el.innerHTML = res.data.map(renderOrderRow).join('');
  });
}

// ── ORDERS ──
function loadOrders() {
  var filter = document.getElementById('orderFilter');
  var status = filter ? filter.value : '';
  var url = withAdmin('admin_orders&limit=100' + (status ? '&status=' + status : ''));
  get(url).then(function(res) {
    var el = document.getElementById('ordersList');
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = emptyState('Buyurtmalar topilmadi', iconBox());
      return;
    }
    _allOrders = res.data;
    el.innerHTML = res.data.map(renderOrderRow).join('');
  });
}

function renderOrderRow(o) {
  var name = ((o.first_name || '') + ' ' + (o.last_name || '')).trim() || 'Noma\'lum';
  var uname = o.username ? '@' + o.username : '';
  var items = (o.items || []).map(function(i) { return i.name + ' ×' + i.qty; }).join(' · ');
  var date = o.created_at ? new Date(o.created_at.replace(' ', 'T')).toLocaleString('ru-RU') : '';
  var photo = o.photo_url
    ? '<img src="' + o.photo_url + '" class="order-avatar" onerror="this.src=\''+avatarUrl(o.first_name)+'\'">'
    : '<img src="' + avatarUrl(o.first_name) + '" class="order-avatar">';

  var statusMap = { new:'Yangi', confirmed:'Qabul', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };

  return '<div class="order-row" onclick="showOrderDetail(' + o.id + ')" style="cursor:pointer">' +
    photo +
    '<div class="order-details">' +
      '<div class="order-top">' +
        '<span class="order-id">#' + o.id + '</span>' +
        '<span class="badge badge-' + o.status + '">' + (statusMap[o.status] || o.status) + '</span>' +
        '<span class="order-amount">' + fmt(o.total) + '</span>' +
      '</div>' +
      '<div class="order-client">' + esc(name) + (uname ? ' <span class="order-uname">' + esc(uname) + '</span>' : '') + '</div>' +
      '<div class="order-items-text">' + esc(items || '—') + '</div>' +
      (o.note ? '<div class="order-note">📝 ' + esc(o.note) + '</div>' : '') +
      '<div class="order-meta">' +
        '<span>' + iconPhone() + esc(o.phone || '—') + '</span>' +
        '<span>' + iconPin() + esc(o.address || '—') + '</span>' +
        '<span>' + iconClock() + date + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="order-ctrl" onclick="event.stopPropagation()">' +
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

// ── ORDER DETAIL ──
var _allOrders = [];
function showOrderDetail(orderId) {
  // orders dan topamiz (dashboard yoki orders listdan)
  var o = _allOrders.find(function(x) { return x.id == orderId; });
  if (!o) return;
  var name = ((o.first_name || '') + ' ' + (o.last_name || '')).trim() || 'Noma\'lum';
  var statusMap = { new:'Yangi', confirmed:'Qabul qilindi', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor qilindi' };
  var itemsHtml = (o.items || []).map(function(i) {
    return '<div class="order-detail-item">' +
      '<span>' + esc(i.name) + ' <span style="color:var(--text-dim)">×' + i.qty + '</span></span>' +
      '<span style="font-weight:600">' + fmtFull(i.price * i.qty) + '</span>' +
    '</div>';
  }).join('');

  var mapsLink = o.address ? 'https://maps.google.com/?q=' + encodeURIComponent(o.address) : '';

  document.getElementById('orderDetailBody').innerHTML =
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
      '<div>' +
        '<div style="font-size:18px;font-weight:700">#' + o.id + ' Buyurtma</div>' +
        '<div style="font-size:12px;color:var(--text-dim);margin-top:2px">' + (o.created_at ? new Date(o.created_at.replace(' ','T')).toLocaleString('ru-RU') : '') + '</div>' +
      '</div>' +
      '<span class="badge badge-' + o.status + '">' + (statusMap[o.status] || o.status) + '</span>' +
    '</div>' +
    '<div style="padding:16px 20px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">Mijoz</div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">' +
        '<img src="' + avatarUrl(o.first_name) + '" style="width:40px;height:40px;border-radius:50%">' +
        '<div>' +
          '<div style="font-weight:600">' + esc(name) + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim)">' + (o.username ? '@'+esc(o.username) : 'ID: '+o.user_id) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;gap:8px;margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-dim)">Telefon</span><span>' + esc(o.phone || '—') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-dim)">Manzil</span><span style="text-align:right;max-width:60%">' + esc(o.address || '—') + (mapsLink ? ' <a href="'+mapsLink+'" target="_blank" style="color:var(--accent);font-size:11px">🗺</a>' : '') + '</span></div>' +
        (o.note ? '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-dim)">Izoh</span><span style="text-align:right;max-width:60%">' + esc(o.note) + '</span></div>' : '') +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">Mahsulotlar</div>' +
      '<div style="display:grid;gap:6px;margin-bottom:14px">' + itemsHtml + '</div>' +
      '<div style="border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;font-size:16px;font-weight:700">' +
        '<span>Jami</span><span style="color:var(--accent)">' + fmtFull(o.total) + '</span>' +
      '</div>' +
    '</div>' +
    '<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">' +
      '<select onchange="updateOrderStatus(' + o.id + ', this.value);closeOrderDetail()" class="status-select" style="flex:1">' +
        '<option value="">Holatni o\'zgartirish...</option>' +
        '<option value="confirmed">✓ Qabul qilish</option>' +
        '<option value="cooking">⏳ Tayyorlanmoqda</option>' +
        '<option value="delivered">✓ Yetkazildi</option>' +
        '<option value="cancelled">✕ Bekor qilish</option>' +
      '</select>' +
    '</div>';
  document.getElementById('orderDetailModal').classList.remove('hidden');
}

function closeOrderDetail() { document.getElementById('orderDetailModal').classList.add('hidden'); }

function updateOrderStatus(id, status) {
  if (!status) return;
  post('admin_update_order', { order_id: id, status: status, admin_id: adminId }).then(function(res) {
    if (res.success) {
      adminToast('Buyurtma #' + id + ' yangilandi', 'success');
      loadOrders(); loadDashboard();
    } else adminToast('Xatolik!', 'error');
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
  get(withAdmin('admin_users')).then(function(res) {
    if (!res.success || !res.data) return;
    allUsers = res.data;
    setText('usersCount', 'Jami: ' + allUsers.length + ' ta foydalanuvchi');
    renderUsers(allUsers);
  });
}

function renderUsers(list) {
  var el = document.getElementById('usersList');
  if (!list.length) { el.className = ''; el.innerHTML = emptyState('Foydalanuvchilar topilmadi', iconUsers()); return; }
  el.className = 'users-grid';
  el.innerHTML = list.map(function(u) {
    var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'Noma\'lum';
    var photo = u.photo_url
      ? '<img src="' + u.photo_url + '" class="user-card-photo" onerror="this.src=\''+avatarUrl(u.first_name)+'\'">'
      : '<img src="' + avatarUrl(u.first_name) + '" class="user-card-photo">';
    var hasPhone = u.phone ? '<span class="user-tag tag-green">' + esc(u.phone) + '</span>' : '';
    var hasAddr = u.address ? '<span class="user-tag tag-blue">' + esc(u.address.substring(0,20)) + (u.address.length>20?'…':'') + '</span>' : '';
    var isBlocked = parseInt(u.is_blocked) === 1;
    var blockedTag = isBlocked ? '<span class="user-tag" style="background:rgba(239,68,68,.12);color:var(--red)">⛔ Bloklangan</span>' : '';
    return '<div class="user-card" onclick="showUserDetail(' + u.id + ')" style="' + (isBlocked ? 'opacity:.7' : '') + '">' +
      photo +
      '<div class="user-card-info">' +
        '<div class="user-card-name">' + esc(name) + '</div>' +
        '<div class="user-card-meta">' + (u.username ? '@' + esc(u.username) : 'ID: ' + u.id) + '</div>' +
        '<div class="user-card-tags">' + hasPhone + hasAddr + blockedTag + '</div>' +
      '</div>' +
      '<svg class="user-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="9 18 15 12 9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
    '</div>';
  }).join('');
}

function showUserDetail(userId) {
  var u = allUsers.find(function(x) { return x.id == userId; });
  if (!u) return;
  var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'Noma\'lum';
  var photo = u.photo_url
    ? '<img src="' + u.photo_url + '" class="umodal-photo" onerror="this.src=\''+avatarUrl(u.first_name)+'\'">'
    : '<img src="' + avatarUrl(u.first_name) + '" class="umodal-photo">';

  var isBlocked = parseInt(u.is_blocked) === 1;
  var blockBtn = isBlocked
    ? '<button class="btn-sm" style="color:var(--green);border-color:var(--green)" onclick="unblockUser(' + u.id + ')">✓ Blokdan olish</button>'
    : '<button class="btn-sm" style="color:var(--red);border-color:var(--red)" onclick="promptBlockUser(' + u.id + ')">⛔ Bloklash</button>';

  document.getElementById('userModalBody').innerHTML =
    '<div class="umodal-header">' + photo +
      '<div class="umodal-name">' + esc(name) + '</div>' +
      '<div class="umodal-username">' + (u.username ? '@' + esc(u.username) : '') + '</div>' +
      (isBlocked ? '<div style="margin-top:6px"><span class="badge badge-cancelled">Bloklangan' + (u.block_reason ? ': ' + esc(u.block_reason) : '') + '</span></div>' : '') +
    '</div>' +
    '<div class="umodal-rows">' +
      uRow('Telegram ID', u.id) +
      uRow('Ism', esc(name)) +
      uRow('Username', u.username ? '@'+esc(u.username) : '—') +
      uRow('Telefon', esc(u.phone || '—')) +
      uRow('Manzil', esc(u.address || '—')) +
      uRow('Buyurtmalar', (u.order_count || 0) + ' ta') +
      uRow('Jami xarid', fmt(u.total_spent || 0)) +
      uRow('Qo\'shilgan', u.created_at ? new Date(u.created_at.replace(' ','T')).toLocaleDateString('ru-RU') : '—') +
    '</div>' +
    '<div style="padding:12px 20px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)">' +
      '<a href="https://t.me/' + (u.username || '') + '" target="_blank" class="btn-primary" style="flex:1;text-align:center;text-decoration:none;' + (!u.username?'opacity:.4;pointer-events:none':'') + '">Telegram</a>' +
      '<a href="tel:' + (u.phone||'') + '" class="btn-sm" style="' + (!u.phone?'opacity:.4;pointer-events:none':'') + '">📞</a>' +
      '<button class="btn-sm" onclick="promptSendMessage(' + u.id + ')">✉️ Xabar</button>' +
      blockBtn +
    '</div>' +
    '<div style="padding:0 20px 16px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;padding-top:14px;border-top:1px solid var(--border)">Buyurtmalar tarixi</div>' +
      '<div id="userOrderHistory"><div style="text-align:center;padding:12px;color:var(--text-dim);font-size:13px">Yuklanmoqda...</div></div>' +
    '</div>';
  document.getElementById('userModal').classList.remove('hidden');
  // Buyurtmalar tarixini yuklash
  get(withAdmin('admin_user_orders&user_id=' + u.id)).then(function(res) {
    var el = document.getElementById('userOrderHistory');
    if (!el) return;
    if (!res.success || !res.data || !res.data.length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-dim);text-align:center;padding:8px 0">Buyurtmalar yo\'q</p>';
      return;
    }
    var statusMap = { new:'Yangi', confirmed:'Qabul', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };
    el.innerHTML = res.data.map(function(o) {
      var items = (o.items||[]).map(function(i){ return esc(i.name)+'×'+i.qty; }).join(', ');
      var date = o.created_at ? new Date(o.created_at.replace(' ','T')).toLocaleDateString('ru-RU') : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">' +
        '<div>' +
          '<span style="font-weight:600;color:var(--accent)">#'+o.id+'</span> ' +
          '<span class="badge badge-'+o.status+'" style="font-size:10px">'+(statusMap[o.status]||o.status)+'</span>' +
          '<div style="color:var(--text-dim);font-size:11px;margin-top:2px">'+items+'</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-weight:700">'+fmt(o.total)+'</div>' +
          '<div style="font-size:11px;color:var(--text-dim)">'+date+'</div>' +
        '</div>' +
      '</div>';
    }).join('');
  });
}

function uRow(label, val) {
  return '<div class="umodal-row"><span class="umodal-label">' + label + '</span><span class="umodal-val">' + val + '</span></div>';
}

function closeUserModal() { document.getElementById('userModal').classList.add('hidden'); }

// ── BLOCK / UNBLOCK ──
function promptBlockUser(userId) {
  var reason = prompt('Bloklash sababi (ixtiyoriy):');
  if (reason === null) return; // Cancel bosildi
  post('admin_block_user', { user_id: userId, reason: reason, admin_id: adminId }).then(function(res) {
    if (res.success) {
      adminToast('Foydalanuvchi bloklandi', 'success');
      closeUserModal();
      loadUsers();
    } else adminToast('Xatolik yuz berdi!', 'error');
  });
}

function unblockUser(userId) {
  if (!confirm('Foydalanuvchini blokdan chiqarasizmi?')) return;
  post('admin_unblock_user', { user_id: userId, admin_id: adminId }).then(function(res) {
    if (res.success) {
      adminToast('Foydalanuvchi blokdan chiqarildi', 'success');
      closeUserModal();
      loadUsers();
    } else adminToast('Xatolik yuz berdi!', 'error');
  });
}

// ── SEND MESSAGE ──
function promptSendMessage(userId) {
  var msg = prompt('Foydalanuvchiga yubormoqchi bo\'lgan xabaringiz:');
  if (!msg || !msg.trim()) return;
  post('admin_send_message', { user_id: userId, message: msg.trim(), admin_id: adminId }).then(function(res) {
    if (res.success) adminToast('Xabar yuborildi ✓', 'success');
    else adminToast('Xabar yuborilmadi!', 'error');
  });
}

// ── IMAGE UPLOAD ──
function handleImageUpload(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var status = document.getElementById('prodImageUploadStatus');
  var preview = document.getElementById('prodImagePreview');

  // Local preview
  var reader = new FileReader();
  reader.onload = function(e) {
    preview.innerHTML = '<img src="' + e.target.result + '">';
    preview.classList.add('has-img');
  };
  reader.readAsDataURL(file);

  // Upload to server
  status.textContent = '⏳ Yuklanmoqda...';
  status.className = 'uploading';

  var formData = new FormData();
  formData.append('image', file);

  fetch(UPLOAD_API, {
    method: 'POST',
    headers: apiHeaders(false),
    body: formData
  }).then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.success) {
        document.getElementById('prodImage').value = res.data.url;
        status.textContent = '✓ Yuklandi';
        status.className = 'success';
      } else {
        status.textContent = '✗ Xatolik: ' + (res.data || 'Yuklashda muammo');
        status.className = 'error';
      }
    })
    .catch(function() {
      status.textContent = '✗ Server bilan ulanishda xatolik';
      status.className = 'error';
    });
}

function handleImageUrl(input) {
  var url = input.value.trim();
  var preview = document.getElementById('prodImagePreview');
  if (!url) {
    preview.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.5"/><polyline points="21 15 16 10 5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Rasm tanlang</span>';
    preview.classList.remove('has-img');
    return;
  }
  var img = new Image();
  img.onload = function() {
    preview.innerHTML = '<img src="' + url + '">';
    preview.classList.add('has-img');
  };
  img.onerror = function() { preview.classList.remove('has-img'); };
  img.src = url;
}

function resetImageUpload() {
  var preview = document.getElementById('prodImagePreview');
  if (preview) {
    preview.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.5"/><polyline points="21 15 16 10 5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Rasm tanlang</span>';
    preview.classList.remove('has-img');
  }
  var status = document.getElementById('prodImageUploadStatus');
  if (status) { status.textContent = ''; status.className = ''; }
  var fileInput = document.getElementById('prodImageFile');
  if (fileInput) fileInput.value = '';
}

// ── PRODUCTS ──
function loadProducts() {
  get(withAdmin('admin_categories')).then(function(res) { if (res.success && res.data) categories = res.data; });
  get(withAdmin('admin_products')).then(function(res) {
    var el = document.getElementById('productsList');
    if (!res.success || !res.data || !res.data.length) { el.innerHTML = emptyState('Mahsulotlar yo\'q', iconBox()); return; }
    // Store products for editProduct access
    window._products = res.data;
    el.innerHTML = res.data.map(function(p, idx) {
      var avail = parseInt(p.available);
      var img = p.image
        ? '<img src="'+p.image+'" class="pac-img" onerror="this.style.display=\'none\'">'
        : '<div class="pac-img-placeholder">' + iconFood() + '</div>';
      return '<div class="product-admin-card">' +
        img +
        '<div class="pac-body">' +
          '<div class="pac-top">' +
            '<span class="pac-cat">' + esc(p.category_name || '') + '</span>' +
            '<span class="pac-avail ' + (avail ? 'avail-yes' : 'avail-no') + '">' + (avail ? 'Mavjud' : 'Yo\'q') + '</span>' +
          '</div>' +
          '<div class="pac-name">' + esc(p.name) + '</div>' +
          '<div class="pac-desc">' + esc(p.description || '') + '</div>' +
          '<div class="pac-footer">' +
            '<div class="pac-price">' + fmt(p.price) + '</div>' +
            '<div class="pac-actions">' +
              '<button class="btn-icon btn-edit" onclick="editProduct(' + p.id + ')">' + iconEdit() + '</button>' +
              '<button class="btn-icon btn-delete" onclick="deleteProduct(' + p.id + ')">' + iconTrash() + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showAddProduct() {
  document.getElementById('productModalTitle').textContent = 'Yangi mahsulot';
  document.getElementById('editProductId').value = '';
  ['prodName','prodDesc','prodPrice','prodImage'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('prodAvailGroup').style.display = 'none';
  resetImageUpload();
  fillCatSelect();
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(id) {
  var p = (window._products || []).find(function(x) { return x.id == id; });
  if (!p) return;
  document.getElementById('productModalTitle').textContent = p.name;
  document.getElementById('editProductId').value = p.id;
  document.getElementById('prodName').value = p.name || '';
  document.getElementById('prodDesc').value = p.description || '';
  document.getElementById('prodPrice').value = p.price || '';
  document.getElementById('prodImage').value = p.image || '';
  document.getElementById('prodAvailable').checked = parseInt(p.available) === 1;
  document.getElementById('prodAvailGroup').style.display = 'block';
  // Rasm preview
  resetImageUpload();
  if (p.image) {
    var prev = document.getElementById('prodImagePreview');
    if (prev) { prev.innerHTML = '<img src="' + p.image + '">'; prev.classList.add('has-img'); }
  }
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
    data.admin_id = adminId;
    post('admin_edit_product', data).then(function(res) {
      if (res.success) { adminToast('Mahsulot yangilandi'); closeProductModal(); loadProducts(); }
    });
  } else {
    data.admin_id = adminId;
    post('admin_add_product', data).then(function(res) {
      if (res.success) { adminToast('Mahsulot qo\'shildi'); closeProductModal(); loadProducts(); }
    });
  }
}

function deleteProduct(id) {
  if (!confirm('Bu mahsulotni o\'chirmoqchimisiz?')) return;
  post('admin_delete_product', { id: id, admin_id: adminId }).then(function(res) {
    if (res.success) { adminToast('Mahsulot o\'chirildi'); loadProducts(); }
  });
}

// ── BROADCAST ──
function sendBroadcast() {
  var msg = (document.getElementById('broadcastMsg').value || '').trim();
  var target = document.getElementById('broadcastTarget') ? document.getElementById('broadcastTarget').value : 'all';
  if (!msg) return adminToast('Xabar kiriting!');
  var targetLabel = target === 'active' ? 'faol foydalanuvchilarga' : 'barcha foydalanuvchilarga';
  if (!confirm(targetLabel + ' yuborasizmi?')) return;
  var btn = document.getElementById('broadcastBtn');
  btn.disabled = true; btn.textContent = 'Yuborilmoqda...';
  post('admin_broadcast', { message: msg, target: target, admin_id: adminId }).then(function(res) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Barchaga yuborish';
    var r = document.getElementById('broadcastResult');
    r.classList.remove('hidden');
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
function fmt(n) {
  var num = Number(n);
  if (num >= 1000000) return (num/1000000).toFixed(1).replace('.0','') + ' mln so\'m';
  if (num >= 1000) return (num/1000).toFixed(0) + ' ming so\'m';
  return num.toLocaleString('uz-UZ') + " so'm";
}
function fmtFull(n) { return Number(n).toLocaleString('uz-UZ') + " so'm"; }
function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
function avatarUrl(name) { return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name||'?') + '&background=ff6b35&color=fff&size=80&bold=true'; }
function emptyState(msg, icon) { return '<div class="empty-state">' + icon + '<p>' + msg + '</p></div>'; }

function adminToast(msg, type) {
  var t = document.getElementById('adminToast');
  t.textContent = msg;
  t.style.borderColor = type === 'error' ? 'rgba(239,68,68,.3)' : type === 'success' ? 'rgba(34,197,94,.3)' : '';
  t.style.setProperty('--dot', type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--accent)');
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(function() { t.classList.add('hidden'); }, 2800);
}

function get(action) {
  if (!adminReady) return Promise.resolve({ success: false });
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, 8000);
  return fetch(API + '?action=' + action, { signal: controller.signal, headers: apiHeaders(false) })
    .then(function(r) { clearTimeout(timer); return r.json(); })
    .catch(function() { clearTimeout(timer); return { success: false }; });
}

function post(action, data) {
  if (!adminReady) return Promise.resolve({ success: false });
  if (!data.admin_id) data.admin_id = adminId;
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, 8000);
  return fetch(API + '?action=' + action, {
    method: 'POST', headers: apiHeaders(true),
    body: JSON.stringify(data), signal: controller.signal
  }).then(function(r) { clearTimeout(timer); return r.json(); })
    .catch(function() { clearTimeout(timer); return { success: false }; });
}

// ── SVG ICONS ──
function iconCheck() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="9 12 11 14 15 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'; }
function iconBox() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconUsers() { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconFood() { return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconEdit() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconTrash() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconPhone() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.1 1.18 2 2 0 012.08 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconPin() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg>'; }
function iconClock() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:3px"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'; }
