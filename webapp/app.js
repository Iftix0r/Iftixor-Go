const API = new URL('../api.php', window.location.href).href;
const tg = window.Telegram ? window.Telegram.WebApp : null;
let tgUser = null;
let menu = [], cart = [], activeCat = 0, modalProduct = null, modalQty = 1;
let deliveryFee = 5000;
let orderPollTimer = null;
const $ = id => document.getElementById(id);

// ── CART: localStorage saqlash ──
function saveCart() {
  try { localStorage.setItem('iftixor_cart', JSON.stringify(cart)); } catch(e) {}
}
function loadCart() {
  try {
    const raw = localStorage.getItem('iftixor_cart');
    if (raw) cart = JSON.parse(raw) || [];
  } catch(e) { cart = []; }
}

// ── FMT: minglik ajratgich ──
function fmt(n) {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString('ru-RU').replace(/,/g, ' ') + " so'm";
}

// ── SPLASH ──
function hideSplash() {
  const splash = $('splash');
  if (!splash || splash.style.display === 'none') return;
  splash.style.opacity = '0';
  const appEl = $('app');
  if (appEl) appEl.classList.remove('hidden');
  setTimeout(() => { splash.style.display = 'none'; }, 380);
}

// ── INIT ──
async function init() {
  loadCart();
  if (tg) {
    try { tg.ready(); tg.expand(); } catch(e) {}
    try {
      tgUser = tg.initDataUnsafe?.user || null;
    } catch(e) { tgUser = null; }
  }
  const splashTimer = setTimeout(hideSplash, 1200);
  try {
    await loadConfig();
    if (tgUser?.id) await saveUser();
    else showGuestHeader();
    await loadMenu();
    if (tgUser?.id) { loadProfile(); loadOrderHistory(); }
    renderCart();
    updateCartBadge();
  } catch(e) {
    console.warn('Init error:', e);
    const hName = $('headerName');
    if (hName) hName.textContent = 'Mehmon';
  } finally {
    clearTimeout(splashTimer);
    hideSplash();
  }
}

// ── USER ──
async function saveUser() {
  const el = $('headerName');
  if (el) el.textContent = tgUser.first_name || 'Foydalanuvchi';
  if (tgUser.photo_url) {
    const av = $('headerAvatar');
    if (av) av.innerHTML = `<img src="${tgUser.photo_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  await post('save_user', { user: tgUser });
}

function showGuestHeader() {
  const el = $('headerName');
  if (el) el.textContent = 'Mehmon';
  const warn = $('guestWarning');
  if (warn) warn.style.display = 'flex';
}

async function loadConfig() {
  const res = await get('get_config');
  if (res.success && res.data?.delivery_fee != null) {
    deliveryFee = Number(res.data.delivery_fee);
  }
}

// ── MENU ──
async function loadMenu() {
  const res = await get('get_menu');
  if (!res.success || !res.data?.length) {
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
  // "Barchasi" tab - mahsulotlar jami sonini ko'rsat
  const totalCount = menu.reduce((s, c) => s + (c.products || []).length, 0);
  tabs.appendChild(makeTab(`🍽️ Barchasi`, true, () => filterCat(0), totalCount));
  menu.forEach(c => {
    const count = (c.products || []).length;
    tabs.appendChild(makeTab(`${c.icon || ''} ${c.name}`, false, () => filterCat(c.id), count));
  });
}

function makeTab(label, active, onClick, count) {
  const d = document.createElement('div');
  d.className = 'cat-tab' + (active ? ' active' : '');
  d.innerHTML = `${esc(label)}${count != null ? `<span class="cat-count">${count}</span>` : ''}`;
  d.onclick = () => {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    d.classList.add('active');
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
  if (!query) { renderProducts(activeCat); return; }
  const all = menu.reduce((acc, c) => acc.concat(c.products || []), []);
  const filtered = all.filter(p =>
    (p.name || '').toLowerCase().includes(query) ||
    (p.description || '').toLowerCase().includes(query)
  );
  const grid = $('productGrid');
  grid.innerHTML = '';
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state-msg">🔍 "${esc(q)}" bo'yicha natija topilmadi</div>`;
    return;
  }
  filtered.forEach(p => grid.appendChild(makeProductCard(p)));
}

function renderProducts(catId) {
  const grid = $('productGrid');
  grid.innerHTML = '';
  const all = catId === 0
    ? menu.reduce((acc, c) => acc.concat(c.products || []), [])
    : (menu.find(c => c.id == catId)?.products || []);
  if (!all.length) {
    grid.innerHTML = `<div class="empty-state-msg">Mahsulot yo'q</div>`;
    return;
  }
  all.forEach(p => grid.appendChild(makeProductCard(p)));
}

function makeProductCard(p) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.onclick = () => openModal(p);
  const cartItem = cart.find(i => i.id == p.id);
  const inCart = cartItem ? cartItem.qty : 0;

  // Rasm — onerror inline string ishlatilmaydi, DOM orqali
  if (p.image) {
    const img = document.createElement('img');
    img.src = p.image;
    img.className = 'product-thumb';
    img.alt = p.name || '';
    img.loading = 'lazy';
    img.onerror = function() {
      const ph = document.createElement('div');
      ph.className = 'product-thumb-placeholder';
      ph.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg>';
      this.replaceWith(ph);
    };
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'product-thumb-placeholder';
    ph.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg>';
    card.appendChild(ph);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'product-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'product-name';
  nameEl.textContent = p.name || '';
  body.appendChild(nameEl);

  if (p.description) {
    const desc = document.createElement('div');
    desc.className = 'product-desc';
    desc.textContent = p.description;
    body.appendChild(desc);
  }

  const row = document.createElement('div');
  row.className = 'product-row';

  const price = document.createElement('div');
  price.className = 'product-price';
  price.textContent = fmt(p.price);
  row.appendChild(price);

  if (inCart > 0) {
    const ctrl = document.createElement('div');
    ctrl.className = 'product-qty-ctrl';
    ctrl.id = 'pqc-' + p.id;
    const btnM = document.createElement('button');
    btnM.className = 'pqc-btn';
    btnM.textContent = '−';
    btnM.onclick = e => { e.stopPropagation(); changeCardQty(p.id, -1); };
    const val = document.createElement('span');
    val.className = 'pqc-val';
    val.textContent = inCart;
    const btnP = document.createElement('button');
    btnP.className = 'pqc-btn';
    btnP.textContent = '+';
    btnP.onclick = e => { e.stopPropagation(); changeCardQty(p.id, 1); };
    ctrl.append(btnM, val, btnP);
    row.appendChild(ctrl);
  } else {
    const btn = document.createElement('button');
    btn.className = 'product-add';
    btn.onclick = e => { e.stopPropagation(); quickAdd(p.id); };
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>';
    row.appendChild(btn);
  }

  body.appendChild(row);
  card.appendChild(body);
  return card;
}

function thumbPlaceholder() {
  return '<div class="product-thumb-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M18 8h1a4 4 0 010 8h-1" stroke="#ff6b35" stroke-width="1.5" stroke-linecap="round"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="#ff6b35" stroke-width="1.5"/></svg></div>';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function changeCardQty(id, d) {
  const item = cart.find(i => i.id == id);
  if (!item) return;
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(i => i.id != id);
  saveCart();
  updateCartBadge();
  const ctrl = document.getElementById('pqc-' + id);
  if (!ctrl) { renderProducts(activeCat); return; }
  if (item && item.qty > 0) {
    ctrl.querySelector('.pqc-val').textContent = item.qty;
  } else {
    const btn = document.createElement('button');
    btn.className = 'product-add';
    btn.onclick = e => { e.stopPropagation(); quickAdd(id); };
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
  $('modalAddBtn').textContent = `Savatga qo'shish · ${fmt(p.price)}`;
  const img = $('modalImg');
  if (p.image) { img.src = p.image; img.style.display = 'block'; }
  else img.style.display = 'none';
  $('productModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
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
  $('modalAddBtn').textContent = `Savatga qo'shish · ${fmt(modalProduct.price * modalQty)}`;
}

function addFromModal() {
  if (!modalProduct) return;
  addToCart(modalProduct, modalQty);
  $('productModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  toast(`✓ ${modalProduct.name} savatga qo'shildi`);
  renderProducts(activeCat);
}

function quickAdd(id) {
  const p = menu.reduce((acc, c) => acc.concat(c.products || []), []).find(p => p.id == id);
  if (!p) return;
  addToCart(p, 1);
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  toast(`✓ ${p.name} qo'shildi`);
  renderProducts(activeCat);
}

// ── CART ──
function addToCart(product, qty = 1) {
  const ex = cart.find(i => i.id == product.id);
  if (ex) ex.qty += qty;
  else cart.push({ id: product.id, name: product.name, price: +product.price, qty, image: product.image || '' });
  saveCart();
  updateCartBadge();
}

function updateCartQty(id, d) {
  const item = cart.find(i => i.id == id);
  if (!item) return;
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(i => i.id != id);
  saveCart();
  renderCart();
  updateCartBadge();
}

function clearCart() {
  if (!cart.length) return;
  if (!confirm('Savatni tozalaysizmi?')) return;
  cart = [];
  saveCart();
  renderCart();
  updateCartBadge();
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const badge = $('cartBadge');
  if (badge) badge.textContent = total;
  const nb = $('navCartBadge');
  if (nb) { nb.textContent = total; nb.style.display = total > 0 ? 'flex' : 'none'; }
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
          <div class="cart-item-price">${fmt(i.price)} × ${i.qty}</div>
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

  const sub = cartTotal();
  summary.innerHTML = `
    <div class="cart-summary-card">
      <div class="summary-row"><span>Ovqatlar</span><span>${fmt(sub)}</span></div>
      <div class="summary-row"><span>Yetkazib berish</span><span class="delivery-chip">${fmt(deliveryFee)}</span></div>
      <div class="summary-row total"><span>Jami</span><span>${fmt(sub + deliveryFee)}</span></div>
    </div>
    <div class="checkout-info-bar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      30–60 daqiqada yetkazamiz
    </div>
    <button class="btn-primary btn-checkout" onclick="goCheckout()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="white" stroke-width="2" stroke-linecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="white" stroke-width="2"/></svg>
      Buyurtma berish — ${fmt(sub + deliveryFee)}
    </button>`;
}

function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

// ── CHECKOUT ──
function goCheckout() {
  if (!cart.length) return toast('Savat bo\'sh!');
  if (!tgUser?.id) {
    toast('Iltimos, Telegram orqali oching!');
    return;
  }

  // Profil ma'lumotlarini auto to'ldirish (DB dan yuklangan)
  const savedPhone   = $('profilePhone')?.value?.trim() || '';
  const savedAddress = $('profileAddress')?.value?.trim() || '';
  $('checkoutPhone').value   = savedPhone;
  $('checkoutAddress').value = savedAddress;
  $('checkoutNote').value    = '';

  // Telefon yo'q bo'lsa hint ko'rsat
  if (!savedPhone) {
    const phoneRow = $('checkoutPhone').closest('.input-row') || $('checkoutPhone').parentElement;
    if (phoneRow) {
      const hint = document.createElement('div');
      hint.className = 'phone-hint';
      hint.textContent = '💡 Botda "📱 Telefon raqamimni yuborish" bosib saqlang';
      if (!document.querySelector('.phone-hint')) {
        phoneRow.insertAdjacentElement('afterend', hint);
      }
    }
  }

  const sub = cartTotal();
  $('orderSummaryItems').innerHTML = `
    <div class="order-summary-card">
      ${cart.map(i => `
        <div class="os-item">
          <span>${esc(i.name)} <span class="os-qty">× ${i.qty}</span></span>
          <span>${fmt(i.price * i.qty)}</span>
        </div>`).join('')}
    </div>`;
  $('checkoutTotalBar').innerHTML = `
    <div class="summary-row"><span>Ovqatlar</span><span>${fmt(sub)}</span></div>
    <div class="summary-row"><span>Yetkazib berish</span><span class="delivery-chip">${fmt(deliveryFee)}</span></div>
    <div class="summary-row total"><span>Jami</span><span>${fmt(sub + deliveryFee)}</span></div>
    <div class="checkout-time-hint">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Taxminiy yetkazish: 30–60 daqiqa
    </div>`;

  showPage('checkout');
  if (tg?.BackButton) tg.BackButton.show();
}

// Telegram contact so'rash
function requestPhone() {
  // Profil sahifasida saqlangan telefon bormi?
  const profilePhone = $('profilePhone')?.value?.trim();
  if (profilePhone) {
    const pInput = $('checkoutPhone');
    if (pInput) {
      pInput.value = profilePhone;
      pInput.style.borderColor = 'var(--green)';
      setTimeout(() => { pInput.style.borderColor = ''; }, 1500);
      toast('✓ Telefon raqam to\'ldirildi');
    }
    return;
  }

  // Profilda telefon yo'q — botga yo'naltirish
  if (tg) {
    tg.showPopup({
      title: 'Telefon raqam kerak',
      message: 'Telegram botga o\'tib, "📱 Telefon raqamimni yuborish" tugmasini bosing. Keyin qaytib keling.',
      buttons: [
        { id: 'open_bot', type: 'default', text: 'Botga o\'tish' },
        { id: 'cancel', type: 'cancel' }
      ]
    }, (btnId) => {
      if (btnId === 'open_bot') {
        tg.openTelegramLink('https://t.me/' + (tg.initDataUnsafe?.bot?.username || 'IftixorGoBot'));
      }
    });
  } else {
    toast('Telefon raqamingizni qo\'lda kiriting');
  }
}

// ── ORDER ──
async function submitOrder() {
  const phone   = $('checkoutPhone').value.trim();
  const address = $('checkoutAddress').value.trim();
  const note    = $('checkoutNote').value.trim();

  if (!phone)   return toast('Telefon raqam kiriting!');
  if (!/^\+?[\d\s\-\(\)]{7,15}$/.test(phone)) return toast('Telefon raqam noto\'g\'ri!');
  if (!address) return toast('Manzil kiriting!');
  if (address.length < 5) return toast('Manzilni to\'liq kiriting!');

  const btn = document.querySelector('.btn-order');
  if (btn) { btn.disabled = true; btn.textContent = 'Yuborilmoqda...'; }

  const res = await post('place_order', {
    user_id: tgUser?.id || 0,
    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    phone, address, note
  });

  if (res.success) {
    cart = []; saveCart();
    renderCart(); updateCartBadge();
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if (tg?.BackButton) tg.BackButton.hide();
    showOrderSuccess(res.data.order_id, res.data.total);
    loadOrderHistory();
    startOrderPolling(res.data.order_id);
  } else {
    const msg = typeof res.data === 'string' ? res.data : 'Xatolik yuz berdi!';
    toast('❌ ' + msg);
    if (btn) { btn.disabled = false; btn.textContent = 'Buyurtma berish'; }
  }
}

// ── ORDER STATUS POLLING ──
function startOrderPolling(orderId) {
  stopOrderPolling();
  let attempts = 0;
  const maxAttempts = 20; // ~5 daqiqa
  orderPollTimer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) { stopOrderPolling(); return; }
    const res = await get(`my_orders&user_id=${tgUser?.id}`);
    if (!res.success || !res.data) return;
    const order = res.data.find(o => o.id == orderId);
    if (!order) return;
    updateSuccessStatus(order.status);
    if (order.status === 'delivered' || order.status === 'cancelled') {
      stopOrderPolling();
      loadOrderHistory();
    }
  }, 15000); // har 15 soniyada
}

function stopOrderPolling() {
  if (orderPollTimer) { clearInterval(orderPollTimer); orderPollTimer = null; }
}

function updateSuccessStatus(status) {
  const el = $('successStatus');
  if (!el) return;
  const map = {
    new:       { text: '⏳ Tasdiqlanmoqda...', cls: 'status-new' },
    confirmed: { text: '✅ Qabul qilindi!', cls: 'status-confirmed' },
    cooking:   { text: '👨‍🍳 Tayyorlanmoqda...', cls: 'status-cooking' },
    delivered: { text: '🚚 Yetkazildi!', cls: 'status-delivered' },
    cancelled: { text: '❌ Bekor qilindi', cls: 'status-cancelled' },
  };
  const s = map[status] || map.new;
  el.textContent = s.text;
  el.className = 'success-status-badge ' + s.cls;
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
      <div id="successStatus" class="success-status-badge status-new">⏳ Tasdiqlanmoqda...</div>
      <div class="success-desc">30–60 daqiqada yetkazamiz 🚀</div>
      <div class="success-actions">
        <button class="btn-primary" onclick="navTo('profile', document.querySelectorAll('.nav-item')[2]);scrollToOrders()" style="margin-bottom:8px">
          📋 Buyurtmalarimni ko'rish
        </button>
        <button class="btn-secondary" onclick="navTo('home', document.querySelectorAll('.nav-item')[0])">
          Menyuga qaytish
        </button>
      </div>`;
  }
}

function scrollToOrders() {
  setTimeout(() => {
    const el = $('orderHistory');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

// ── PROFILE ──
async function loadProfile() {
  if (!tgUser?.id) return;
  const res = await get(`get_profile&user_id=${tgUser.id}`);
  if (!res.success || !res.data) return;
  const u = res.data;
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  setText('profileName', name || 'Foydalanuvchi');
  setText('profileUsername', u.username ? `@${u.username}` : '');
  setText('pId', u.id);
  setText('pName', name || '—');
  setText('pUsername', u.username ? `@${u.username}` : '—');
  if (u.phone) { const pp = $('profilePhone'); if (pp) pp.value = u.phone; }
  if (u.address) { const pa = $('profileAddress'); if (pa) pa.value = u.address; }
  const photo = u.photo_url || tgUser?.photo_url || '';
  const pPhoto = $('profilePhoto');
  if (pPhoto) pPhoto.src = photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.first_name || 'U')}&background=ff6b35&color=fff&size=160&bold=true`;
}

async function saveProfile() {
  if (!tgUser?.id) return toast('Telegram orqali kirish kerak!');
  const phone   = $('profilePhone').value.trim();
  const address = $('profileAddress').value.trim();
  if (phone && !/^\+?[\d\s\-\(\)]{7,15}$/.test(phone)) return toast('Telefon raqam noto\'g\'ri!');
  const btn = document.querySelector('#page-profile .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saqlanmoqda...'; }
  const res = await post('update_profile', { user_id: tgUser.id, phone, address });
  if (btn) { btn.disabled = false; btn.textContent = 'Saqlash'; }
  if (res.success) {
    toast('✓ Saqlandi!');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } else {
    toast('Xatolik yuz berdi!');
  }
}

// ── ORDER HISTORY ──
async function loadOrderHistory() {
  if (!tgUser?.id) return;
  const res = await get(`my_orders&user_id=${tgUser.id}`);
  const el = $('orderHistory');
  if (!el) return;

  if (!res.success || !res.data?.length) {
    el.innerHTML = `
      <div class="orders-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="#c7c7cc" stroke-width="1.5" stroke-linecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="#c7c7cc" stroke-width="1.5"/></svg>
        <p>Buyurtmalar yo'q</p>
      </div>`;
    setText('statOrdersCount', '0');
    setText('statTotalSpent', "0 so'm");
    return;
  }

  const orders = res.data;
  setText('statOrdersCount', orders.length);
  const spent = orders.reduce((a, o) => a + (o.status !== 'cancelled' ? +o.total : 0), 0);
  // Profil stats uchun qisqa format (1 250 000 → 1.25 mln)
  const spentShort = spent >= 1000000
    ? (spent/1000000).toFixed(2).replace(/\.?0+$/,'') + " mln so'm"
    : fmt(spent);
  setText('statTotalSpent', spentShort);

  const sMap = { new:'🆕 Yangi', confirmed:'✅ Qabul qilindi', cooking:'👨‍🍳 Tayyorlanmoqda', delivered:'🚚 Yetkazildi', cancelled:'❌ Bekor' };
  const cMap = { new:'s-new', confirmed:'s-confirmed', cooking:'s-cooking', delivered:'s-delivered', cancelled:'s-cancelled' };

  // Faol buyurtmalar (delivered/cancelled emas) yuqorida
  const sorted = [...orders].sort((a, b) => {
    const active = s => s !== 'delivered' && s !== 'cancelled';
    if (active(a.status) && !active(b.status)) return -1;
    if (!active(a.status) && active(b.status)) return 1;
    return 0;
  });

  el.innerHTML = sorted.map(o => {
    const items = (o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
    const d = o.created_at ? new Date(o.created_at.replace(' ','T')) : null;
    const date = d ? `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
    const isActive = o.status !== 'delivered' && o.status !== 'cancelled';
    return `
    <div class="order-hist-item${isActive ? ' order-active' : ''}">
      <div class="order-hist-head">
        <span class="order-hist-id">#${o.id}</span>
        <span class="status-badge ${cMap[o.status]||'s-new'}">${sMap[o.status]||o.status}</span>
      </div>
      <div class="order-hist-items">${esc(items || '—')}</div>
      <div class="order-hist-foot">
        <span class="order-hist-date">📅 ${date}</span>
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
  if (name !== 'success') stopOrderPolling();
}

function navTo(name, el) {
  showPage(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'profile') { loadProfile(); loadOrderHistory(); }
  if (name === 'cart') renderCart();
  if (name !== 'checkout' && name !== 'success') {
    if (tg?.BackButton) tg.BackButton.hide();
  }
}

// ── HELPERS ──
function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function toast(msg, duration = 2600) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  t.style.animation = 'none';
  t.offsetHeight; // reflow
  t.style.animation = '';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), duration);
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (tg?.initData) h['X-Telegram-Init-Data'] = tg.initData;
  return h;
}

async function post(action, data) {
  try {
    // initData ni body ga ham qo'shamiz (header o'tmaydigan serverlar uchun)
    if (tg?.initData && !data.init_data) data.init_data = tg.initData;
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST', headers: apiHeaders(),
      body: JSON.stringify(data)
    });
    return await r.json();
  } catch { return { success: false }; }
}

async function get(action) {
  try {
    // initData ni URL ga ham qo'shamiz
    const sep = action.includes('&') ? '&' : '?';
    const url = tg?.initData
      ? `${API}?action=${action}&init_data=${encodeURIComponent(tg.initData)}`
      : `${API}?action=${action}`;
    const r = await fetch(url, { headers: apiHeaders() });
    return await r.json();
  } catch { return { success: false }; }
}

// ── TELEGRAM BACK BUTTON ──
if (tg?.BackButton) {
  tg.BackButton.onClick(() => {
    const active = document.querySelector('.page.active');
    if (active?.id === 'page-checkout') {
      navTo('cart', document.querySelectorAll('.nav-item')[1]);
    } else if (active?.id === 'page-success') {
      navTo('home', document.querySelectorAll('.nav-item')[0]);
    } else {
      tg.BackButton.hide();
    }
  });
}

// ── TELEGRAM THEME ──
if (tg) {
  const setTheme = () => {
    const c = tg.themeParams;
    if (c?.bg_color)   document.documentElement.style.setProperty('--tg-bg', c.bg_color);
    if (c?.text_color) document.documentElement.style.setProperty('--tg-text', c.text_color);
  };
  setTheme();
  tg.onEvent('themeChanged', setTheme);
}

init();
