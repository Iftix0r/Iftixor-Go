<?php
require_once 'config.php';

/** initData ni qatorlarga ajratish (parse_str ba'zi serverlarda xato beradi) */
function parseInitData(string $initData): array {
    $parsed = [];
    foreach (explode('&', $initData) as $chunk) {
        if ($chunk === '') continue;
        $pos = strpos($chunk, '=');
        if ($pos === false) continue;
        $parsed[substr($chunk, 0, $pos)] = substr($chunk, $pos + 1);
    }
    return $parsed;
}

/** Telegram Mini App initData tekshiruvi */
function validateInitData(?string $initData): ?array {
    if (!$initData || !str_contains($initData, 'hash=')) return null;

    $parsed = parseInitData($initData);
    if (empty($parsed['hash'])) return null;

    $hash = $parsed['hash'];
    unset($parsed['hash']);

    ksort($parsed);
    $lines = [];
    foreach ($parsed as $key => $value) {
        $lines[] = $key . '=' . rawurldecode($value);
    }
    $dataCheckString = implode("\n", $lines);

    $secretKey = hash_hmac('sha256', BOT_TOKEN, 'WebAppData', true);
    $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

    if (!hash_equals(strtolower($calculated), strtolower($hash))) {
        return null;
    }

    if (isset($parsed['auth_date']) && (time() - (int)$parsed['auth_date']) > 86400) {
        return null;
    }

    $user = json_decode(rawurldecode($parsed['user'] ?? ''), true);
    return (is_array($user) && !empty($user['id'])) ? $user : null;
}

function getInitDataFromRequest(): ?string {
    $h = $_SERVER['HTTP_X_TELEGRAM_INIT_DATA'] ?? '';
    if ($h !== '') return $h;

    global $input;
    if (!empty($input['init_data']) && is_string($input['init_data'])) {
        return $input['init_data'];
    }

    if (!empty($_GET['init_data']) && is_string($_GET['init_data'])) {
        return $_GET['init_data'];
    }

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
            'data' => $initData
                ? 'Telegram tasdiqlanmadi. Ilovani yoping va botdan qayta oching.'
                : 'Telegram orqali kirish kerak',
        ]);
        exit;
    }
    return $user;
}

function isAdminId(int $id): bool {
    return in_array($id, ADMIN_IDS, true);
}

/** Buyurtma oldidan foydalanuvchi bazada bo'lishi kerak (FK) */
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
        $tgUser['username'] ?? '',
        $tgUser['first_name'] ?? '',
        $tgUser['last_name'] ?? '',
        $tgUser['language_code'] ?? 'uz',
    ]);
}
