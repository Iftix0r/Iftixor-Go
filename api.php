<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Telegram-Init-Data');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once 'config.php';
require_once 'db.php';
require_once 'auth.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?? [];

function resp($data, $success = true): void {
    echo json_encode(['success' => $success, 'data' => $data]);
    exit;
}

function requireAdmin(): void {
    global $input;
    $tgUser = validateInitData(getInitDataFromRequest());
    if ($tgUser && isAdminId((int)$tgUser['id'])) return;
    $adminId = (int)($input['admin_id'] ?? $_GET['admin_id'] ?? 0);
    if ($adminId && isAdminId($adminId)) return;
    resp('Unauthorized', false);
}

$adminActions = ['admin_stats','admin_orders','admin_users','admin_user_orders',
    'admin_block_user','admin_unblock_user','admin_delete_user','admin_send_message',
    'admin_update_order','admin_broadcast','admin_add_product','admin_edit_product',
    'admin_delete_product','admin_categories','admin_products'];
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

switch ($action) {

    // ── USER ──
    case 'get_config':
        resp(['delivery_fee' => DELIVERY_FEE, 'currency' => CURRENCY]);
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
        $prods = db()->query("SELECT * FROM products WHERE available=1 ORDER BY category_id")->fetchAll();
        $menu = [];
        foreach ($cats as $c) {
            $c['products'] = array_values(array_filter($prods, fn($p) => $p['category_id'] == $c['id']));
            $menu[] = $c;
        }
        resp($menu);
        break;

    // ── ORDER ──
    case 'place_order':
        $auth = requireTelegramUser();
        $userId  = (int)($input['user_id'] ?? 0);
        if ($userId !== (int)$auth['id']) resp('Unauthorized', false);
        $items   = $input['items']   ?? [];
        $address = trim($input['address'] ?? '');
        $phone   = trim($input['phone'] ?? '');
        $note    = trim($input['note'] ?? '');
        if (!$userId || empty($items)) resp('Invalid data', false);
        if (!$phone || !$address) resp('Telefon va manzil kerak', false);

        // Block tekshiruvi
        $chk = db()->prepare("SELECT is_blocked, block_reason FROM users WHERE id=?");
        $chk->execute([$userId]);
        $cu = $chk->fetch();
        if ($cu && $cu['is_blocked']) {
            resp('Siz bloklangansiz' . ($cu['block_reason'] ? ': ' . $cu['block_reason'] : ''), false);
        }

        // Narxlarni DB dan tekshirish (manipulation oldini olish)
        $productIds = array_map(fn($i) => (int)$i['id'], $items);
        if (empty($productIds)) resp('Bo\'sh buyurtma', false);
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));
        $dbProds = db()->prepare("SELECT id, price, name FROM products WHERE id IN ($placeholders) AND available=1");
        $dbProds->execute($productIds);
        $priceMap = [];
        foreach ($dbProds->fetchAll() as $p) $priceMap[$p['id']] = ['price' => (float)$p['price'], 'name' => $p['name']];

        $validatedItems = [];
        foreach ($items as $item) {
            $pid = (int)($item['id'] ?? 0);
            if (!isset($priceMap[$pid])) continue; // Mavjud bo'lmagan mahsulot
            $qty = max(1, (int)($item['qty'] ?? 1));
            $validatedItems[] = [
                'id'    => $pid,
                'name'  => $priceMap[$pid]['name'],
                'price' => $priceMap[$pid]['price'], // DB narxi
                'qty'   => $qty,
            ];
        }
        if (empty($validatedItems)) resp('Hech bir mahsulot topilmadi', false);
        $items = $validatedItems;

        $subtotal = array_sum(array_map(fn($i) => $i['price'] * $i['qty'], $items));
        $total = $subtotal + DELIVERY_FEE;
        $stmt = db()->prepare("INSERT INTO orders (user_id, items, total, address, phone, note) VALUES (?,?,?,?,?,?)");
        $stmt->execute([$userId, json_encode($items, JSON_UNESCAPED_UNICODE), $total, $address, $phone, $note]);
        $orderId = db()->lastInsertId();

        $u = db()->prepare("SELECT * FROM users WHERE id=?");
        $u->execute([$userId]);
        $u = $u->fetch();

        $itemList = implode("\n", array_map(fn($i) => "  • {$i['name']} × {$i['qty']} = ".number_format($i['price']*$i['qty'])." ".CURRENCY, $items));
        $name  = trim(($u['first_name'] ?? '').' '.($u['last_name'] ?? ''));
        $uname = $u['username'] ? "@{$u['username']}" : "ID: $userId";

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
        $data = [$input['category_id']??0, $input['name']??'', $input['description']??'', $input['price']??0, $input['image']??''];
        if (!$data[0] || !$data[1] || !$data[3]) resp('Missing data', false);
        $s = db()->prepare("INSERT INTO products (category_id, name, description, price, image, available) VALUES (?,?,?,?,?,1)");
        $s->execute($data);
        resp(['id' => db()->lastInsertId()]);
        break;

    case 'admin_edit_product':
        $id = $input['id'] ?? 0;
        if (!$id) resp('Missing id', false);
        db()->prepare("UPDATE products SET name=?, description=?, price=?, image=?, available=?, category_id=? WHERE id=?")
            ->execute([$input['name']??'', $input['description']??'', $input['price']??0, $input['image']??'', $input['available']??1, $input['category_id']??0, $id]);
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

    case 'admin_products':
        resp(db()->query("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.category_id, p.id")->fetchAll());
        break;

    default:
        resp('Unknown action', false);
}
