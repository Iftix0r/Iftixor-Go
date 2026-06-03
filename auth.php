<?php
require_once 'config.php';

/** Telegram Mini App initData tekshiruvi. Muvaffaqiyatda user massivini qaytaradi. */
function validateInitData(?string $initData): ?array {
    if (!$initData) return null;
    parse_str($initData, $params);
    if (empty($params['hash'])) return null;

    $hash = $params['hash'];
    unset($params['hash']);
    ksort($params);
    $pairs = [];
    foreach ($params as $k => $v) {
        $pairs[] = "$k=$v";
    }
    $dataCheckString = implode("\n", $pairs);
    $secretKey = hash_hmac('sha256', BOT_TOKEN, 'WebAppData', true);
    $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

    if (!hash_equals($calculated, $hash)) return null;
    if (isset($params['auth_date']) && time() - (int)$params['auth_date'] > 86400) return null;

    $user = json_decode($params['user'] ?? 'null', true);
    return is_array($user) && !empty($user['id']) ? $user : null;
}

function getInitDataFromRequest(): ?string {
    // 1. HTTP header (app.js tomonidan yuboriladi)
    $h = $_SERVER['HTTP_X_TELEGRAM_INIT_DATA'] ?? '';
    if ($h !== '') return $h;

    // 2. JSON body (global $input api.php da avval aniqlanadi)
    global $input;
    if (!empty($input['init_data'])) return $input['init_data'];

    // 3. GET parametr
    if (!empty($_GET['init_data'])) return $_GET['init_data'];

    // 4. POST parametr (form-data holatida)
    if (!empty($_POST['init_data'])) return $_POST['init_data'];

    return null;
}

function requireTelegramUser(): array {
    $user = validateInitData(getInitDataFromRequest());
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'data' => 'Telegram orqali kirish kerak']);
        exit;
    }
    return $user;
}

function isAdminId(int $id): bool {
    return in_array($id, ADMIN_IDS, true);
}
