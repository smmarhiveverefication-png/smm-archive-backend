/**
 * ============================================================================
 * SMM ARCHIVE — OFFICIAL PRODUCTION MASTER SERVER (SERVER.JS)
 * Express / PostgreSQL (Supabase) / Resend / Telegram Bot / YooMoney API
 * ============================================================================
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Resend } = require('resend');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'smmarchive_ultra_secure_jwt_key_2026';

// ЮMoney Настройки (Замените на ваши реальные данные или переменные окружения)
const YOOMONEY_SHOP_ID = process.env.YOOMONEY_SHOP_ID || 'YOUR_SHOP_ID';
const YOOMONEY_SECRET_KEY = process.env.YOOMONEY_SECRET_KEY || 'YOUR_SECRET_KEY';

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors({
  origin: ['https://www.smmarchive.store', 'https://smmarchive.store', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('SMM Archive Official Store Engine is active and running.');
});

// Resend Email API
const resend = new Resend('re_ATyU1DR1_2RaQZNx7KoMJuoMWPtebds');

// Telegram Bot API
const TELEGRAM_BOT_TOKEN = '8787531145:AAEGO7IRwWQrT_EJvvhF5nzImWAnpYMa0g4';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409 Conflict')) return;
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  if (text.startsWith('/start')) {
    bot.sendMessage(chatId, '🖤 Добро пожаловать в SMM ARCHIVE!\n\nВведите ваш 6-значный код привязки с сайта в личной кабинете.');
    return;
  }

  if (/^\d{6}$/.test(text)) {
    try {
      const userCheck = await db.query('SELECT * FROM users WHERE tg_code = $1', [text]);
      if (userCheck.rows.length > 0) {
        await db.query('UPDATE users SET tg_id = $1, is_tg_verified = 1, tg_code = NULL WHERE tg_code = $2', [chatId.toString(), text]);
        bot.sendMessage(chatId, '✅ Ваш Telegram успешно привязан к профилю SMM ARCHIVE!');
      } else {
        bot.sendMessage(chatId, '❌ Неверный или устаревший код привязки.');
      }
    } catch (err) {
      console.error('[TG BOT ERROR]', err);
      bot.sendMessage(chatId, '⚠️ Ошибка сервера при привязке.');
    }
  }
});

// Автосоздание Администраторов при старте сервера
async function seedAdmins() {
  const admins = [
    { login: 'Fedotov2209', pass: 'S22092009', email: 'alexgoost135809@gmail.com', name: 'Fedotov' },
    { login: 'Butilkin1906', pass: 'M19072009', email: 'juicy.789pbz@gmail.com', name: 'Butilkin' },
    { login: 'Sereda1703', pass: 'M17032009', email: 'markussereda123@gmail.com', name: 'Sereda' }
  ];

  for (const adm of admins) {
    try {
      const checkRes = await db.query("SELECT * FROM users WHERE login = $1", [adm.login]);
      const hashedPassword = await bcrypt.hash(adm.pass, 10);

      if (checkRes.rows.length === 0) {
        const refCode = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        await db.query(
          `INSERT INTO users (login, password, email, phone, name, referral_code, is_verified, is_admin, balance) 
           VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 0)`,
          [adm.login, hashedPassword, adm.email, '+79990000000', adm.name, refCode]
        );
      } else {
        await db.query(`UPDATE users SET password = $1, is_admin = 1, is_verified = 1 WHERE login = $2`, [hashedPassword, adm.login]);
      }
    } catch (e) {
      console.error(`[ADMIN SEED ERROR] ${adm.login}:`, e.message);
    }
  }
}

// ==========================================
// АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  const { login, password, confirmPassword, phone, email } = req.body;
  if (!login || !password || !phone || !email) {
    return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Пароли не совпадают' });
  }

  const emailCode = Math.floor(1000 + Math.random() * 9000).toString();
  const refCode = 'REF-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const insertRes = await db.query(
      `INSERT INTO users (login, password, email, phone, name, referral_code, email_code, is_verified, balance) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0) RETURNING id`,
      [login, hashedPassword, email, phone, login, refCode, emailCode]
    );

    const userId = insertRes.rows[0].id;

    try {
      await resend.emails.send({
        from: 'SMM ARCHIVE <support@smmarchive.store>',
        to: [email],
        subject: 'Подтверждение регистрации — SMM ARCHIVE',
        html: `<div style="background:#10081c; color:#f3f0f7; padding:35px; border-radius:12px;"><h2 style="color:#c084fc;">SMM ARCHIVE</h2><p>Код подтверждения:</p><div style="font-size:28px; font-weight:bold; color:#c084fc; text-align:center; padding:15px; border:1px dashed #c084fc;">${emailCode}</div></div>`
      });
    } catch (mailErr) {
      console.error('[RESEND ERROR]', mailErr.message);
    }

    res.json({ success: true, userId, message: 'Код подтверждения отправлен на Email' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Логин или Email уже заняты в системе' });
  }
});

app.post('/api/auth/verify-email', async (req, res) => {
  const { userId, code } = req.body;
  try {
    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];

    if (!user || user.email_code !== code) {
      return res.status(400).json({ success: false, message: 'Неверный код подтверждения' });
    }

    await db.query("UPDATE users SET is_verified = 1, email_code = NULL WHERE id = $1", [userId]);
    const token = jwt.sign({ userId: user.id, login: user.login }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token, userId: user.id, name: user.name, balance: user.balance, referral_code: user.referral_code, is_admin: user.is_admin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const userRes = await db.query("SELECT * FROM users WHERE login = $1 OR email = $1", [login]);
    const user = userRes.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль' });
    }
    if (user.is_verified === 0 && user.is_admin !== 1) {
      return res.status(400).json({ success: false, message: 'Email не подтвержден кодом' });
    }

    const token = jwt.sign({ userId: user.id, login: user.login }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token, userId: user.id, name: user.name, balance: user.balance, referral_code: user.referral_code, is_admin: user.is_admin, is_tg_verified: user.is_tg_verified });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/auth/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Нет токена' });
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET);

    const userRes = await db.query("SELECT id, login, email, phone, name, balance, referral_code, is_admin, is_tg_verified FROM users WHERE id = $1", [decoded.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    res.json({ success: true, user: userRes.rows[0] });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Неверный токен' });
  }
});

app.post('/api/auth/generate-tg-code', async (req, res) => {
  let { userId } = req.body;
  const parsedId = parseInt(userId, 10);
  if (isNaN(parsedId)) return res.status(400).json({ success: false, message: 'Некорректный ID' });

  const tgCode = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await db.query("UPDATE users SET tg_code = $1 WHERE id = $2", [tgCode, parsedId]);
    res.json({ success: true, code: tgCode });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Ошибка генерации Telegram кода' });
  }
});

// ==========================================
// КАТАЛОГ, НОВОСТИ И ОТЗЫВЫ
// ==========================================

app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows.map(p => ({
      ...p,
      sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : (p.sizes || []),
      photos: typeof p.photos === 'string' ? JSON.parse(p.photos || '[]') : (p.photos || [])
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM news ORDER BY id DESC");
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const result = await db.query(`SELECT reviews.*, users.name FROM reviews LEFT JOIN users ON reviews.user_id = users.id ORDER BY reviews.id DESC`);
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ЗАКАЗЫ И ИНТЕГРАЦИЯ С ЮMONEY
// ==========================================

app.post('/api/orders', async (req, res) => {
  const { userId, number, total, delivery, address, items, paymentMethod } = req.body;
  const orderId = 'ord-' + Date.now();
  const trackingNumber = 'RU-' + Math.floor(Math.random() * 90000000 + 10000000);

  try {
    if (paymentMethod === 'yoomoney') {
      // Создание реального платежа через API ЮMoney
      // (В продакшене здесь вызывается YooKassa/YooMoney API для получения URL оплаты)
      const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=41001XXXXXXXXX&sum=${total}&quickpay-form=shop&targets=Заказ №${number}&label=${orderId}`;
      
      await db.query(
        `INSERT INTO orders (id, user_id, customer_name, phone, total, status, delivery, address, items, track) VALUES ($1, $2, $3, $4, $5, 'Ожидает оплаты', $6, $7, $8, $9)`,
        [orderId, userId || null, number, '', total, delivery, address, JSON.stringify(items), trackingNumber]
      );

      return res.json({ success: true, orderId, paymentUrl, message: 'Сгенерирована ссылка на оплату ЮMoney' });
    }

    // Оплата с баланса кошелька или при получении
    await db.query(
      `INSERT INTO orders (id, user_id, customer_name, phone, total, status, delivery, address, items, track) VALUES ($1, $2, $3, $4, $5, 'Оплачен', $6, $7, $8, $9)`,
      [orderId, userId || null, number, '', total, delivery, address, JSON.stringify(items), trackingNumber]
    );

    if (userId) {
      await db.query("UPDATE users SET balance = GREATEST(0, balance - $1) WHERE id = $2", [total, userId]);
    }

    res.json({ success: true, orderId, track: trackingNumber, message: 'Заказ успешно оформлен!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// АДМИН-ПАНЕЛЬ (Управление магазином)
// ==========================================

// Статистика магазина для администратора
app.get('/api/admin/stats', async (req, res) => {
  try {
    const usersCount = await db.query("SELECT COUNT(*) FROM users");
    const ordersCount = await db.query("SELECT COUNT(*) FROM orders");
    const revenueSum = await db.query("SELECT SUM(total) FROM orders WHERE status = 'Оплачен'");
    
    res.json({
      success: true,
      users: parseInt(usersCount.rows[0].count, 10),
      orders: parseInt(ordersCount.rows[0].count, 10),
      revenue: parseFloat(revenueSum.rows[0].sum || 0)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Публикация новости администратором
app.post('/api/admin/news', async (req, res) => {
  const { title, text, photo } = req.body;
  try {
    await db.query("INSERT INTO news (title, text, photo) VALUES ($1, $2, $3)", [title, text, photo || '']);
    res.json({ success: true, message: 'Новость успешно опубликована' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Добавление товара в каталог
app.post('/api/admin/products', async (req, res) => {
  const { title, category, price, description, photos, sizes, badge } = req.body;
  try {
    await db.query(
      `INSERT INTO products (title, category, price, description, photos, sizes, badge) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [title, category, price, description, JSON.stringify(photos || []), JSON.stringify(sizes || ['S', 'M', 'L', 'XL']), badge || '']
    );
    res.json({ success: true, message: 'Товар успешно добавлен в каталог' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Просмотр всех заказов администратором
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Изменение статуса заказа и трек-номера админом
app.put('/api/admin/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status, track } = req.body;
  try {
    await db.query("UPDATE orders SET status = COALESCE($1, status), track = COALESCE($2, track) WHERE id = $3", [status, track, id]);
    res.json({ success: true, message: 'Заказ успешно обновлен' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`SMM ARCHIVE PROD SERVER RUNNING ON PORT ${PORT}`);
  await seedAdmins();
});
