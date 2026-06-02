<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once 'config.php';
require_once 'db.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?? [];

function response($data, $success = true): void {
    echo json_encode(['success' => $success, 'data' => $data]);
    exit;
}

function tgRequest(string $method, array $params = []): array {
    $url = "https://api.telegram.org/bot".BOT_TOKEN."/$method";
    $ch = curl_init($url);
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
    case 'save_user':
        $u = $input['user'] ?? [];
        if (empty($u['id'])) response('No user data', false);

        db()->prepare("INSERT INTO users (id, username, first_name, last_name, photo_url, language_code)
            VALUES (:id, :username, :first_name, :last_name, :photo_url, :lang)
            ON DUPLICATE KEY UPDATE username=VALUES(username), first_name=VALUES(first_name),
            last_name=VALUES(last_name), photo_url=VALUES(photo_url)"
        )->execute([
            ':id' => $u['id'],
            ':username' => $u['username'] ?? '',
            ':first_name' => $u['first_name'] ?? '',
            ':last_name' => $u['last_name'] ?? '',
            ':photo_url' => $u['photo_url'] ?? '',
            ':lang' => $u['language_code'] ?? 'uz',
        ]);
        response('saved');
        break;

    case 'update_profile':
        $id = $input['user_id'] ?? 0;
        if (!$id) response('No ID', false);
        db()->prepare("UPDATE users SET phone=:phone, address=:address WHERE id=:id")
            ->execute([':phone' => $input['phone'] ?? '', ':address' => $input['address'] ?? '', ':id' => $id]);
        response('updated');
        break;

    case 'get_profile':
        $id = $_GET['user_id'] ?? 0;
        $user = db()->prepare("SELECT * FROM users WHERE id=?");
        $user->execute([$id]);
        $data = $user->fetch();
        response($data ?: []);
        break;

    case 'get_menu':
        $cats = db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll();
        $prods = db()->query("SELECT * FROM products WHERE available=1 ORDER BY category_id")->fetchAll();
        $menu = [];
        foreach ($cats as $c) {
            $c['products'] = array_values(array_filter($prods, function($p) use ($c) { return $p['category_id'] == $c['id']; }));
            $menu[] = $c;
        }
        response($menu);
        break;

    case 'place_order':
        $userId = $input['user_id'] ?? 0;
        $items = $input['items'] ?? [];
        $address = $input['address'] ?? '';
        $phone = $input['phone'] ?? '';
        $note = $input['note'] ?? '';

        if (!$userId || empty($items)) response('Invalid data', false);

        $total = array_sum(array_map(function($i) { return $i['price'] * $i['qty']; }, $items));

        $stmt = db()->prepare("INSERT INTO orders (user_id, items, total, address, phone, note) VALUES (?,?,?,?,?,?)");
        $stmt->execute([$userId, json_encode($items, JSON_UNESCAPED_UNICODE), $total, $address, $phone, $note]);
        $orderId = db()->lastInsertId();

        // Get user info
        $user = db()->prepare("SELECT * FROM users WHERE id=?");
        $user->execute([$userId]);
        $u = $user->fetch();

        // Build Telegram message
        $itemList = implode("\n", array_map(function($i) { return "  • {$i['name']} × {$i['qty']} = ".number_format($i['price']*$i['qty'])." ".CURRENCY; }, $items));
        $name = trim(($u['first_name'] ?? '').' '.($u['last_name'] ?? ''));
        $uname = $u['username'] ? "@{$u['username']}" : "ID: $userId";

        $msg = "🆕 *Yangi Buyurtma #$orderId*\n\n"
             . "👤 *Mijoz:* $name ($uname)\n"
             . "📞 *Tel:* $phone\n"
             . "📍 *Manzil:* $address\n"
             . ($note ? "📝 *Izoh:* $note\n" : '')
             . "\n🛒 *Buyurtma:*\n$itemList\n\n"
             . "💰 *Jami: ".number_format($total)." ".CURRENCY."*\n"
             . "🕐 ".date('d.m.Y H:i');

        tgRequest('sendMessage', [
            'chat_id' => GROUP_CHAT_ID,
            'text' => $msg,
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '✅ Qabul qilish', 'callback_data' => "confirm_$orderId"],
                ['text' => '❌ Bekor qilish', 'callback_data' => "cancel_$orderId"],
            ]]]
        ]);

        response(['order_id' => $orderId, 'total' => $total]);
        break;

    case 'my_orders':
        $userId = $_GET['user_id'] ?? 0;
        $orders = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20");
        $orders->execute([$userId]);
        $list = $orders->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        response($list);
        break;

    // ═══════════ ADMIN API ═══════════

    case 'admin_stats':
        $today = date('Y-m-d');
        $todayOrders = db()->prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE DATE(created_at)=?");
        $todayOrders->execute([$today]);
        $ts = $todayOrders->fetch();

        $allOrders = db()->query("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders")->fetch();
        $users = db()->query("SELECT COUNT(*) as cnt FROM users")->fetch();
        $pending = db()->query("SELECT COUNT(*) as cnt FROM orders WHERE status='new'")->fetch();

        response([
            'today_orders' => (int)$ts['cnt'],
            'today_revenue' => (int)$ts['rev'],
            'total_orders' => (int)$allOrders['cnt'],
            'total_revenue' => (int)$allOrders['rev'],
            'total_users' => (int)$users['cnt'],
            'pending_orders' => (int)$pending['cnt'],
        ]);
        break;

    case 'admin_orders':
        $status = $_GET['status'] ?? '';
        $limit = (int)($_GET['limit'] ?? 50);
        $sql = "SELECT o.*, u.first_name, u.last_name, u.username, u.photo_url, u.phone as user_phone FROM orders o LEFT JOIN users u ON o.user_id=u.id";
        if ($status) {
            $sql .= " WHERE o.status=?";
            $stmt = db()->prepare($sql . " ORDER BY o.created_at DESC LIMIT $limit");
            $stmt->execute([$status]);
        } else {
            $stmt = db()->query($sql . " ORDER BY o.created_at DESC LIMIT $limit");
        }
        $list = $stmt->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        response($list);
        break;

    case 'admin_users':
        $search = $_GET['search'] ?? '';
        if ($search) {
            $stmt = db()->prepare("SELECT * FROM users WHERE first_name LIKE ? OR username LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 100");
            $q = "%$search%";
            $stmt->execute([$q, $q, $q]);
        } else {
            $stmt = db()->query("SELECT * FROM users ORDER BY id DESC LIMIT 100");
        }
        response($stmt->fetchAll());
        break;

    case 'admin_update_order':
        $orderId = $input['order_id'] ?? 0;
        $newStatus = $input['status'] ?? '';
        if (!$orderId || !$newStatus) response('Missing data', false);
        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);

        // Notify user
        $order = db()->prepare("SELECT user_id FROM orders WHERE id=?");
        $order->execute([$orderId]);
        $o = $order->fetch();
        if ($o) {
            $msgs = [
                'confirmed' => "✅ *#{$orderId} buyurtmangiz qabul qilindi!*\n🍽️ Tayyorlanmoqda...",
                'cooking' => "👨‍🍳 *#{$orderId} buyurtmangiz tayyorlanmoqda!*",
                'delivered' => "🚚 *#{$orderId} buyurtmangiz yetkazildi!*\nYoqimli ishtaha! 😋",
                'cancelled' => "❌ *#{$orderId} buyurtmangiz bekor qilindi.*",
            ];
            if (isset($msgs[$newStatus])) {
                tgRequest('sendMessage', ['chat_id' => $o['user_id'], 'text' => $msgs[$newStatus], 'parse_mode' => 'Markdown']);
            }
        }
        response('updated');
        break;

    case 'admin_broadcast':
        $message = $input['message'] ?? '';
        if (!$message) response('No message', false);
        $users = db()->query("SELECT id FROM users")->fetchAll();
        $sent = 0;
        foreach ($users as $u) {
            $result = tgRequest('sendMessage', ['chat_id' => $u['id'], 'text' => $message, 'parse_mode' => 'Markdown']);
            if (!empty($result['ok'])) $sent++;
        }
        response(['sent' => $sent, 'total' => count($users)]);
        break;

    case 'admin_add_product':
        $catId = $input['category_id'] ?? 0;
        $name = $input['name'] ?? '';
        $desc = $input['description'] ?? '';
        $price = $input['price'] ?? 0;
        $image = $input['image'] ?? '';
        if (!$catId || !$name || !$price) response('Missing data', false);
        $stmt = db()->prepare("INSERT INTO products (category_id, name, description, price, image, available) VALUES (?,?,?,?,?,1)");
        $stmt->execute([$catId, $name, $desc, $price, $image]);
        response(['id' => db()->lastInsertId()]);
        break;

    case 'admin_edit_product':
        $id = $input['id'] ?? 0;
        $name = $input['name'] ?? '';
        $desc = $input['description'] ?? '';
        $price = $input['price'] ?? 0;
        $image = $input['image'] ?? '';
        $available = isset($input['available']) ? (int)$input['available'] : 1;
        if (!$id) response('Missing id', false);
        db()->prepare("UPDATE products SET name=?, description=?, price=?, image=?, available=? WHERE id=?")
            ->execute([$name, $desc, $price, $image, $available, $id]);
        response('updated');
        break;

    case 'admin_delete_product':
        $id = $input['id'] ?? 0;
        if (!$id) response('Missing id', false);
        db()->prepare("DELETE FROM products WHERE id=?")->execute([$id]);
        response('deleted');
        break;

    case 'admin_categories':
        response(db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll());
        break;

    case 'admin_products':
        response(db()->query("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.category_id, p.id")->fetchAll());
        break;

    default:
        response('Unknown action', false);
        break;
}
