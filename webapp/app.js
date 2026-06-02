const API = 'https://iftixorgo.bigsaver.ru/api.php';

// Telegram WebApp - optional
const tg = window.Telegram ? window.Telegram.WebApp : null;
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;

// Browser fallback user (saytdan kirganda)
const currentUser = tgUser || { id: 0, first_name: 'Mehmon', username: '', photo_url: '' };

let menu = [], cart = [], activeCat = 0, modalProduct = null, modalQty = 1;
const $ = id => document.getElementById(id);

// ── INIT ──
if (tg) tg.expand();
if (tg) tg.ready();

async function init() {
  // Splash 900ms dan keyin har qanday holatda yashiriladi
  const splashTimer = setTimeout(hideSplash, 900);

  try {
    if (tgUser && tgUser.id) await saveUser();
    else showGuestHeader();
    await loadMenu();
    if (tgUser && tgUser.id) { loadProfile(); loadOrderHistory(); }
    renderCart();
  } catch(e) {
    console.warn('Init error:', e);
  } finally {
    clearTimeout(splashTimer);
    hideSplash();
  }
}

function hideSplash() {
  const splash = $('splash');
  splash.style.opacity = '0';
  $('app').classList.remove('hidden');
  setTimeout(() => splash.style.display = 'none', 380);
}

function showGuestHeader() {
  $('headerName').textContent = 'Mehmon';
}

// ── USER ──
async function saveUser() {
  const res = await post('save_user', { user: tgUser });
  if (!res.success) return;

  $('headerName').textContent = tgUser.first_name || 'Foydalanuvchi';
  if (tgUser.photo_url) {
    $('headerAvatar').innerHTML = `<img src="${tgUser.photo_url}" alt="">`;
  }
}

// ── MENU ──
async function loadMenu() {
  const res = await get('get_menu');
  if (!res.success || !(res.data && res.data.length)) {
    $('productGrid').innerHTML = '<div style="padding:40px;text-align:center;color:var(--subtext)">Menyu yuklanmadi</div>';
    return;
  }
  menu = res.data;
  renderCats();
  renderProducts(0);
}

function renderCats() {
  const tabs = $('catTabs');
  tabs.innerHTML = '';
  const all = makeTab('Barchasi', true, () => filterCat(0));
  tabs.appendChild(all);
  menu.forEach(c => {
    const t = makeTab(c.name, false, () => filterCat(c.id, t));
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
    onClick();
  };
  return d;
}

function filterCat(catId) {
  activeCat = catId;
  renderProducts(catId);
}

function filterProducts(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.product-card').forEach(card => {
    card.style.display = card.dataset.name.includes(query) ? '' : 'none';
  });
}

function renderProducts(catId) {
  const grid = $('productGrid');
  grid.innerHTML = '';
  const all = catId === 0
    ? menu.reduce((acc, c) => acc.concat(c.products || []), [])
    : ((menu.find(c => c.id == catId) || {}).products || []);

  if (!all.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--subtext)">Mahsulot yo'q</div>`;
    return;
  }

  all.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.dataset.name = (p.name || '').toLowerCase();
    card.onclick = () => openModal(p);

    const imgHtml = p.image
      ? `<img src="${p.image}" class="product-thumb" alt="${p.name}" onerror="this.replaceWith(makePlaceholder())">`
      : thumbPlaceholder();

    card.innerHTML = `
      ${imgHtml}
      <div class="product-body">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        <button class="product-add" onclick="event.stopPropagation();quickAdd(${p.id})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="5" y1="12" x2="19" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>`;
    grid.appendChild(card);
  });
}

function thumbPlaceholder() {
  return `<div class="product-thumb-placeholder">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
      <path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/>
      <line x1="6" y1="1" x2="6" y2="4" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="10" y1="1" x2="10" y2="4" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14" y1="1" x2="14" y2="4" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </div>`;
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
  $('productModal').classList.remove('hidden');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeModal(e) {
  if (e.target.id === 'productModal') $('productModal').classList.add('hidden');
}

function changeModalQty(d) {
  modalQty = Math.max(1, modalQty + d);
  $('modalQty').textContent = modalQty;
}

function addFromModal() {
  if (!modalProduct) return;
  addToCart(modalProduct, modalQty);
  $('productModal').classList.add('hidden');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  toast(`${modalProduct.name} savatga qo'shildi`);
}

function quickAdd(id) {
  const p = menu.reduce((acc, c) => acc.concat(c.products || []), []).find(p => p.id == id);
  if (!p) return;
  addToCart(p, 1);
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  toast(`${p.name} qo'shildi`);
}

// ── CART ──
function addToCart(product, qty = 1) {
  const ex = cart.find(i => i.id == product.id);
  if (ex) ex.qty += qty;
  else cart.push({ id: product.id, name: product.name, price: +product.price, qty });
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

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  $('cartBadge').textContent = total;
  const nb = $('navCartBadge');
  nb.textContent = total;
  nb.style.display = total > 0 ? 'block' : 'none';
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

  container.innerHTML = cart.map(i => `
    <div class="cart-item">
      <div class="cart-item-img">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg>
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${i.name}</div>
        <div class="cart-item-price">${fmt(i.price)}</div>
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
    </div>`).join('');

  const sub = cartTotal(), delivery = 5000;
  summary.innerHTML = `
    <div class="cart-summary-card">
      <div class="summary-row"><span>Ovqatlar</span><span>${fmt(sub)}</span></div>
      <div class="summary-row"><span>Yetkazib berish</span><span>${fmt(delivery)}</span></div>
      <div class="summary-row total"><span>Jami</span><span>${fmt(sub + delivery)}</span></div>
    </div>
    <button class="btn-primary" onclick="goCheckout()">Buyurtma berish</button>`;
}

function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

function goCheckout() {
  if (!cart.length) return toast('Savat bo\'sh!');
  if (!(tgUser && tgUser.id)) return toast('Iltimos, Telegram orqali oching!');

  $('checkoutPhone').value = $('profilePhone') ? $('profilePhone').value : '';
  $('checkoutAddress').value = $('profileAddress') ? $('profileAddress').value : '';
  $('checkoutNote').value = '';

  const itemsHtml = cart.map(i =>
    `<div class="os-item"><span>${i.name} × ${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`
  ).join('');

  $('orderSummaryItems').innerHTML = `
    <div class="order-summary-card">
      ${itemsHtml}
    </div>`;
  $('checkoutTotalBar').innerHTML = `
    <div class="summary-row"><span>Ovqatlar</span><span>${fmt(cartTotal())}</span></div>
    <div class="summary-row"><span>Yetkazib berish</span><span>${fmt(5000)}</span></div>
    <div class="summary-row total"><span>Jami</span><span>${fmt(cartTotal() + 5000)}</span></div>`;

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
  btn.disabled = true; btn.textContent = 'Yuborilmoqda...';

  const res = await post('place_order', {
    user_id: tgUser && tgUser.id ? tgUser.id : 0,
    items: cart, phone, address, note
  });

  btn.disabled = false; btn.textContent = 'Buyurtma berish';

  if (res.success) {
    cart = [];
    renderCart();
    updateCartBadge();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if (tg && tg.BackButton) tg.BackButton.hide();
    if (tg) {
      tg.showAlert(`✅ Buyurtma qabul qilindi!\n\n#${res.data.order_id} — ${fmt(res.data.total + 5000)}\n\n30-60 daqiqada yetkazamiz!`);
    } else {
      toast('✅ Buyurtma qabul qilindi!');
    }
    navTo('home', document.querySelectorAll('.nav-item')[0]);
    loadOrderHistory();
  } else {
    toast('Xatolik! Qayta urinib ko\'ring.');
  }
}

// ── PROFILE ──
async function loadProfile() {
  if (!(tgUser && tgUser.id)) return;
  const res = await get(`get_profile&user_id=${tgUser.id}`);
  if (!res.success || !res.data) return;
  const u = res.data;
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();

  $('profileName').textContent = name || 'Foydalanuvchi';
  $('profileUsername').textContent = u.username ? `@${u.username}` : '';
  $('pId').textContent = u.id;
  $('pName').textContent = name || '—';
  $('pUsername').textContent = u.username ? `@${u.username}` : '—';
  if (u.phone) $('profilePhone').value = u.phone;
  if (u.address) $('profileAddress').value = u.address;

  const photo = u.photo_url || tgUser.photo_url || '';
  $('profilePhoto').src = photo
    ? photo
    : `https://ui-avatars.com/api/?name=${encodeURIComponent(u.first_name || 'U')}&background=ff6b35&color=fff&size=160&bold=true`;
}

async function saveProfile() {
  if (!(tgUser && tgUser.id)) return toast('Telegram orqali kirish kerak!');
  const phone = $('profilePhone').value.trim();
  const address = $('profileAddress').value.trim();
  const res = await post('update_profile', { user_id: tgUser.id, phone, address });
  if (res.success) { toast('Saqlandi!'); if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success'); }
}

async function loadOrderHistory() {
  if (!(tgUser && tgUser.id)) return;
  const res = await get(`my_orders&user_id=${tgUser.id}`);
  const el = $('orderHistory');
  if (!res.success || !(res.data && res.data.length)) {
    el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--subtext);font-size:13px">Buyurtmalar yo'q</div>`;
    return;
  }
  const sMap = { new:'Yangi', confirmed:'Qabul', cooking:'Tayyorlanmoqda', delivered:'Yetkazildi', cancelled:'Bekor' };
  const cMap = { new:'s-new', confirmed:'s-confirmed', cooking:'s-cooking', delivered:'s-delivered', cancelled:'s-cancelled' };
  el.innerHTML = res.data.map(o => `
    <div class="order-hist-item">
      <div class="order-hist-head">
        <span class="order-hist-id">#${o.id} — ${fmt(o.total)}</span>
        <span class="status-badge ${cMap[o.status] || 's-new'}">${sMap[o.status] || o.status}</span>
      </div>
      <div class="order-hist-sub">${new Date(o.created_at).toLocaleString('uz-UZ')} · ${o.items && o.items.length ? o.items.length : 0} ta</div>
    </div>`).join('');
}

// ── NAV ──
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`page-${name}`);
  if (pageEl) pageEl.classList.add('active');
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
function fmt(n) {
  return Number(n).toLocaleString('uz-UZ') + ' so\'m';
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2400);
}

async function post(action, data) {
  try {
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await r.json();
  } catch { return { success: false }; }
}

async function get(action) {
  try {
    const r = await fetch(`${API}?action=${action}`);
    return await r.json();
  } catch { return { success: false }; }
}

// Telegram Back Button
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    const activeEl = document.querySelector('.page.active');
    const active = activeEl ? activeEl.id : null;
    if (active === 'page-checkout') {
      navTo('cart', document.querySelectorAll('.nav-item')[1]);
    } else {
      tg.BackButton.hide();
    }
  });
}

init();
