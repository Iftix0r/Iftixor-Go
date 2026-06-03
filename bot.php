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

// Asosiy klaviatura (foydalanuvchida telefon bor/yo'qqa qarab)
function mainKeyboard(bool $hasPhone): array {
    $rows = [];
    if (!$hasPhone) {
        $rows[] = [['text' => '📱 Telefon raqamimni yuborish', 'request_contact' => true]];
    }
    $rows[] = [['text' => '📍 Joylashuvimni yuborish', 'request_location' => true]];
    $rows[] = [['text' => '📋 Buyurtmalarim'], ['text' => '👤 Profil']];
    $rows[] = [['text' => '📞 Bog\'lanish'], ['text' => 'ℹ️ Haqida']];
    return ['keyboard' => $rows, 'resize_keyboard' => true];
}

$update = json_decode(file_get_contents('php://input'), true);
if (!$update) exit;

// ── CALLBACK QUERIES (admin group) ──
if (isset($update['callback_query'])) {
    $cb     = $update['callback_query'];
    $data   = $cb['data'];
    $msgId  = $cb['message']['message_id'];
    $chatId = $cb['message']['chat']['id'];

    if (preg_match('/^(confirm|cancel)_(\d+)$/', $data, $m)) {
        $action    = $m[1];
        $orderId   = (int)$m[2];
        $newStatus = $action === 'confirm' ? 'confirmed' : 'cancelled';
        $statusText = $action === 'confirm' ? '✅ Qabul qilindi' : '❌ Bekor qilindi';

        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$newStatus, $orderId]);

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
            'chat_id'    => $chatId,
            'message_id' => $msgId,
            'text'       => $cb['message']['text']."\n\n*$statusText* — ".$cb['from']['first_name'],
            'parse_mode' => 'Markdown',
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

// ── KONTAKT: telefon saqlash ──
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

// DB dan foydalanuvchi ma'lumotlari
$userRow = db()->prepare("SELECT phone, address FROM users WHERE id=?");
$userRow->execute([$chatId]);
$dbUser  = $userRow->fetch() ?: ['phone' => '', 'address' => ''];
$hasPhone = !empty($dbUser['phone']);

if ($text === '/start') {
    $welcome = "👋 Assalomu alaykum, *{$firstName}*!\n\n"
             . "🍽️ *Iftixor Go* — tez va qulay ovqat buyurtmasi\n\n";

    if (!$hasPhone) {
        $welcome .= "📱 Avval telefon raqamingizni yuboring — buyurtmada ishlatiladi.\n\n";
    }
    $welcome .= "Quyidagi tugmani bosib buyurtma bering 👇";

    // 1) Inline keyboard (Web App)
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => $welcome,
        'parse_mode'   => 'Markdown',
        'reply_markup' => ['inline_keyboard' => [[
            ['text' => '🛒 Buyurtma berish', 'web_app' => ['url' => WEBAPP_URL]]
        ]]]
    ]);

    // 2) Reply keyboard (kontakt/joylashuv tugmalari) — alohida xabar
    tg('sendMessage', [
        'chat_id'      => $chatId,
        'text'         => $hasPhone
            ? "📍 Joylashuvingizni yangilash uchun:"
            : "📱 Telefon va joylashuvni yuboring:",
        'reply_markup' => mainKeyboard($hasPhone)
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
