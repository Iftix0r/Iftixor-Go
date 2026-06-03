const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const API_URL = '../api.php';
let initData = tg.initData || '';

let state = {
  restaurant: null,
  products: [],
  categories: [],
  orders: [],
  stats: { views: 0, total_orders: 0, total_products_sold: 0, total_revenue: 0 }
};

function $(id) { return document.getElementById(id); }

async function post(action, data = {}) {
  try {
    const res = await fetch(API_URL + '?action=' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Init-Data': initData
      },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    return { success: false, error: 'Xatolik yuz berdi' };
  }
}

async function loadData() {
  const res = await post('rest_get_data');
  
  if (res.needs_creation) {
    switchPage('create');
    $('restName').textContent = 'Yangi restoran';
    $('restSub').textContent = 'Ro\'yxatdan o\'tish';
    document.querySelector('.bottom-nav').style.display = 'none';
    return;
  }
  
  if (res.success === false) {
    tg.showAlert(res.error || 'Ma\'lumot yuklashda xatolik!');
    return;
  }
  
  document.querySelector('.bottom-nav').style.display = 'flex';
  switchPage('orders');
  
  state.restaurant = res.restaurant;
  state.products = res.products || [];
  state.categories = res.categories || [];
  state.orders = res.orders || [];
  state.stats = res.stats || { views: 0, total_orders: 0, total_products_sold: 0, total_revenue: 0 };
  
  $('restName').textContent = state.restaurant.name;
  $('statViews').textContent = state.stats.views;
  $('statSold').textContent = state.stats.total_products_sold;
  $('statOrders').textContent = state.stats.total_orders;
  $('statRevenue').textContent = Number(state.stats.total_revenue).toLocaleString() + " so'm";
  
  const catSelect = $('prodCategory');
  catSelect.innerHTML = '<option value="">Kategoriya tanlang</option>' + 
    state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
  renderProducts();
  renderOrders();
}

async function createRestaurant() {
  const name = $('createName').value;
  const phone = $('createPhone').value;
  const address = $('createAddress').value;
  
  if (!name || !phone) {
    tg.showAlert("Nomi va telefon raqamini kiritish majburiy!");
    return;
  }
  
  const res = await post('rest_create', { name, phone, address });
  if (res.success) {
    tg.HapticFeedback.notificationOccurred('success');
    loadData();
  } else {
    tg.showAlert(res.error || "Xatolik yuz berdi");
  }
}

function renderProducts() {
  const list = $('productsList');
  if (!state.products.length) {
    list.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--subtext)">Mahsulotlar yo\'q</div>';
    return;
  }
  
  list.innerHTML = state.products.map(p => `
    <div class="card">
      <div class="card-title">${p.name} ${parseInt(p.available) ? '' : '❌'}</div>
      <div class="card-sub">${p.description || 'Tavsif yo\'q'}</div>
      <div class="card-price">${Number(p.price).toLocaleString()} so'm</div>
      <div class="card-actions">
        <button class="btn btn-secondary" onclick="editProduct(${p.id})">Tahrirlash</button>
      </div>
    </div>
  `).join('');
}

function renderOrders() {
  const list = $('ordersList');
  if (!state.orders.length) {
    list.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--subtext)">Hali buyurtmalar yo\'q</div>';
    return;
  }
  
  const statuses = {
    'new': { text: 'Yangi', cls: 'status-new' },
    'confirmed': { text: 'Tasdiqlangan', cls: 'status-confirmed' },
    'cooking': { text: 'Tayyorlanmoqda', cls: 'status-confirmed' },
    'delivered': { text: 'Yetkazilgan', cls: 'status-confirmed' },
    'cancelled': { text: 'Bekor qilingan', cls: '' }
  };
  
  list.innerHTML = state.orders.map(o => {
    let itemsStr = '';
    try {
      const parsed = JSON.parse(o.items);
      itemsStr = parsed.map(i => `${i.qty}x ${i.name}`).join(', ');
    } catch(e){}
    
    const s = statuses[o.status] || { text: o.status, cls: '' };
    
    return `
    <div class="card">
      <div class="order-header">
        <span>Buyurtma #${o.id}</span>
        <span class="order-status ${s.cls}">${s.text}</span>
      </div>
      <div class="order-items">${itemsStr}</div>
      <div class="card-price">${Number(o.my_total).toLocaleString()} so'm</div>
    </div>
  `}).join('');
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(p => p.classList.remove('active'));
  
  $('page-' + page).classList.add('active');
  $('nav' + page.charAt(0).toUpperCase() + page.slice(1)).classList.add('active');
}

function showAddProductModal() {
  $('modalTitle').textContent = "Yangi mahsulot";
  $('prodId').value = "";
  $('prodName').value = "";
  $('prodDesc').value = "";
  $('prodPrice').value = "";
  $('prodImage').value = "";
  $('prodCategory').value = "";
  $('prodAvailable').checked = true;
  $('productModal').classList.remove('hidden');
}

function editProduct(id) {
  const p = state.products.find(x => x.id == id);
  if(!p) return;
  $('modalTitle').textContent = "Tahrirlash";
  $('prodId').value = p.id;
  $('prodName').value = p.name;
  $('prodDesc').value = p.description;
  $('prodPrice').value = p.price;
  $('prodImage').value = p.image || '';
  $('prodCategory').value = p.category_id || '';
  $('prodAvailable').checked = parseInt(p.available) === 1;
  $('productModal').classList.remove('hidden');
}

function closeProductModal() {
  $('productModal').classList.add('hidden');
}

async function saveProduct() {
  const data = {
    id: $('prodId').value,
    name: $('prodName').value,
    description: $('prodDesc').value,
    price: $('prodPrice').value,
    image: $('prodImage').value,
    category_id: $('prodCategory').value,
    available: $('prodAvailable').checked ? 1 : 0
  };
  
  if(!data.name || !data.price || !data.category_id) {
    tg.showAlert("Nomi, narxi va kategoriyasini kiriting!");
    return;
  }
  
  const res = await post('rest_save_product', data);
  if(res.success) {
    closeProductModal();
    tg.HapticFeedback.notificationOccurred('success');
    loadData(); // reload
  } else {
    tg.showAlert(res.error || 'Saqlashda xatolik');
  }
}

function closeApp() {
  tg.close();
}

window.onload = () => {
  loadData();
};
