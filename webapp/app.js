const API = new URL('../api.php', window.location.href).href;
const tg = window.Telegram ? window.Telegram.WebApp : null;
let tgUser = null;
let menu = [], cart = [], activeCat = 0, activeRestaurant = null, modalProduct = null, modalQty = 1;
let deliveryFee = 5000;
let orderPollTimer = null;
let taxiPollTimer = null;

const taxiState = {
  carType: 'ekonom',
  price: 0,
  distKm: 0,
  fromLat: 0, fromLon: 0, toLat: 0, toLon: 0,
  allPrices: {},
  geocoded: false,
  lastRideId: null,
  ordersFilter: 'all',
  tariffs: {
    ekonom:  { label: 'Ekonom',  icon: '🚗', min: 7000 },
    comfort: { label: 'Comfort', icon: '🚙', min: 12000 },
    minivan: { label: 'Minivan', icon: '🚐', min: 18000 },
  },
};

const TAXI_POPULAR = [
  { label: '✈️ Aeroport', field: 'to', value: 'Toshkent xalqaro aeroporti' },
  { label: '🚉 Vokzal', field: 'to', value: 'Toshkent vokzali' },
  { label: '🏥 Shifoxona', field: 'to', value: 'Shifoxona' },
  { label: '🛒 Bozor', field: 'to', value: 'Bozor' },
  { label: '🏫 Universitet', field: 'to', value: 'Universitet' },
  { label: '🏠 Uyga', field: 'to', value: 'Uy' },
];

const TAXI_STATUS = {
  new:       { text: '🆕 Yangi',           step: 0 },
  accepted:  { text: '✅ Qabul qilindi',    step: 1 },
  on_way:    { text: '🚕 Yo\'lda',          step: 2 },
  arrived:   { text: '📍 Yetib keldi',      step: 3 },
  completed: { text: '✓ Tugallandi',        step: 4 },
  cancelled: { text: '❌ Bekor',             step: -1 },
};
const $ = id => document.getElementById(id);

// ── SOUND ENGINE (Web Audio API, faylsiz) ──
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _audioCtx;
}

function playSound(type) {
  // Telegram HapticFeedback ham ishlatamiz
  try {
    if (tg?.HapticFeedback) {
      const hmap = {
        add:     () => tg.HapticFeedback.impactOccurred('medium'),
        remove:  () => tg.HapticFeedback.impactOccurred('light'),
        success: () => tg.HapticFeedback.notificationOccurred('success'),
        error:   () => tg.HapticFeedback.notificationOccurred('error'),
        tap:     () => tg.HapticFeedback.impactOccurred('light'),
        clear:   () => tg.HapticFeedback.notificationOccurred('warning'),
      };
      hmap[type]?.();
    }
  } catch(e) {}

  const ctx = getAudioCtx();
  if (!ctx) return;

  // AudioContext foydalanuvchi harakati bilan yoqilishi kerak
  if (ctx.state === 'suspended') { ctx.resume(); }

  const sounds = {
    // Savatga qo'shish: ko'tariluvchi 2 notalı "pop"
    add: () => {
      _beep(ctx, 'sine',    520, 0.13, 0,    0.08, 0.06);
      _beep(ctx, 'sine',    780, 0.10, 0.07, 0.08, 0.06);
    },
    // Savatdan olib tashlash: tushuvchi "pop"
    remove: () => {
      _beep(ctx, 'sine',    440, 0.10, 0,    0.06, 0.05);
      _beep(ctx, 'sine',    300, 0.07, 0.05, 0.06, 0.05);
    },
    // Buyurtma berildi: muvaffaqiyat akkord
    success: () => {
      _beep(ctx, 'sine',    523, 0.12, 0,    0.10, 0.08);
      _beep(ctx, 'sine',    659, 0.12, 0.10, 0.10, 0.08);
      _beep(ctx, 'sine',    784, 0.15, 0.20, 0.18, 0.10);
    },
    // Xatolik: ikki marta past
    error: () => {
      _beep(ctx, 'square', 220, 0.12, 0,    0.10, 0.08);
      _beep(ctx, 'square', 180, 0.10, 0.13, 0.10, 0.08);
    },
    // Tugma bosildi: yumshoq klik
    tap: () => {
      _beep(ctx, 'sine',   600, 0.07, 0, 0.05, 0.04);
    },
    // Savatni tozalash: sliding down
    clear: () => {
      _beepSlide(ctx, 400, 180, 0.10, 0, 0.25);
    },
    // Modal ochildi: yengil "whoosh"
    open: () => {
      _beep(ctx, 'sine',   800, 0.06, 0,    0.04, 0.08);
      _beep(ctx, 'sine',   640, 0.05, 0.04, 0.06, 0.06);
    },
  };

  sounds[type]?.();
}

// Oddiy beep: tembr, chastota, tovush balandligi, boshlash, davomiylik, so'nish
function _beep(ctx, type, freq, vol, startOffset, dur, release) {
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
    gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + startOffset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + dur + release);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + dur + release + 0.01);
  } catch(e) {}
}

// Sliding (glide) beep: chastota boshliqdan oxirgacha o'zgaradi
function _beepSlide(ctx, freqFrom, freqTo, vol, startOffset, dur) {
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqFrom, ctx.currentTime + startOffset);
    osc.frequency.exponentialRampToValueAtTime(freqTo, ctx.currentTime + startOffset + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime + startOffset);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + dur);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + dur + 0.02);
  } catch(e) {}
}


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

// ── SERVICE SELECTION ──
let currentService = null;

const SERVICE_LABELS = {
  food: { title: 'Menyu', sub: 'Ovqatlar' },
  taxi: { title: 'Taxi', sub: 'Taxi xizmati' },
};

function toggleServiceMenu() {
  const d = $('serviceDrawer');
  if (!d) return;
  d.classList.toggle('hidden');
  document.body.style.overflow = d.classList.contains('hidden') ? '' : 'hidden';
}

function closeServiceMenu() {
  const d = $('serviceDrawer');
  if (d) d.classList.add('hidden');
  document.body.style.overflow = '';
}

function pickServiceFromMenu(type) {
  closeServiceMenu();
  selectService(type);
}

function getActivePageId() {
  return document.querySelector('.page.active')?.id?.replace('page-', '') || 'service';
}

function updateHeader() {
  const hamburger = $('btnHamburger');
  const back = $('btnBack');
  const cartBtn = $('cartBtn');
  const sub = $('headerSub');
  const name = $('headerName');
  const page = getActivePageId();
  const onHub = !currentService || page === 'service';

  if (hamburger) hamburger.classList.toggle('hidden', !onHub);
  if (back) back.classList.toggle('hidden', onHub);

  const app = $('app');
  if (app) app.classList.toggle('mode-hub', onHub);

  if (onHub) {
    if (cartBtn) cartBtn.classList.add('hidden');
    if (name) name.textContent = 'Iftixor Go';
    if (sub) sub.textContent = 'Xizmatlar';
    if (tg?.BackButton) tg.BackButton.hide();
    return;
  }

  if (currentService === 'food') {
    const titles = {
      home: { t: 'Menyu', s: 'Ovqatlar' },
      cart: { t: 'Savat', s: 'Ovqatlar' },
      profile: { t: 'Profil', s: 'Ovqatlar' },
      checkout: { t: 'Buyurtma', s: 'Ovqatlar' },
      success: { t: 'Tayyor', s: 'Ovqatlar' },
    };
    const lbl = titles[page] || SERVICE_LABELS.food;
    if (name) name.textContent = lbl.t;
    if (sub) sub.textContent = lbl.s;
    const showCart = page === 'home' || page === 'cart';
    if (cartBtn) cartBtn.classList.toggle('hidden', !showCart);
    if (tg?.BackButton) {
      if (page === 'checkout' || page === 'success') tg.BackButton.show();
      else tg.BackButton.hide();
    }
  } else if (currentService === 'taxi') {
    const titles = {
      taxi: { t: 'Taxi', s: 'Taxi xizmati' },
      'taxi-orders': { t: 'Buyurtmalarim', s: 'Taxi' },
      'taxi-profile': { t: 'Profil', s: 'Taxi' },
      'taxi-success': { t: 'Qabul qilindi', s: 'Taxi' },
    };
    const lbl = titles[page] || SERVICE_LABELS.taxi;
    if (name) name.textContent = lbl.t;
    if (sub) sub.textContent = lbl.s;
    if (cartBtn) cartBtn.classList.add('hidden');
    if (tg?.BackButton) {
      if (page === 'taxi-success') tg.BackButton.show();
      else tg.BackButton.hide();
    }
  }
}

function goBack() {
  playSound('tap');
  const page = getActivePageId();
  if (currentService === 'food') {
    if (page === 'checkout') { showFoodPage('cart'); return; }
    if (page === 'success') { navTo('service'); return; }
    navTo('service');
    return;
  }
  if (currentService === 'taxi') {
    if (page === 'taxi-success') { showTaxiPage('taxi'); return; }
    navTo('service');
  }
}

function selectService(type) {
  closeServiceMenu();
  currentService = type;
  showAllNavs('none');
  if (type === 'food') {
    $('navFood').style.display = 'flex';
    showPage('home');
    setFoodNav('navFoodMenu');
  } else if (type === 'taxi') {
    $('navTaxi').style.display = 'flex';
    initTaxiPage();
    showPage('taxi');
    setTaxiNav('navTaxiMain');
  }
  updateHeader();
}

function navTo(name) {
  if (name === 'service') {
    showAllNavs('none');
    showPage('service');
    currentService = null;
    updateHeader();
    return;
  }
  showPage(name);
  if (name === 'profile' && currentService === 'food') { loadProfile(); loadOrderHistory(); }
  if (name === 'cart') renderCart();
  updateHeader();
}

function showFoodPage(name) {
  showPage(name);
  if (name === 'home')    setFoodNav('navFoodMenu');
  if (name === 'cart')   { renderCart(); setFoodNav('navFoodCart'); }
  if (name === 'profile'){ loadProfile(); loadOrderHistory(); setFoodNav('navFoodProfile'); }
  updateHeader();
}

function showTaxiPage(name) {
  const pageMap = { taxi: 'taxi', orders: 'taxi-orders', profile: 'taxi-profile' };
  showPage(pageMap[name] || name);
  if (name === 'taxi')    { initTaxiPage(); setTaxiNav('navTaxiMain'); }
  if (name === 'orders') { loadTaxiRideHistory(); setTaxiNav('navTaxiOrders'); }
  if (name === 'profile'){ loadTaxiProfile(); setTaxiNav('navTaxiProfile'); }
  updateHeader();
}

function setFoodNav(activeId) {
  ['navFoodMenu','navFoodCart','navFoodProfile'].forEach(id => {
    const el = $(id); if (el) el.classList.remove('active');
  });
  const el = $(activeId); if (el) el.classList.add('active');
}

function setTaxiNav(activeId) {
  ['navTaxiMain','navTaxiOrders','navTaxiProfile'].forEach(id => {
    const el = $(id); if (el) el.classList.remove('active');
  });
  const el = $(activeId); if (el) el.classList.add('active');
}

function showAllNavs(val) {
  ['navFood','navTaxi'].forEach(id => {
    const el = $(id); if (el) el.style.display = val;
  });
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
    if (tgUser?.id) loadProfile();
    renderCart();
    updateCartBadge();
    showPage('service');
    showAllNavs('none');
    updateGreeting();
    updateHeader();
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
  updateGreeting();
  if (tgUser.photo_url) {
    const av = $('headerAvatar');
    if (av) av.innerHTML = `<img src="${tgUser.photo_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  await post('save_user', { user: tgUser });
}

function updateGreeting() {
  const el = $('servicesGreet');
  if (!el) return;
  const n = tgUser?.first_name || 'Mehmon';
  el.textContent = `Assalomu alaykum, ${n} 👋`;
}

function showGuestHeader() {
  updateGreeting();
  const warn = $('guestWarning');
  if (warn) warn.style.display = 'flex';
}

async function loadConfig() {
  const res = await get('get_config');
  if (res.success && res.data) {
    if (res.data.delivery_fee != null) deliveryFee = Number(res.data.delivery_fee);
    if (res.data.taxi_tariffs) taxiState.tariffs = res.data.taxi_tariffs;
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
  let all = menu.reduce((acc, c) => acc.concat(c.products || []), []);
  if (activeRestaurant) all = all.filter(p => p.restaurant_id == activeRestaurant);
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
  let all = catId === 0
    ? menu.reduce((acc, c) => acc.concat(c.products || []), [])
    : (menu.find(c => c.id == catId)?.products || []);
  
  if (activeRestaurant) {
    all = all.filter(p => p.restaurant_id == activeRestaurant);
  }

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

  if (p.restaurant_name) {
    const rest = document.createElement('div');
    rest.className = 'product-restaurant';
    rest.innerHTML = '🏪 ' + esc(p.restaurant_name);
    rest.onclick = (e) => {
      e.stopPropagation();
      setRestaurantFilter(p.restaurant_id, p.restaurant_name);
    };
    body.appendChild(rest);
  }

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
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id != id);
    playSound('remove');
  } else {
    playSound(d > 0 ? 'add' : 'remove');
  }
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
  
  let descText = p.description || '';
  if (p.restaurant_name) {
    descText = '🏪 ' + p.restaurant_name + (descText ? '\n\n' + descText : '');
  }
  $('modalDesc').textContent = descText;
  
  $('modalPrice').textContent = fmt(p.price);
  $('modalQty').textContent = '1';
  $('modalAddBtn').textContent = `Savatga qo'shish · ${fmt(p.price)}`;
  const img = $('modalImg');
  if (p.image) { img.src = p.image; img.style.display = 'block'; }
  else img.style.display = 'none';
  $('productModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  playSound('open');
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
  playSound('tap');
}

function addFromModal() {
  if (!modalProduct) return;
  addToCart(modalProduct, modalQty);
  $('productModal').classList.add('hidden');
  document.body.style.overflow = '';
  playSound('add');
  toast(`✓ ${modalProduct.name} savatga qo'shildi`);
  renderProducts(activeCat);
}

function quickAdd(id) {
  const p = menu.reduce((acc, c) => acc.concat(c.products || []), []).find(p => p.id == id);
  if (!p) return;
  addToCart(p, 1);
  playSound('add');
  toast(`✓ ${p.name} qo'shildi`);
  renderProducts(activeCat);
}

function setRestaurantFilter(id, name) {
  activeRestaurant = id;
  const si = $('searchInput');
  if (si) si.value = '';
  $('restFilterBar').innerHTML = `
    <div class="rest-filter-content">
      <span>🏪 <b>${esc(name)}</b> restoranining barcha mahsulotlari</span>
      <button onclick="clearRestaurantFilter()">✕</button>
    </div>
  `;
  $('restFilterBar').classList.remove('hidden');
  renderProducts(activeCat);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearRestaurantFilter() {
  activeRestaurant = null;
  $('restFilterBar').classList.add('hidden');
  $('restFilterBar').innerHTML = '';
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
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id != id);
    playSound('remove');
  } else {
    playSound(d > 0 ? 'add' : 'remove');
  }
  saveCart();
  renderCart();
  updateCartBadge();
}

function clearCart() {
  if (!cart.length) return;
  if (!confirm('Savatni tozalaysizmi?')) return;
  cart = [];
  saveCart();
  playSound('clear');
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
  if (!tgUser?.id) return toast('Buyurtma uchun Telegram orqali oching!');
  if (!tg?.initData) return toast('Ilovani yoping va botdan qayta oching!');

  const phone   = $('checkoutPhone').value.trim();
  const address = $('checkoutAddress').value.trim();
  const note    = $('checkoutNote').value.trim();

  if (!phone)   return toast('Telefon raqam kiriting!');
  if (!/^\+?[\d\s\-\(\)]{7,15}$/.test(phone)) return toast('Telefon raqam noto\'g\'ri!');
  if (!address) return toast('Manzil kiriting!');
  if (address.length < 5) return toast('Manzilni to\'liq kiriting!');
  if (!cart.length) return toast('Savat bo\'sh!');

  const btn = document.querySelector('.btn-order');
  if (btn) { btn.disabled = true; btn.textContent = 'Yuborilmoqda...'; }

  await saveUser();

  const res = await post('place_order', {
    user_id: tgUser.id,
    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    phone, address, note
  });

  if (res.success) {
    cart = []; saveCart();
    renderCart(); updateCartBadge();
    playSound('success');
    if (tg?.BackButton) tg.BackButton.hide();
    showOrderSuccess(res.data.order_id, res.data.total);
    loadOrderHistory();
    startOrderPolling(res.data.order_id);
  } else {
    const msg = apiErrorMessage(res, 'Buyurtma yuborilmadi');
    playSound('error');
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
        <button class="btn-primary" onclick="showFoodPage('profile');scrollToOrders()" style="margin-bottom:8px">
          📋 Buyurtmalarimni ko'rish
        </button>
        <button class="btn-secondary" onclick="navTo('service')">
          Xizmatlarga
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
    playSound('success');
  } else {
    playSound('error');
    toast('Xatolik yuz berdi!');
  }
}

// ── TAXI PROFILE & ORDERS ──
async function loadTaxiProfile() {
  if (!tgUser?.id) return;
  const res = await get(`get_profile&user_id=${tgUser.id}`);
  if (!res.success || !res.data) return;
  const u = res.data;
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  setText('taxiProfileName', name || 'Foydalanuvchi');
  setText('taxiProfileUsername', u.username ? `@${u.username}` : '');
  if (u.phone) { const tp = $('taxiProfilePhone'); if (tp) tp.value = u.phone; }
  const photo = u.photo_url || tgUser?.photo_url || '';
  const pPhoto = $('taxiProfilePhoto');
  if (pPhoto) pPhoto.src = photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.first_name || 'U')}&background=2563eb&color=fff&size=160&bold=true`;
  await loadTaxiRideStats();
}

async function loadTaxiRideStats() {
  if (!tgUser?.id) return;
  const res = await get(`my_taxi_rides&user_id=${tgUser.id}`);
  if (!res.success || !res.data) {
    setText('taxiStatRidesCount', '0');
    setText('taxiStatTotalSpent', "0 so'm");
    return;
  }
  const rides = res.data;
  setText('taxiStatRidesCount', rides.length);
  const spent = rides.reduce((a, r) => a + (r.status !== 'cancelled' ? +r.price : 0), 0);
  setText('taxiStatTotalSpent', fmt(spent));
}

async function saveTaxiProfile() {
  if (!tgUser?.id) return toast('Telegram orqali kirish kerak!');
  const phone = $('taxiProfilePhone')?.value.trim() || '';
  if (phone && !/^\+?[\d\s\-\(\)]{7,15}$/.test(phone)) return toast('Telefon raqam noto\'g\'ri!');
  const btn = document.querySelector('#page-taxi-profile .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saqlanmoqda...'; }
  const prof = await get(`get_profile&user_id=${tgUser.id}`);
  const address = prof.success && prof.data ? (prof.data.address || '') : '';
  const res = await post('update_profile', { user_id: tgUser.id, phone, address });
  if (btn) { btn.disabled = false; btn.textContent = 'Saqlash'; }
  if (res.success) {
    toast('✓ Saqlandi!');
    playSound('success');
    const tp = $('taxiPhone');
    if (tp && phone) tp.value = phone;
  } else {
    playSound('error');
    toast('Xatolik yuz berdi!');
  }
}

async function loadTaxiRideHistory() {
  if (!tgUser?.id) return;
  const res = await get(`my_taxi_rides&user_id=${tgUser.id}`);
  const el = $('taxiOrderHistory');
  if (!el) return;

  if (!res.success || !res.data?.length) {
    el.innerHTML = `<div class="orders-empty" style="margin:0 16px">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><rect x="1" y="9" width="22" height="11" rx="2" stroke="#c7c7cc" stroke-width="1.5"/></svg>
      <p>Taxi buyurtmalari yo'q</p>
    </div>`;
    return;
  }

  let rides = res.data;
  if (taxiState.ordersFilter === 'active') {
    rides = rides.filter(r => !['completed', 'cancelled'].includes(r.status));
  }
  if (!rides.length) {
    el.innerHTML = `<div class="orders-empty" style="margin:0 16px"><p>Faol buyurtmalar yo'q</p></div>`;
    return;
  }

  const cMap = {
    new: 's-new', accepted: 's-confirmed', on_way: 's-cooking',
    arrived: 's-cooking', completed: 's-delivered', cancelled: 's-cancelled'
  };

  el.innerHTML = rides.map(r => {
    const st = TAXI_STATUS[r.status] || { text: r.status, step: 0 };
    const d = r.created_at ? new Date(r.created_at.replace(' ', 'T')) : null;
    const date = d ? `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
    const isActive = !['completed', 'cancelled'].includes(r.status);
    const price = +r.price > 0 ? fmt(r.price) : '—';
    const typeMap = { ekonom: '🚗', comfort: '🚙', minivan: '🚐' };
    const mapsFrom = r.from_address ? `https://maps.google.com/?q=${encodeURIComponent(r.from_address)}` : '';
    return `
    <div class="order-hist-item taxi-hist-item${isActive ? ' order-active' : ''}" style="margin:0 16px 10px">
      <div class="order-hist-head">
        <span class="order-hist-id">#${r.id} ${typeMap[r.car_type] || '🚖'}</span>
        <span class="status-badge ${cMap[r.status] || 's-new'}">${st.text}</span>
      </div>
      <div class="taxi-hist-route">
        <div class="taxi-hist-row"><span class="taxi-dot taxi-dot-from"></span>${esc(r.from_address || '—')}</div>
        <div class="taxi-hist-row"><span class="taxi-dot taxi-dot-to"></span>${esc(r.to_address || '—')}</div>
      </div>
      <div class="order-hist-foot">
        <span class="order-hist-date">${date}</span>
        <span class="order-hist-total">${price}</span>
      </div>
      <div class="taxi-hist-actions">
        ${mapsFrom ? `<a href="${mapsFrom}" target="_blank" class="taxi-hist-link">🗺 Xarita</a>` : ''}
        ${isActive ? `<button type="button" class="taxi-hist-cancel" onclick="cancelTaxiRide(${r.id})">Bekor qilish</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function filterTaxiOrders(filter, btn) {
  taxiState.ordersFilter = filter;
  document.querySelectorAll('.taxi-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadTaxiRideHistory();
}

async function cancelTaxiRide(rideId) {
  if (!confirm('#' + rideId + ' buyurtmani bekor qilasizmi?')) return;
  const res = await post('cancel_taxi_ride', { ride_id: rideId });
  if (res.success) {
    playSound('success');
    toast('Buyurtma bekor qilindi');
    loadTaxiRideHistory();
    checkTaxiActiveRide();
    if (taxiState.lastRideId == rideId) pollTaxiRideStatus(rideId);
  } else {
    toast('❌ ' + apiErrorMessage(res, 'Bekor qilinmadi'));
  }
}

function cancelActiveTaxiRide() {
  if (taxiState.lastRideId) cancelTaxiRide(taxiState.lastRideId);
}

// ── ORDER HISTORY (ovqat) ──
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
  updateHeader();
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

function apiErrorMessage(res, fallback) {
  if (!res) return fallback;
  if (typeof res.data === 'string' && res.data) return res.data;
  if (res.data?.message) return res.data.message;
  return fallback;
}

async function post(action, data) {
  try {
    // initData ni faqat header orqali yuborish — URL ga qo'shmaslik
    const body = { ...data };
    if (tg?.initData && !body.init_data) body.init_data = tg.initData;
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body)
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { success: false, data: text ? text.slice(0, 200) : `Server xatosi (${r.status})` }; }
  } catch(e) {
    return { success: false, data: 'Internet ulanishi yo\'q' };
  }
}

async function get(action) {
  try {
    // GET da init_data ni HEADER orqali yuborish
    // URL ga qo'shmaslik — juda uzun bo'lib qoladi
    const r = await fetch(`${API}?action=${action}`, {
      method: 'GET',
      headers: apiHeaders()
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { success: false, data: text ? text.slice(0, 200) : `Server xatosi (${r.status})` }; }
  } catch(e) {
    return { success: false, data: 'Internet ulanishi yo\'q' };
  }
}

// ── TAXI ──
function renderTaxiPopular() {
  const wrap = $('taxiPopularChips');
  if (!wrap) return;
  wrap.innerHTML = TAXI_POPULAR.map((p, i) =>
    `<button type="button" class="taxi-chip" onclick="applyTaxiPopular(${i})">${p.label}</button>`
  ).join('');
}

function applyTaxiPopular(idx) {
  const p = TAXI_POPULAR[idx];
  if (!p) return;
  const inp = p.field === 'from' ? $('taxiFrom') : $('taxiTo');
  if (inp) inp.value = p.value;
  updateTaxiPrice();
  playSound('tap');
}

function renderTaxiCarTypes() {
  const wrap = $('taxiCarTypes');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(taxiState.tariffs).map(([key, t]) => {
    const live = taxiState.allPrices[key]?.price;
    const priceLabel = live ? fmt(live) : `dan ${fmt(t.min || 7000)}`;
    return `
    <button type="button" class="taxi-car-card${taxiState.carType === key ? ' active' : ''}" onclick="selectTaxiCar('${key}')">
      <span class="taxi-car-icon">${t.icon || '🚗'}</span>
      <span class="taxi-car-name">${esc(t.label || key)}</span>
      <span class="taxi-car-from">${priceLabel}</span>
    </button>`;
  }).join('');
}

function selectTaxiCar(type) {
  taxiState.carType = type;
  taxiState.price = taxiState.allPrices[type]?.price || taxiState.tariffs[type]?.min || 0;
  renderTaxiCarTypes();
  updateTaxiPriceUI();
  playSound('tap');
}

function updateTaxiPriceUI() {
  const price = taxiState.price || taxiState.tariffs[taxiState.carType]?.min || 0;
  const val = $('taxiPriceVal');
  const hint = $('taxiPriceHint');
  const btnPrice = $('taxiSubmitPrice');
  const dist = taxiState.distKm > 0 ? `~${taxiState.distKm} km` : '';
  const label = taxiState.geocoded && taxiState.distKm > 0 ? fmt(price) : `dan ${fmt(price)}`;
  if (val) val.textContent = label;
  if (hint) hint.textContent = dist || (taxiState.geocoded ? '' : 'Manzil kiriting — narx hisoblanadi');
  if (btnPrice) btnPrice.textContent = fmt(price);
}

async function updateTaxiPrice() {
  const from = $('taxiFrom')?.value.trim();
  const to   = $('taxiTo')?.value.trim();
  const min = taxiState.tariffs[taxiState.carType]?.min || 7000;

  if (!from || !to) {
    taxiState.price = min;
    taxiState.distKm = 0;
    taxiState.geocoded = false;
    taxiState.allPrices = {};
    updateTaxiPriceUI();
    renderTaxiCarTypes();
    return;
  }

  const priceBar = $('taxiPriceBar');
  if (priceBar) priceBar.classList.add('loading');

  const res = await post('taxi_price', {
    from_address: from,
    to_address: to,
    from_lat: taxiState.fromLat,
    from_lon: taxiState.fromLon,
    to_lat: taxiState.toLat,
    to_lon: taxiState.toLon,
    car_type: taxiState.carType,
  });

  if (priceBar) priceBar.classList.remove('loading');

  if (res.success && res.data?.prices) {
    taxiState.allPrices = res.data.prices;
    taxiState.distKm = res.data.dist_km || 0;
    taxiState.geocoded = !!res.data.geocoded;
    if (res.data.from_lat) { taxiState.fromLat = res.data.from_lat; taxiState.fromLon = res.data.from_lon; }
    if (res.data.to_lat)   { taxiState.toLat = res.data.to_lat;     taxiState.toLon = res.data.to_lon; }
    const p = res.data.prices[taxiState.carType];
    taxiState.price = p?.price || min;
  } else {
    taxiState.price = min;
    taxiState.distKm = 0;
    taxiState.geocoded = false;
    taxiState.allPrices = {};
  }
  updateTaxiPriceUI();
  renderTaxiCarTypes();
}

function onTaxiRouteChange() {
  clearTimeout(onTaxiRouteChange._t);
  onTaxiRouteChange._t = setTimeout(updateTaxiPrice, 600);
}

function swapTaxiRoute() {
  const f = $('taxiFrom'), t = $('taxiTo');
  if (!f || !t) return;
  [f.value, t.value] = [t.value, f.value];
  [taxiState.fromLat, taxiState.toLat] = [taxiState.toLat, taxiState.fromLat];
  [taxiState.fromLon, taxiState.toLon] = [taxiState.toLon, taxiState.fromLon];
  playSound('tap');
  updateTaxiPrice();
}

function useTaxiLocation() {
  if (!navigator.geolocation) return toast('Joylashuv qo\'llab-quvvatlanmaydi');
  toast('Joylashuv olinmoqda...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      taxiState.fromLat = pos.coords.latitude;
      taxiState.fromLon = pos.coords.longitude;
      const inp = $('taxiFrom');
      if (inp) inp.value = 'Joriy joylashuvim';
      playSound('success');
      updateTaxiPrice();
    },
    () => toast('Joylashuvga ruxsat bering'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function fillTaxiFromProfile() {
  if (!tgUser?.id) return toast('Telegram orqali kirish kerak');
  get(`get_profile&user_id=${tgUser.id}`).then(res => {
    const a = res.success && res.data?.address ? res.data.address : '';
    if (!a) return toast('Profilda manzil yo\'q — avval saqlang');
    const inp = $('taxiFrom');
    if (inp) inp.value = a;
    taxiState.fromLat = 0;
    taxiState.fromLon = 0;
    updateTaxiPrice();
    toast('✓ Manzil qo\'yildi');
  });
}

function requestTaxiPhone() {
  const ph = $('taxiProfilePhone')?.value?.trim() || $('profilePhone')?.value?.trim();
  if (ph) {
    const inp = $('taxiPhone');
    if (inp) inp.value = ph;
    toast('✓ Telefon to\'ldirildi');
    return;
  }
  requestPhone();
}

let _taxiRecentItems = [];

function renderTaxiRecent() {
  const wrap = $('taxiRecentWrap');
  if (!wrap || !tgUser?.id) return;
  get(`my_taxi_rides&user_id=${tgUser.id}`).then(res => {
    if (!res.success || !res.data?.length) {
      wrap.classList.add('hidden');
      return;
    }
    const seen = new Set();
    _taxiRecentItems = [];
    res.data.forEach(r => {
      if (r.from_address && !seen.has(r.from_address)) {
        seen.add(r.from_address);
        _taxiRecentItems.push({ type: 'from', text: r.from_address });
      }
      if (r.to_address && !seen.has(r.to_address)) {
        seen.add(r.to_address);
        _taxiRecentItems.push({ type: 'to', text: r.to_address });
      }
    });
    if (!_taxiRecentItems.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `<div class="taxi-recent-label">So'nggi manzillar</div>
      <div class="taxi-recent-chips">${_taxiRecentItems.slice(0, 6).map((it, i) => `
        <button type="button" class="taxi-chip" onclick="applyTaxiRecent(${i})">${esc(it.text.length > 28 ? it.text.slice(0, 28) + '…' : it.text)}</button>
      `).join('')}</div>`;
  });
}

function applyTaxiRecent(idx) {
  const it = _taxiRecentItems[idx];
  if (!it) return;
  const inp = it.type === 'from' ? $('taxiFrom') : $('taxiTo');
  if (inp) inp.value = it.text;
  if (it.type === 'from') { taxiState.fromLat = 0; taxiState.fromLon = 0; }
  else { taxiState.toLat = 0; taxiState.toLon = 0; }
  updateTaxiPrice();
}

async function checkTaxiActiveRide() {
  if (!tgUser?.id) return;
  const res = await get(`my_taxi_rides&user_id=${tgUser.id}`);
  const banner = $('taxiActiveBanner');
  if (!banner) return;
  const active = res.success && res.data?.find(r => !['completed', 'cancelled'].includes(r.status));
  if (!active) {
    banner.classList.add('hidden');
    return;
  }
  const st = TAXI_STATUS[active.status] || { text: active.status };
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="taxi-active-inner" onclick="showTaxiPage('orders')">
      <span class="taxi-active-pulse">🚕</span>
      <div>
        <div class="taxi-active-title">#${active.id} — ${st.text}</div>
        <div class="taxi-active-route">${esc(active.from_address)} → ${esc(active.to_address)}</div>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polyline points="9 18 15 12 9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </div>`;
}

function initTaxiPage() {
  renderTaxiCarTypes();
  renderTaxiPopular();
  const ph = $('taxiProfilePhone')?.value?.trim() || $('profilePhone')?.value?.trim() || '';
  if (ph && $('taxiPhone') && !$('taxiPhone').value) $('taxiPhone').value = ph;
  updateTaxiPrice();
  renderTaxiRecent();
  checkTaxiActiveRide();
  if (!taxiPollTimer) {
    taxiPollTimer = setInterval(() => {
      if (currentService !== 'taxi') return;
      const page = getActivePageId();
      if (page === 'taxi') checkTaxiActiveRide();
      if (page === 'taxi-success' && taxiState.lastRideId) pollTaxiRideStatus(taxiState.lastRideId);
      if (page === 'taxi-orders') loadTaxiRideHistory();
    }, 8000);
  }
}

function renderTaxiTimeline(status) {
  const el = $('taxiSuccessTimeline');
  if (!el) return;
  const steps = ['Qidirilmoqda', 'Qabul qilindi', 'Yo\'lda', 'Yetib keldi', 'Tugallandi'];
  const current = (TAXI_STATUS[status] || {}).step ?? 0;
  if (status === 'cancelled') {
    el.innerHTML = `<div class="taxi-timeline-cancel">❌ Buyurtma bekor qilindi</div>`;
    return;
  }
  el.innerHTML = `<div class="taxi-timeline-steps">${steps.map((s, i) =>
    `<div class="tt-step${i <= current ? ' done' : ''}${i === current ? ' current' : ''}">
      <div class="tt-dot"></div><span>${s}</span>
    </div>`
  ).join('')}</div>`;
}

async function pollTaxiRideStatus(rideId) {
  const res = await get(`my_taxi_rides&user_id=${tgUser?.id || 0}`);
  if (!res.success) return;
  const ride = res.data?.find(r => r.id == rideId);
  const el = $('taxiSuccessStatus');
  const cancelBtn = $('taxiCancelRideBtn');
  if (!ride || !el) return;

  const st = TAXI_STATUS[ride.status] || { text: ride.status, step: 0 };
  el.textContent = st.text;
  el.className = 'success-status-badge ' + (
    ride.status === 'cancelled' ? 's-cancelled' :
    ride.status === 'completed' ? 's-delivered' :
    ride.status === 'new' ? 's-new' : 's-confirmed'
  );
  renderTaxiTimeline(ride.status);
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', ['completed', 'cancelled'].includes(ride.status));
  }
}

async function submitTaxi() {
  if (!tgUser?.id) return toast('Telegram orqali oching!');
  if (!tg?.initData) return toast('Ilovani yoping va botdan qayta oching!');

  const from  = $('taxiFrom')?.value.trim();
  const to    = $('taxiTo')?.value.trim();
  const phone = $('taxiPhone')?.value.trim();
  const note  = $('taxiNote')?.value.trim();

  if (!from)  return toast('Qayerdan ekanligini kiriting!');
  if (!to)    return toast('Qayerga borishingizni kiriting!');
  if (!phone) return toast('Telefon raqam kiriting!');
  if (!/^\+?[\d\s\-\(\)]{7,15}$/.test(phone)) return toast('Telefon raqam noto\'g\'ri!');

  await saveUser();

  const btn = $('taxiSubmitBtn');
  const btnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>Yuborilmoqda...</span>'; }

  await updateTaxiPrice();
  const price = taxiState.price || taxiState.tariffs[taxiState.carType]?.min || 0;

  const res = await post('taxi_order', {
    user_id: tgUser.id,
    from_address: from,
    to_address: to,
    phone,
    note,
    car_type: taxiState.carType,
    price,
    from_lat: taxiState.fromLat,
    from_lon: taxiState.fromLon,
    to_lat: taxiState.toLat,
    to_lon: taxiState.toLon,
  });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = btnHtml;
    updateTaxiPriceUI();
  }

  if (res.success) {
    playSound('success');
    const rideId = res.data?.ride_id || '';
    taxiState.lastRideId = rideId;
    const finalPrice = res.data?.price || price;
    const car = taxiState.tariffs[taxiState.carType];

    $('taxiFrom').value = '';
    $('taxiTo').value   = '';
    $('taxiNote').value = '';
    taxiState.fromLat = taxiState.fromLon = taxiState.toLat = taxiState.toLon = 0;

    setText('taxiSuccessRideId', rideId ? '#' + rideId : '');
    const info = $('taxiSuccessInfo');
    if (info) info.innerHTML = `
      <div class="taxi-route">
        <div class="taxi-route-row"><span class="taxi-dot taxi-dot-from"></span><span>${esc(from)}</span></div>
        <div class="taxi-route-row"><span class="taxi-dot taxi-dot-to"></span><span>${esc(to)}</span></div>
        ${car ? `<div class="taxi-success-car">${car.icon} ${esc(car.label)}</div>` : ''}
      </div>`;
    const priceEl = $('taxiSuccessPrice');
    if (priceEl) priceEl.textContent = finalPrice ? fmt(finalPrice) : '';
    const cancelBtn = $('taxiCancelRideBtn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    renderTaxiTimeline('new');
    pollTaxiRideStatus(rideId);
    showPage('taxi-success');
    setTaxiNav('navTaxiMain');
    checkTaxiActiveRide();
    renderTaxiRecent();
  } else {
    playSound('error');
    toast('❌ ' + apiErrorMessage(res, 'Taxi buyurtma yuborilmadi'));
  }
}

// ── TELEGRAM BACK BUTTON ──
if (tg?.BackButton) {
  tg.BackButton.onClick(() => goBack());
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
