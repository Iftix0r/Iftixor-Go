<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

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

match($action) {
    'save_user' => (function() use ($input) {
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
    })(),

    'update_profile' => (function() use ($input) {
        $id = $input['user_id'] ?? 0;
        if (!$id) response('No ID', false);
        db()->prepare("UPDATE users SET phone=:phone, address=:address WHERE id=:id")
            ->execute([':phone' => $input['phone'] ?? '', ':address' => $input['address'] ?? '', ':id' => $id]);
        response('updated');
    })(),

    'get_profile' => (function() {
        $id = $_GET['user_id'] ?? 0;
        $user = db()->prepare("SELECT * FROM users WHERE id=?");
        $user->execute([$id]);
        response($user->fetch() ?: []);
    })(),

    'get_menu' => (function() {
        $cats = db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll();
        $prods = db()->query("SELECT * FROM products WHERE available=1 ORDER BY category_id")->fetchAll();
        $menu = [];
        foreach ($cats as $c) {
            $c['products'] = array_values(array_filter($prods, fn($p) => $p['category_id'] == $c['id']));
            $menu[] = $c;
        }
        response($menu);
    })(),

    'place_order' => (function() use ($input) {
        $userId = $input['user_id'] ?? 0;
        $items = $input['items'] ?? [];
        $address = $input['address'] ?? '';
        $phone = $input['phone'] ?? '';
        $note = $input['note'] ?? '';

        if (!$userId || empty($items)) response('Invalid data', false);

        $total = array_sum(array_map(fn($i) => $i['price'] * $i['qty'], $items));

        $stmt = db()->prepare("INSERT INTO orders (user_id, items, total, address, phone, note) VALUES (?,?,?,?,?,?)");
        $stmt->execute([$userId, json_encode($items, JSON_UNESCAPED_UNICODE), $total, $address, $phone, $note]);
        $orderId = db()->lastInsertId();

        // Get user info
        $user = db()->prepare("SELECT * FROM users WHERE id=?");
        $user->execute([$userId]);
        $u = $user->fetch();

        // Build Telegram message
        $itemList = implode("\n", array_map(fn($i) => "  • {$i['name']} × {$i['qty']} = ".number_format($i['price']*$i['qty'])." ".CURRENCY, $items));
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
    })(),

    'my_orders' => (function() {
        $userId = $_GET['user_id'] ?? 0;
        $orders = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20");
        $orders->execute([$userId]);
        $list = $orders->fetchAll();
        foreach ($list as &$o) $o['items'] = json_decode($o['items'], true);
        response($list);
    })(),

    default => response('Unknown action', false),
};
