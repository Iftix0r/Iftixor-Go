<?php
// admin_bot.php
// Admin bot for managing the entire Iftixor platform (restaurants, orders, taxi, users)
// Token is stored in .env as ADMIN_BOT_TOKEN

require_once __DIR__ . '/config.php';
$adminToken = ADMIN_BOT_TOKEN;
if (!$adminToken) {
    error_log('ADMIN_BOT_TOKEN not set in config.php');
    exit;
}

// Helper to send requests to Telegram Bot API
function tgRequest(string $method, array $params = []): array {
    global $adminToken;
    $url = "https://api.telegram.org/bot{$adminToken}/{$method}";
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($params),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json']
    ];
    $ch = curl_init($url);
    curl_setopt_array($ch, $options);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($result, true);
    if ($httpCode !== 200 || !$data['ok']) {
        error_log('Telegram API error: ' . $result);
        return [];
    }
    return $data['result'];
}

function sendMessage(int $chatId, string $text, array $replyMarkup = null): void {
    $params = [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'Markdown',
    ];
    if ($replyMarkup) {
        $params['reply_markup'] = $replyMarkup;
    }
    tgRequest('sendMessage', $params);
}

function answerCallbackQuery(string $callbackQueryId, string $text = null): void {
    $params = ['callback_query_id' => $callbackQueryId];
    if ($text) {
        $params['text'] = $text;
    }
    tgRequest('answerCallbackQuery', $params);
}

// Simple inline keyboards for the admin menu
function adminMainMenu(): array {
    return [
        'inline_keyboard' => [
            [
                ['text' => '🏪 Restoranlar', 'callback_data' => 'admin_restaurants'],
                ['text' => '📦 Buyurtmalar', 'callback_data' => 'admin_orders']
            ],
            [
                ['text' => '🚕 Taxi buyurtmalar', 'callback_data' => 'admin_taxi'],
                ['text' => '👥 Foydalanuvchilar', 'callback_data' => 'admin_users']
            ],
            [
                ['text' => '📊 Statistika', 'callback_data' => 'admin_stats']
            ]
        ]
    ];
}

// Entry point – this file is intended to be called via webhook
$update = json_decode(file_get_contents('php://input'), true);
if (!$update) { exit; }

$chatId = null;
$message = $update['message'] ?? null;
$callback = $update['callback_query'] ?? null;

if ($message) {
    $chatId = $message['chat']['id'];
    $text = $message['text'] ?? '';
    if (strpos($text, '/start') === 0) {
        sendMessage($chatId, "👋 Admin paneliga xush kelibsiz!", adminMainMenu());
        exit;
    }
    // Future plain‑text commands can be handled here
}

    // Process callback queries (inline button presses)
    if ($callback) {
        // Safely obtain chat ID (may be absent in some callbacks)
        $chatId = $callback['message']['chat']['id'] ?? $callback['from']['id'];
        $cbId   = $callback['id'];
        $data   = $callback['data'];
        // Acknowledge the callback to remove loading spinner
        answerCallbackQuery($cbId);

        // Ensure only authorized admins can use the admin panel
        if (!in_array($chatId, ADMIN_IDS, true)) {
            sendMessage($chatId, "🚫 Siz admin emasligingiz sababli bu amalni bajara olmaysiz.");
            exit;
        }

        // Handle admin-prefixed callbacks
        if (strpos($data, 'admin_') === 0) {
            $action = substr($data, 6); // strip "admin_"
            switch ($action) {
                case 'restaurants':
                    listRestaurants($chatId);
                    break;
                case 'orders':
                    listOrders($chatId);
                    break;
                case 'taxi':
                    listTaxiOrders($chatId);
                    break;
                case 'users':
                    listUsers($chatId);
                    break;
                case 'stats':
                    showStats($chatId);
                    break;
                case 'rest_detail':
                    $parts = explode(':', $data);
                    $restId = $parts[1] ?? null;
                    if ($restId) viewRestaurant($chatId, (int)$restId);
                    break;
                case 'rest_delete':
                    $parts = explode(':', $data);
                    $restId = $parts[1] ?? null;
                    if ($restId) deleteRestaurant($chatId, (int)$restId);
                    break;
                // Add more admin actions here as needed
                default:
                    sendMessage($chatId, "❓ Noma'lum admin amali: $action");
            }
        } else {
            // Non‑admin callback – simply acknowledge
            sendMessage($chatId, "⚙️ Bot faqat admin paneli uchun.");
        }
        exit; // Stop further processing for callbacks
    }

// ---------- Helper implementations (place‑holders) ----------

function db(): PDO {
    // Centralised DB connection – adapt credentials as needed
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=localhost;dbname=iftixor;charset=utf8mb4';
        $user = 'root';
        $pass = '';
        $pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }
    return $pdo;
}

function listRestaurants(int $chatId): void {
    $stmt = db()->query('SELECT id, name, phone FROM restaurants');
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        sendMessage($chatId, "📭 Hozircha restoranlar yo'q.");
        return;
    }
    $text = "🏪 *Restoranlar ro'yxati*\n";
    $keyboard = [];
    foreach ($rows as $r) {
        $text .= "\n• {$r['name']} (ID: {$r['id']})";
        $keyboard[] = [
            ['text' => "🔎 {$r['name']}", 'callback_data' => "admin_rest_detail:{$r['id']}"],
            ['text' => "🗑️ O'chirish", 'callback_data' => "admin_rest_delete:{$r['id']}"],
        ];
    }
    sendMessage($chatId, $text, ['inline_keyboard' => $keyboard]);
}

function viewRestaurant(int $chatId, int $restId): void {
    $stmt = db()->prepare('SELECT * FROM restaurants WHERE id=?');
    $stmt->execute([$restId]);
    $rest = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$rest) {
        sendMessage($chatId, "❌ Restoran topilmadi.");
        return;
    }
    $text = "🏪 *{$rest['name']}*\n";
    $text .= "📞 Telefon: {$rest['phone']}\n";
    $text .= "📍 Manzil: {$rest['address']}\n";
    sendMessage($chatId, $text);
}

function deleteRestaurant(int $chatId, int $restId): void {
    // Delete orders, products, then the restaurant itself – same logic as API endpoint
    db()->prepare('DELETE FROM orders WHERE restaurant_id=?')->execute([$restId]);
    db()->prepare('DELETE FROM products WHERE restaurant_id=?')->execute([$restId]);
    db()->prepare('DELETE FROM restaurants WHERE id=?')->execute([$restId]);
    sendMessage($chatId, "✅ Restoran (ID: $restId) va unga tegishli barcha ma'lumotlar o'chirildi.");
}

function listOrders(int $chatId): void {
    $stmt = db()->query('SELECT o.id, r.name AS restaurant, o.status, o.my_total FROM orders o JOIN restaurants r ON o.restaurant_id=r.id ORDER BY o.id DESC LIMIT 20');
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        sendMessage($chatId, "📭 Hozircha buyurtmalar yo'q.");
        return;
    }
    $text = "📦 *So'nggi 20 buyurtma*\n";
    foreach ($rows as $o) {
        $text .= "\n#{$o['id']} – {$o['restaurant']} – {$o['status']} – {$o['my_total']} so'm";
    }
    sendMessage($chatId, $text);
}

function listTaxiOrders(int $chatId): void {
    // Placeholder – adjust table/fields if you have a taxi module
    $stmt = db()->query('SELECT id, user_id, status FROM taxi_orders ORDER BY id DESC LIMIT 20');
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        sendMessage($chatId, "📭 Taxi buyurtmalari mavjud emas.");
        return;
    }
    $text = "🚕 *Taxi buyurtmalari*\n";
    foreach ($rows as $t) {
        $text .= "\n#{$t['id']} – foydalanuvchi {$t['user_id']} – {$t['status']}";
    }
    sendMessage($chatId, $text);
}

function listUsers(int $chatId): void {
    $stmt = db()->query('SELECT id, tg_id, username, is_blocked FROM users ORDER BY id DESC LIMIT 20');
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        sendMessage($chatId, "👥 Foydalanuvchilar ro'yxati bo'sh.");
        return;
    }
    $text = "👥 *Foydalanuvchilar*\n";
    foreach ($rows as $u) {
        $blocked = $u['is_blocked'] ? '🚫 bloklangan' : '✅ faol';
        $text .= "\n#{$u['id']} – TG: {$u['tg_id']} – {$u['username']} – $blocked";
    }
    sendMessage($chatId, $text);
}

function showStats(int $chatId): void {
    // Simple aggregate stats – modify as needed
    $totalRest = db()->query('SELECT COUNT(*) FROM restaurants')->fetchColumn();
    $totalProd = db()->query('SELECT COUNT(*) FROM products')->fetchColumn();
    $totalOrders = db()->query('SELECT COUNT(*) FROM orders')->fetchColumn();
    $totalRevenue = db()->query('SELECT SUM(my_total) FROM orders')->fetchColumn();
    $text = "📊 *Umumiy statistika*\n";
    $text .= "🏪 Restoranlar: $totalRest\n";
    $text .= "🍔 Mahsulotlar: $totalProd\n";
    $text .= "📦 Buyurtmalar: $totalOrders\n";
    $text .= "💰 Daromad: " . number_format($totalRevenue ?? 0, 0, '.', ' ') . " so'm";
    sendMessage($chatId, $text);
}
?>
