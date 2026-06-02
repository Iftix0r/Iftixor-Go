# 🍽️ Iftixor Go — Telegram Restoran Bot

<p align="center">
  <img src="https://img.shields.io/badge/PHP-8.0+-777BB4?style=for-the-badge&logo=php&logoColor=white">
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white">
  <img src="https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white">
  <img src="https://img.shields.io/badge/Mini%20App-WebApp-26A5E4?style=for-the-badge&logo=telegram&logoColor=white">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge">
</p>

<p align="center">
  Telegram Mini App + Bot yordamida to'liq funksional restoran buyurtma tizimi.<br>
  iOS Native dizayn, real-time admin panel, va qulay foydalanuvchi interfeysi.
</p>

---

## ✨ Imkoniyatlar

| Foydalanuvchi | Admin |
|---|---|
| 🛒 Mini App orqali buyurtma berish | 🔔 Yangi buyurtmalar telegram guruhga tushadi |
| 🍽️ Kategoriyalar bo'yicha menyu | ✅ Bir tugma bilan qabul qilish |
| 🔍 Ovqat qidirish | ❌ Bir tugma bilan bekor qilish |
| 🛍️ Savat — miqdor o'zgartirish | 📩 Foydalanuvchiga avtomatik xabar |
| 📋 Buyurtmalar tarixi | — |
| 👤 Profil — telefon, manzil, rasm | — |
| 📱 Haptic feedback & Toast xabarlari | — |

---

## 📱 Ekranlar

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   🍽️ Menyu      │   │   🛒 Savat       │   │   👤 Profil     │
│                 │   │                 │   │                 │
│ [Barchasi] [🍽️] │   │ Osh × 2  50,000 │   │  [Profil Rasm]  │
│                 │   │ Burger × 1 28k  │   │   Ism Familiya  │
│ ┌────┐  ┌────┐  │   │─────────────────│   │   @username     │
│ │ 🍽️ │  │ 🍔 │  │   │ Jami: 83,000   │   │─────────────────│
│ │Osh │  │Brg │  │   │                 │   │ 📞 Telefon      │
│ └────┘  └────┘  │   │ [Buyurtma berish]│   │ 📍 Manzil       │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

---

## 🗂️ Fayl Strukturasi

```
iftixor-go/
├── 📄 config.php        # Bot token, DB va URL sozlamalari
├── 📄 bot.php           # Telegram Webhook handler
├── 📄 api.php           # REST API (menyu, buyurtma, profil)
├── 📄 db.php            # PDO ulanish + jadvallar + seed data
├── 📄 setup.php         # O'rnatish scripti
└── 📁 webapp/
    ├── 📄 index.html    # Telegram Mini App (UI)
    ├── 📄 style.css     # iOS Native dizayn
    └── 📄 app.js        # JavaScript logika
```

---

## ⚙️ O'rnatish

### Talablar
- PHP 8.0+, PDO, cURL
- MySQL 5.7+ / MariaDB
- HTTPS domain (Telegram talab qiladi)

### 1️⃣ Reponi clone qiling

```bash
git clone https://github.com/username/iftixor-go.git
cd iftixor-go
```

### 2️⃣ `config.php` ni sozlang

```php
define('BOT_TOKEN',    '123456789:AAF...');       // @BotFather dan
define('GROUP_CHAT_ID', '-1001234567890');         // Admin guruh ID
define('WEBAPP_URL',   'https://domain.com/webapp');
define('DB_HOST',      'localhost');
define('DB_NAME',      'iftixor_bot');
define('DB_USER',      'root');
define('DB_PASS',      'parol');
```

> 💡 **Guruh ID olish:** guruhga `@username_to_id_bot` qo'shing yoki botni guruhga qo'shib `/chatid` yuboring.

### 3️⃣ MySQL bazasini yarating

```sql
CREATE DATABASE iftixor_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4️⃣ Setup scriptini ishga tushiring

```bash
php setup.php
```

Bu script:
- ✅ Jadvallarni yaratadi (`users`, `categories`, `products`, `orders`)
- ✅ Namuna menyu ma'lumotlarini qo'shadi
- ✅ Telegram Webhook ni o'rnatadi

### 5️⃣ Fayllarni serverga yuklang

```
/var/www/html/
├── bot.php
├── api.php
├── db.php
├── config.php
└── webapp/
    ├── index.html
    ├── style.css
    └── app.js
```

### 6️⃣ @BotFather da Mini App yarating

```
1. @BotFather → /newapp
2. Botingizni tanlang
3. App URL: https://domain.com/webapp
4. /start buyrug'ini yuboring → "Buyurtma berish" tugmasi paydo bo'ladi
```

---

## 🗄️ Database Sxema

```sql
users       — Telegram foydalanuvchilar (id, ism, username, telefon, manzil, rasm)
categories  — Menyu kategoriyalari (Ovqatlar, Fastfood, Ichimliklar...)
products    — Mahsulotlar (nomi, narxi, tavsifi, rasm, kategoriya)
orders      — Buyurtmalar (foydalanuvchi, mahsulotlar JSON, jami, status)
```

**Order statuslari:** `new` → `confirmed` → `cooking` → `delivered` / `cancelled`

---

## 📡 API Endpointlar

| Action | Method | Tavsif |
|--------|--------|--------|
| `save_user` | POST | Telegram foydalanuvchini saqlash |
| `get_menu` | GET | Kategoriyalar va mahsulotlar |
| `get_profile` | GET | Foydalanuvchi profili |
| `update_profile` | POST | Telefon va manzilni yangilash |
| `place_order` | POST | Yangi buyurtma berish |
| `my_orders` | GET | Buyurtmalar tarixi |

---

## 🍽️ Menyu Kategoriyalari

| # | Kategoriya | Emoji |
|---|-----------|-------|
| 1 | Ovqatlar | 🍽️ |
| 2 | Shiriniklar | 🍰 |
| 3 | Fastfood | 🍔 |
| 4 | Ichimliklar | 🥤 |
| 5 | Salatlar | 🥗 |
| 6 | Boshqalar | 🍱 |

> Kategoriya va mahsulotlarni to'g'ridan-to'g'ri MySQL da tahrirlash mumkin.

---

## 🔒 Xavfsizlik

- ✅ PDO Prepared Statements — SQL Injection himoyasi
- ✅ HTTPS majburiy — Telegram talab qiladi
- ⚠️ Production uchun `initData` validatsiyasini qo'shing:

```php
// bot.php yoki api.php da
function validateTelegramData(string $initData): bool {
    parse_str($initData, $params);
    $hash = $params['hash'];
    unset($params['hash']);
    ksort($params);
    $dataStr = implode("\n", array_map(fn($k,$v) => "$k=$v", array_keys($params), $params));
    $secretKey = hash_hmac('sha256', BOT_TOKEN, 'WebAppData', true);
    return hash_hmac('sha256', $dataStr, $secretKey) === $hash;
}
```

---

## 🤝 Hissa qo'shish

1. Fork qiling
2. Branch yarating: `git checkout -b feature/yangi-imkoniyat`
3. Commit: `git commit -m "feat: yangi imkoniyat qo'shildi"`
4. Push: `git push origin feature/yangi-imkoniyat`
5. Pull Request oching

---

## 📄 Litsenziya

[MIT License](LICENSE) — Erkin foydalaning, o'zgartiring va tarqating.

---

<p align="center">
  <b>Iftixor Go</b> — Telegram orqali qulay ovqat buyurtmasi 🍽️<br>
  <a href="https://t.me/your_bot">Bot</a> · 
  <a href="https://github.com/username/iftixor-go/issues">Muammo bildirish</a>
</p>
