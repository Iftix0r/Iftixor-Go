<?php
require_once 'config.php';

function db(): PDO {
    static $pdo = null;
    if (!$pdo) {
        $pdo = new PDO("mysql:host=".DB_HOST.";dbname=".DB_NAME.";charset=utf8mb4", DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}

function initDB(): void {
    $pdo = db();
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT PRIMARY KEY,
            username VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            photo_url TEXT,
            phone VARCHAR(20),
            address TEXT,
            language_code VARCHAR(10),
            role ENUM('user','seller','admin') DEFAULT 'user',
            restaurant_id INT DEFAULT NULL,
            is_blocked TINYINT(1) DEFAULT 0,
            block_reason VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked TINYINT(1) DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason VARCHAR(255);

        CREATE TABLE IF NOT EXISTS categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            icon VARCHAR(50),
            sort_order INT DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS restaurants (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            address TEXT,
            phone VARCHAR(50),
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            category_id INT,
            restaurant_id INT DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            image VARCHAR(500),
            available TINYINT(1) DEFAULT 1,
            order_count INT DEFAULT 0,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            items JSON NOT NULL,
            total DECIMAL(10,2),
            address TEXT,
            phone VARCHAR(20),
            status ENUM('new','confirmed','cooking','delivered','cancelled') DEFAULT 'new',
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS taxi_rides (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            phone VARCHAR(20),
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            from_lat DOUBLE,
            from_lon DOUBLE,
            to_lat DOUBLE,
            to_lon DOUBLE,
            car_type ENUM('ekonom','comfort','minivan') DEFAULT 'ekonom',
            price DECIMAL(10,2) DEFAULT 0,
            status ENUM('new','accepted','on_way','arrived','completed','cancelled') DEFAULT 'new',
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    ");

    // Seed categories
    $count = $pdo->query("SELECT COUNT(*) FROM categories")->fetchColumn();
    if ($count == 0) {
        $pdo->exec("INSERT INTO categories (name, icon, sort_order) VALUES
            ('Ovqatlar', '🍽️', 1),
            ('Shiriniklar', '🍰', 2),
            ('Fastfood', '🍔', 3),
            ('Ichimliklar', '🥤', 4),
            ('Salatlar', '🥗', 5),
            ('Boshqalar', '🍱', 6)
        ");

        $pdo->exec("INSERT INTO products (category_id, name, description, price, image) VALUES
            (1, 'Osh', 'Milliy taomimiz - palov', 25000, 'https://i.imgur.com/palov.jpg'),
            (1, 'Lag\'mon', 'Qo\'lda tayyorlangan lag\'mon', 22000, ''),
            (1, 'Manti', '6 dona bug\'da pishirilgan', 20000, ''),
            (2, 'Napoleon tort', 'Slivochny krem bilan', 18000, ''),
            (2, 'Cheesecake', 'New York style', 22000, ''),
            (3, 'Burger', 'Mol go\'shtli burger', 28000, ''),
            (3, 'Hot Dog', 'Sosisli hot dog', 15000, ''),
            (3, 'Pizza', '30sm, mol go\'shtli', 45000, ''),
            (4, 'Coca-Cola', '0.5L', 8000, ''),
            (4, 'Choy', 'Ko\'k choy', 5000, ''),
            (4, 'Sharbat', 'Tabiiy meva sharbati', 12000, ''),
            (5, 'Aralash salat', 'Sabzavotli salat', 14000, ''),
            (5, 'Olivye', 'Klassik olivye', 16000, ''),
            (6, 'Non', 'Tandirdan yangi non', 5000, ''),
            (6, 'Somsa', '2 dona mol go\'shtli', 12000, '')
        ");
    }
}

try { initDB(); } catch (Exception $e) { /* ignore on subsequent requests */ }

// Ensure columns exist (safe migration)
try {
    $cols = db()->query("SHOW COLUMNS FROM users LIKE 'is_blocked'")->fetchAll();
    if (empty($cols)) {
        db()->exec("ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) DEFAULT 0");
        db()->exec("ALTER TABLE users ADD COLUMN block_reason VARCHAR(255)");
    }
} catch (Exception $e) { /* ignore */ }

try {
    $scols = db()->query("SHOW COLUMNS FROM users LIKE 'bot_state'")->fetchAll();
    if (empty($scols)) {
        db()->exec("ALTER TABLE users ADD COLUMN bot_state VARCHAR(255) DEFAULT ''");
        db()->exec("ALTER TABLE users ADD COLUMN bot_temp_data TEXT");
    }
} catch (Exception $e) { /* ignore */ }

try {
    $rcols = db()->query("SHOW COLUMNS FROM users LIKE 'role'")->fetchAll();
    if (empty($rcols)) {
        db()->exec("ALTER TABLE users ADD COLUMN role ENUM('user','seller','admin') DEFAULT 'user'");
        db()->exec("ALTER TABLE users ADD COLUMN restaurant_id INT DEFAULT NULL");
    }
} catch (Exception $e) { /* ignore */ }

try {
    db()->exec("
        CREATE TABLE IF NOT EXISTS restaurants (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            address TEXT,
            phone VARCHAR(50),
            is_active TINYINT(1) DEFAULT 1,
            views INT DEFAULT 0,
            owner_tg_id BIGINT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ");
} catch (Exception $e) { /* ignore */ }

try {
    $rcols = db()->query("SHOW COLUMNS FROM restaurants LIKE 'views'")->fetchAll();
    if (empty($rcols)) {
        db()->exec("ALTER TABLE restaurants ADD COLUMN views INT DEFAULT 0");
    }
} catch (Exception $e) { /* ignore */ }

try {
    $rcols2 = db()->query("SHOW COLUMNS FROM restaurants LIKE 'owner_tg_id'")->fetchAll();
    if (empty($rcols2)) {
        db()->exec("ALTER TABLE restaurants ADD COLUMN owner_tg_id BIGINT DEFAULT NULL");
    }
} catch (Exception $e) { /* ignore */ }

try {
    $pcols = db()->query("SHOW COLUMNS FROM products LIKE 'restaurant_id'")->fetchAll();
    if (empty($pcols)) {
        db()->exec("ALTER TABLE products ADD COLUMN restaurant_id INT DEFAULT NULL");
    }
} catch (Exception $e) { /* ignore */ }

try {
    $pcols2 = db()->query("SHOW COLUMNS FROM products LIKE 'order_count'")->fetchAll();
    if (empty($pcols2)) {
        db()->exec("ALTER TABLE products ADD COLUMN order_count INT DEFAULT 0");
    }
} catch (Exception $e) { /* ignore */ }

// taxi_rides jadvali (eski serverlar uchun)
try {
    db()->exec("
        CREATE TABLE IF NOT EXISTS taxi_rides (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT NOT NULL,
            phone VARCHAR(20),
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            from_lat DOUBLE DEFAULT 0,
            from_lon DOUBLE DEFAULT 0,
            to_lat DOUBLE DEFAULT 0,
            to_lon DOUBLE DEFAULT 0,
            car_type VARCHAR(20) DEFAULT 'ekonom',
            price DECIMAL(10,2) DEFAULT 0,
            status ENUM('new','accepted','on_way','arrived','completed','cancelled') DEFAULT 'new',
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ");
} catch (Exception $e) { /* ignore */ }
