/**
 * ============================================================================
 * SMM ARCHIVE — DATABASE ENGINE MODULE (DATABASE.JS)
 * SQLite3 Persistent Storage Management with Full Auto-Migration
 * ============================================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'smm_archive.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('[DB FATAL ERROR]:', err.message);
  else console.log('[DB SUCCESS] Подключено:', dbPath);
});

db.run("PRAGMA foreign_keys = ON;");
db.run("PRAGMA journal_mode = WAL;");

db.serialize(() => {
  // 1. Таблица пользователей + миграции
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
  )`, () => {
    db.run(`ALTER TABLE users ADD COLUMN balance REAL DEFAULT 1000.0`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN bonus_balance REAL DEFAULT 1000.0`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, () => {});
  });

  // 2. Таблица товаров + миграции
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
    db.run(`ALTER TABLE products ADD COLUMN badge TEXT`, () => {});
    if (!err) seedProducts();
  });

  // 3. Таблица заказов
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
  )`);

  // 4. Таблица новостей + миграция столбца content
  db.run(`CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT,
    text TEXT,
    content TEXT,
    photo TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    db.run(`ALTER TABLE news ADD COLUMN content TEXT`, () => {});
    if (!err) seedNews();
  });

  // 5. Таблица отзывов
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
  )`, (err) => { if (!err) seedReviews(); });

  // 6. Таблица саппорта
  db.run(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    sender TEXT,
    text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Индексы
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);`);

  // Админы
  setTimeout(() => {
    const admins = [
      { login: 'Fedotov2209', pass: 'S22092009', name: 'Fedotov', email: 'Alexgood135889@Gmail.com' },
      { login: 'Butilkin1906', pass: 'M19072009', name: 'Butilkin', email: 'juicy.789pbz@gmail.com' },
      { login: 'Sereda1703', pass: 'M17032009', name: 'Sereda', email: 'markussereda123@gmail.com' }
    ];

    admins.forEach(a => {
      const ref = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();
      db.run(`INSERT OR IGNORE INTO users (login, password, email, name, is_admin, is_verified, referral_code, balance, bonus_balance) VALUES (?, ?, ?, ?, 1, 1, ?, 99999, 99999)`,
        [a.login, a.pass, a.email, a.name, ref]);
    });
  }, 500);
});

function seedProducts() {
  db.get("SELECT COUNT(*) as c FROM products", (e, r) => {
    if (r && r.c === 0) {
      const pList = [
        { id: 'prod-1', title: 'Vintage Heavy Hoodie Archive', model: 'HVY-01', category: 'longsleeve', price: 5400, badge: 'NEW', desc: 'Плотный футер 320г, оверсайз.', sizes: '["S","M","L","XL"]', photos: '["/images/sample1.jpg"]' },
        { id: 'prod-2', title: 'Streetwear Cargo Utility Pants', model: 'CRG-02', category: 'pants', price: 6800, badge: 'HIT', desc: 'Широкие карго с карманами.', sizes: '["M","L","XL"]', photos: '["/images/sample2.jpg"]' }
      ];
      const stmt = db.prepare(`INSERT INTO products (id, title, model, category, price, badge, description, sizes, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      pList.forEach(p => stmt.run(p.id, p.title, p.model, p.category, p.price, p.badge, p.desc, p.sizes, p.photos));
      stmt.finalize();
    }
  });
}

function seedNews() {
  db.get("SELECT COUNT(*) as c FROM news", (e, r) => {
    if (r && r.c === 0) {
      db.run(`INSERT INTO news (id, title, text, content, photo, date) VALUES (?, ?, ?, ?, ?, ?)`,
        ['news-1', 'Зимний сезон 2026', 'Поступление архивного streetwear.', 'Поступление тяжелого футера и редких силуэтов.', '/images/news1.jpg', '12 ОКТ 2026']);
    }
  });
}

function seedReviews() {
  db.get("SELECT COUNT(*) as c FROM reviews", (e, r) => {
    if (r && r.c === 0) {
      db.run(`INSERT INTO reviews (id, user_id, name, rating, product, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['rev-1', 1, 'Артем', 5, 'Vintage Heavy Hoodie Archive', 'Качество на высоте!', 'approved']);
    }
  });
}

module.exports = db;
