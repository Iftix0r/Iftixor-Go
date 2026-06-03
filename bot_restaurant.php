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

if (isset($update['message'])) {
    $msg = $update['message'];
    $chatId = $msg['chat']['id'];
    $text = trim($msg['text'] ?? '');
    
    // Foydalanuvchini saqlash yoki tekshirish
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

    if ($text === '/start') {
        $welcome = "👋 Assalomu alaykum, hurmatli sotuvchi!\n\n"
                 . "🏪 *Iftixor Go Sotuvchi* tizimiga xush kelibsiz.\n"
                 . "Bu yerda siz o'z do'koningiz mahsulotlarini va buyurtmalarini boshqarishingiz mumkin.\n\n"
                 . "👇 Quyidagi tugmani bosib panelga kiring:";
                 
        tg_rest('sendMessage', [
            'chat_id'      => $chatId,
            'text'         => $welcome,
            'parse_mode'   => 'Markdown',
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '⚙️ Sotuvchi Paneli', 'web_app' => ['url' => REST_WEBAPP_URL]]
            ]]]
        ]);
    }
}
