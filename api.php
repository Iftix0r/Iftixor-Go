<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Telegram-Init-Data');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once 'config.php';
require_once 'db.php';

// $input avval aniqlanadi — auth.php undan foydalanadi
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true) ?? [];

require_once 'auth.php';
session_start();

function resp($data, $success = true): void {
    echo json_encode(['success' => $success, 'data' => $data]);
    exit;
}

function isAdminAuthorized(): bool {
    if (!empty($_SESSION['admin_authenticated']) && $_SESSION['admin_authenticated'] === true) {
        return true;
    }
    $tgUser = validateInitData(getInitDataFromRequest());
    return $tgUser && isAdminId((int)$tgUser['id']);
}

function requireAdmin(): void {
    if (isAdminAuthorized()) return;
    resp('Unauthorized', false);
}

$adminActions = ['admin_stats','admin_orders','admin_users','admin_user_orders',
    'admin_block_user','admin_unblock_user','admin_delete_user','admin_send_message',
    'admin_update_order','admin_broadcast','admin_add_product','admin_edit_product',
    'admin_delete_product','admin_categories','admin_products',
    'admin_restaurants', 'admin_add_restaurant', 'admin_edit_restaurant', 'admin_delete_restaurant'];
if (in_array($action, $adminActions, true)) {
    requireAdmin();
}

function tgReq(string $method, array $params = []): array {
    $ch = curl_init("https://api.telegram.org/bot".BOT_TOKEN."/$method");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($params),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    return json_decode($res, true) ?? [];
}

function geocodeAddress(string $address): ?array {
    $address = trim($address);
    if (strlen($address) < 3 || $address === 'Joriy joylashuvim') return null;
    $url = 'https://nominatim.openstreetmap.org/search?q=' . urlencode($address . ', O\'zbekiston')
         . '&format=json&limit=1&countrycodes=uz';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['User-Agent: IftixorGo-Taxi/1.0'],
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    $data = json_decode($res, true);
    if (empty($data[0]['lat'])) return null;
    return ['lat' => (float)$data[0]['lat'], 'lon' => (float)$data[0]['lon']];
}

function calcTaxiPrices(float $distKm): array {
    $tariffs = [
        'ekonom'  => ['start' => 5000,  'per_km' => 1500, 'label' => 'Ekonom',  'min' => 7000],
        'comfort' => ['start' => 8000,  'per_km' => 2200, 'label' => 'Comfort', 'min' => 12000],
        'minivan' => ['start' => 12000, 'per_km' => 3000, 'label' => 'Minivan', 'min' => 18000],
    ];
    $prices = [];
    foreach ($tariffs as $key => $t) {
        $price = $t['start'] + round($distKm * $t['per_km'] / 500) * 500;
        $price = max($price, $t['min']);
        $prices[$key] = ['price' => $price, 'label' => $t['label'], 'dist_km' => round($distKm, 1)];
    }
    return $prices;
}

switch ($action) {
    case 'admin_login':
        $user = trim((string)($input['username'] ?? ''));
        $pass = trim((string)($input['password'] ?? ''));
        if ($user === 'admin' && $pass === 'admin123') {
            $_SESSION['admin_authenticated'] = true;
            resp('authorized');
        }
        resp('Invalid credentials', false);
        break;

    case 'admin_logout':
        unset($_SESSION['admin_authenticated']);
        resp('logged out');
        break;

    case 'admin_status':
        resp(isAdminAuthorized() ? 'authorized' : 'unauthorized');
        break;

    // ── USER ──
    case 'get_config':
        resp([
            'delivery_fee' => DELIVERY_FEE,
            'currency' => CURRENCY,
            'taxi_tariffs' => [
                'ekonom'  => ['label' => 'Ekonom',  'icon' => '🚗', 'min' => 7000,  'start' => 5000],
                'comfort' => ['label' => 'Comfort', 'icon' => '🚙', 'min' => 12000, 'start' => 8000],
                'minivan' => ['label' => 'Minivan', 'icon' => '🚐', 'min' => 18000, 'start' => 12000],
            ],
        ]);
        break;

    case 'save_user':
        $tgUser = validateInitData(getInitDataFromRequest());
        $u = $tgUser ?: ($input['user'] ?? []);
        if (empty($u['id'])) resp('No user data', false);
        db()->prepare("INSERT INTO users (id, username, first_name, last_name, photo_url, language_code)
            VALUES (:id,:un,:fn,:ln,:ph,:lc)
            ON DUPLICATE KEY UPDATE username=VALUES(username), first_name=VALUES(first_name),
            last_name=VALUES(last_name), photo_url=VALUES(photo_url)"
        )->execute([
            ':id' => $u['id'], ':un' => $u['username'] ?? '',
            ':fn' => $u['first_name'] ?? '', ':ln' => $u['last_name'] ?? '',
            ':ph' => $u['photo_url'] ?? '', ':lc' => $u['language_code'] ?? 'uz',
        ]);
        resp('saved');
        break;

    case 'update_profile':
        $auth = requireTelegramUser();
        $id = (int)($input['user_id'] ?? 0);
        if ($id !== (int)$auth['id']) resp('Unauthorized', false);
        if (!$id) resp('No ID', false);
        db()->prepare("UPDATE users SET phone=?, address=? WHERE id=?")
            ->execute([$input['phone'] ?? '', $input['address'] ?? '', $id]);
        resp('updated');
        break;

    case 'get_profile':
        $auth = requireTelegramUser();
        $id = (int)($_GET['user_id'] ?? 0);
        if ($id !== (int)$auth['id']) resp('Unauthorized', false);
        $s = db()->prepare("SELECT * FROM users WHERE id=?");
        $s->execute([$id]);
        resp($s->fetch() ?: []);
        break;

    // ── MENU ──
    case 'get_menu':
        $cats  = db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll();
        $prods = db()->query("SELECT p.*, r.name as restaurant_name, r.views as restaurant_views FROM products p LEFT JOIN restaurants r ON p.restaurant_id=r.id WHERE p.available=1 ORDER BY p.order_count DESC, p.category_id")->fetchAll();
        $menu = [];
        foreach ($cats as $c) {
            $c['products'] = array_values(array_filter($prods, fn($p) => $p['category_id'] == $c['id']));
            $menu[] = $c;
        }
        resp($menu);
        break;

    case 'view_restaurant':
        try {
            $rid = (int)($input['restaurant_id'] ?? 0);
            if ($rid > 0) {
                db()->prepare("UPDATE restaurants SET views = views + 1 WHERE id = ?")->execute([$rid]);
            }
            resp(['success' => true]);
        } catch (Exception $e) {
            resp('Error', false);
        }
        break;

    // ── RESTAURANT WEBAPP ENDPOINTS ──
    case 'rest_get_data':
        $auth = requireTelegramUser();
        $tgId = (int)$auth['id'];
        
        $r = db()->prepare("SELECT * FROM restaurants WHERE owner_tg_id=?");
        $r->execute([$tgId]);
        $rest = $r->fetch();
        
        if (!$rest) {
            resp(['needs_creation' => true]);
            break;
        }
        
        $rid = $rest['id'];
        
        // Let's just return products and categories for now
        $cats = db()->query("SELECT * FROM categories")->fetchAll();
        $prods = db()->prepare("SELECT * FROM products WHERE restaurant_id=?");
        $prods->execute([$rid]);
        $prodsList = $prods->fetchAll();
        
        $prodIds = array_column($prodsList, 'id');
        
        // Orders
        $allOrders = db()->query("SELECT * FROM orders ORDER BY id DESC LIMIT 500")->fetchAll();
        $restOrders = [];
        $totalRevenue = 0;
        
        foreach ($allOrders as $o) {
            $items = json_decode($o['items'], true);
            if (!is_array($items)) continue;
            
            $myItems = [];
            $myTotal = 0;
            foreach ($items as $item) {
                if (in_array((int)$item['id'], $prodIds)) {
                    $myItems[] = $item;
                    $myTotal += ($item['price'] * $item['qty']);
                }
            }
            
            if (count($myItems) > 0) {
                $o['items'] = json_encode($myItems, JSON_UNESCAPED_UNICODE);
                $o['my_total'] = $myTotal;
                $restOrders[] = $o;
                if ($o['status'] === 'delivered' || $o['status'] === 'confirmed' || $o['status'] === 'cooking' || $o['status'] === 'new') {
                    $totalRevenue += $myTotal;
                }
            }
        }
        
        // Total orders sold by this restaurant
        $totalOrders = array_reduce($prodsList, fn($s, $p) => $s + (int)$p['order_count'], 0);
        
        resp([
            'restaurant' => $rest,
            'products' => $prodsList,
            'categories' => $cats,
            'orders' => array_slice($restOrders, 0, 50),
            'stats' => [
                'views' => $rest['views'], 
                'total_orders' => count($restOrders), 
                'total_products_sold' => $totalOrders,
                'total_revenue' => $totalRevenue
            ]
        ]);
        break;
        
    case 'rest_delete':
        $auth = requireTelegramUser();
        $tgId = (int)$auth['id'];
        $r = db()->prepare("SELECT id FROM restaurants WHERE owner_tg_id=?");
        $r->execute([$tgId]);
        $rest = $r->fetch();
        if (!$rest) resp('Restoran topilmadi', false);
        $restId = $rest['id'];
        // Delete related orders
        db()->prepare("DELETE FROM orders WHERE restaurant_id=?")->execute([$restId]);
        // Delete products
        db()->prepare("DELETE FROM products WHERE restaurant_id=?")->execute([$restId]);
        // Delete restaurant
        db()->prepare("DELETE FROM restaurants WHERE id=?")->execute([$restId]);
        resp(['success'=>true]);
        break;

    case 'rest_create':
        $auth = requireTelegramUser();
        $tgId = (int)$auth['id'];
        
        // Ensure user doesn't already have one
        $r = db()->prepare("SELECT id FROM restaurants WHERE owner_tg_id=?");
        $r->execute([$tgId]);
        if ($r->fetch()) resp('Sizda allaqachon restoran bor', false);
        
        $name = trim($input['name'] ?? '');
        $phone = trim($input['phone'] ?? '');
        $address = trim($input['address'] ?? '');
        
        if (!$name || !$phone) resp('Nomi va telefon raqam majburiy', false);
        
        db()->prepare("INSERT INTO restaurants (name, address, phone, owner_tg_id) VALUES (?,?,?,?)")
          ->execute([$name, $address, $phone, $tgId]);
          
        resp(['success' => true]);
        break;

    // ── ORDER ──
    case 'place_order':
        try {
            $auth = requireTelegramUser();
            $userId  = (int)($input['user_id'] ?? 0);
            if ($userId !== (int)$auth['id']) resp('Unauthorized', false);
            ensureUserExists($auth);

            $items   = $input['items']   ?? [];
            $address = trim($input['address'] ?? '');
            $phone   = trim($input['phone'] ?? '');
            $note    = trim($input['note'] ?? '');
            if (!$userId || empty($items)) resp('Noto\'g\'ri ma\'lumot', false);
            if (!$phone || !$address) resp('Telefon va manzil kerak', false);

            $chk = db()->prepare("SELECT is_blocked, block_reason FROM users WHERE id=?");
            $chk->execute([$userId]);
            $cu = $chk->fetch();
            if ($cu && $cu['is_blocked']) {
                resp('Siz bloklangansiz' . ($cu['block_reason'] ? ': ' . $cu['block_reason'] : ''), false);
            }

            $productIds = array_values(array_unique(array_filter(array_map(fn($i) => (int)($i['id'] ?? 0), $items))));
            if (empty($productIds)) resp('Bo\'sh buyurtma', false);
            $placeholders = implode(',', array_fill(0, count($productIds), '?'));
            $dbProds = db()->prepare("SELECT id, price, name FROM products WHERE id IN ($placeholders) AND available=1");
            $dbProds->execute($productIds);
            $priceMap = [];
            foreach ($dbProds->fetchAll() as $p) $priceMap[$p['id']] = ['price' => (float)$p['price'], 'name' => $p['name']];

            $validatedItems = [];
            foreach ($items as $item) {
                $pid = (int)($item['id'] ?? 0);
                if (!isset($priceMap[$pid])) continue;
                $qty = max(1, (int)($item['qty'] ?? 1));
                $validatedItems[] = [
                    'id'    => $pid,
                    'name'  => $priceMap[$pid]['name'],
                    'price' => $priceMap[$pid]['price'],
                    'qty'   => $qty,
                ];
            }
            if (empty($validatedItems)) resp('Mahsulot topilmadi yoki sotuvda yo\'q', false);
            $items = $validatedItems;

            $subtotal = array_sum(array_map(fn($i) => $i['price'] * $i['qty'], $items));
            $total = $subtotal + DELIVERY_FEE;
            $stmt = db()->prepare("INSERT INTO orders (user_id, items, total, address, phone, note) VALUES (?,?,?,?,?,?)");
            $stmt->execute([$userId, json_encode($items, JSON_UNESCAPED_UNICODE), $total, $address, $phone, $note]);
            $orderId = db()->lastInsertId();

            // Ommaboplik uchun buyurtma sonini oshirish
            foreach ($items as $item) {
                db()->prepare("UPDATE products SET order_count = order_count + 1 WHERE id=?")->execute([$item['id']]);
            }

            $u = db()->prepare("SELECT * FROM users WHERE id=?");
            $u->execute([$userId]);
            $u = $u->fetch() ?: [];

            $itemList = implode("\n", array_map(fn($i) => "  • {$i['name']} × {$i['qty']} = ".number_format($i['price']*$i['qty'])." ".CURRENCY, $items));
            $name  = trim(($u['first_name'] ?? '').' '.($u['last_name'] ?? ''));
            $uname = !empty($u['username']) ? "@{$u['username']}" : "ID: $userId";

            $msg = "🆕 *Yangi Buyurtma #$orderId*\n\n"
                 . "👤 *Mijoz:* $name ($uname)\n"
                 . "📞 *Tel:* $phone\n"
                 . "📍 *Manzil:* $address\n"
                 . ($note ? "📝 *Izoh:* $note\n" : '')
                 . "\n🛒 *Buyurtma:*\n$itemList\n\n"
                 . "🚚 *Yetkazish:* ".number_format(DELIVERY_FEE)." ".CURRENCY."\n"
                 . "💰 *Jami: ".number_format($total)." ".CURRENCY."*\n"
                 . "🕐 ".date('d.m.Y H:i');

            tgReq('sendMessage', [
                'chat_id' => GROUP_CHAT_ID, 'text' => $msg, 'parse_mode' => 'Markdown',
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '✅ Qabul', 'callback_data' => "confirm_$orderId"],
                    ['text' => '❌ Bekor', 'callback_data' => "cancel_$orderId"],
                ]]]
            ]);
            resp(['order_id' => $orderId, 'total' => $total, 'subtotal' => $subtotal, 'delivery_fee' => DELIVERY_FEE]);
        } catch (Throwable $e) {
            resp('Buyurtma saqlanmadi: ' . $e->getMessage(), false);
        }
        break;

    case 'my_orders':
        $auth = requireTelegramUser();
        $userId = (int)($_GET['user_id'] ?? 0);
        if ($userId !== (int)$auth['id']) resp('Unauthorized', false);
        $s = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20");
        $s->execute([$userId]);
        $list = $s->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        resp($list);
        break;

// ══════════ ADMIN ══════════

    case 'admin_stats':
        $today = date('Y-m-d');
        try {
            $ts = db()->prepare("SELECT COUNT(*) cnt, COALESCE(SUM(total),0) rev FROM orders WHERE DATE(created_at)=?");
            $ts->execute([$today]); $ts = $ts->fetch();
            $all  = db()->query("SELECT COUNT(*) cnt, COALESCE(SUM(total),0) rev FROM orders")->fetch();
            $u    = db()->query("SELECT COUNT(*) cnt FROM users")->fetch();
            $pend = db()->query("SELECT COUNT(*) cnt FROM orders WHERE status='new'")->fetch();
            // is_blocked ustuni bo'lmasa 0 qaytarsin
            try {
                $blk = db()->query("SELECT COUNT(*) cnt FROM users WHERE is_blocked=1")->fetch();
            } catch (Exception $e) {
                $blk = ['cnt' => 0];
            }
            resp([
                'today_orders'   => (int)$ts['cnt'],
                'today_revenue'  => (int)$ts['rev'],
                'total_orders'   => (int)$all['cnt'],
                'total_revenue'  => (int)$all['rev'],
                'total_users'    => (int)$u['cnt'],
                'blocked_users'  => (int)$blk['cnt'],
                'pending_orders' => (int)$pend['cnt'],
            ]);
        } catch (Exception $e) {
            resp(['error' => $e->getMessage()], false);
        }
        break;

    case 'admin_orders':
        $status = $_GET['status'] ?? '';
        $limit  = min((int)($_GET['limit'] ?? 50), 200);
        $sql = "SELECT o.*, u.first_name, u.last_name, u.username, u.photo_url, u.phone as user_phone
                FROM orders o LEFT JOIN users u ON o.user_id=u.id";
        if ($status) {
            $s = db()->prepare($sql." WHERE o.status=? ORDER BY o.created_at DESC LIMIT $limit");
            $s->execute([$status]);
        } else {
            $s = db()->query($sql." ORDER BY o.created_at DESC LIMIT $limit");
        }
        $list = $s->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        resp($list);
        break;

    case 'admin_users':
        $search = $_GET['search'] ?? '';
        $filter = $_GET['filter'] ?? ''; // blocked | active
        $sql = "SELECT *, (SELECT COUNT(*) FROM orders WHERE user_id=users.id) as order_count,
                (SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=users.id) as total_spent
                FROM users";
        $where = []; $params = [];
        if ($search) {
            $where[] = "(first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR phone LIKE ?)";
            $q = "%$search%"; $params = [$q,$q,$q,$q];
        }
        if ($filter === 'blocked') $where[] = 'is_blocked=1';
        if ($filter === 'active')  $where[] = 'is_blocked=0';
        if ($where) $sql .= ' WHERE '.implode(' AND ', $where);
        $sql .= ' ORDER BY id DESC LIMIT 200';
        $s = db()->prepare($sql); $s->execute($params);
        resp($s->fetchAll());
        break;

    case 'admin_user_orders':
        $uid = $_GET['user_id'] ?? 0;
        $s = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20");
        $s->execute([$uid]);
        $list = $s->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        resp($list);
        break;

    case 'admin_block_user':
        $uid    = $input['user_id'] ?? 0;
        $reason = $input['reason'] ?? '';
        if (!$uid) resp('No ID', false);
        db()->prepare("UPDATE users SET is_blocked=1, block_reason=? WHERE id=?")->execute([$reason, $uid]);
        $msg = "⛔ *Hisobingiz bloklandi.*".($reason ? "\nSabab: $reason" : '')."\n\nSavollar: @Iftix0r";
        tgReq('sendMessage', ['chat_id' => $uid, 'text' => $msg, 'parse_mode' => 'Markdown']);
        resp('blocked');
        break;

    case 'admin_unblock_user':
        $uid = $input['user_id'] ?? 0;
        if (!$uid) resp('No ID', false);
        db()->prepare("UPDATE users SET is_blocked=0, block_reason=NULL WHERE id=?")->execute([$uid]);
        tgReq('sendMessage', ['chat_id' => $uid, 'text' => "✅ *Hisobingiz blokdan chiqarildi!*\nEndi buyurtma bera olasiz.", 'parse_mode' => 'Markdown']);
        resp('unblocked');
        break;

    case 'admin_delete_user':
        $uid = $input['user_id'] ?? 0;
        if (!$uid) resp('No ID', false);
        db()->prepare("DELETE FROM orders WHERE user_id=?")->execute([$uid]);
        db()->prepare("DELETE FROM users WHERE id=?")->execute([$uid]);
        resp('deleted');
        break;

    case 'admin_send_message':
        $uid = $input['user_id'] ?? 0;
        $msg = $input['message'] ?? '';
        if (!$uid || !$msg) resp('Missing data', false);
        $res = tgReq('sendMessage', ['chat_id' => $uid, 'text' => $msg, 'parse_mode' => 'Markdown']);
        resp($res['ok'] ?? false);
        break;

    case 'admin_update_order':
        $orderId   = $input['order_id'] ?? 0;
        $newStatus = $input['status']   ?? '';
        if (!$orderId || !$newStatus) resp('Missing data', false);
        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);
        $o = db()->prepare("SELECT user_id FROM orders WHERE id=?");
        $o->execute([$orderId]); $o = $o->fetch();
        if ($o) {
            $msgs = [
                'confirmed' => "✅ *#{$orderId} buyurtmangiz qabul qilindi!*\n🍽️ Tayyorlanmoqda...",
                'cooking'   => "👨‍🍳 *#{$orderId} buyurtmangiz tayyorlanmoqda!*",
                'delivered' => "🚚 *#{$orderId} buyurtmangiz yetkazildi!*\nYoqimli ishtaha! 😋",
                'cancelled' => "❌ *#{$orderId} buyurtmangiz bekor qilindi.*",
            ];
            if (isset($msgs[$newStatus]))
                tgReq('sendMessage', ['chat_id' => $o['user_id'], 'text' => $msgs[$newStatus], 'parse_mode' => 'Markdown']);
        }
        resp('updated');
        break;

    case 'admin_broadcast':
        $message = $input['message'] ?? '';
        $target  = $input['target']  ?? 'all'; // all | active
        if (!$message) resp('No message', false);
        $sql = $target === 'active'
            ? "SELECT id FROM users WHERE is_blocked=0"
            : "SELECT id FROM users";
        $users = db()->query($sql)->fetchAll();
        $sent = 0;
        foreach ($users as $u) {
            $r = tgReq('sendMessage', ['chat_id' => $u['id'], 'text' => $message, 'parse_mode' => 'Markdown']);
            if (!empty($r['ok'])) $sent++;
            usleep(50000); // 50ms delay - Telegram rate limit
        }
        resp(['sent' => $sent, 'total' => count($users)]);
        break;

    case 'admin_add_product':
        $rid = !empty($input['restaurant_id']) ? (int)$input['restaurant_id'] : null;
        $data = [$input['category_id']??0, $rid, $input['name']??'', $input['description']??'', $input['price']??0, $input['image']??''];
        if (!$data[0] || !$data[2] || !$data[4]) resp('Missing data', false);
        $s = db()->prepare("INSERT INTO products (category_id, restaurant_id, name, description, price, image, available) VALUES (?,?,?,?,?,?,1)");
        $s->execute($data);
        resp(['id' => db()->lastInsertId()]);
        break;

    case 'admin_edit_product':
        $id = $input['id'] ?? 0;
        if (!$id) resp('Missing id', false);
        $rid = !empty($input['restaurant_id']) ? (int)$input['restaurant_id'] : null;
        db()->prepare("UPDATE products SET name=?, description=?, price=?, image=?, available=?, category_id=?, restaurant_id=? WHERE id=?")
            ->execute([$input['name']??'', $input['description']??'', $input['price']??0, $input['image']??'', $input['available']??1, $input['category_id']??0, $rid, $id]);
        resp('updated');
        break;

    case 'admin_delete_product':
        $id = $input['id'] ?? 0;
        if (!$id) resp('Missing id', false);
        db()->prepare("DELETE FROM products WHERE id=?")->execute([$id]);
        resp('deleted');
        break;

    case 'admin_categories':
        resp(db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll());
        break;

    case 'admin_add_category':
        $name = trim($input['name'] ?? '');
        $icon = trim($input['icon'] ?? '🍽️');
        $sort = (int)($input['sort_order'] ?? 0);
        if (!$name) resp('Missing name', false);
        $s = db()->prepare("INSERT INTO categories (name, icon, sort_order) VALUES (?,?,?)");
        $s->execute([$name, $icon, $sort]);
        resp(['id' => db()->lastInsertId()]);
        break;

    case 'admin_edit_category':
        $id   = $input['id'] ?? 0;
        $name = trim($input['name'] ?? '');
        $icon = trim($input['icon'] ?? '');
        $sort = (int)($input['sort_order'] ?? 0);
        if (!$id || !$name) resp('Missing data', false);
        db()->prepare("UPDATE categories SET name=?, icon=?, sort_order=? WHERE id=?")->execute([$name, $icon, $sort, $id]);
        resp('updated');
        break;

    case 'admin_delete_category':
        $id = $input['id'] ?? 0;
        if (!$id) resp('Missing id', false);
        // Check if has products
        $cnt = db()->prepare("SELECT COUNT(*) FROM products WHERE category_id=?");
        $cnt->execute([$id]);
        if ($cnt->fetchColumn() > 0) resp("Bu kategoriyada mahsulotlar bor, avval ularni o'chiring", false);
        db()->prepare("DELETE FROM categories WHERE id=?")->execute([$id]);
        resp('deleted');
        break;

    case 'admin_revenue_chart':
        // So'nggi 7 kun daromadi
        $rows = db()->query(
            "SELECT DATE(created_at) as day, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
             FROM orders
             WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
               AND status != 'cancelled'
             GROUP BY DATE(created_at)
             ORDER BY day ASC"
        )->fetchAll();
        resp($rows);
        break;

    case 'admin_restaurants':
        resp(db()->query("SELECT * FROM restaurants ORDER BY id DESC")->fetchAll());
        break;

    case 'admin_add_restaurant':
        $name = trim($input['name'] ?? '');
        $address = trim($input['address'] ?? '');
        $phone = trim($input['phone'] ?? '');
        if (!$name) resp('Missing name', false);
        $s = db()->prepare("INSERT INTO restaurants (name, address, phone, is_active) VALUES (?,?,?,1)");
        $s->execute([$name, $address, $phone]);
        resp(['id' => db()->lastInsertId()]);
        break;

    case 'admin_edit_restaurant':
        $id = $input['id'] ?? 0;
        $name = trim($input['name'] ?? '');
        $address = trim($input['address'] ?? '');
        $phone = trim($input['phone'] ?? '');
        $is_active = isset($input['is_active']) ? (int)$input['is_active'] : 1;
        if (!$id || !$name) resp('Missing data', false);
        db()->prepare("UPDATE restaurants SET name=?, address=?, phone=?, is_active=? WHERE id=?")
            ->execute([$name, $address, $phone, $is_active, $id]);
        resp('updated');
        break;

    case 'admin_delete_restaurant':
        $id = $input['id'] ?? 0;
        if (!$id) resp('Missing id', false);
        // Check if has products
        $cnt = db()->prepare("SELECT COUNT(*) FROM products WHERE restaurant_id=?");
        $cnt->execute([$id]);
        if ($cnt->fetchColumn() > 0) resp("Bu restoranda mahsulotlar bor, avval ularni o'chiring yoki o'zgartiring", false);
        db()->prepare("DELETE FROM restaurants WHERE id=?")->execute([$id]);
        resp('deleted');
        break;

    case 'admin_products':
        resp(db()->query("SELECT p.*, c.name as category_name, r.name as restaurant_name FROM products p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN restaurants r ON p.restaurant_id=r.id ORDER BY p.category_id, p.id")->fetchAll());
        break;

// ══════════ TAXI ══════════

    case 'taxi_price':
        $fromLat = (float)($input['from_lat'] ?? 0);
        $fromLon = (float)($input['from_lon'] ?? 0);
        $toLat   = (float)($input['to_lat']   ?? 0);
        $toLon   = (float)($input['to_lon']   ?? 0);
        $fromAddr = trim($input['from_address'] ?? '');
        $toAddr   = trim($input['to_address']   ?? '');

        if (!$fromLat && $fromAddr) {
            $g = geocodeAddress($fromAddr);
            if ($g) { $fromLat = $g['lat']; $fromLon = $g['lon']; }
        }
        if (!$toLat && $toAddr) {
            $g = geocodeAddress($toAddr);
            if ($g) { $toLat = $g['lat']; $toLon = $g['lon']; }
        }

        $dist = 0;
        if ($fromLat && $toLat) {
            $R    = 6371;
            $dLat = deg2rad($toLat - $fromLat);
            $dLon = deg2rad($toLon - $fromLon);
            $a    = sin($dLat/2)*sin($dLat/2) + cos(deg2rad($fromLat))*cos(deg2rad($toLat))*sin($dLon/2)*sin($dLon/2);
            $dist = $R * 2 * atan2(sqrt($a), sqrt(1-$a));
        }

        $prices = calcTaxiPrices($dist);
        resp([
            'prices'    => $prices,
            'dist_km'   => round($dist, 1),
            'from_lat'  => $fromLat,
            'from_lon'  => $fromLon,
            'to_lat'    => $toLat,
            'to_lon'    => $toLon,
            'geocoded'  => ($fromLat && $toLat && $dist > 0),
        ]);
        break;

    case 'taxi_order':
        try {
            $auth   = requireTelegramUser();
            $userId = (int)($input['user_id'] ?? 0);
            if ($userId !== (int)$auth['id']) resp('Unauthorized', false);
            ensureUserExists($auth);

            $from    = trim($input['from_address'] ?? '');
            $to      = trim($input['to_address']   ?? '');
            $phone   = trim($input['phone']        ?? '');
            $type    = in_array($input['car_type'] ?? '', ['ekonom','comfort','minivan'], true)
                ? $input['car_type'] : 'ekonom';
            $price   = (float)($input['price'] ?? 0);
            $note    = trim($input['note'] ?? '');
            $fromLat = (float)($input['from_lat'] ?? 0);
            $fromLon = (float)($input['from_lon'] ?? 0);
            $toLat   = (float)($input['to_lat'] ?? 0);
            $toLon   = (float)($input['to_lon'] ?? 0);

            if (!$from || !$to || !$phone) resp('Manzil va telefon kerak', false);
            if (!$userId) resp('Foydalanuvchi topilmadi', false);

            if (!$fromLat && $from) { $g = geocodeAddress($from); if ($g) { $fromLat = $g['lat']; $fromLon = $g['lon']; } }
            if (!$toLat && $to)     { $g = geocodeAddress($to);   if ($g) { $toLat = $g['lat'];   $toLon = $g['lon']; } }
            if ($price <= 0 && $fromLat && $toLat) {
                $R = 6371; $dLat = deg2rad($toLat - $fromLat); $dLon = deg2rad($toLon - $fromLon);
                $a = sin($dLat/2)*sin($dLat/2) + cos(deg2rad($fromLat))*cos(deg2rad($toLat))*sin($dLon/2)*sin($dLon/2);
                $dist = $R * 2 * atan2(sqrt($a), sqrt(1-$a));
                $prices = calcTaxiPrices($dist);
                $price = (float)($prices[$type]['price'] ?? $price);
            }

            $chk = db()->prepare("SELECT is_blocked FROM users WHERE id=?");
            $chk->execute([$userId]);
            $cu = $chk->fetch();
            if ($cu && $cu['is_blocked']) resp('Siz bloklangansiz', false);

            $s = db()->prepare(
                "INSERT INTO taxi_rides (user_id, phone, from_address, to_address, from_lat, from_lon, to_lat, to_lon, car_type, price, note)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            );
            $s->execute([$userId, $phone, $from, $to, $fromLat, $fromLon, $toLat, $toLon, $type, $price, $note]);
            $rideId = db()->lastInsertId();

            $u = db()->prepare("SELECT * FROM users WHERE id=?");
            $u->execute([$userId]);
            $u = $u->fetch() ?: [];
            $name  = trim(($u['first_name']??'').' '.($u['last_name']??''));
            $uname = !empty($u['username']) ? "@{$u['username']}" : "ID: $userId";

            $typeLabels = ['ekonom' => '🚗 Ekonom', 'comfort' => '🚙 Comfort', 'minivan' => '🚐 Minivan'];
            $typeLabel  = $typeLabels[$type] ?? $type;

            $fromMaps = $fromLat ? "https://maps.google.com/?q={$fromLat},{$fromLon}" : '';
            $toMaps   = $toLat   ? "https://maps.google.com/?q={$toLat},{$toLon}"     : '';

            $msg = "🚕 *Yangi Taxi #{$rideId}*\n\n"
                 . "👤 *Mijoz:* {$name} ({$uname})\n"
                 . "📞 *Tel:* {$phone}\n"
                 . "{$typeLabel}\n\n"
                 . "📍 *Qayerdan:* {$from}" . ($fromMaps ? " [🗺]({$fromMaps})" : '') . "\n"
                 . "🏁 *Qayerga:* {$to}"   . ($toMaps   ? " [🗺]({$toMaps})"   : '') . "\n"
                 . "💰 *Narx:* " . number_format($price, 0, '.', ' ') . " so'm\n"
                 . ($note ? "📝 *Izoh:* {$note}\n" : '')
                 . "🕐 " . date('d.m.Y H:i');

            tgReq('sendMessage', [
                'chat_id'      => GROUP_CHAT_ID,
                'text'         => $msg,
                'parse_mode'   => 'Markdown',
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '✅ Qabul',   'callback_data' => "taxi_accept_{$rideId}"],
                    ['text' => '❌ Bekor',   'callback_data' => "taxi_cancel_{$rideId}"],
                ]]]
            ]);
            resp(['ride_id' => $rideId, 'price' => $price]);
        } catch (Throwable $e) {
            resp('Taxi buyurtma saqlanmadi: ' . $e->getMessage(), false);
        }
        break;

    case 'my_taxi_rides':
        $auth   = requireTelegramUser();
        $userId = (int)($_GET['user_id'] ?? 0);
        if ($userId !== (int)$auth['id']) resp('Unauthorized', false);
        $s = db()->prepare("SELECT * FROM taxi_rides WHERE user_id=? ORDER BY created_at DESC LIMIT 15");
        $s->execute([$userId]);
        resp($s->fetchAll());
        break;

    case 'cancel_taxi_ride':
        try {
            $auth   = requireTelegramUser();
            $userId = (int)$auth['id'];
            $rideId = (int)($input['ride_id'] ?? 0);
            if (!$rideId) resp('ID kerak', false);

            $s = db()->prepare("SELECT * FROM taxi_rides WHERE id=? AND user_id=?");
            $s->execute([$rideId, $userId]);
            $ride = $s->fetch();
            if (!$ride) resp('Buyurtma topilmadi', false);
            if (in_array($ride['status'], ['completed', 'cancelled'], true)) {
                resp('Bu buyurtmani bekor qilib bo\'lmaydi', false);
            }
            db()->prepare("UPDATE taxi_rides SET status='cancelled' WHERE id=?")->execute([$rideId]);
            resp(['cancelled' => true, 'ride_id' => $rideId]);
        } catch (Throwable $e) {
            resp('Bekor qilinmadi: ' . $e->getMessage(), false);
        }
        break;

    case 'admin_taxi_rides':
        requireAdmin();
        $status = $_GET['status'] ?? '';
        if ($status) {
            $s = db()->prepare(
                "SELECT r.*, u.first_name, u.last_name, u.username
                 FROM taxi_rides r LEFT JOIN users u ON r.user_id=u.id
                 WHERE r.status=? ORDER BY r.created_at DESC LIMIT 100"
            );
            $s->execute([$status]);
        } else {
            $s = db()->query(
                "SELECT r.*, u.first_name, u.last_name, u.username
                 FROM taxi_rides r LEFT JOIN users u ON r.user_id=u.id
                 ORDER BY r.created_at DESC LIMIT 100"
            );
        }
        resp($s->fetchAll());
        break;

    case 'admin_update_taxi':
        requireAdmin();
        $rideId    = $input['ride_id'] ?? 0;
        $newStatus = $input['status']  ?? '';
        if (!$rideId || !$newStatus) resp('Missing data', false);
        db()->prepare("UPDATE taxi_rides SET status=? WHERE id=?")->execute([$newStatus, $rideId]);
        $r = db()->prepare("SELECT user_id FROM taxi_rides WHERE id=?");
        $r->execute([$rideId]); $r = $r->fetch();
        if ($r) {
            $msgs = [
                'accepted'  => "✅ *#{$rideId} taxi buyurtmangiz qabul qilindi!*\n🚕 Haydovchi yo'lda...",
                'on_way'    => "🚕 *#{$rideId} Haydovchi sizga qarab kelyapti!*",
                'arrived'   => "📍 *#{$rideId} Haydovchi yetib keldi!*\nChiqib keling 🚗",
                'completed' => "✅ *#{$rideId} Safaringiz yakunlandi!*\nSafar uchun rahmat 😊",
                'cancelled' => "❌ *#{$rideId} Taxi buyurtmangiz bekor qilindi.*",
            ];
            if (isset($msgs[$newStatus]))
                tgReq('sendMessage', ['chat_id' => $r['user_id'], 'text' => $msgs[$newStatus], 'parse_mode' => 'Markdown']);
        }
        resp('updated');
        break;

    default:
        resp('Unknown action', false);
}
