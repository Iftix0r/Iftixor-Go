<?php
require_once 'config.php';
require_once 'db.php';

function tg_rest(string $method, array $params): array {
    $ch = curl_init("https://api.telegram.org/bot".REST_BOT_TOKEN."/$method");
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

$update = json_decode(file_get_contents('php://input'), true);
if (!$update) exit;

if (isset($update['callback_query'])) {
    $cb = $update['callback_query'];
    $data = $cb['data'];
    $chatId = $cb['message']['chat']['id'];
    $msgId = $cb['message']['message_id'];
    
    // Statusni o'zgartirish
    if (preg_match('/^rest_order_(new|confirmed|cooking|delivered|cancelled)_(\d+)$/', $data, $m)) {
        $status = $m[1];
        $orderId = (int)$m[2];
        
        db()->prepare("UPDATE orders SET status=? WHERE id=?")->execute([$status, $orderId]);
        
        $statusTexts = [
            'new' => '🆕 Yangi',
            'confirmed' => '✅ Tasdiqlangan',
            'cooking' => '👨‍🍳 Tayyorlanmoqda',
            'delivered' => '🚚 Yetkazilgan',
            'cancelled' => '❌ Bekor qilingan'
        ];
        
        tg_rest('editMessageText', [
            'chat_id' => $chatId,
            'message_id' => $msgId,
            'text' => $cb['message']['text'] . "\n\n🔰 *Hozirgi holat:* " . $statusTexts[$status],
            'parse_mode' => 'Markdown',
            'reply_markup' => getOrderKeyboard($orderId)
        ]);
    }
    
    tg_rest('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
    exit;
}

if (!isset($update['message'])) exit;

$msg = $update['message'];
$chatId = $msg['chat']['id'];
$text = trim($msg['text'] ?? '');

// Foydalanuvchini saqlash yoki yangilash
db()->prepare(
    "INSERT INTO users (id, username, first_name, last_name)
     VALUES (:id, :un, :fn, :ln)
     ON DUPLICATE KEY UPDATE
       username=VALUES(username),
       first_name=VALUES(first_name),
       last_name=VALUES(last_name)"
)->execute([
    ':id' => $chatId,
    ':un' => $msg['from']['username'] ?? '',
    ':fn' => $msg['from']['first_name'] ?? '',
    ':ln' => $msg['from']['last_name'] ?? '',
]);

// Foydalanuvchi state-ni olish
$u = db()->prepare("SELECT bot_state, bot_temp_data FROM users WHERE id=?");
$u->execute([$chatId]);
$userRow = $u->fetch();
$state = $userRow['bot_state'] ?? '';
$tempData = json_decode($userRow['bot_temp_data'] ?? '{}', true) ?: [];

function setState($chatId, $state, $temp = []) {
    db()->prepare("UPDATE users SET bot_state=?, bot_temp_data=? WHERE id=?")
      ->execute([$state, json_encode($temp, JSON_UNESCAPED_UNICODE), $chatId]);
}

// Do'konni tekshirish
$r = db()->prepare("SELECT * FROM restaurants WHERE owner_tg_id=?");
$r->execute([$chatId]);
$rest = $r->fetch();

function mainInlineKeyboard($rest) {
    if (!$rest) {
        return ['inline_keyboard' => [
            [['text' => '🏪 Do\'kon yaratish', 'callback_data' => 'action_create_restaurant']]
        ]];
    }
    return ['inline_keyboard' => [
        [
            ['text' => '📦 Yangi buyurtmalar', 'callback_data' => 'action_new_orders'],
            ['text' => '🍔 Mahsulotlarim', 'callback_data' => 'action_my_products']
        ],
        [
            ['text' => '➕ Mahsulot qo\'shish', 'callback_data' => 'action_add_product'],
            ['text' => '📊 Hisobot va Sozlamalar', 'callback_data' => 'action_report']
        ]
    ]];
}


function getOrderKeyboard($orderId) {
    return ['inline_keyboard' => [
        [
            ['text' => '✅ Tasdiqlash', 'callback_data' => "rest_order_confirmed_$orderId"],
            ['text' => '👨‍🍳 Tayyorlash', 'callback_data' => "rest_order_cooking_$orderId"]
        ],
        [
            ['text' => '🚚 Yetkazilgan', 'callback_data' => "rest_order_delivered_$orderId"],
            ['text' => '❌ Bekor qilish', 'callback_data' => "rest_order_cancelled_$orderId"]
        ]
    ]];
}

if ($text === '/start' || $text === 'Ortga' || $text === 'Bekor qilish') {
    setState($chatId, '');
    $welcome = $rest 
        ? "👋 Assalomu alaykum, *{$rest['name']}* rahbari!\nQuyidagi menyudan foydalaning:" 
        : "👋 Assalomu alaykum! Tizimdan foydalanish uchun do'kon yarating.";
    tg_rest('sendMessage', [
        'chat_id' => $chatId,
        'text' => $welcome,
        'parse_mode' => 'Markdown',
        'reply_markup' => mainInlineKeyboard($rest)
    ]);
    exit;
}

if (!$rest) {
    if ($text === '🏪 Do\'kon yaratish') {
        setState($chatId, 'create_name');
        tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "🏢 Do'koningiz nomini kiriting:"]);
        exit;
    }
    
    if ($state === 'create_name') {
        setState($chatId, 'create_phone', ['name' => $text]);
        $phoneKeyboard = [
            ['text' => "📞 Telefon raqamini yuboring", 'request_contact' => true]
        ];
        tg_rest('sendMessage', [
            'chat_id' => $chatId,
            'text' => "📞 Do'kon telefon raqamini yuboring:",
            'reply_markup' => ['keyboard' => [$phoneKeyboard], 'resize_keyboard' => true, 'one_time_keyboard' => true]
        ]);
        exit;
    }
    
        if ($state === 'create_phone') {
            // Agar foydalanuvchi kontakt yuborgan bo'lsa, telefon raqamini olinadi
            if (isset($msg['contact']) && $msg['contact']['phone_number']) {
                $tempData['phone'] = $msg['contact']['phone_number'];
                setState($chatId, 'create_address', $tempData);
                tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "📍 Do'kon manzilini kiriting:"]);
                exit;
            }
            // Aks holda, matnli telefonni qabul qilamiz
            $tempData['phone'] = $text;
            setState($chatId, 'create_address', $tempData);
            tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "📍 Do'kon manzilini kiriting:"]);
            exit;
        }  
    if ($state === 'create_address') {
        $name = $tempData['name'] ?? 'Nomsiz';
        $phone = $tempData['phone'] ?? '';
        $address = $text;
        
        db()->prepare("INSERT INTO restaurants (name, phone, address, owner_tg_id) VALUES (?,?,?,?)")
          ->execute([$name, $phone, $address, $chatId]);
          
        setState($chatId, '');
        $newRest = db()->prepare("SELECT * FROM restaurants WHERE owner_tg_id=?");
        $newRest->execute([$chatId]);
        $rData = $newRest->fetch();
        
        tg_rest('sendMessage', [
            'chat_id' => $chatId, 
            'text' => "✅ Do'koningiz muvaffaqiyatli yaratildi!",
            'reply_markup' => mainInlineKeyboard($rData)
        ]);
        exit;
    }
} else {
    // RESTAURANT EXISTS
    if ($text === '📊 Hisobot va Sozlamalar') {
        $prods = db()->prepare("SELECT * FROM products WHERE restaurant_id=?");
        $prods->execute([$rest['id']]);
        $prodsList = $prods->fetchAll();
        $prodIds = array_column($prodsList, 'id');
        
        $allOrders = db()->query("SELECT * FROM orders")->fetchAll();
        $totalRev = 0; $totalOrders = 0;
        foreach($allOrders as $o) {
            $items = json_decode($o['items'], true);
            if(!is_array($items)) continue;
            $myTotal = 0;
            foreach($items as $i) {
                if(in_array((int)$i['id'], $prodIds)) {
                    $myTotal += ($i['price'] * $i['qty']);
                }
            }
            if($myTotal > 0) {
                $totalOrders++;
                if(in_array($o['status'], ['new','confirmed','cooking','delivered'])) {
                    $totalRev += $myTotal;
                }
            }
        }
        
        $msg = "📊 *{$rest['name']}* hisoboti:\n\n"
             . "👁️ Sahifa ko'rishlar: *{$rest['views']}*\n"
             . "📦 Jami buyurtmalar: *{$totalOrders}*\n"
             . "💰 Umumiy daromad: *".number_format($totalRev, 0, '.', ' ')." so'm*\n";
             
        tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => $msg, 'parse_mode' => 'Markdown']);
        exit;
    }
    
    if ($text === '🍔 Mahsulotlarim') {
        $prods = db()->prepare("SELECT * FROM products WHERE restaurant_id=?");
        $prods->execute([$rest['id']]);
        $list = $prods->fetchAll();
        
        if (empty($list)) {
            tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "Sizda hozircha mahsulotlar yo'q."]);
        } else {
            $msg = "🍔 *Sizning mahsulotlaringiz:*\n\n";
            foreach($list as $p) {
                $msg .= "▪️ *{$p['name']}* — ".number_format($p['price'], 0, '.', ' ')." so'm\n";
            }
            tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => $msg, 'parse_mode' => 'Markdown']);
        }
        exit;
    }
    
    if ($text === '➕ Mahsulot qo\'shish') {
        setState($chatId, 'add_prod_name');
        tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "📝 Mahsulot nomini kiriting:"]);
        exit;
    }
    
    if ($state === 'add_prod_name') {
        setState($chatId, 'add_prod_price', ['name' => $text]);
        tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "💰 Narxini kiriting (faqat raqam, masalan: 15000):"]);
        exit;
    }
    
    if ($state === 'add_prod_price') {
        $tempData['price'] = (int)preg_replace('/[^\d]/', '', $text);
        setState($chatId, 'add_prod_cat', $tempData);
        
        $cats = db()->query("SELECT id, name FROM categories ORDER BY sort_order")->fetchAll();
        $btns = [];
        foreach($cats as $c) {
            $btns[] = [['text' => "📂 " . $c['name'], 'callback_data' => "cat_" . $c['id']]];
        }
        
        tg_rest('sendMessage', [
            'chat_id' => $chatId, 
            'text' => "📂 Kategoriyani tanlang:",
            'reply_markup' => ['inline_keyboard' => $btns]
        ]);
        exit;
    }
    
    if ($state === 'add_prod_cat') {
        $catId = 1;
        if (preg_match('/cat_(\d+)/', $text, $m)) {
            $catId = (int)$m[1];
        } else {
            $catId = (int)$text ?: 1;
        }
        
        $name = $tempData['name'];
        $price = $tempData['price'];
        
        db()->prepare("INSERT INTO products (name, price, category_id, restaurant_id, available) VALUES (?,?,?,?,1)")
          ->execute([$name, $price, $catId, $rest['id']]);
          
        setState($chatId, '');
        tg_rest('sendMessage', [
            'chat_id' => $chatId, 
            'text' => "✅ Mahsulot qo'shildi: *$name*", 
            'parse_mode' => 'Markdown',
            'reply_markup' => mainKeyboard($rest)
        ]);
        exit;
    }
    
    if ($text === '📦 Yangi buyurtmalar') {
        $prods = db()->prepare("SELECT id FROM products WHERE restaurant_id=?");
        $prods->execute([$rest['id']]);
        $prodIds = array_column($prods->fetchAll(), 'id');
        
        $allOrders = db()->query("SELECT * FROM orders ORDER BY id DESC LIMIT 20")->fetchAll();
        $found = false;
        
        $statusTexts = [
            'new' => '🆕 Yangi',
            'confirmed' => '✅ Tasdiqlangan',
            'cooking' => '👨‍🍳 Tayyorlanmoqda',
            'delivered' => '🚚 Yetkazilgan',
            'cancelled' => '❌ Bekor qilingan'
        ];
        
        foreach($allOrders as $o) {
            $items = json_decode($o['items'], true);
            if(!is_array($items)) continue;
            
            $myItems = []; $myTotal = 0;
            foreach($items as $i) {
                if(in_array((int)$i['id'], $prodIds)) {
                    $myItems[] = $i;
                    $myTotal += ($i['price'] * $i['qty']);
                }
            }
            
            if(count($myItems) > 0 && in_array($o['status'], ['new', 'confirmed', 'cooking'])) {
                $found = true;
                $msg = "📦 *Buyurtma #{$o['id']}*\n";
                $msg .= "Holati: " . ($statusTexts[$o['status']] ?? $o['status']) . "\n\n";
                foreach($myItems as $i) {
                    $msg .= "▪️ {$i['qty']}x {$i['name']}\n";
                }
                $msg .= "\nSumma: *".number_format($myTotal, 0, '.', ' ')." so'm*";
                $msg .= "\nTelefon: {$o['phone']}\nManzil: {$o['address']}";
                
                tg_rest('sendMessage', [
                    'chat_id' => $chatId,
                    'text' => $msg,
                    'parse_mode' => 'Markdown',
                    'reply_markup' => getOrderKeyboard($o['id'])
                ]);
            }
        }
        if (!$found) {
            tg_rest('sendMessage', ['chat_id' => $chatId, 'text' => "Yangi buyurtmalar yo'q."]);
        }
        exit;
    }
}
