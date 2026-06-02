<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Telegram-Init-Data');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once 'auth.php';

$tgUser = validateInitData($_SERVER['HTTP_X_TELEGRAM_INIT_DATA'] ?? '');
if (!$tgUser || !isAdminId((int)$tgUser['id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'data' => 'Unauthorized']);
    exit;
}

function resp($data, $success = true): void {
    echo json_encode(['success' => $success, 'data' => $data]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') resp('Method not allowed', false);
if (empty($_FILES['image'])) resp('No file uploaded', false);

$file   = $_FILES['image'];
$maxSize = 5 * 1024 * 1024; // 5MB
$allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

if ($file['error'] !== UPLOAD_ERR_OK)  resp('Upload error: ' . $file['error'], false);
if ($file['size'] > $maxSize)          resp('Fayl juda katta (max 5MB)', false);

// MIME type tekshiruvi
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime  = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);
if (!in_array($mime, $allowed)) resp('Faqat JPG, PNG, WEBP, GIF ruxsat etiladi', false);

// Upload papka
$uploadDir = __DIR__ . '/webapp/uploads/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// Xavfsiz fayl nomi
$ext      = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp','image/gif'=>'gif'][$mime];
$filename = uniqid('img_', true) . '.' . $ext;
$destPath = $uploadDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    resp('Faylni saqlashda xatolik', false);
}

$baseUrl = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'];
$url = $baseUrl . '/webapp/uploads/' . $filename;

resp(['url' => $url, 'filename' => $filename]);
