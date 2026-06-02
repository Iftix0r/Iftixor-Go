#!/usr/bin/env php
<?php
// Run: php setup.php
require_once __DIR__ . '/config.php';

$webhookUrl = "https://iftixorgo.bigsaver.ru/bot.php"; // O'zgartiring!

$ch = curl_init("https://api.telegram.org/bot".BOT_TOKEN."/setWebhook");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => ['url' => $webhookUrl],
    CURLOPT_RETURNTRANSFER => true,
]);
$res = json_decode(curl_exec($ch), true);
curl_close($ch);

echo $res['ok'] ? "✅ Webhook o'rnatildi: $webhookUrl\n" : "❌ Xato: {$res['description']}\n";

// Create DB
require_once __DIR__ . '/db.php';
echo "✅ Database va jadvallar yaratildi!\n";
