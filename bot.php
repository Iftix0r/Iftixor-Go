<?php
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/bot_error.log');

set_exception_handler(function(Throwable $e) {
    file_put_contents(__DIR__ . '/bot_error.log',
        date('Y-m-d H:i:s') . ' EXCEPTION: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine() . "\n",
        FILE_APPEND);
});

require_once 'config.php';
require_once 'db.php';

// role va restaurant_id ustunlari yo'q bo'lsa qo'shish
try {
    $cols = db()->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('role', $cols)) {
        db()->exec("ALTER TABLE users ADD COLUMN role ENUM('user','seller','admin') DEFAULT 'user'");
    }
    if (!in_array('restaurant_id', $cols)) {
        db()->exec("ALTER TABLE users ADD COLUMN restaurant_id INT DEFAULT NULL");
    }
} catch (Throwable $e) {
    file_put_contents(__DIR__ . '/bot_error.log', date('Y-m-d H:i:s') . ' ALTER: ' . $e->getMessage() . "\n", FILE_APPEND);
}

function tg(string $method, array $params): array {
    $ch = curl_init("https://api.telegram.org/bot".BOT_TOKEN."/$method");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($params),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $res = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $res ?? [];
}

function sendMsg(int $chatId, string $text, ?array $replyMarkup = null): void {
    $params = ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'Markdown'];
    if ($replyMarkup) $params['reply_markup'] = $replyMarkup;
    tg('sendMessage', $params);
}

// Asosiy klaviatura role-ga qarab
function mainKeyboard(bool $hasPhone, string $role = 'user'): array {
    $rows = [];
    if (!$hasPhone) {
        $rows[] = [['text' => '📱 Telefon raqamimni yuborish', 'request_contact' => true]];
    }
    $rows[] = [['text' => '📍 Joylashuvimni yuborish', 'request_location' => true]];
    $rows[] = [['text' => '📋 Buyurtmalarim'], ['text' => '👤 Profil']];
    $rows[] = [['text' => '📞 Bog\'lanish'], ['text' => 'ℹ️ Haqida']];
    return ['keyboard' => $rows, 'resize_keyboard' => true];
}

// Role-ga qarab inline tugmalar
function roleInlineButtons(string $role): array {
    if ($role === 'seller') {
        return ['inline_keyboard' => [
            [['text' => '📦 Buyurtmalar',     'callback_data' => 'seller_orders'],
             ['text' => '📊 Statistika',      'callback_data' => 'seller_stats']],
            [['text' => '🍽️ Menyu',           'callback_data' => 'seller_menu']],
            [['text' => '⚙️ Sozlamalar',       'callback_data' => 'seller_settings']],
        ]];
    }
    if ($role === 'admin') {
        return ['inline_keyboard' => [
            [['text' => '⚙️ Admin Panel', 'web_app' => ['url' => WEBAPP_URL . 'admin.html']]],
        ]];
    }
    return ['inline_keyboard' => [
        [['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]]
    ]];
}

function sellerOrdersKeyboard(array $orders): array {
    $rows = [];
    foreach (array_slice($orders, 0, 8) as $o) {
        $statusIcons = ['new'=>'🆕','confirmed'=>'✅','cooking'=>'👨‍🍳','delivered'=>'🚚','cancelled'=>'❌'];
        $icon = $statusIcons[$o['status']] ?? '❓';
        $rows[] = [['text' => "{$icon} #{$o['id']} — ".number_format($o['total']).' so\'m', 'callback_data' => 'order_detail_'.$o['id']]];
    }
    $rows[] = [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']];
    return ['inline_keyboard' => $rows];
}

function orderDetailKeyboard(int $orderId, string $status): array {
    $buttons = [['text' => '🔙 Buyurtmalar', 'callback_data' => 'seller_orders']];
    $actions = [
        'new'       => [['text' => '✅ Qabul', 'callback_data' => "seller_status_{$orderId}_confirmed"], ['text' => '❌ Bekor', 'callback_data' => "seller_status_{$orderId}_cancelled"]],
        'confirmed' => [['text' => '👨‍🍳 Tayyorlanmoqda', 'callback_data' => "seller_status_{$orderId}_cooking"]],
        'cooking'   => [['text' => '🚚 Yetkazildi', 'callback_data' => "seller_status_{$orderId}_delivered"]],
    ];
    $rows = [];
    if (isset($actions[$status])) $rows[] = $actions[$status];
    $rows[] = $buttons;
    return ['inline_keyboard' => $rows];
}

function getSellerRestaurant(int $tgId): ?array {
    // avval users.restaurant_id orqali
    $s = db()->prepare("SELECT r.* FROM restaurants r JOIN users u ON u.restaurant_id=r.id WHERE u.id=?");
    $s->execute([$tgId]);
    $r = $s->fetch();
    if ($r) return $r;
    // bo'lmasa owner_tg_id orqali
    $s2 = db()->prepare("SELECT * FROM restaurants WHERE owner_tg_id=?");
    $s2->execute([$tgId]);
    $r2 = $s2->fetch();
    if ($r2) {
        // restaurant_id ni users ga yozib qo'yamiz
        db()->prepare("UPDATE users SET restaurant_id=? WHERE id=?")->execute([$r2['id'], $tgId]);
        return $r2;
    }
    return null;
}

function getSellerOrders(int $tgId): array {
    $rest = getSellerRestaurant($tgId);
    if (!$rest) return [];
    $prods = db()->prepare("SELECT id FROM products WHERE restaurant_id=?");
    $prods->execute([$rest['id']]);
    $prodIds = array_column($prods->fetchAll(), 'id');
    if (!$prodIds) return [];

    $orders = db()->query("SELECT * FROM orders WHERE status != 'cancelled' ORDER BY id DESC LIMIT 50")->fetchAll();
    $result = [];
    foreach ($orders as $o) {
        $items = json_decode($o['items'], true) ?? [];
        foreach ($items as $item) {
            if (in_array((int)$item['id'], $prodIds)) {
                $result[] = $o;
                break;
            }
        }
    }
    return $result;
}

function getSellerProducts(int $tgId): array {
    $rest = getSellerRestaurant($tgId);
    if (!$rest) return [];
    $s = db()->prepare("SELECT * FROM products WHERE restaurant_id=? ORDER BY id DESC");
    $s->execute([$rest['id']]);
    return $s->fetchAll();
}

function saveProdFromDraft(int $chatId, array $rest, string $imageUrl): void {
    $d = db()->prepare("SELECT * FROM seller_draft WHERE user_id=?");
    $d->execute([$chatId]); $d = $d->fetch();
    if (!$d || !$d['name'] || !$d['price']) {
        sendMsg($chatId, "\xE2\x9D\x8C Xatolik, qayta boshlang.");
        clearSellerState($chatId);
        return;
    }
    $desc = $d['desc_text'] ?? '';
    db()->prepare("INSERT INTO products (category_id, restaurant_id, name, description, price, image, available) VALUES (?,?,?,?,?,?,1)")
        ->execute([$d['cat_id'], $rest['id'], $d['name'], $desc, $d['price'], $imageUrl]);
    db()->prepare("DELETE FROM seller_draft WHERE user_id=?")->execute([$chatId]);
    clearSellerState($chatId);
    $products = getSellerProducts($chatId);
    $rows = [];
    foreach ($products as $p) {
        $av = $p['available'] ? "\xE2\x9C\x85" : "\xE2\x9D\x8C";
        $rows[] = [['text' => "{$av} {$p['name']} \xE2\x80\x94 ".number_format($p['price'])." so'm", 'callback_data' => 'prod_detail_'.$p['id']]];
    }
    $rows[] = [['text' => "\xE2\x9E\x95 Mahsulot qo'shish", 'callback_data' => 'prod_add_start']];
    $rows[] = [['text' => "\xF0\x9F\x94\x99 Orqaga", 'callback_data' => 'seller_back']];
    tg('sendMessage', ['chat_id' => $chatId,
        'text' => "\xE2\x9C\x85 *{$d['name']}* menyuga qo'shildi!",
        'parse_mode' => 'Markdown', 'reply_markup' => ['inline_keyboard' => $rows]]);
}

// ── STATE: sotuvchi jarayon holati ──
function setSellerState(int $uid, string $state, int $ref = 0): void {
    db()->prepare("INSERT INTO seller_states (user_id, state, ref_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state), ref_id=VALUES(ref_id), updated_at=NOW()")
        ->execute([$uid, $state, $ref]);
}
function getSellerState(int $uid): array {
    try {
        $s = db()->prepare("SELECT state, ref_id FROM seller_states WHERE user_id=? AND updated_at > NOW() - INTERVAL 10 MINUTE");
        $s->execute([$uid]);
        return $s->fetch() ?: ['state' => '', 'ref_id' => 0];
    } catch (Throwable $e) { return ['state' => '', 'ref_id' => 0]; }
}
function clearSellerState(int $uid): void {
    db()->prepare("DELETE FROM seller_states WHERE user_id=?")->execute([$uid]);
}
// Jadval yo'q bo'lsa yaratamiz
try {
    db()->exec("CREATE TABLE IF NOT EXISTS seller_states (
        user_id BIGINT PRIMARY KEY,
        state VARCHAR(64) NOT NULL,
        ref_id INT DEFAULT 0,
        updated_at DATETIME DEFAULT NOW()
    )");
    db()->exec("CREATE TABLE IF NOT EXISTS seller_draft (
        user_id BIGINT PRIMARY KEY,
        cat_id INT DEFAULT 0,
        name VARCHAR(255) DEFAULT '',
        desc_text TEXT,
        price DECIMAL(10,2) DEFAULT 0
    )");
    // desc_text ustuni yo'q bo'lsa qo'shish
    try {
        db()->exec("ALTER TABLE seller_draft ADD COLUMN desc_text TEXT");
    } catch (Throwable $e) {}
} catch (Throwable $e) {}

function getUserRole(int $id): string {
    static $cache = [];
    if (isset($cache[$id])) return $cache[$id];
    try {
        $s = db()->prepare("SELECT role FROM users WHERE id=?");
        $s->execute([$id]);
        $cache[$id] = $s->fetchColumn() ?: 'user';
    } catch (Throwable $e) {
        $cache[$id] = 'user';
    }
    return $cache[$id];
}

$update = json_decode(file_get_contents('php://input'), true);
if (!$update) exit;

// ── CALLBACK QUERIES ──
if (isset($update['callback_query'])) {
    $cb     = $update['callback_query'];
    $data   = $cb['data'];
    $msgId  = $cb['message']['message_id'];
    $chatId = $cb['message']['chat']['id'];
    $fromId = (int)$cb['from']['id'];

    // ── ADMIN: buyurtma qabul/bekor ──
    if (preg_match('/^(confirm|cancel)_(\d+)$/', $data, $m)) {
        $action    = $m[1];
        $orderId   = (int)$m[2];
        $newStatus = $action === 'confirm' ? 'confirmed' : 'cancelled';
        $statusText = $action === 'confirm' ? '✅ Qabul qilindi' : '❌ Bekor qilindi';
        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);
        $order = db()->prepare("SELECT user_id FROM orders WHERE id=?");
        $order->execute([$orderId]); $o = $order->fetch();
        if ($o) {
            $userMsg = $action === 'confirm'
                ? "✅ *#{$orderId} buyurtmangiz qabul qilindi!*\n🍽️ Tayyorlanmoqda, kuting..."
                : "❌ *#{$orderId} buyurtmangiz bekor qilindi.*";
            tg('sendMessage', ['chat_id' => $o['user_id'], 'text' => $userMsg, 'parse_mode' => 'Markdown']);
        }
        tg('editMessageText', [
            'chat_id' => $chatId, 'message_id' => $msgId,
            'text' => $cb['message']['text']."\n\n*{$statusText}* — ".$cb['from']['first_name'],
            'parse_mode' => 'Markdown',
        ]);
    }

    // ── ADMIN: taxi ──
    elseif (preg_match('/^taxi_(accept|cancel)_(\d+)$/', $data, $m)) {
        $rideId    = (int)$m[2];
        $newStatus = $m[1] === 'accept' ? 'accepted' : 'cancelled';
        $statusText = $m[1] === 'accept' ? '✅ Taxi qabul qilindi' : '❌ Taxi bekor qilindi';
        db()->prepare("UPDATE taxi_rides SET status=? WHERE id=?")->execute([$newStatus, $rideId]);
        $ride = db()->prepare("SELECT user_id FROM taxi_rides WHERE id=?");
        $ride->execute([$rideId]); $r = $ride->fetch();
        if ($r) {
            $userMsg = $m[1] === 'accept'
                ? "✅ *#{$rideId} taxi buyurtmangiz qabul qilindi!*\n🚕 Haydovchi yo'lda..."
                : "❌ *#{$rideId} taxi buyurtmangiz bekor qilindi.*";
            tg('sendMessage', ['chat_id' => $r['user_id'], 'text' => $userMsg, 'parse_mode' => 'Markdown']);
        }
        tg('editMessageText', [
            'chat_id' => $chatId, 'message_id' => $msgId,
            'text' => $cb['message']['text']."\n\n*{$statusText}* — ".$cb['from']['first_name'],
            'parse_mode' => 'Markdown',
        ]);
    }

    // ── SOTUVCHI: bosh menu ──
    elseif ($data === 'seller_back' || $data === 'seller_start') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "🏪 *Sotuvchi Panel*\n\nNimani boshqarasiz?",
            'parse_mode' => 'Markdown',
            'reply_markup' => roleInlineButtons('seller'),
        ]);
    }

    // ── SOTUVCHI: buyurtmalar ro'yxati ──
    elseif ($data === 'seller_orders') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $orders = getSellerOrders($fromId);
        if (empty($orders)) {
            tg('editMessageText', [
                'chat_id' => $fromId, 'message_id' => $msgId,
                'text' => "📦 Hozircha faol buyurtma yo'q.",
                'parse_mode' => 'Markdown',
                'reply_markup' => ['inline_keyboard' => [[['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']]]],
            ]);
        } else {
            tg('editMessageText', [
                'chat_id' => $fromId, 'message_id' => $msgId,
                'text' => "📦 *Buyurtmalar (".count($orders)." ta):*\n\nBirini tanlang:",
                'parse_mode' => 'Markdown',
                'reply_markup' => sellerOrdersKeyboard($orders),
            ]);
        }
    }

    // ── SOTUVCHI: buyurtma detail ──
    elseif (preg_match('/^order_detail_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $orderId = (int)$m[1];
        $o = db()->prepare("SELECT o.*, u.first_name, u.last_name, u.username FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?");
        $o->execute([$orderId]); $o = $o->fetch();
        if (!$o) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Topilmadi']); exit; }
        $items = json_decode($o['items'], true) ?? [];
        $itemList = implode("\n", array_map(fn($i) => "  • {$i['name']} ×{$i['qty']} = ".number_format($i['price']*$i['qty'])." so'm", $items));
        $statusMap = ['new' => '🆕 Yangi', 'confirmed' => '✅ Qabul', 'cooking' => '👨🍳 Tayyorlanmoqda', 'delivered' => '🚚 Yetkazildi', 'cancelled' => '❌ Bekor'];
        $name  = trim(($o['first_name']??'').' '.($o['last_name']??''));
        $uname = $o['username'] ? "@{$o['username']}" : '';
        $text = "📦 *Buyurtma #{$orderId}*\n\n"
              . "👤 {$name} {$uname}\n"
              . "📞 {$o['phone']}\n"
              . "📍 {$o['address']}\n\n"
              . "🛒 *Tarkib:*\n{$itemList}\n\n"
              . "💰 Jami: *".number_format($o['total'])." so'm*\n"
              . "📊 Status: *".($statusMap[$o['status']]??$o['status'])."*";
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => orderDetailKeyboard($orderId, $o['status']),
        ]);
    }

    // ── SOTUVCHI: status o'zgartirish ──
    elseif (preg_match('/^seller_status_(\d+)_(.+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $orderId   = (int)$m[1];
        $newStatus = $m[2];
        $allowed   = ['confirmed', 'cooking', 'delivered', 'cancelled'];
        if (!in_array($newStatus, $allowed, true)) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);
        $o = db()->prepare("SELECT user_id FROM orders WHERE id=?");
        $o->execute([$orderId]); $o = $o->fetch();
        if ($o) {
            $msgs = [
                'confirmed' => "✅ *#{$orderId} buyurtmangiz qabul qilindi!*\n🍽️ Tayyorlanmoqda...",
                'cooking'   => "👨🍳 *#{$orderId} buyurtmangiz tayyorlanmoqda!*",
                'delivered' => "🚚 *#{$orderId} buyurtmangiz yetkazildi!*\nYoqimli ishtaha! 😋",
                'cancelled' => "❌ *#{$orderId} buyurtmangiz bekor qilindi.*",
            ];
            if (isset($msgs[$newStatus]))
                tg('sendMessage', ['chat_id' => $o['user_id'], 'text' => $msgs[$newStatus], 'parse_mode' => 'Markdown']);
        }
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => '✅ Status yangilandi']);
        // Qayta detail ko'rsat
        $cb['data'] = "order_detail_{$orderId}";
        // Re-fetch and show
        $oRow = db()->prepare("SELECT o.*, u.first_name, u.last_name, u.username FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?");
        $oRow->execute([$orderId]); $oRow = $oRow->fetch();
        $items = json_decode($oRow['items'], true) ?? [];
        $itemList = implode("\n", array_map(fn($i) => "  • {$i['name']} ×{$i['qty']} = ".number_format($i['price']*$i['qty'])." so'm", $items));
        $statusMap = ['new' => '🆕 Yangi', 'confirmed' => '✅ Qabul', 'cooking' => '👨🍳 Tayyorlanmoqda', 'delivered' => '🚚 Yetkazildi', 'cancelled' => '❌ Bekor'];
        $name  = trim(($oRow['first_name']??'').' '.($oRow['last_name']??''));
        $uname = $oRow['username'] ? "@{$oRow['username']}" : '';
        $text = "📦 *Buyurtma #{$orderId}*\n\n"
              . "👤 {$name} {$uname}\n"
              . "📞 {$oRow['phone']}\n"
              . "📍 {$oRow['address']}\n\n"
              . "🛒 *Tarkib:*\n{$itemList}\n\n"
              . "💰 Jami: *".number_format($oRow['total'])." so'm*\n"
              . "📊 Status: *".($statusMap[$newStatus]??$newStatus)."*";
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => orderDetailKeyboard($orderId, $newStatus),
        ]);
        exit;
    }

    // ── SOTUVCHI: menyu ──
    elseif ($data === 'seller_menu') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $products = getSellerProducts($fromId);
        $rows = [];
        foreach ($products as $p) {
            $avail = $p['available'] ? '✅' : '❌';
            $rows[] = [['text' => "{$avail} {$p['name']} — ".number_format($p['price'])." so'm",
                        'callback_data' => 'prod_detail_'.$p['id']]];
        }
        $rows[] = [['text' => '➕ Mahsulot qo\'shish', 'callback_data' => 'prod_add_start']];
        $rows[] = [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']];
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "🍽️ *Menyu" . (count($products) ? ' ('.count($products).' ta)' : ' \u2014 bo\'sh') . "*\n\nMahsulotni bosing yoki yangi qo'shing:",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => $rows],
        ]);
    }

    // ── SOTUVCHI: mahsulot detail ──
    elseif (preg_match('/^prod_detail_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $pid = (int)$m[1];
        $p = db()->prepare("SELECT p.*, c.name as cat_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?");
        $p->execute([$pid]); $p = $p->fetch();
        if (!$p) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Topilmadi']); exit; }
        $avail = $p['available'] ? '✅ Mavjud' : '❌ Mavjud emas';
        $text = "🍽️ *{$p['name']}*\n\n"
              . "💰 Narx: *".number_format($p['price'])." so'm*\n"
              . "🏷️ Kategoriya: {$p['cat_name']}\n"
              . "📊 Status: {$avail}\n"
              . ($p['description'] ? "📝 {$p['description']}" : '');
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [
                [['text' => $p['available'] ? '❌ Yopish' : '✅ Ochish', 'callback_data' => 'prod_toggle_'.$pid],
                 ['text' => '✏️ Narx o\'zgartir', 'callback_data' => 'prod_price_'.$pid]],
                [['text' => '🗑️ O\'chirish', 'callback_data' => 'prod_delete_'.$pid]],
                [['text' => '🔙 Menyu', 'callback_data' => 'seller_menu']],
            ]],
        ]);
    }

    // ── SOTUVCHI: mahsulot toggle ──
    elseif (preg_match('/^prod_toggle_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $pid = (int)$m[1];
        $p = db()->prepare("SELECT available FROM products WHERE id=?");
        $p->execute([$pid]); $p = $p->fetch();
        if (!$p) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Topilmadi']); exit; }
        $newAvail = $p['available'] ? 0 : 1;
        db()->prepare("UPDATE products SET available=? WHERE id=?")->execute([$newAvail, $pid]);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'],
            'text' => $newAvail ? '✅ Faollashtirildi' : '❌ O\'chirildi']);
        // Detail qayta ko'rsat
        $cb['data'] = "prod_detail_{$pid}";
        $p2 = db()->prepare("SELECT p.*, c.name as cat_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?");
        $p2->execute([$pid]); $p2 = $p2->fetch();
        $avail = $p2['available'] ? '✅ Mavjud' : '❌ Mavjud emas';
        $text = "🍽️ *{$p2['name']}*\n\n💰 Narx: *".number_format($p2['price'])." so'm*\n🏷️ Kategoriya: {$p2['cat_name']}\n📊 Status: {$avail}";
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [
                [['text' => $p2['available'] ? '❌ Yopish' : '✅ Ochish', 'callback_data' => 'prod_toggle_'.$pid],
                 ['text' => '✏️ Narx o\'zgartir', 'callback_data' => 'prod_price_'.$pid]],
                [['text' => '🗑️ O\'chirish', 'callback_data' => 'prod_delete_'.$pid]],
                [['text' => '🔙 Menyu', 'callback_data' => 'seller_menu']],
            ]],
        ]);
        exit;
    }

    // ── SOTUVCHI: mahsulot o'chirish ──
    elseif (preg_match('/^prod_delete_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $pid = (int)$m[1];
        // Faqat o'z mahsuloti
        $rest = getSellerRestaurant($fromId);
        $own = db()->prepare("SELECT id, name FROM products WHERE id=? AND restaurant_id=?");
        $own->execute([$pid, $rest['id'] ?? 0]); $own = $own->fetch();
        if (!$own) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Ruxsat yo\'q']); exit; }
        db()->prepare("DELETE FROM products WHERE id=?")->execute([$pid]);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => '🗑️ O\'chirildi']);
        // Menyuga qayt
        $products = getSellerProducts($fromId);
        $rows = [];
        foreach ($products as $p) {
            $avail = $p['available'] ? '✅' : '❌';
            $rows[] = [['text' => "{$avail} {$p['name']} — ".number_format($p['price'])." so'm",
                        'callback_data' => 'prod_detail_'.$p['id']]];
        }
        $rows[] = [['text' => '➕ Mahsulot qo\'shish', 'callback_data' => 'prod_add_start']];
        $rows[] = [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']];
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "🍽️ *Menyu" . (count($products) ? ' ('.count($products).' ta)' : ' \u2014 bo\'sh') . "*\n\nMahsulotni bosing yoki yangi qo'shing:",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => $rows],
        ]);
        exit;
    }

    // ── SOTUVCHI: narx o'zgartirish boshlash ──
    elseif (preg_match('/^prod_price_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $pid = (int)$m[1];
        setSellerState($fromId, 'awaiting_price', $pid);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        tg('sendMessage', [
            'chat_id' => $fromId,
            'text' => "✏️ Yangi narxni yuboring (faqat raqam, masalan: 15000)",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[['text' => '❌ Bekor', 'callback_data' => 'state_cancel']]]],
        ]);
        exit;
    }

    // ── SOTUVCHI: mahsulot qo'shish ──
    elseif ($data === 'prod_add_start') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        // Kategoriyalarni ko'rsat
        $cats = db()->query("SELECT * FROM categories ORDER BY sort_order")->fetchAll();
        $rows = [];
        foreach ($cats as $c) {
            $rows[] = [['text' => "{$c['icon']} {$c['name']}", 'callback_data' => 'prod_add_cat_'.$c['id']]];
        }
        $rows[] = [['text' => '❌ Bekor', 'callback_data' => 'seller_menu']];
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "➕ *Yangi mahsulot*\n\nKategoriyani tanlang:",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => $rows],
        ]);
    }

    elseif (preg_match('/^prod_add_cat_(\d+)$/', $data, $m)) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $catId = (int)$m[1];
        setSellerState($fromId, 'awaiting_prod_name', $catId);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "➕ *Yangi mahsulot*\n\nMahsulot nomini yuboring:",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[['text' => '❌ Bekor', 'callback_data' => 'state_cancel']]]],
        ]);
    }

    // ── SOTUVCHI: sozlamalar ──
    elseif ($data === 'seller_settings') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $rest = getSellerRestaurant($fromId);
        if (!$rest) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Restoran topilmadi']); exit; }
        $text = "⚙️ *Sozlamalar*\n\n"
              . "🏪 Nomi: *{$rest['name']}*\n"
              . "📍 Manzil: " . ($rest['address'] ?: '_kiritilmagan_') . "\n"
              . "📞 Telefon: " . ($rest['phone'] ?: '_kiritilmagan_') . "\n";
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [
                [['text' => '🏪 Nom o\'zgartir',   'callback_data' => 'set_name'],
                 ['text' => '📞 Tel o\'zgartir',    'callback_data' => 'set_phone']],
                [['text' => '📍 Manzil o\'zgartir','callback_data' => 'set_address']],
                [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']],
            ]],
        ]);
    }

    elseif (in_array($data, ['set_name','set_phone','set_address'])) {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $prompts = [
            'set_name'    => "🏪 Yangi restoran nomini yuboring:",
            'set_phone'   => "📞 Yangi telefon raqamini yuboring:",
            'set_address' => "📍 Yangi manzilni yuboring:",
        ];
        setSellerState($fromId, 'awaiting_'.$data, 0);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $prompts[$data],
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[['text' => '❌ Bekor', 'callback_data' => 'state_cancel']]]],
        ]);
    }

    // ── Skip desc ──
    elseif ($data === 'prod_skip_desc') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        db()->prepare("INSERT INTO seller_draft (user_id, desc_text) VALUES (?,?) ON DUPLICATE KEY UPDATE desc_text=VALUES(desc_text)")->execute([$fromId, '']);
        setSellerState($fromId, 'awaiting_prod_image', 0);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        tg('editMessageText', ['chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "Mahsulot rasmini yuboring (yoki o'tkazib yuboring):",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[['text' => 'Skip', 'callback_data' => 'prod_skip_image']]]]]);
        exit;
    }

    elseif ($data === 'prod_skip_image') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $rest = getSellerRestaurant($fromId);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Qo\'shildi']);
        saveProdFromDraft($fromId, $rest, '');
        exit;
    }

    // ── State bekor qilish ──
    elseif ($data === 'state_cancel') {
        clearSellerState($fromId);
        db()->prepare("DELETE FROM seller_draft WHERE user_id=?")->execute([$fromId]);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Bekor qilindi']);
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "🏪 *Sotuvchi Panel*\n\nNimani boshqarasiz?",
            'parse_mode' => 'Markdown',
            'reply_markup' => roleInlineButtons('seller'),
        ]);
    }

    // ── SOTUVCHI: statistika ──
    elseif ($data === 'seller_stats') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $rest = getSellerRestaurant($fromId);
        if (!$rest) { tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Restoran topilmadi']); exit; }
        $prods = db()->prepare("SELECT id FROM products WHERE restaurant_id=?");
        $prods->execute([$rest['id']]); $prodIds = array_column($prods->fetchAll(), 'id');
        $allOrders = db()->query("SELECT * FROM orders")->fetchAll();
        $total = 0; $count = 0; $today = 0; $todayRev = 0;
        $todayDate = date('Y-m-d');
        foreach ($allOrders as $o) {
            $items = json_decode($o['items'], true) ?? [];
            $mine = array_filter($items, fn($i) => in_array((int)$i['id'], $prodIds));
            if (!$mine || $o['status'] === 'cancelled') continue;
            $rev = array_sum(array_map(fn($i) => $i['price']*$i['qty'], $mine));
            $total += $rev; $count++;
            if (strpos($o['created_at'], $todayDate) === 0) { $today++; $todayRev += $rev; }
        }
        $text = "📊 *Statistika: {$rest['name']}*\n\n"
              . "📅 Bugun: {$today} ta buyurtma, ".number_format($todayRev)." so'm\n"
              . "📊 Jami: {$count} ta buyurtma\n"
              . "💰 Jami daromad: ".number_format($total)." so'm";
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => $text, 'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']]]],
        ]);
    }

    tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
    exit;
}

// ── XABARLAR ──
$msg = $update['message'] ?? null;
if (!$msg) exit;

$chatId = (int)$msg['chat']['id'];
$from   = $msg['from'];

// Foydalanuvchini saqlash / yangilash
db()->prepare(
    "INSERT INTO users (id, username, first_name, last_name, language_code)
     VALUES (:id, :un, :fn, :ln, :lc)
     ON DUPLICATE KEY UPDATE
       username=VALUES(username),
       first_name=VALUES(first_name),
       last_name=VALUES(last_name)"
)->execute([
    ':id' => $chatId,
    ':un' => $from['username']     ?? '',
    ':fn' => $from['first_name']   ?? '',
    ':ln' => $from['last_name']    ?? '',
    ':lc' => $from['language_code'] ?? 'uz',
]);

$firstName = $from['first_name'] ?? 'Foydalanuvchi';
$userRole = getUserRole($chatId);
// DB dan foydalanuvchi ma'lumotlari
$userRow = db()->prepare("SELECT phone, address FROM users WHERE id=?");
$userRow->execute([$chatId]);
$dbUser  = $userRow->fetch() ?: ['phone' => '', 'address' => ''];
$hasPhone = !empty($dbUser['phone']);
if (isset($msg['contact'])) {
    $contact = $msg['contact'];

    if ((int)($contact['user_id'] ?? 0) !== $chatId) {
        sendMsg($chatId, "❌ Iltimos, *o'z* raqamingizni yuboring.");
        exit;
    }

    $raw = preg_replace('/[^\d]/', '', $contact['phone_number'] ?? '');
    $phone = '+' . $raw;

    db()->prepare("UPDATE users SET phone=? WHERE id=?")->execute([$phone, $chatId]);

    // Tekshir: saqlandimi?
    $check = db()->prepare("SELECT phone FROM users WHERE id=?");
    $check->execute([$chatId]);
    $saved = $check->fetchColumn();

    if ($saved) {
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => "✅ Telefon raqam saqlandi: *{$phone}*\n\nEndi buyurtma berishingiz mumkin 👇",
            'parse_mode'   => 'Markdown',
            'reply_markup' => [
                'inline_keyboard' => [[
                    ['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]
                ]]
            ]
        ]);
    } else {
        sendMsg($chatId, "⚠️ Saqlashda xatolik yuz berdi. Qayta urinib ko'ring.");
    }
    exit;
}

// ── JOYLASHUV: manzil saqlash ──
if (isset($msg['location'])) {
    $lat = $msg['location']['latitude'];
    $lon = $msg['location']['longitude'];
    $mapsUrl  = "https://maps.google.com/?q={$lat},{$lon}";
    $address  = "📍 {$lat}, {$lon}";

    db()->prepare("UPDATE users SET address=? WHERE id=?")->execute([$address, $chatId]);

    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => "✅ Joylashuvingiz saqlandi!\n\n📍 [{$lat}, {$lon}]({$mapsUrl})\n\nBuyurtma berishda manzil sifatida ishlatiladi.",
        'parse_mode'   => 'Markdown',
        'reply_markup' => [
            'inline_keyboard' => [[
                ['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]
            ]]
        ]
    ]);
    exit;
}

// ── RASM (photo) ──
if (isset($msg['photo']) && $userRole === 'seller') {
    $st = getSellerState($chatId);
    if ($st['state'] === 'awaiting_prod_image') {
        $rest = getSellerRestaurant($chatId);
        // Eng katta o'lchamdagi rasmni olish
        $photos = $msg['photo'];
        $fileId = end($photos)['file_id'];
        // Telegram file URL olish
        $fileRes = tg('getFile', ['file_id' => $fileId]);
        $filePath = $fileRes['result']['file_path'] ?? '';
        $imageUrl = $filePath ? "https://api.telegram.org/file/bot".BOT_TOKEN."/".$filePath : '';
        saveProdFromDraft($chatId, $rest, $imageUrl);
    }
    exit;
}

// ── MATN XABARLARI ──
$text = trim($msg['text'] ?? '');

// ── STATE handler: sotuvchi jarayon ──
if ($userRole === 'seller' && $text && strpos($text, '/') !== 0) {
    $st = getSellerState($chatId);
    if ($st['state']) {
        $rest = getSellerRestaurant($chatId);
        switch ($st['state']) {

            case 'awaiting_prod_name':
                // ref_id = category_id
                db()->prepare("INSERT INTO seller_draft (user_id, cat_id, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE cat_id=VALUES(cat_id), name=VALUES(name)")->execute([$chatId, $st['ref_id'], $text]);
                setSellerState($chatId, 'awaiting_prod_price', $st['ref_id']);
                sendMsg($chatId, "➕ Nom saqlandi: *{$text}*\n\nEndi narxini yuboring (masalan: 25000):");
                exit;

            case 'awaiting_prod_price':
                $price = (float)preg_replace('/[^\d.]/', '', $text);
                if ($price <= 0) { sendMsg($chatId, '❌ Noto\'g\'ri narx! Faqat raqam kiriting (masalan: 25000)'); exit; }
                db()->prepare("INSERT INTO seller_draft (user_id, price) VALUES (?,?) ON DUPLICATE KEY UPDATE price=VALUES(price)")->execute([$chatId, $price]);
                setSellerState($chatId, 'awaiting_prod_desc', 0);
                sendMsg($chatId, "✅ Narx: *".number_format($price)." so'm*\n\nTavsif yuboring (yoki /skip bosing):", ['inline_keyboard' => [[['text' => '⏭️ Skip', 'callback_data' => 'prod_skip_desc']]]]);
                exit;

            case 'awaiting_prod_desc':
                $desc = ($text === '/skip') ? '' : $text;
                db()->prepare("INSERT INTO seller_draft (user_id, desc_text) VALUES (?,?) ON DUPLICATE KEY UPDATE desc_text=VALUES(desc_text)")->execute([$chatId, $desc]);
                setSellerState($chatId, 'awaiting_prod_image', 0);
                sendMsg($chatId, "\xF0\x9F\x96\xBC\xEF\xB8\x8F Mahsulot rasmini yuboring (yoki o'tkazib yuboring):", ['inline_keyboard' => [[['text' => "\xE2\x8F\xAD\xEF\xB8\x8F Skip", 'callback_data' => 'prod_skip_image']]]]);
                exit;

            case 'awaiting_prod_image':
                // Matn kelsa skip deb hisoblaymiz
                saveProdFromDraft($chatId, $rest, '');
                exit;

            case 'awaiting_price':
                // ref_id = product_id
                $price = (float)preg_replace('/[^\d.]/', '', $text);
                if ($price <= 0) { sendMsg($chatId, '❌ Noto\'g\'ri narx! Faqat raqam kiriting'); exit; }
                $pid = $st['ref_id'];
                $own = db()->prepare("SELECT id, name FROM products WHERE id=? AND restaurant_id=?");
                $own->execute([$pid, $rest['id']]); $own = $own->fetch();
                if (!$own) { sendMsg($chatId, '❌ Ruxsat yo\'q'); clearSellerState($chatId); exit; }
                db()->prepare("UPDATE products SET price=? WHERE id=?")->execute([$price, $pid]);
                clearSellerState($chatId);
                sendMsg($chatId, "✅ *{$own['name']}* narxi yangilandi: *".number_format($price)." so'm*",
                    ['inline_keyboard' => [[['text' => '🔙 Menyu', 'callback_data' => 'seller_menu']]]]);
                exit;

            case 'awaiting_set_name':
                if (strlen($text) < 2) { sendMsg($chatId, '❌ Nom kamida 2 ta harf bo\'lsin'); exit; }
                db()->prepare("UPDATE restaurants SET name=? WHERE id=?")->execute([$text, $rest['id']]);
                clearSellerState($chatId);
                sendMsg($chatId, "✅ Restoran nomi: *{$text}*",
                    ['inline_keyboard' => [[['text' => '⚙️ Sozlamalar', 'callback_data' => 'seller_settings']]]]);
                exit;

            case 'awaiting_set_phone':
                db()->prepare("UPDATE restaurants SET phone=? WHERE id=?")->execute([$text, $rest['id']]);
                clearSellerState($chatId);
                sendMsg($chatId, "✅ Telefon saqlandi: *{$text}*",
                    ['inline_keyboard' => [[['text' => '⚙️ Sozlamalar', 'callback_data' => 'seller_settings']]]]);
                exit;

            case 'awaiting_set_address':
                db()->prepare("UPDATE restaurants SET address=? WHERE id=?")->execute([$text, $rest['id']]);
                clearSellerState($chatId);
                sendMsg($chatId, "✅ Manzil saqlandi: *{$text}*",
                    ['inline_keyboard' => [[['text' => '⚙️ Sozlamalar', 'callback_data' => 'seller_settings']]]]);
                exit;
        }
    }
}

if (preg_match('~^/start(?:@\w+)?~i', $text) || mb_strtolower($text) === 'start') {
    $welcome = "\xF0\x9F\x91\x8B Assalomu alaykum, *{$firstName}*!\n\n";

    if ($userRole === 'seller') {
        $rest = getSellerRestaurant($chatId);
        if (!$rest) {
            // DB debug
            $dbgU = db()->prepare('SELECT id, role, restaurant_id FROM users WHERE id=?');
            $dbgU->execute([$chatId]);
            $dbgRow = $dbgU->fetch();
            $dbgR = db()->query('SELECT id, name, owner_tg_id FROM restaurants')->fetchAll();
            $info = "role={$dbgRow['role']} rest_id={$dbgRow['restaurant_id']}\n";
            foreach ($dbgR as $r) $info .= "#{$r['id']} {$r['name']} owner={$r['owner_tg_id']}\n";
            sendMsg($chatId, "DEBUG:\n" . $info);
            exit;
        }
        $welcome .= "\xF0\x9F\x8F\xAA *Sotuvchi paneli* \xE2\x80\x94 {$rest['name']}\n\nBuyurtmalar va menyuni boshqaring \xF0\x9F\x91\x87";
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => roleInlineButtons('seller'),
        ]);
        exit;
    }

    if ($userRole === 'admin') {
        $welcome .= "\xE2\x9A\x99\xEF\xB8\x8F *Admin* sifatida kirgansiz.";
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => roleInlineButtons('admin'),
        ]);
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $hasPhone ? "\xF0\x9F\x93\x8D Joylashuvni yangilash:" : "\xF0\x9F\x93\xB1 Telefon va joylashuv:",
            'reply_markup' => mainKeyboard($hasPhone),
        ]);
        exit;
    }

    // oddiy user
    $welcome .= "\xF0\x9F\x8D\xBD\xEF\xB8\x8F *Iftixor Go* \xE2\x80\x94 tez va qulay ovqat buyurtmasi\n\n";
    if (!$hasPhone) $welcome .= "\xF0\x9F\x93\xB1 Avval telefon raqamingizni yuboring.\n\n";
    $welcome .= "Quyidagi tugmani bosib buyurtma bering \xF0\x9F\x91\x87";
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => $welcome,
        'parse_mode'   => 'Markdown',
        'reply_markup' => roleInlineButtons('user'),
    ]);
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => $hasPhone ? "\xF0\x9F\x93\x8D Joylashuvni yangilash:" : "\xF0\x9F\x93\xB1 Telefon va joylashuv:",
        'reply_markup' => mainKeyboard($hasPhone),
    ]);
    exit;
}

elseif ($text === '/admin') {
    if (!in_array($chatId, ADMIN_IDS)) {
        sendMsg($chatId, "❌ Sizda admin huquqi yo'q.");
        exit;
    }
    db()->prepare("UPDATE users SET role='admin' WHERE id=?")->execute([$chatId]);
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => "✅ Siz endi *Admin* sifatida faolsiz!",
        'parse_mode'   => 'Markdown',
        'reply_markup' => roleInlineButtons('admin'),
    ]);
}

elseif ($text === '/seller') {
    $s = db()->prepare(
        "SELECT r.id, r.owner_tg_id FROM restaurants r \
         LEFT JOIN users u ON u.id=? \
         WHERE r.owner_tg_id=? OR r.id=u.restaurant_id"
    );
    $s->execute([$chatId, $chatId]);
    $rest = $s->fetch();
    if (!$rest) {
        sendMsg($chatId, "❌ Sizda restoran yo'q.\n\nRestoran yaratish uchun admin bilan bog'laning.");
        exit;
    }
    if (empty($rest['owner_tg_id'])) {
        db()->prepare("UPDATE restaurants SET owner_tg_id=? WHERE id=?")->execute([$chatId, $rest['id']]);
    }
    db()->prepare("UPDATE users SET role='seller', restaurant_id=? WHERE id=?")->execute([$rest['id'], $chatId]);
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => "✅ Siz endi *Sotuvchi* sifatida faolsiz!\n/start yoki quyidagi panelga qaytish orqali sotuvchi panelini oching.",
        'parse_mode'   => 'Markdown',
        'reply_markup' => roleInlineButtons('seller'),
    ]);
}

elseif ($text === '📋 Buyurtmalarim') {
    $orders = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 5");
    $orders->execute([$chatId]);
    $list = $orders->fetchAll();

    if (empty($list)) {
        sendMsg($chatId, "📋 Sizda hali buyurtma yo'q.\n\n🛒 Buyurtma berish uchun *Buyurtma berish* tugmasini bosing.");
    } else {
        $statusMap = ['new'=>'🆕','confirmed'=>'✅','cooking'=>'👨‍🍳','delivered'=>'🚚','cancelled'=>'❌'];
        $reply = "📋 *So'nggi buyurtmalaringiz:*\n\n";
        foreach ($list as $o) {
            $s = $statusMap[$o['status']] ?? '❓';
            $reply .= "{$s} *#{$o['id']}* — ".number_format((float)$o['total'], 0, '.', ' ')." ".CURRENCY."\n";
            $reply .= "   📅 ".date('d.m.Y H:i', strtotime($o['created_at']))."\n\n";
        }
        sendMsg($chatId, $reply);
    }
}

elseif ($text === '👤 Profil') {
    $u    = $dbUser;
    $name = trim(($from['first_name']??'').' '.($from['last_name']??''));
    $reply = "👤 *Profil ma'lumotlari*\n\n"
           . "🆔 ID: `{$chatId}`\n"
           . "👤 Ism: *{$name}*\n"
           . (isset($from['username']) ? "📌 Username: @{$from['username']}\n" : '')
           . ($u['phone']   ? "📞 Tel: {$u['phone']}\n"      : "📞 Tel: _kiritilmagan_\n")
           . ($u['address'] ? "📍 Manzil: {$u['address']}\n" : "📍 Manzil: _kiritilmagan_\n");
    sendMsg($chatId, $reply);
}

elseif ($text === '📞 Bog\'lanish') {
    sendMsg($chatId, "📞 *Bog'lanish:*\n\n👤 Muallif: @Iftix0r\n📱 Telefon: +998 50 500 93 56\n\n_Savollar uchun yozing!_");
}

elseif ($text === 'ℹ️ Haqida') {
    sendMsg($chatId, "ℹ️ *Iftixor Go* — onlayn restoran\n\n🕐 Ish vaqti: 09:00 - 23:00\n⚡ Yetkazib berish: 30-60 daqiqa\n🚚 Yetkazish narxi: 5 000 so'm");
}
elseif ($text && preg_match('~^(/|start)~i', $text)) {
    sendMsg($chatId, "❓ Bot buyruqni qabul qildi, lekin hozirda u yo'naltirilmagan. /start ni qaytatdan yuboring.");
}
elseif ($text && strpos($text, '/') === 0) {
    sendMsg($chatId, "❓ Bu buyruq tanilmadi. Boshlash uchun /start ni yuboring.");
}
