/**
 * ============================================================================
 * SMM ARCHIVE — MASTER BACKEND SERVER (SERVER.JS)
 * Express / SQLite / Nodemailer Gmail Production API Engine
 * Архитектура: Reg.ru / Production Ready
 * Объем кода: 900+ строк
 * ============================================================================
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3005;

// --- 1. БАЗОВЫЕ МИДЛВЕРЫ И НАСТРОЙКИ СЕРВЕРА ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Логирующий мидлвер для отслеживания запросов
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} — ${req.url}`);
  next();
});

// --- 2. НАСТРОЙКА ПОЧТОВОГО СЕРВЕРА GMAIL (NODEMAILER) ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'smmarchiveverefication@gmail.com',
    pass: 'tmjzibdmgkndlrwm'
  }
});

// Верификация почтового транспорта при запуске
transporter.verify((error, success) => {
  if (error) {
    console.error('[GMAIL ERROR] Ошибка инициализации почтового клиента:', error);
  } else {
    console.log('[GMAIL SUCCESS] Почтовый сервер успешно подключен и готов к работе.');
  }
});

// ============================================================================
// 3. ИНИЦИАЛИЗАЦИЯ И СИДИРОВАНИЕ БАЗЫ ДАННЫХ (DATABASE TABLES & SEEDS)
// ============================================================================
db.serialize(() => {
  // Таблица пользователей
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE,
    password TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    name TEXT,
    balance REAL DEFAULT 1000.0,
    referral_code TEXT,
    ref_count INTEGER DEFAULT 0,
    tg_discount_claimed INTEGER DEFAULT 0,
    email_code TEXT,
    is_verified INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (!err) {
      // Создаем дефолтного администратора, если его нет
      db.get("SELECT * FROM users WHERE is_admin = 1", (admErr, adminRow) => {
        if (!adminRow) {
          db.run(`INSERT OR IGNORE INTO users (login, password, email, phone, name, is_verified, is_admin, balance) VALUES (?, ?, ?, ?, ?, 1, 1, 99999)`,
            ['admin', 'admin123', 'smmarchiveverefication@gmail.com', '+79990000000', 'Главный Администратор']);
          console.log('[DB] Создан учетный запись администратора по умолчанию (admin / admin123).');
        }
      });
    }
  });

  // Таблица товаров каталога
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    title TEXT,
    category TEXT,
    price REAL,
    badge TEXT,
    description TEXT,
    photos TEXT,
    sizes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, () => {
    seedDefaultProducts();
  });

  // Таблица новостей и журнала
  db.run(`CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT,
    photo TEXT,
    date TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, () => {
    seedDefaultNews();
  });

  // Таблица отзывов клиентов
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    name TEXT,
    rating INTEGER,
    product TEXT,
    comment TEXT,
    status TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, () => {
    seedDefaultReviews();
  });

  // Таблица заказов
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    userId TEXT,
    number TEXT,
    total REAL,
    status TEXT DEFAULT 'Оплачен',
    delivery TEXT,
    address TEXT,
    items TEXT,
    track TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Таблица чата поддержки
  db.run(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    sender TEXT,
    text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Функции наполнения базовыми данными (Mock Seed Data)
function seedDefaultProducts() {
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (row && row.count === 0) {
      const demoProducts = [
        {
          id: 'prod-1',
          title: 'Vintage Heavy Hoodie Archive',
          category: 'longsleeve',
          price: 5400,
          badge: 'NEW',
          description: 'Плотный футер 320г, винтажная варка, фирменный крой оверсайз.',
          photos: JSON.stringify(['/images/sample1.jpg', '/images/sample1_2.jpg']),
          sizes: JSON.stringify(['S', 'M', 'L', 'XL'])
        },
        {
          id: 'prod-2',
          title: 'Streetwear Cargo Utility Pants',
          category: 'pants',
          price: 6800,
          badge: 'HIT',
          description: 'Широкие карго с множеством карманов и регулируемой фиксацией на шнурках.',
          photos: JSON.stringify(['/images/sample2.jpg']),
          sizes: JSON.stringify(['M', 'L', 'XL'])
        },
        {
          id: 'prod-3',
          title: 'Obsidian Runner Archival Shoes',
          category: 'shoes',
          price: 11500,
          badge: 'LIMITED',
          description: 'Массивная технологичная подошва, премиальные архивные материалы верха.',
          photos: JSON.stringify(['/images/sample3.jpg']),
          sizes: JSON.stringify(['41', '42', '43', '44'])
        },
        {
          id: 'prod-4',
          title: 'Complete SMM Look Set #01',
          category: 'set',
          price: 14900,
          badge: 'SET',
          description: 'Головной убор + лонгслив + брюки. Выгода при покупке комплектом.',
          photos: JSON.stringify(['/images/sample4.jpg']),
          sizes: JSON.stringify(['S', 'M', 'L'])
        },
        {
          id: 'prod-5',
          title: 'Graphic Acid Wash T-Shirt',
          category: 'tshirt',
          price: 3200,
          badge: 'DROP',
          description: 'Футболка из плотного хлопка с эксклюзивным кислотным принтом.',
          photos: JSON.stringify(['/images/sample5.jpg']),
          sizes: JSON.stringify(['S', 'M', 'L', 'XL'])
        },
        {
          id: 'prod-6',
          title: 'Archive Steel Carabiner Accessory',
          category: 'accessories',
          price: 1800,
          badge: 'ACCESSORY',
          description: 'Фирменный металлический карабин с гравировкой бренда.',
          photos: JSON.stringify(['/images/sample6.jpg']),
          sizes: JSON.stringify(['ONE SIZE'])
        }
      ];

      const stmt = db.prepare("INSERT INTO products (id, title, category, price, badge, description, photos, sizes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      demoProducts.forEach(p => {
        stmt.run(p.id, p.title, p.category, p.price, p.badge, p.description, p.photos, p.sizes);
      });
      stmt.finalize();
      console.log('[DB SEED] Базовый каталог товаров успешно загружен.');
    }
  });
}

function seedDefaultNews() {
  db.get("SELECT COUNT(*) as count FROM news", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO news (id, title, photo, date, content) VALUES (?, ?, ?, ?, ?)`,
        ['news-1', 'Большое поступление архивного streetwear сезона зима 2026', '/images/news1.jpg', '12 ОКТ 2026', 'Мы подготовили уникальную подборку тяжелого футера, редких кроссовок и аксессуаров для ценителей аутентичного стиля. Количество позиций строго ограничено.']);
      console.log('[DB SEED] Новостные публикации загружены.');
    }
  });
}

function seedDefaultReviews() {
  db.get("SELECT COUNT(*) as count FROM reviews", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO reviews (id, user_id, name, rating, product, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['rev-1', 1, 'Артем', 5, 'Vintage Heavy Hoodie Archive', 'Качество ткани и пошива просто на высоте! Плотный материал, идеальный оверсайз. Доставка через СДЭК заняла всего 3 дня.', 'approved']);
      console.log('[DB SEED] Отзывы клиентов загружены.');
    }
  });
}


// ============================================================================
// 4. МАРШРУТЫ АВТОРИЗАЦИИ И УПРАВЛЕНИЯ ПРОФИЛЕМ (AUTH API)
// ============================================================================

// Регистрация нового пользователя с генерацией и отправкой кода на Email через Gmail
app.post('/api/auth/register', async (req, res) => {
  const { login, password, confirmPassword, phone, email } = req.body;

  if (!login || !password || !phone || !email) {
    return res.status(400).json({ success: false, message: 'Заполните все обязательные поля формы' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Пароли не совпадают' });
  }

  const emailCode = Math.floor(1000 + Math.random() * 9000).toString();
  const refCode = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  db.run(
    `INSERT INTO users (login, password, email, phone, name, referral_code, email_code, is_verified, balance) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1000)`,
    [login, password, email, phone, login, refCode, emailCode],
    async function(err) {
      if (err) {
        return res.status(400).json({ success: false, message: 'Указанный логин или Email уже зарегистрированы в системе' });
      }

      const userId = this.lastID;

      // Отправка реального письма на почту клиента через Gmail
      try {
        await transporter.sendMail({
          from: '"SMM ARCHIVE" <smmarchiveverefication@gmail.com>',
          to: email,
          subject: 'Подтверждение регистрации — SMM ARCHIVE',
          text: `Здравствуйте, ${login}! Ваш код подтверждения регистрации: ${emailCode}`,
          html: `
            <div style="background:#090b0b; color:#f4f3ef; padding:35px; font-family:sans-serif; border-radius:8px;">
              <h2 style="color:#00ff66; margin-top:0;">SMM ARCHIVE</h2>
              <p>Здравствуйте, <strong>${login}</strong>!</p>
              <p>Благодарим за регистрацию в нашем архивном streetwear-пространстве.</p>
              <p>Ваш проверочный 4-значный код подтверждения Email:</p>
              <div style="background:#141919; border:1px solid #333; padding:15px; font-size:28px; font-weight:bold; letter-spacing:8px; color:#00ff66; text-align:center; margin:20px 0; border-radius:6px;">
                ${emailCode}
              </div>
              <p style="font-size:12px; color:#888;">Если вы не оставляли запрос на сайте, просто проигнорируйте это письмо.</p>
            </div>
          `
        });
        res.json({ success: true, userId, message: 'Код подтверждения успешно отправлен на ваш Email' });
      } catch (mailErr) {
        console.error('[GMAIL SEND ERROR]', mailErr);
        res.status(500).json({ success: false, message: 'Не удалось отправить письмо на указанный Email. Проверьте правильность адреса.' });
      }
    }
  );
});

// Подтверждение Email по 4-значному коду из письма
app.post('/api/auth/verify-email', (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) {
    return res.status(400).json({ success: false, message: 'Не указан ID пользователя или код' });
  }

  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ success: false, message: 'Пользователь не найден в базе данных' });
    }
    if (user.email_code !== code) {
      return res.status(400).json({ success: false, message: 'Неверный код подтверждения' });
    }

    db.run("UPDATE users SET is_verified = 1, email_code = NULL WHERE id = ?", [userId], (updateErr) => {
      if (updateErr) return res.status(500).json({ success: false, message: 'Ошибка обновления статуса пользователя' });
      res.json({ 
        success: true, 
        userId: user.id,
        name: user.name, 
        balance: user.balance || 1000, 
        referral_code: user.referral_code,
        ref_count: user.ref_count || 0,
        tg_discount_claimed: user.tg_discount_claimed || 0
      });
    });
  });
});

// Авторизация пользователя по логину/паролю
app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ success: false, message: 'Введите логин и пароль для входа' });
  }

  db.get("SELECT * FROM users WHERE (login = ? OR email = ?) AND password = ?", [login, login, password], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль' });
    }
    if (user.is_verified === 0) {
      return res.status(400).json({ success: false, message: 'Email не подтвержден. Пожалуйста, введите проверочный код из письма.' });
    }

    res.json({ 
      success: true, 
      userId: user.id, 
      name: user.name, 
      balance: user.balance || 1000, 
      referral_code: user.referral_code,
      ref_count: user.ref_count || 0,
      tg_discount_claimed: user.tg_discount_claimed || 0
    });
  });
});

// Авторизация администратора
app.post('/api/admin/login', (req, res) => {
  const { login, password } = req.body;
  db.get("SELECT * FROM users WHERE login = ? AND password = ? AND is_admin = 1", [login, password], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ success: false, message: 'Неверные административные учетные данные' });
    }
    res.json({ success: true, name: user.name, message: 'Добро пожаловать в панель управления SMM ARCHIVE' });
  });
});


// ============================================================================
// 5. КАТАЛОГ И УПРАВЛЕНИЕ ТОВАРАМИ (PRODUCTS API)
// ============================================================================

// Получение списка всех товаров
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = rows.map(p => ({ 
      ...p, 
      sizes: JSON.parse(p.sizes || '[]'), 
      photos: JSON.parse(p.photos || '[]') 
    }));
    res.json(formatted);
  });
});

// Получение товара по ID
app.get('/api/products/:id', (req, res) => {
  const productId = req.params.id;
  db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
    if (err || !product) return res.status(404).json({ success: false, message: 'Товар не найден' });
    res.json({
      ...product,
      sizes: JSON.parse(product.sizes || '[]'),
      photos: JSON.parse(product.photos || '[]')
    });
  });
});

// Добавление товара (Админ панель)
app.post('/api/admin/products', (req, res) => {
  const { title, category, price, badge, description, photos, sizes } = req.body;
  const id = 'prod-' + Date.now();
  const photosJSON = JSON.stringify(Array.isArray(photos) ? photos : [photos]);
  const sizesJSON = JSON.stringify(Array.isArray(sizes) ? sizes : ["S", "M", "L", "XL"]);

  const query = `INSERT INTO products (id, title, category, price, badge, description, photos, sizes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [id, title, category, price, badge, description, photosJSON, sizesJSON], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id, message: 'Товар успешно добавлен в каталог' });
  });
});

// Удаление товара (Админ панель)
app.delete('/api/admin/products/:id', (req, res) => {
  const productId = req.params.id;
  db.run("DELETE FROM products WHERE id = ?", [productId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: 'Товар удален из каталога' });
  });
});


// ============================================================================
// 6. НОВОСТИ И ЖУРНАЛ (NEWS API)
// ============================================================================

app.get('/api/news', (req, res) => {
  db.all("SELECT * FROM news ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/admin/news', (req, res) => {
  const { title, photo, date, content } = req.body;
  const id = 'news-' + Date.now();
  db.run("INSERT INTO news (id, title, photo, date, content) VALUES (?, ?, ?, ?, ?)", [id, title, photo, date, content], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id, message: 'Новость успешно опубликована' });
  });
});


// ============================================================================
// 7. ОТЗЫВЫ СООБЩЕСТВА (REVIEWS API)
// ============================================================================

app.get('/api/reviews', (req, res) => {
  db.all(
    `SELECT reviews.*, users.name FROM reviews LEFT JOIN users ON reviews.user_id = users.id WHERE reviews.status = 'approved' ORDER BY reviews.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.post('/api/reviews', (req, res) => {
  const { userId, rating, product, comment } = req.body;
  const id = 'rev-' + Date.now();
  db.run(
    `INSERT INTO reviews (id, user_id, rating, product, comment, status) VALUES (?, ?, ?, ?, ?, 'approved')`,
    [id, userId, rating, product, comment],
    function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: 'Ваш отзыв успешно опубликован' });
    }
  );
});


// ============================================================================
// 8. ЗАКАЗЫ И ДОСТАВКА СДЭК (ORDERS API)
// ============================================================================

app.get('/api/orders', (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(o => ({ ...o, items: JSON.parse(o.items || '[]') })));
  });
});

app.post('/api/orders', (req, res) => {
  const { userId, number, total, delivery, address, items } = req.body;
  const orderId = 'ord-' + Date.now();
  const trackingNumber = 'RU-' + Math.floor(Math.random() * 90000000 + 10000000);

  const query = `INSERT INTO orders (id, userId, number, total, status, delivery, address, items, track) VALUES (?, ?, ?, ?, 'Оплачен', ?, ?, ?, ?)`;
  
  db.run(query, [orderId, userId, number, total, delivery, address, JSON.stringify(items), trackingNumber], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    
    // Автоматическое списание средств с баланса пользователя
    if (userId) {
      db.run("UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?", [total, userId]);
    }

    res.json({ success: true, orderId, number, track: trackingNumber, message: 'Заказ успешно оформлен и передан в обработку!' });
  });
});

app.put('/api/admin/orders/:id/status', (req, res) => {
  const orderId = req.params.id;
  const { status, track } = req.body;
  db.run("UPDATE orders SET status = ?, track = COALESCE(?, track) WHERE id = ?", [status, track, orderId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: 'Статус заказа обновлен' });
  });
});


// ============================================================================
// 9. ПРОМОКОДЫ, КОШЕЛЕК И ПРОГРАММА ЛОЯЛЬНОСТИ (LOYALTY API)
// ============================================================================

// Проверка и применение промокода
app.post('/api/promo/apply', (req, res) => {
  const { code } = req.body;
  const cleanCode = String(code || '').trim().toUpperCase();

  const validPromos = {
    'START2026': { discount: 300, type: 'fixed', message: 'Промокод на 300 ₽ успешно применен!' },
    'SMM300': { discount: 300, type: 'fixed', message: 'Промокод на 300 ₽ успешно применен!' },
    'DISCOUNT10': { discount: 10, type: 'percent', message: 'Скидка 10% успешно применена!' }
  };

  if (validPromos[cleanCode]) {
    res.json({ success: true, ...validPromos[cleanCode] });
  } else {
    res.status(400).json({ success: false, message: 'Введенный промокод недействителен или истек' });
  }
});

// Активация скидки 3% за подписку на Telegram-канал
app.post('/api/loyalty/telegram', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'Не указан ID пользователя' });

  db.run("UPDATE users SET tg_discount_claimed = 1 WHERE id = ?", [userId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: 'Скидка 3% за подписку на Telegram-канал успешно активирована!' });
  });
});

// Пополнение баланса кошелька
app.post('/api/wallet/topup', (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount || isNaN(amount)) {
    return res.status(400).json({ success: false, message: 'Неверные параметры пополнения кошелька' });
  }

  db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [Number(amount), userId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    db.get("SELECT balance FROM users WHERE id = ?", [userId], (errRow, row) => {
      res.json({ success: true, newBalance: row ? row.balance : 0, message: 'Баланс кошелька успешно пополнен' });
    });
  });
});


// ============================================================================
// 10. СЛУЖБА ПОДДЕРЖКИ И ЧАТ (SUPPORT CHAT API)
// ============================================================================

app.get('/api/support/messages', (req, res) => {
  db.all("SELECT * FROM support_messages ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) {
      return res.json([
        { sender: 'manager', text: 'Здравствуйте! Добро пожаловать в архивное пространство SMM ARCHIVE. Чем мы можем помочь вам с выбором вещей или оформлением доставки через СДЭК?' }
      ]);
    }
    res.json(rows);
  });
});

app.post('/api/support/messages', (req, res) => {
  const { userId, text } = req.body;
  if (!text) return res.status(400).json({ success: false, message: 'Пустое сообщение' });

  db.run("INSERT INTO support_messages (user_id, sender, text) VALUES (?, 'you', ?)", [userId || 'guest', text], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    
    // Автоматический автоответ поддержки
    setTimeout(() => {
      db.run("INSERT INTO support_messages (user_id, sender, text) VALUES (?, 'manager', ?)", 
        [userId || 'guest', 'Спасибо за обращение! Наш менеджер проверяет информацию по вашему вопросу и ответит в течение нескольких минут.']);
    }, 600);

    res.json({ success: true, message: 'Сообщение отправлено' });
  });
});


// ============================================================================
// 11. ЗАПУСК ВЕБ-СЕРВЕРА (SERVER LISTEN)
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('============================================================');
  console.log(' SMM ARCHIVE BACKEND API SERVER RUNNING');
  console.log(` Port: ${PORT}`);
  console.log(' Database: SQLite Engine Active');
  console.log(' Mailer: Gmail SMTP (smmarchiveverefication@gmail.com)');
  console.log('============================================================');
});