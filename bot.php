<?php
require_once 'config.php';
require_once 'db.php';

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
            [['text' => '📦 Buyurtmalar',    'callback_data' => 'seller_orders']],
            [['text' => '🍽️ Menyu boshqarish','callback_data' => 'seller_menu']],
            [['text' => '📊 Statistika',     'callback_data' => 'seller_stats']],
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
    $s = db()->prepare("SELECT r.* FROM restaurants r JOIN users u ON u.restaurant_id=r.id WHERE u.id=?");
    $s->execute([$tgId]);
    return $s->fetch() ?: null;
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

function getUserRole(int $id): string {
    static $cache = [];
    if (isset($cache[$id])) return $cache[$id];
    $s = db()->prepare("SELECT role FROM users WHERE id=?");
    $s->execute([$id]);
    $cache[$id] = $s->fetchColumn() ?: 'user';
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

    // ── SOTUVCHI: menyu boshqarish ──
    elseif ($data === 'seller_menu') {
        $role = getUserRole($fromId);
        if ($role !== 'seller') { tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]); exit; }
        $products = getSellerProducts($fromId);
        if (empty($products)) {
            tg('editMessageText', [
                'chat_id' => $fromId, 'message_id' => $msgId,
                'text' => "🍽️ Menyu bo'sh.\n\nQo'shish uchun adminga murojaat qiling.",
                'parse_mode' => 'Markdown',
                'reply_markup' => ['inline_keyboard' => [[['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']]]],
            ]);
        } else {
            $rows = [];
            foreach ($products as $p) {
                $avail = $p['available'] ? '✅' : '❌';
                $rows[] = [['text' => "{$avail} {$p['name']} — ".number_format($p['price'])." so'm",
                            'callback_data' => 'prod_toggle_'.$p['id']]];
            }
            $rows[] = [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']];
            tg('editMessageText', [
                'chat_id' => $fromId, 'message_id' => $msgId,
                'text' => "🍽️ *Menyungiz (".count($products)." ta):*\n\n✅ = mavjud, ❌ = yoq\nToggle qilish uchun bosing:",
                'parse_mode' => 'Markdown',
                'reply_markup' => ['inline_keyboard' => $rows],
            ]);
        }
    }

    // ── SOTUVCHI: mahsulot toggle (mavjud/mavjud emas) ──
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
            'text' => $newAvail ? '✅ Mahsulot faollashtirildi' : '❌ Mahsulot o\'chirildi']);
        // Menyuni qayta ko'rsat
        $products = getSellerProducts($fromId);
        $rows = [];
        foreach ($products as $pr) {
            $avail = $pr['available'] ? '✅' : '❌';
            $rows[] = [['text' => "{$avail} {$pr['name']} — ".number_format($pr['price'])." so'm",
                        'callback_data' => 'prod_toggle_'.$pr['id']]];
        }
        $rows[] = [['text' => '🔙 Orqaga', 'callback_data' => 'seller_back']];
        tg('editMessageText', [
            'chat_id' => $fromId, 'message_id' => $msgId,
            'text' => "🍽️ *Menyungiz (".count($products)." ta):*\n\n✅ = mavjud, ❌ = yoq\nToggle qilish uchun bosing:",
            'parse_mode' => 'Markdown',
            'reply_markup' => ['inline_keyboard' => $rows],
        ]);
        exit;
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
            if (str_starts_with($o['created_at'], $todayDate)) { $today++; $todayRev += $rev; }
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

// ── MATN XABARLARI ──
$text = trim($msg['text'] ?? '');

if ($text === '/start') {
    $welcome = "👋 Assalomu alaykum, *{$firstName}*!\n\n";

    if ($userRole === 'seller') {
        $rest = getSellerRestaurant($chatId);
        $restName = $rest ? $rest['name'] : 'Restoran';
        $welcome .= "🏪 *Sotuvchi paneli* — {$restName}\n\nBuyurtmalar va menyuni boshqaring 👇";
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => roleInlineButtons('seller'),
        ]);
    } elseif ($userRole === 'admin') {
        $welcome .= "⚙️ *Admin* sifatida kirgansiz.";
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => roleInlineButtons('admin'),
        ]);
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $hasPhone ? "📍 Joylashuvni yangilash:" : "📱 Telefon va joylashuv:",
            'reply_markup' => mainKeyboard($hasPhone),
        ]);
    } else {
        $welcome .= "🍽️ *Iftixor Go* — tez va qulay ovqat buyurtmasi\n\n";
        if (!$hasPhone) $welcome .= "📱 Avval telefon raqamingizni yuboring.\n\n";
        $welcome .= "Quyidagi tugmani bosib buyurtma bering 👇";
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => roleInlineButtons('user'),
        ]);
        tg('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $hasPhone ? "📍 Joylashuvni yangilash:" : "📱 Telefon va joylashuv:",
            'reply_markup' => mainKeyboard($hasPhone),
        ]);
    }
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
    $s = db()->prepare("SELECT id FROM restaurants WHERE owner_tg_id=?");
    $s->execute([$chatId]);
    $rest = $s->fetch();
    if (!$rest) {
        sendMsg($chatId, "❌ Sizda restoran yo'q.\n\nRestoran yaratish uchun admin bilan bog'laning.");
        exit;
    }
    db()->prepare("UPDATE users SET role='seller', restaurant_id=? WHERE id=?")->execute([$rest['id'], $chatId]);
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => "✅ Siz endi *Sotuvchi* sifatida faolsiz!",
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
