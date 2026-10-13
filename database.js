/**
 * ============================================================================
 * SMM ARCHIVE — DATABASE ENGINE MODULE (DATABASE.JS)
 * SQLite3 Persistent Storage Management & Initial Seed
 * Compatible with server.js & production architecture
 * ============================================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Путь к файлу базы данных SQLite в корне проекта
const dbPath = path.resolve(__dirname, 'smm_archive.db');

// Создание и подключение к экземпляру базы данных
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB FATAL ERROR] Ошибка подключения к базе данных SQLite:', err.message);
  } else {
    console.log('[DB SUCCESS] Успешное подключение к базе данных SQLite:', dbPath);
  }
});

// Включение поддержки внешних ключей и оптимизация производительности WAL
db.run("PRAGMA foreign_keys = ON;");
db.run("PRAGMA journal_mode = WAL;");

// --- ИНИЦИАЛИЗАЦИЯ СХЕМЫ БАЗЫ ДАННЫХ И СИДИРОВАНИЕ ---
db.serialize(() => {
  console.log('[DB SCHEMA] Проверка и создание таблиц базы данных...');

  // 1. Таблица пользователей (полностью совместима с server.js)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE,
    password TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    name TEXT,
    is_admin INTEGER DEFAULT 0,
    bonus_balance REAL DEFAULT 1000.0,
    balance REAL DEFAULT 1000.0,
    referral_code TEXT UNIQUE,
    ref_count INTEGER DEFAULT 0,
    tg_discount_claimed INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    email_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица users:', err.message);
  });

  // 2. Таблица товаров каталога
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    title TEXT,
    model TEXT,
    category TEXT,
    price REAL,
    badge TEXT,
    description TEXT,
    sizes TEXT,
    photos TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица products:', err.message);
    else seedInitialProducts();
  });

  // 3. Таблица заказов клиентов
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    userId TEXT,
    number TEXT,
    items TEXT,
    total REAL,
    total_price REAL,
    discount_applied TEXT,
    delivery_type TEXT,
    delivery TEXT,
    delivery_address TEXT,
    address TEXT,
    status TEXT DEFAULT 'Принят',
    track_number TEXT,
    track TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица orders:', err.message);
  });

  // 4. Таблица новостей и журнала
  db.run(`CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT,
    text TEXT,
    content TEXT,
    photo TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица news:', err.message);
    else seedInitialNews();
  });

  // 5. Таблица отзывов сообщества
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    name TEXT,
    rating INTEGER,
    product TEXT,
    product_id INTEGER,
    comment TEXT,
    status TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица reviews:', err.message);
    else seedInitialReviews();
  });

  // 6. Таблица чата службы поддержки
  db.run(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    sender TEXT,
    text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('[DB ERROR] Таблица support_messages:', err.message);
  });

  // --- СОЗДАНИЕ ИНДЕКСОВ ДЛЯ ОПТИМИЗАЦИИ ПОИСКА ---
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);`);

  // --- ДОБАВЛЕНИЕ АДМИНИСТРАТОРОВ СИСТЕМЫ ---
  const admins = [
    { login: 'Fedotov2209', pass: 'S22092009', name: 'Fedotov', email: 'Alexgood135889@Gmail.com' },
    { login: 'Butilkin1906', pass: 'M19072009', name: 'Butilkin', email: 'juicy.789pbz@gmail.com' },
    { login: 'Sereda1703', pass: 'M17032009', name: 'Sereda', email: 'markussereda123@gmail.com' }
  ];

  admins.forEach(admin => {
    const defaultRef = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    db.run(
      `INSERT OR IGNORE INTO users (login, password, email, name, is_admin, is_verified, referral_code, balance, bonus_balance) VALUES (?, ?, ?, ?, 1, 1, ?, 99999, 99999)`,
      [admin.login, admin.pass, admin.email, admin.name, defaultRef],
      (adminErr) => {
        if (adminErr) {
          console.error(`[DB ADMIN ERROR] Не удалось создать админа ${admin.login}:`, adminErr.message);
        }
      }
    );
  });
  console.log('[DB ADMIN] Учетные записи администраторов успешно инициализированы.');
});


// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ СИДИРОВАНИЯ ДАННЫХ (SEED MOCKS)
// ============================================================================

function seedInitialProducts() {
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (row && row.count === 0) {
      const defaultProducts = [
        {
          id: 'prod-1',
          title: 'Vintage Heavy Hoodie Archive',
          model: 'HVY-01',
          category: 'longsleeve',
          price: 5400,
          badge: 'NEW',
          description: 'Плотный футер 320г, винтажная варка, фирменный архивный крой оверсайз.',
          sizes: JSON.stringify(['S', 'M', 'L', 'XL']),
          photos: JSON.stringify(['/images/sample1.jpg', '/images/sample1_2.jpg'])
        },
        {
          id: 'prod-2',
          title: 'Streetwear Cargo Utility Pants',
          model: 'CRG-02',
          category: 'pants',
          price: 6800,
          badge: 'HIT',
          description: 'Широкие карго с множеством карманов и регулируемой фиксацией на шнурках.',
          sizes: JSON.stringify(['M', 'L', 'XL']),
          photos: JSON.stringify(['/images/sample2.jpg'])
        },
        {
          id: 'prod-3',
          title: 'Obsidian Runner Archival Shoes',
          model: 'OBS-03',
          category: 'shoes',
          price: 11500,
          badge: 'LIMITED',
          description: 'Массивная технологичная подошва, премиальные архивные материалы верха.',
          sizes: JSON.stringify(['41', '42', '43', '44']),
          photos: JSON.stringify(['/images/sample3.jpg'])
        },
        {
          id: 'prod-4',
          title: 'Complete SMM Look Set #01',
          model: 'SET-01',
          category: 'set',
          price: 14900,
          badge: 'SET',
          description: 'Головной убор + лонгслив + брюки. Выгода при покупке готовым сетом.',
          sizes: JSON.stringify(['S', 'M', 'L']),
          photos: JSON.stringify(['/images/sample4.jpg'])
        }
      ];

      const stmt = db.prepare(`INSERT INTO products (id, title, model, category, price, badge, description, sizes, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      defaultProducts.forEach(p => {
        stmt.run(p.id, p.title, p.model, p.category, p.price, p.badge, p.description, p.sizes, p.photos);
      });
      stmt.finalize();
      console.log('[DB SEED] Базовые товары каталога успешно загружены в базу данных.');
    }
  });
}

function seedInitialNews() {
  db.get("SELECT COUNT(*) as count FROM news", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO news (id, title, text, content, photo, date) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'news-1',
          'Большое поступление архивного streetwear сезона зима 2026',
          'Мы подготовили уникальную подборку тяжелого футера и редких силуэтов.',
          'Мы подготовили уникальную подборку тяжелого футера, редких кроссовок и аксессуаров для ценителей аутентичного стиля. Количество позиций строго ограничено.',
          '/images/news1.jpg',
          '12 ОКТ 2026'
        ]
      );
      console.log('[DB SEED] Новостные публикации загружены.');
    }
  });
}

function seedInitialReviews() {
  db.get("SELECT COUNT(*) as count FROM reviews", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO reviews (id, user_id, name, rating, product, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['rev-1', 1, 'Артем', 5, 'Vintage Heavy Hoodie Archive', 'Качество ткани и пошива просто на высоте! Плотный материал, идеальный оверсайз.', 'approved']
      );
      console.log('[DB SEED] Отзывы клиентов загружены.');
    }
  });
}

// Экспорт готового экземпляра базы данных для использования в server.js
module.exports = db;