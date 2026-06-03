<?php
require_once 'config.php';

/**
 * initData stringini key=value juftlariga ajratadi.
 * parse_str() ba'zi serverlarda dot va boshqa belgilarni buzadi —
 * shuning uchun qo'lda parse qilamiz.
 */
function parseInitData(string $raw): array {
    $result = [];
    foreach (explode('&', $raw) as $chunk) {
        if ($chunk === '') continue;
        $pos = strpos($chunk, '=');
        if ($pos === false) continue;
        $key = substr($chunk, 0, $pos);
        $val = substr($chunk, $pos + 1);
        $result[$key] = $val;   // URL-encoded holda saqlaymiz, keyin decode
    }
    return $result;
}

/**
 * Telegram Web App initData ni kriptografik tekshiradi.
 * Muvaffaqiyatda user massivini, muvaffaqiyatsizda null qaytaradi.
 */
function validateInitData(?string $initData): ?array {
    if (!$initData) return null;

    // hash= mavjudligini tekshirish (PHP 7 mos)
    if (strpos($initData, 'hash=') === false) return null;

    $parsed = parseInitData($initData);
    if (empty($parsed['hash'])) return null;

    $receivedHash = strtolower(urldecode($parsed['hash']));
    unset($parsed['hash']);

    // Telegram talabi: kalitlar alifbo tartibida saralanadi
    ksort($parsed);

    $lines = [];
    foreach ($parsed as $key => $value) {
        // URL-encoded qiymatni decode qilamiz
        $lines[] = $key . '=' . urldecode($value);
    }
    $dataCheckString = implode("\n", $lines);

    // HMAC hisoblash
    $secretKey  = hash_hmac('sha256', BOT_TOKEN, 'WebAppData', true);
    $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

    $isValid = false;
    
    if (hash_equals($calculated, $receivedHash)) {
        $isValid = true;
    } else {
        // Try without decoding (some clients)
        $lines2 = [];
        foreach ($parsed as $key => $value) {
            $lines2[] = $key . '=' . $value;
        }
        $dc2 = implode("\n", $lines2);
        $calc2 = hash_hmac('sha256', $dc2, $secretKey);
        if (hash_equals($calc2, $receivedHash)) $isValid = true;
    }
    
    // Agar asosiy bot bilan o'xshamasa, REST_BOT_TOKEN bilan tekshiramiz
    if (!$isValid && defined('REST_BOT_TOKEN')) {
        $secretKeyRest  = hash_hmac('sha256', REST_BOT_TOKEN, 'WebAppData', true);
        $calculatedRest = hash_hmac('sha256', $dataCheckString, $secretKeyRest);
        if (hash_equals($calculatedRest, $receivedHash)) {
            $isValid = true;
        } else {
            $calc2Rest = hash_hmac('sha256', $dc2 ?? '', $secretKeyRest);
            if (hash_equals($calc2Rest, $receivedHash)) $isValid = true;
        }
    }
    
    if (!$isValid) return null;

    // auth_date tekshiruvi: 48 soat (2 kun) — 24 soat ba'zan muammo)
    if (isset($parsed['auth_date'])) {
        $age = time() - (int)urldecode($parsed['auth_date']);
        if ($age > 172800) return null; // 48 soat
    }

    $userJson = urldecode($parsed['user'] ?? '');
    $user = $userJson ? json_decode($userJson, true) : null;
    if (!is_array($user) || empty($user['id'])) return null;

    return $user;
}

function getInitDataFromRequest(): ?string {
    // 1. HTTP Header — app.js har doim shu orqali yuboradi
    $h = $_SERVER['HTTP_X_TELEGRAM_INIT_DATA'] ?? '';
    if ($h !== '') {
        // Nginx/Apache ba'zan headerlarni decode qiladi — ikkita decode xavfli emas
        return $h;
    }

    // 2. JSON body (POST da init_data field)
    global $input;
    if (!empty($input['init_data']) && is_string($input['init_data'])) {
        return $input['init_data'];
    }

    // 3. GET parametr
    if (!empty($_GET['init_data']) && is_string($_GET['init_data'])) {
        return urldecode($_GET['init_data']);
    }

    // 4. POST form-data
    if (!empty($_POST['init_data']) && is_string($_POST['init_data'])) {
        return $_POST['init_data'];
    }

    return null;
}

function requireTelegramUser(): array {
    $initData = getInitDataFromRequest();
    $user = validateInitData($initData);

    if (!$user) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'data'    => $initData
                ? 'Telegram autentifikatsiya muvaffaqiyatsiz. Ilovani yopib, botdan qayta oching.'
                : 'Telegram orqali kirish kerak',
        ]);
        exit;
    }
    return $user;
}

function isAdminId(int $id): bool {
    return in_array($id, ADMIN_IDS, true);
}

/** Buyurtma oldidan foydalanuvchi bazada bo'lishi kerak (FK uchun) */
function ensureUserExists(array $tgUser): void {
    db()->prepare(
        "INSERT INTO users (id, username, first_name, last_name, language_code)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           username=VALUES(username),
           first_name=VALUES(first_name),
           last_name=VALUES(last_name)"
    )->execute([
        (int)$tgUser['id'],
        $tgUser['username']      ?? '',
        $tgUser['first_name']    ?? '',
        $tgUser['last_name']     ?? '',
        $tgUser['language_code'] ?? 'uz',
    ]);
}
