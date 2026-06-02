# 🍽️ Iftixor Go - Restoran Bot

Telegram Mini App + Bot bilan zamonaviy restoran buyurtma tizimi.

## 📁 Fayl Strukturasi
```
├── config.php          # Bot token, DB sozlamalari
├── bot.php             # Telegram webhook handler
├── api.php             # Backend API
├── db.php              # Database + jadval yaratish
├── setup.php           # Birinchi marta ishga tushirish
└── webapp/
    ├── index.html      # Mini App UI
    ├── style.css       # iOS dizayn
    └── app.js          # JavaScript logika
```

## ⚙️ O'rnatish

### 1. config.php ni tahrirlang
```php
define('BOT_TOKEN', 'YOUR_BOT_TOKEN');        // @BotFather dan oling
define('GROUP_CHAT_ID', '-100XXXXXXXXXX');    // Admin guruh ID
define('WEBAPP_URL', 'https://sizndomain.com/webapp');
define('DB_HOST', 'localhost');
define('DB_NAME', 'iftixor_bot');
define('DB_USER', 'root');
define('DB_PASS', 'parol');
```

### 2. MySQL bazani yarating
```sql
CREATE DATABASE iftixor_bot CHARACTER SET utf8mb4;
```

### 3. Setup ni ishga tushiring
```bash
php setup.php
```

### 4. Fayllarni serverga yuklang (HTTPS kerak!)
```
/var/www/html/
├── bot.php, api.php, db.php, config.php
└── webapp/ (index.html, style.css, app.js)
```

### 5. @BotFather da Web App yarating
- `/newapp` buyrug'ini yuboring
- URL: `https://sizndomain.com/webapp`

## 🤖 Bot Imkoniyatlari
- 🛒 Web App orqali buyurtma berish
- 📋 Buyurtmalar tarixi
- 👤 Profil (Telegram ID, ism, rasm, telefon, manzil)
- 🔔 Admin guruhga buyurtma xabari
- ✅/❌ Admin tomonidan buyurtmani tasdiqlash/bekor qilish
- 📩 Foydalanuvchiga status xabari

## 🍽️ Menyu Bo'limlari
| Bo'lim | Emoji |
|--------|-------|
| Ovqatlar | 🍽️ |
| Shiriniklar | 🍰 |
| Fastfood | 🍔 |
| Ichimliklar | 🥤 |
| Salatlar | 🥗 |
| Boshqalar | 🍱 |

## 📱 Dizayn
- iOS Native dizayn (SF Pro font, safe-area)
- Splash screen animatsiya
- Modal product detail
- Bottom navigation
- Cart badge
- Toast xabarlari
- Haptic feedback

## 🔒 Xavfsizlik
- PDO prepared statements (SQL injection himoya)
- Telegram initData validatsiya qo'shing (production uchun)
- HTTPS majburiy
# Iftixor-Go
