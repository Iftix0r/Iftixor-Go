const API = new URL('../api.php', window.location.href).href;
const tg = window.Telegram ? window.Telegram.WebApp : null;
let tgUser = null;
let menu = [], cart = [], activeCat = 0, modalProduct = null, modalQty = 1;
let deliveryFee = 5000;
const $ = id => document.getElementById(id);

// ── INIT ──
window.addEventListener('load', function() {
  setTimeout(function() {
    var s = $('splash'), a = $('app');
    if (s && s.style.display !== 'none') {
      s.style.opacity = '0';
      if (a) a.classList.remove('hidden');
      setTimeout(function() { s.style.display = 'none'; }, 400);
    }
  }, 3000);
});

async function init() {
  if (tg) {
    try { tg.ready(); tg.expand(); } catch(e) {}
    try { tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null; } catch(e) { tgUser = null; }
  }
  const splashTimer = setTimeout(hideSplash, 900);
  try {
    await loadConfig();
    if (tgUser && tgUser.id) await saveUser();
    else showGuestHeader();
    await loadMenu();
    if (tgUser && tgUser.id) { loadProfile(); loadOrderHistory(); }
    renderCart();
  } catch(e) {
    console.warn('Init error:', e);
    var hName = $('headerName');
    if (hName) hName.textContent = 'Mehmon';
  } finally {
    clearTimeout(splashTimer);
    hideSplash();
  }
}

function hideSplash() {
  var splash = $('splash');
  if (!splash || splash.style.display === 'none') return;
  splash.style.opacity = '0';
  var appEl = $('app');
  if (appEl) appEl.classList.remove('hidden');
  setTimeout(function() { splash.style.display = 'none'; }, 380);
}

function showGuestHeader() {
  const el = $('headerName');
  if (el) el.textContent = 'Mehmon';
}

// ── USER ──
async function saveUser() {
  const el = $('headerName');
  if (el) el.textContent = tgUser.first_name || 'Foydalanuvchi';
  if (tgUser.photo_url && $('headerAvatar'))
    $('headerAvatar').innerHTML = `<img src="${tgUser.photo_url}" alt="">`;
  const res = await post('save_user', { user: tgUser });
  if (!res.success) console.warn('save_user failed');
}

async function loadConfig() {
  const res = await get('get_config');
  if (res.success && res.data && res.data.delivery_fee != null) {
    deliveryFee = Number(res.data.delivery_fee);
  }
}

// ── MENU ──
async function loadMenu() {
  const res = await get('get_menu');
  if (!res.success || !(res.data && res.data.length)) {
    $('productGrid').innerHTML = '<div class="empty-state-msg">Menyu yuklanmadi. Qayta urinib ko\'ring.</div>';
    return;
  }
  menu = res.data;
  renderCats();
  renderProducts(0);
}

function renderCats() {
  const tabs = $('catTabs');
  tabs.innerHTML = '';
  const all = makeTab('🍽️ Barchasi', true, () => filterCat(0));
  tabs.appendChild(all);
  menu.forEach(c => {
    const t = makeTab((c.icon || '') + ' ' + c.name, false, () => filterCat(c.id));
    tabs.appendChild(t);
  });
}

function makeTab(label, active, onClick) {
  const d = document.createElement('div');
  d.className = 'cat-tab' + (active ? ' active' : '');
  d.textContent = label;
  d.onclick = () => {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    d.classList.add('active');
    // Clear search
    const si = $('searchInput');
    if (si) si.value = '';
    onClick();
  };
  return d;
}

function filterCat(catId) {
  activeCat = catId;
  renderProducts(catId);
}

function filterProducts(q) {
  const query = q.toLowerCase().trim();
  if (!query) {
    renderProducts(activeCat);
    return;
  }
  // Search across all products
  const all = menu.reduce((acc, c) => acc.concat(c.products || []), []);
  const filtered = all.filter(p => (p.name || '').toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query));
  const grid = $('productGrid');
  grid.innerHTML = '';
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state-msg">"${q}" bo'yicha natija topilmadi</div>`;
    return;
  }
  filtered.forEach(p => grid.appendChild(makeProductCard(p)));
}

function renderProducts(catId) {
  const grid = $('productGrid');
  grid.innerHTML = '';
  const all = catId === 0
    ? menu.reduce((acc, c) => acc.concat(c.products || []), [])
    : ((menu.find(c => c.id == catId) || {}).products || []);
  if (!all.length) {
    grid.innerHTML = `<div class="empty-state-msg">Mahsulot yo'q</div>`;
    return;
  }
  all.forEach(p => grid.appendChild(makeProductCard(p)));
}

function makeProductCard(p) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.name = (p.name || '').toLowerCase();
  card.onclick = () => openModal(p);
  const cartItem = cart.find(i => i.id == p.id);
  const inCart = cartItem ? cartItem.qty : 0;

  const imgHtml = p.image
    ? `<img src="${p.image}" class="product-thumb" alt="${esc(p.name)}" loading="lazy" onerror="this.parentElement.innerHTML='${thumbPlaceholder().replace(/'/g,"\\'")}'">`
    : thumbPlaceholder();

  card.innerHTML = `
    ${imgHtml}
    <div class="product-body">
      <div class="product-name">${esc(p.name)}</div>
      ${p.description ? `<div class="product-desc">${esc(p.description)}</div>` : ''}
      <div class="product-row">
        <div class="product-price">${fmt(p.price)}</div>
        ${inCart > 0
          ? `<div class="product-qty-ctrl" id="pqc-${p.id}">
              <button class="pqc-btn" onclick="event.stopPropagation();changeCardQty(${p.id},-1)">−</button>
              <span class="pqc-val">${inCart}</span>
              <button class="pqc-btn pqc-plus" onclick="event.stopPropagation();changeCardQty(${p.id},1)">+</button>
             </div>`
          : `<button class="product-add" onclick="event.stopPropagation();quickAdd(${p.id})">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
             </button>`
        }
      </div>
    </div>`;
  return card;
}

function thumbPlaceholder() {
  return `<div class="product-thumb-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg></div>`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function changeCardQty(id, d) {
  const item = cart.find(i => i.id == id);
  if (!item) return;
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(i => i.id != id);
  updateCartBadge();
  // Re-render only that card's ctrl
  const ctrl = document.getElementById('pqc-' + id);
  if (!ctrl) { renderProducts(activeCat); return; }
  if (item && item.qty > 0) {
    ctrl.querySelector('.pqc-val').textContent = item.qty;
  } else {
    const btn = document.createElement('button');
    btn.className = 'product-add';
    btn.onclick = function(e) { e.stopPropagation(); quickAdd(id); };
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>';
    ctrl.replaceWith(btn);
  }
}

// ── MODAL ──
function openModal(p) {
  modalProduct = p; modalQty = 1;
  $('modalName').textContent = p.name;
  $('modalDesc').textContent = p.description || '';
  $('modalPrice').textContent = fmt(p.price);
  $('modalQty').textContent = '1';
  const img = $('modalImg');
  if (p.image) { img.src = p.image; img.style.display = 'block'; }
  else img.style.display = 'none';
  // Show existing qty
  const existing = cart.find(i => i.id == p.id);
  if (existing) { modalQty = 1; }
  $('productModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeModal(e) {
  if (!e || e.target.id === 'productModal' || e.currentTarget.id === 'modalCloseBtn') {
    $('productModal').classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function changeModalQty(d) {
  modalQty = Math.max(1, modalQty + d);
  $('modalQty').textContent = modalQty;
  $('modalAddBtn').textContent = modalQty > 1
    ? `Savatga qo'shish · ${fmt(modalProduct.price * modalQty)}`
    : `Savatga qo'shish · ${fmt(modalProduct.price)}`;
}

function addFromModal() {
  if (!modalProduct) return;
  addToCart(modalProduct, modalQty);
  $('productModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  toast(`${modalProduct.name} savatga qo'shildi ✓`);
  renderProducts(activeCat);
}

function quickAdd(id) {
  const p = menu.reduce((acc, c) => acc.concat(c.products || []), []).find(p => p.id == id);
  if (!p) return;
  addToCart(p, 1);
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  toast(`${p.name} qo'shildi`);
  renderProducts(activeCat);
}

// ── CART ──
function addToCart(product, qty = 1) {
  const ex = cart.find(i => i.id == product.id);
  if (ex) ex.qty += qty;
  else cart.push({ id: product.id, name: product.name, price: +product.price, qty, image: product.image || '' });
  updateCartBadge();
}

function updateCartQty(id, d) {
  const item = cart.find(i => i.id == id);
  if (!item) return;
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(i => i.id != id);
  renderCart();
  updateCartBadge();
}

function clearCart() {
  if (!cart.length) return;
  if (!confirm('Savatni tozalaysizmi?')) return;
  cart = [];
  renderCart();
  updateCartBadge();
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const badge = $('cartBadge');
  if (badge) { badge.textContent = total; }
  const nb = $('navCartBadge');
  if (nb) { nb.textContent = total; nb.style.display = total > 0 ? 'block' : 'none'; }
}

function renderCart() {
  const container = $('cartItems');
  const summary = $('cartSummary');
  updateCartBadge();

  if (!cart.length) {
    container.innerHTML = `
      <div class="empty-cart">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="#c7c7cc" stroke-width="1.5" stroke-linejoin="round"/><line x1="3" y1="6" x2="21" y2="6" stroke="#c7c7cc" stroke-width="1.5"/><path d="M16 10a4 4 0 01-8 0" stroke="#c7c7cc" stroke-width="1.5"/></svg>
        <p>Savat bo'sh</p>
        <small>Menuydan ovqat tanlang</small>
      </div>`;
    summary.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="cart-header">
      <span>${cart.reduce((s,i)=>s+i.qty,0)} ta mahsulot</span>
      <button class="cart-clear-btn" onclick="clearCart()">Tozalash</button>
    </div>` +
    cart.map(i => {
      const imgHtml = i.image
        ? `<img src="${i.image}" class="cart-item-img-photo" alt="" onerror="this.style.display='none'">`
        : `<div class="cart-item-img"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg></div>`;
      return `
      <div class="cart-item">
        ${imgHtml}
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(i.name)}</div>
          <div class="cart-item-price">${fmt(i.price * i.qty)}</div>
        </div>
        <div class="cart-item-ctrl">
          <button class="qty-btn" onclick="updateCartQty(${i.id},-1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
          <span class="qty-val">${i.qty}</span>
          <button class="qty-btn" onclick="updateCartQty(${i.id},1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

  const sub = cartTotal(), delivery = deliveryFee;
  summary.innerHTML = `
    <div class="cart-summary-card">
      <div class="summary-row"><span>Ovqatlar</span><span>${fmt(sub)}</span></div>
      <div class="summary-row"><span>Yetkazib berish</span><span class="delivery-chip">${fmt(delivery)}</span></div>
      <div class="summary-row total"><span>Jami</span><span>${fmt(sub + delivery)}</span></div>
    </div>
    <button class="btn-primary btn-checkout" onclick="goCheckout()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="white" stroke-width="2" stroke-linecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="white" stroke-width="2"/></svg>
      Buyurtma berish — ${fmt(sub + delivery)}
    </button>`;
}

function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

// ── CHECKOUT ──
function goCheckout() {
  if (!cart.length) return toast('Savat bo\'sh!');
  if (!(tgUser && tgUser.id)) return toast('Iltimos, Telegram orqali oching!');

  // Avvalgi ma'lumotlarni to'ldirish
  const ph = $('profilePhone'), ad = $('profileAddress');
  $('checkoutPhone').value = ph ? ph.value : '';
  $('checkoutAddress').value = ad ? ad.value : '';
  $('checkoutNote').value = '';

  const sub = cartTotal(), delivery = deliveryFee;
  $('orderSummaryItems').innerHTML = `
    <div class="order-summary-card">
      ${cart.map(i => `<div class="os-item"><span>${esc(i.name)} × ${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`).join('')}
    </div>`;
  $('checkoutTotalBar').innerHTML = `
    <div class="summary-row"><span>Ovqatlar</span><span>${fmt(sub)}</span></div>
    <div class="summary-row"><span>Yetkazib berish</span><span>${fmt(delivery)}</span></div>
    <div class="summary-row total"><span>Jami</span><span>${fmt(sub + delivery)}</span></div>`;

  showPage('checkout');
  if (tg && tg.BackButton) tg.BackButton.show();
}

// ── ORDER ──
async function submitOrder() {
  const phone = $('checkoutPhone').value.trim();
  const address = $('checkoutAddress').value.trim();
  const note = $('checkoutNote').value.trim();
  if (!phone) return toast('Telefon raqam kiriting!');
  if (!address) return toast('Manzil kiriting!');

  const btn = document.querySelector('.btn-order');
  if (btn) { btn.disabled = true; btn.textContent = 'Yuborilmoqda...'; }

  const res = await post('place_order', {
    user_id: tgUser && tgUser.id ? tgUser.id : 0,
    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    phone, address, note
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Buyurtma berish'; }

  if (res.success) {
    cart = [];
    renderCart();
    updateCartBadge();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if (tg && tg.BackButton) tg.BackButton.hide();
    showOrderSuccess(res.data.order_id, res.data.total);
    loadOrderHistory();
  } else {
    const msg = typeof res.data === 'string' ? res.data : 'Xatolik yuz berdi!';
    toast('❌ ' + msg);
    if (btn) { btn.disabled = false; btn.textContent = 'Buyurtma berish'; }
  }
}

function showOrderSuccess(orderId, total) {
  showPage('success');
  const el = $('successContent');
  if (el) {
    el.innerHTML = `
      <div class="success-icon">✅</div>
      <div class="success-title">Buyurtma qabul qilindi!</div>
      <div class="success-id">#${orderId}</div>
      <div class="success-total">${fmt(total)}</div>
      <div class="success-desc">30–60 daqiqada yetkazamiz 🚀</div>
      <button class="btn-primary" onclick="navTo('home', document.querySelectorAll('.nav-item')[0])" style="margin-top:8px">Menyuga qaytish</button>`;
  }
}

// ── PROFILE ──
async function loadProfile() {
  if (!(tgUser && tgUser.id)) return;
  const res = await get(`get_profile&user_id=${tgUser.id}`);
  if (!res.success || !res.data) return;
  const u = res.data;
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  setText('profileName', name || 'Foydalanuvchi');
  setText('profileUsername', u.username ? `@${u.username}` : '');
  setText('pId', u.id);
  setText('pName', name || '—');
  setText('pUsername', u.username ? `@${u.username}` : '—');
  if (u.phone && $('profilePhone')) $('profilePhone').value = u.phone;
  if (u.address && $('profileAddress')) $('profileAddress').value = u.address;
  const photo = u.photo_url || (tgUser && tgUser.photo_url) || '';
  const pPhoto = $('profilePhoto');
  if (pPhoto) pPhoto.src = photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.first_name || 'U')}&background=ff6b35&color=fff&size=160&bold=true`;
}

async function saveProfile() {
  if (!(tgUser && tgUser.id)) return toast('Telegram orqali kirish kerak!');
  const phone = $('profilePhone').value.trim();
  const address = $('profileAddress').value.trim();
  const res = await post('update_profile', { user_id: tgUser.id, phone, address });
  if (res.success) {
    toast('✓ Saqlandi!');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } else {
    toast('Xatolik!');
  }
}

async function loadOrderHistory() {
  if (!(tgUser && tgUser.id)) return;
  const res = await get(`my_orders&user_id=${tgUser.id}`);
  const el = $('orderHistory');
  if (!el) return;
  if (!res.success || !(res.data && res.data.length)) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--subtext);font-size:13px">Buyurtmalar yo'q</div>`;
    setText('statOrdersCount', '0');
    setText('statTotalSpent', "0 so'm");
    return;
  }
  setText('statOrdersCount', res.data.length);
  const spent = res.data.reduce((a, o) => a + (o.status !== 'cancelled' ? +o.total : 0), 0);
  setText('statTotalSpent', fmt(spent));

  const sMap = { new:'Yangi', confirmed:'Qabul qilindi', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };
  const cMap = { new:'s-new', confirmed:'s-confirmed', cooking:'s-cooking', delivered:'s-delivered', cancelled:'s-cancelled' };
  el.innerHTML = res.data.map(o => {
    const items = (o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
    const date = o.created_at ? new Date(o.created_at.replace(' ','T')).toLocaleDateString('uz-UZ') : '';
    return `
    <div class="order-hist-item">
      <div class="order-hist-head">
        <span class="order-hist-id">#${o.id}</span>
        <span class="status-badge ${cMap[o.status]||'s-new'}">${sMap[o.status]||o.status}</span>
      </div>
      <div class="order-hist-items">${esc(items || '—')}</div>
      <div class="order-hist-foot">
        <span class="order-hist-date">${date}</span>
        <span class="order-hist-total">${fmt(o.total)}</span>
      </div>
    </div>`;
  }).join('');
}

// ── NAV ──
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = $(`page-${name}`);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function navTo(name, el) {
  showPage(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'profile') { loadProfile(); loadOrderHistory(); }
  if (name === 'cart') renderCart();
  if (name !== 'checkout') { if (tg && tg.BackButton) tg.BackButton.hide(); }
}

// ── HELPERS ──
function fmt(n) { return Number(n).toLocaleString('uz-UZ') + ' so\'m'; }

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
  return h;
}

async function post(action, data) {
  try {
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(data)
    });
    return await r.json();
  } catch { return { success: false }; }
}

async function get(action) {
  try {
    const r = await fetch(`${API}?action=${action}`, { headers: apiHeaders() });
    return await r.json();
  } catch { return { success: false }; }
}

// ── TELEGRAM BACK BUTTON ──
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    const active = document.querySelector('.page.active');
    if (active && active.id === 'page-checkout') {
      navTo('cart', document.querySelectorAll('.nav-item')[1]);
    } else if (active && active.id === 'page-success') {
      navTo('home', document.querySelectorAll('.nav-item')[0]);
    } else {
      tg.BackButton.hide();
    }
  });
}

init();
