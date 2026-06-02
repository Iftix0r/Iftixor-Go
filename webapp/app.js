const API = '../api.php';
const tg = window.Telegram?.WebApp;
const tgUser = tg?.initDataUnsafe?.user || {};

let menu = [], cart = [], activeCat = 0, modalProduct = null, modalQty = 1;
const $ = id => document.getElementById(id);

// Init
tg?.expand();
tg?.setHeaderColor('#ff6b35');

async function init() {
  await saveUser();
  await loadMenu();
  loadProfile();
  loadOrderHistory();
  renderCart();

  setTimeout(() => {
    $('splash').style.opacity = '0';
    setTimeout(() => { $('splash').style.display = 'none'; $('app').classList.remove('hidden'); }, 400);
  }, 1200);
}

// Telegram user save
async function saveUser() {
  if (!tgUser.id) return;
  // Try to get profile photo
  let photoUrl = tgUser.photo_url || '';
  await post('save_user', { user: { ...tgUser, photo_url: photoUrl } });

  // Update header
  $('headerName').textContent = tgUser.first_name || 'Foydalanuvchi';
  if (photoUrl) {
    $('headerAvatar').innerHTML = `<img src="${photoUrl}" alt="">`;
  }
}

// Menu
async function loadMenu() {
  const res = await get('get_menu');
  if (!res.success) return;
  menu = res.data;
  renderCats();
  renderProducts(activeCat);
}

function renderCats() {
  const tabs = $('catTabs');
  tabs.innerHTML = `<div class="cat-tab active" onclick="filterCat(0, this)">🍽️ Barchasi</div>`;
  menu.forEach(c => {
    const d = document.createElement('div');
    d.className = 'cat-tab';
    d.textContent = `${c.icon} ${c.name}`;
    d.onclick = () => filterCat(c.id, d);
    tabs.appendChild(d);
  });
}

function filterCat(catId, el) {
  activeCat = catId;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderProducts(catId);
}

function filterProducts(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.product-card').forEach(card => {
    card.style.display = card.dataset.name.toLowerCase().includes(query) ? '' : 'none';
  });
}

function renderProducts(catId) {
  const grid = $('productGrid');
  grid.innerHTML = '';
  const all = catId === 0 ? menu.flatMap(c => c.products) : (menu.find(c => c.id == catId)?.products || []);
  all.forEach(p => {
    const div = document.createElement('div');
    div.className = 'product-card';
    div.dataset.name = p.name;
    div.onclick = () => openModal(p);
    const imgHtml = p.image
      ? `<img src="${p.image}" class="product-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    div.innerHTML = `
      ${imgHtml}
      <div class="product-img no-img" ${p.image ? 'style="display:none"' : ''}>🍽️</div>
      <div class="product-body">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        <button class="product-add" onclick="event.stopPropagation();quickAdd(${p.id})">+</button>
      </div>`;
    grid.appendChild(div);
  });
}

// Product Modal
function openModal(p) {
  modalProduct = p; modalQty = 1;
  $('modalName').textContent = p.name;
  $('modalDesc').textContent = p.description || 'Mazali taom';
  $('modalPrice').textContent = fmt(p.price);
  $('modalQty').textContent = '1';
  const img = $('modalImg');
  if (p.image) { img.src = p.image; img.style.display = ''; }
  else img.style.display = 'none';
  $('productModal').classList.remove('hidden');
}

function closeModal(e) {
  if (e.target === $('productModal') || !e) $('productModal').classList.add('hidden');
}

function changeModalQty(d) {
  modalQty = Math.max(1, modalQty + d);
  $('modalQty').textContent = modalQty;
}

function addFromModal() {
  if (!modalProduct) return;
  addToCart(modalProduct, modalQty);
  $('productModal').classList.add('hidden');
  tg?.HapticFeedback?.notificationOccurred('success');
  toast(`✅ ${modalProduct.name} savatga qo'shildi`);
}

function quickAdd(id) {
  const p = menu.flatMap(c => c.products).find(p => p.id == id);
  if (p) { addToCart(p, 1); toast(`✅ ${p.name} qo'shildi`); }
}

// Cart
function addToCart(product, qty = 1) {
  const existing = cart.find(i => i.id === product.id);
  if (existing) existing.qty += qty;
  else cart.push({ id: product.id, name: product.name, price: parseFloat(product.price), qty });
  renderCart();
  updateCartBadge();
}

function updateCartQty(id, d) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  renderCart();
  updateCartBadge();
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  $('cartBadge').textContent = total;
}

function renderCart() {
  const container = $('cartItems');
  const summary = $('cartSummary');
  updateCartBadge();

  if (cart.length === 0) {
    container.innerHTML = `<div class="empty-cart">🛒<br><br>Savat bo'sh<br><small>Menuydan ovqat tanlang</small></div>`;
    summary.innerHTML = '';
    return;
  }

  container.innerHTML = cart.map(i => `
    <div class="cart-item">
      <div class="cart-item-emoji">🍽️</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${i.name}</div>
        <div class="cart-item-price">${fmt(i.price)} × ${i.qty}</div>
      </div>
      <div class="cart-item-ctrl">
        <button class="qty-btn" onclick="updateCartQty(${i.id},-1)">−</button>
        <span class="qty-val">${i.qty}</span>
        <button class="qty-btn" onclick="updateCartQty(${i.id},1)">+</button>
      </div>
    </div>`).join('');

  const subtotal = cartTotal();
  const delivery = 5000;
  summary.innerHTML = `
    <div class="summary-row"><span>Ovqatlar</span><span>${fmt(subtotal)}</span></div>
    <div class="summary-row"><span>Yetkazib berish</span><span>${fmt(delivery)}</span></div>
    <div class="summary-row total"><span>Jami</span><span>${fmt(subtotal + delivery)}</span></div>
    <button class="btn-primary" style="margin-top:14px" onclick="goCheckout()">📦 Buyurtma berish</button>`;
}

function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

function goCheckout() {
  if (cart.length === 0) return toast('⚠️ Savat bo\'sh!');
  // Pre-fill from profile
  const phone = $('profilePhone')?.value || '';
  const address = $('profileAddress')?.value || '';
  $('checkoutPhone').value = phone;
  $('checkoutAddress').value = address;

  const items = $('orderSummaryItems');
  items.innerHTML = cart.map(i =>
    `<div class="os-item"><span>${i.name} × ${i.qty}</span><span>${fmt(i.price*i.qty)}</span></div>`
  ).join('') + `<div class="os-item" style="font-weight:700"><span>Jami</span><span>${fmt(cartTotal()+5000)}</span></div>`;
  $('checkoutTotal').textContent = fmt(cartTotal() + 5000);
  showPage('checkout');
}

// Order submission
async function submitOrder() {
  const phone = $('checkoutPhone').value.trim();
  const address = $('checkoutAddress').value.trim();
  const note = $('checkoutNote').value.trim();

  if (!phone) return toast('⚠️ Telefon raqam kiriting!');
  if (!address) return toast('⚠️ Manzil kiriting!');

  const btn = document.querySelector('.btn-order');
  btn.disabled = true; btn.textContent = '⏳ Yuborilmoqda...';

  const res = await post('place_order', {
    user_id: tgUser.id || 0,
    items: cart,
    phone, address, note
  });

  btn.disabled = false; btn.textContent = '✅ Buyurtma berish';

  if (res.success) {
    cart = [];
    renderCart();
    tg?.HapticFeedback?.notificationOccurred('success');
    tg?.showAlert(`✅ Buyurtmangiz qabul qilindi!\n\n📦 Buyurtma №${res.data.order_id}\n💰 Jami: ${fmt(res.data.total + 5000)}\n\n🕐 30-60 daqiqada yetkazamiz!`);
    showPage('home');
    navTo('home', document.querySelector('.nav-item'));
    loadOrderHistory();
  } else {
    toast('❌ Xatolik! Qayta urinib ko\'ring.');
  }
}

// Profile
async function loadProfile() {
  if (!tgUser.id) return;
  const res = await get(`get_profile&user_id=${tgUser.id}`);
  if (!res.success || !res.data) return;
  const u = res.data;

  $('profileName').textContent = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Foydalanuvchi';
  $('profileUsername').textContent = u.username ? `@${u.username}` : '';
  $('pId').textContent = u.id;
  $('pName').textContent = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  $('pUsername').textContent = u.username ? `@${u.username}` : '—';
  if (u.phone) $('profilePhone').value = u.phone;
  if (u.address) $('profileAddress').value = u.address;

  const photo = u.photo_url || tgUser.photo_url || '';
  if (photo) $('profilePhoto').src = photo;
  else $('profilePhoto').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.first_name||'U')}&background=ff6b35&color=fff&size=200`;
}

async function saveProfile() {
  const phone = $('profilePhone').value.trim();
  const address = $('profileAddress').value.trim();
  if (!phone && !address) return toast('⚠️ Ma\'lumot kiriting');
  const res = await post('update_profile', { user_id: tgUser.id, phone, address });
  if (res.success) { toast('✅ Saqlandi!'); tg?.HapticFeedback?.notificationOccurred('success'); }
}

async function loadOrderHistory() {
  if (!tgUser.id) return;
  const res = await get(`my_orders&user_id=${tgUser.id}`);
  const container = $('orderHistory');
  if (!res.success || !res.data?.length) {
    container.innerHTML = '<div style="color:var(--subtext);font-size:13px;text-align:center;padding:12px">Buyurtmalar yo\'q</div>';
    return;
  }
  const statusMap = { new:'🆕 Yangi', confirmed:'✅ Qabul', cooking:'👨‍🍳 Tayyorlanmoqda', delivered:'🚚 Yetkazildi', cancelled:'❌ Bekor' };
  const statusClass = { new:'s-new', confirmed:'s-confirmed', cooking:'s-new', delivered:'s-confirmed', cancelled:'s-cancelled' };
  container.innerHTML = res.data.map(o => `
    <div class="order-hist-item">
      <div class="order-hist-head">
        <span>#${o.id} — ${fmt(o.total)}</span>
        <span class="status-badge ${statusClass[o.status]||'s-new'}">${statusMap[o.status]||o.status}</span>
      </div>
      <div class="order-hist-sub">${new Date(o.created_at).toLocaleString('uz-UZ')} • ${o.items?.length||0} ta mahsulot</div>
    </div>`).join('');
}

// Navigation
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`page-${name}`)?.classList.add('active');
}

function navTo(name, el) {
  showPage(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  if (name === 'profile') { loadProfile(); loadOrderHistory(); }
  if (name === 'cart') renderCart();
}

// Helpers
function fmt(n) { return Number(n).toLocaleString('uz-UZ') + ' so\'m'; }
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

async function post(action, data) {
  try {
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return r.json();
  } catch { return { success: false }; }
}

async function get(action) {
  try {
    const r = await fetch(`${API}?action=${action}`);
    return r.json();
  } catch { return { success: false }; }
}

// Telegram back button
tg?.BackButton?.onClick(() => {
  const active = document.querySelector('.page.active')?.id;
  if (active === 'page-checkout') { showPage('cart'); }
  else { tg.BackButton.hide(); }
});

init();
