/**
 * ============================================================================
 * SMM ARCHIVE — DATABASE ENGINE MODULE (DATABASE.JS)
 * PostgreSQL Persistent Storage Management for Supabase & Render
 * ============================================================================
 */

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('connect', () => {
    console.log('[DB SUCCESS] Подключено к PostgreSQL (Supabase)');
});

pool.on('error', (err) => {
    console.error('[DB FATAL ERROR]:', err.message);
});

async function initDB() {
    try {
        // 1. Таблица пользователей
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance REAL DEFAULT 1000.0`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_balance REAL DEFAULT 1000.0`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);

        // 2. Таблица товаров
        await pool.query(`CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            title TEXT,
            model TEXT,
            category TEXT,
            price REAL,
            badge TEXT,
            description TEXT,
            sizes TEXT,
            photos TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS badge TEXT`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS model TEXT`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS photos TEXT`);

        // 3. Таблица заказов
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price REAL`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_applied TEXT`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery TEXT`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS address TEXT`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS track TEXT`);

        // 4. Таблица новостей
        await pool.query(`CREATE TABLE IF NOT EXISTS news (
            id TEXT PRIMARY KEY,
            title TEXT,
            text TEXT,
            content TEXT,
            photo TEXT,
            date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS content TEXT`);
        await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS photo TEXT`);
        await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS date TEXT`);

        // 5. Таблица отзывов
        await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            name TEXT,
            rating INTEGER,
            product TEXT,
            product_id INTEGER,
            comment TEXT,
            status TEXT DEFAULT 'approved',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS name TEXT`);
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS product TEXT`);
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT`);

        // 6. Таблица саппорта
        await pool.query(`CREATE TABLE IF NOT EXISTS support_messages (
            id SERIAL PRIMARY KEY,
            user_id TEXT,
            sender TEXT,
            text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Индексы
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);`);

        // Инициализация начальных данных
        await seedProducts();
        await seedNews();
        await seedReviews();
        await seedAdmins();

        console.log('[DB SUCCESS] База данных PostgreSQL полностью инициализирована.');
    } catch (err) {
        console.error('[DB ERROR] Ошибка инициализации БД:', err.message);
    }
}

async function seedProducts() {
    const res = await pool.query("SELECT COUNT(*) as c FROM products");
    if (parseInt(res.rows[0].c) === 0) {
        const pList = [
            { id: 'prod-1', title: 'Vintage Heavy Hoodie Archive', model: 'HVY-01', category: 'longsleeve', price: 5400, badge: 'NEW', desc: 'Плотный футер 320г, оверсайз.', sizes: '["S","M","L","XL"]', photos: '["/images/sample1.jpg"]' },
            { id: 'prod-2', title: 'Streetwear Cargo Utility Pants', model: 'CRG-02', category: 'pants', price: 6800, badge: 'HIT', desc: 'Широкие карго с карманами.', sizes: '["M","L","XL"]', photos: '["/images/sample2.jpg"]' }
        ];
        for (const p of pList) {
            await pool.query(
                `INSERT INTO products (id, title, model, category, price, badge, description, sizes, photos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
                [p.id, p.title, p.model, p.category, p.price, p.badge, p.desc, p.sizes, p.photos]
            );
        }
    }
}

async function seedNews() {
    const res = await pool.query("SELECT COUNT(*) as c FROM news");
    if (parseInt(res.rows[0].c) === 0) {
        await pool.query(
            `INSERT INTO news (id, title, text, content, photo, date) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
            ['news-1', 'Зимний сезон 2026', 'Поступление архивного streetwear.', 'Поступление тяжелого футера и редких силуэтов.', '/images/news1.jpg', '12 ОКТ 2026']
        );
    }
}

async function seedReviews() {
    const res = await pool.query("SELECT COUNT(*) as c FROM reviews");
    if (parseInt(res.rows[0].c) === 0) {
        await pool.query(
            `INSERT INTO reviews (id, user_id, name, rating, product, comment, status) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
            ['rev-1', 1, 'Артем', 5, 'Vintage Heavy Hoodie Archive', 'Качество на высоте!', 'approved']
        );
    }
}

async function seedAdmins() {
    const admins = [
        { login: 'Fedotov2209', pass: 'S22092009', name: 'Fedotov', email: 'Alexgood135889@Gmail.com' },
        { login: 'Butilkin1906', pass: 'M19072009', name: 'Butilkin', email: 'juicy.789pbz@gmail.com' },
        { login: 'Sereda1703', pass: 'M17032009', name: 'Sereda', email: 'markussereda123@gmail.com' }
    ];

    for (const a of admins) {
        const ref = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        await pool.query(
            `INSERT INTO users (login, password, email, name, is_admin, is_verified, referral_code, balance, bonus_balance) 
             VALUES ($1, $2, $3, $4, 1, 1, $5, 99999, 99999) 
             ON CONFLICT (login) DO NOTHING`,
            [a.login, a.pass, a.email, a.name, ref]
        );
    }
}

initDB();

module.exports = pool;
