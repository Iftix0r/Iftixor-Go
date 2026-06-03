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

function sendMsg(int $chatId, string $text, array $keyboard = []): void {
    $params = ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'Markdown'];
    if ($keyboard) $params['reply_markup'] = ['keyboard' => $keyboard, 'resize_keyboard' => true];
    tg('sendMessage', $params);
}

$update = json_decode(file_get_contents('php://input'), true);
if (!$update) exit;

// Handle callback queries (admin group actions)
if (isset($update['callback_query'])) {
    $cb = $update['callback_query'];
    $data = $cb['data'];
    $msgId = $cb['message']['message_id'];
    $chatId = $cb['message']['chat']['id'];

    if (preg_match('/^(confirm|cancel)_(\d+)$/', $data, $m)) {
        $action = $m[1];
        $orderId = (int)$m[2];
        $newStatus = $action === 'confirm' ? 'confirmed' : 'cancelled';
        $statusText = $action === 'confirm' ? '✅ Qabul qilindi' : '❌ Bekor qilindi';

        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);

        // Get user_id to notify
        $order = db()->prepare("SELECT user_id FROM orders WHERE id=?");
        $order->execute([$orderId]);
        $o = $order->fetch();

        if ($o) {
            $userMsg = $action === 'confirm'
                ? "✅ *#{$orderId} buyurtmangiz qabul qilindi!*\n🍽️ Tayyorlanmoqda, kuting..."
                : "❌ *#{$orderId} buyurtmangiz bekor qilindi.*\nBoshqa muammo bo'lsa, biz bilan bog'laning.";
            tg('sendMessage', ['chat_id' => $o['user_id'], 'text' => $userMsg, 'parse_mode' => 'Markdown']);
        }

        tg('editMessageText', [
            'chat_id' => $chatId,
            'message_id' => $msgId,
            'text' => $cb['message']['text']."\n\n*$statusText* - ".$cb['from']['first_name'],
            'parse_mode' => 'Markdown',
        ]);
    }

    tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
    exit;
}

// Handle messages
$msg = $update['message'] ?? null;
if (!$msg) exit;

$chatId = $msg['chat']['id'];
$text = trim($msg['text'] ?? '');
$from = $msg['from'];

// ── KONTAKT xabari: telefon raqamni saqlash ──
if (isset($msg['contact'])) {
    $contact = $msg['contact'];
    // Faqat o'z kontaktini yuborsa (boshqa odamnikini emas)
    if ((int)($contact['user_id'] ?? 0) === (int)$chatId) {
        $rawPhone = preg_replace('/[^\d+]/', '', $contact['phone_number'] ?? '');
        if ($rawPhone && !str_starts_with($rawPhone, '+')) {
            $rawPhone = '+' . $rawPhone;
        }
        if ($rawPhone) {
            db()->prepare("UPDATE users SET phone=? WHERE id=?")->execute([$rawPhone, $chatId]);
            tg('sendMessage', [
                'chat_id' => $chatId,
                'text' => "✅ Telefon raqamingiz saqlandi: *{$rawPhone}*\n\nEndi buyurtma berishingiz mumkin 👇",
                'parse_mode' => 'Markdown',
                'reply_markup' => [
                    'inline_keyboard' => [[
                        ['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]
                    ]]
                ]
            ]);
        }
    } else {
        tg('sendMessage', ['chat_id' => $chatId, 'text' => "❌ Iltimos, o'z raqamingizni yuboring."]);
    }
    exit;
}

// Save/update user
db()->prepare("INSERT INTO users (id, username, first_name, last_name, language_code)
    VALUES (:id, :un, :fn, :ln, :lc)
    ON DUPLICATE KEY UPDATE username=VALUES(username), first_name=VALUES(first_name), last_name=VALUES(last_name)"
)->execute([
    ':id' => $from['id'],
    ':un' => $from['username'] ?? '',
    ':fn' => $from['first_name'] ?? '',
    ':ln' => $from['last_name'] ?? '',
    ':lc' => $from['language_code'] ?? 'uz',
]);

$firstName = $from['first_name'] ?? 'Foydalanuvchi';

if ($text === '/start') {
    // Foydalanuvchi telefoni DB da bormi?
    $userRow = db()->prepare("SELECT phone FROM users WHERE id=?");
    $userRow->execute([$chatId]);
    $existingUser = $userRow->fetch();
    $hasPhone = !empty($existingUser['phone']);

    $welcome = "👋 Assalomu alaykum, *$firstName*!\n\n"
             . "🍽️ *Iftixor Go* — tez va qulay ovqat buyurtmasi\n\n"
             . "Quyidagi tugmani bosib buyurtma bering 👇";

    // Keyboard — telefon yo'q bo'lsa "Telefon yuborish" tugmasi ko'rinadi
    $keyboard = $hasPhone
        ? [
            [['text' => '📋 Buyurtmalarim'], ['text' => '👤 Profil']],
            [['text' => '📞 Bog\'lanish'], ['text' => 'ℹ️ Haqida']],
          ]
        : [
            [['text' => '📱 Telefon raqamimni yuborish', 'request_contact' => true]],
            [['text' => '📋 Buyurtmalarim'], ['text' => '👤 Profil']],
            [['text' => '📞 Bog\'lanish'], ['text' => 'ℹ️ Haqida']],
          ];

    tg('sendMessage', [
        'chat_id' => $chatId,
        'text' => $welcome,
        'parse_mode' => 'Markdown',
        'reply_markup' => [
            'inline_keyboard' => [
                [['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]],
            ],
            'keyboard' => $keyboard,
            'resize_keyboard' => true,
        ]
    ]);
}


elseif ($text === '📋 Buyurtmalarim') {
    $orders = db()->prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 5");
    $orders->execute([$chatId]);
    $list = $orders->fetchAll();

    if (empty($list)) {
        sendMsg($chatId, "📋 Sizda hali buyurtma yo'q.\n\n🛒 Buyurtma berish uchun *Menu* tugmasini bosing.");
    } else {
        $statusMap = ['new'=>'🆕','confirmed'=>'✅','cooking'=>'👨‍🍳','delivered'=>'🚚','cancelled'=>'❌'];
        $reply = "📋 *So'nggi buyurtmalaringiz:*\n\n";
        foreach ($list as $o) {
            $s = $statusMap[$o['status']] ?? '❓';
            $reply .= "$s *#{$o['id']}* — ".number_format($o['total'])." ".CURRENCY."\n";
            $reply .= "   📅 ".date('d.m.Y H:i', strtotime($o['created_at']))."\n\n";
        }
        sendMsg($chatId, $reply);
    }
}

elseif ($text === '👤 Profil') {
    $user = db()->prepare("SELECT * FROM users WHERE id=?");
    $user->execute([$chatId]);
    $u = $user->fetch();
    $name = trim(($u['first_name']??'').' '.($u['last_name']??''));
    $reply = "👤 *Profil ma'lumotlari*\n\n"
           . "🆔 ID: `{$chatId}`\n"
           . "👤 Ism: *$name*\n"
           . ($u['username'] ? "📌 Username: @{$u['username']}\n" : '')
           . ($u['phone'] ? "📞 Tel: {$u['phone']}\n" : "📞 Tel: _kiritilmagan_\n")
           . ($u['address'] ? "📍 Manzil: {$u['address']}\n" : "📍 Manzil: _kiritilmagan_\n");
    sendMsg($chatId, $reply);
}

elseif ($text === '📞 Bog\'lanish') {
    sendMsg($chatId, "📞 *Bog'lanish:*\n\n👤 Muallif: @Iftix0r\n📱 Telefon: +998 50 500 93 56\n\n_Savollar uchun yozing!_");
}

elseif ($text === 'ℹ️ Haqida') {
    sendMsg($chatId, "ℹ️ *Iftixor Go* — onlayn restoran\n\n🕐 Ish vaqti: 09:00 - 23:00\n⚡ Yetkazib berish: 30-60 daqiqa\n🚚 Yetkazish narxi: 5,000 so'm");
}
