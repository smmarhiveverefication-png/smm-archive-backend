/**
 * ============================================================================
 * SMM ARCHIVE — MASTER BACKEND SERVER (SERVER.JS)
 * Express / PostgreSQL (Supabase) / Nodemailer Gmail & Telegram Bot Production API Engine
 * Архитектура: Reg.ru / Production Ready / Cloud Scale (With Forced CORS)
 * ============================================================================
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'smmarchive_secure_jwt_secret_key_2026';

// ============================================================================
// 1. ПРИНУДИТЕЛЬНЫЕ CORS ЗАГОЛОВКИ И МИДЛВЕРЫ
// ============================================================================
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
  origin: [
    'https://www.smmarchive.store',
    'https://smmarchive.store',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[HTTP INCOMING] [${timestamp}] ${req.method} — ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.send('SMM Archive Backend API is running successfully!');
});

// ============================================================================
// 2. НАСТРОЙКА ПОЧТОВОГО СЕРВЕРА GMAIL И TELEGRAM БОТА
// ============================================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'smmarhiveverefication@gmail.com',
    pass: 'tmjzibdmgkndlrwm'
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('[GMAIL ERROR] Ошибка инициализации почтового клиента:', error);
  } else {
    console.log('[GMAIL SUCCESS] Почтовый сервер успешно подключен и готов к рассылке.');
  }
});

// Инициализация Telegram бота для реальной привязки аккаунтов
const TELEGRAM_BOT_TOKEN = '8787531145:AAEGO7IRwWQrT_EJvvhF5nzImWAnpYMa0g4';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('polling_error', (error) => {
  console.error('[TELEGRAM POLLING ERROR]', error.code, error.message);
});

// Обработка сообщений в Telegram боте
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  if (text.startsWith('/start')) {
    bot.sendMessage(chatId, '🖤 Добро пожаловать в SMM ARCHIVE!\n\nВведите ваш 6-значный код подтверждения с сайта, чтобы привязать Telegram-аккаунт.');
    return;
  }

  // Если пользователь прислал 6-значный код для привязки
  if (/^\d{6}$/.test(text)) {
    try {
      const userCheck = await db.query('SELECT * FROM users WHERE tg_code = $1', [text]);
      if (userCheck.rows.length > 0) {
        await db.query('UPDATE users SET tg_id = $1, is_tg_verified = 1, tg_code = NULL WHERE tg_code = $2', [chatId, text]);
        bot.sendMessage(chatId, '✅ Аккаунт успешно привязан к SMM ARCHIVE!');
      } else {
        bot.sendMessage(chatId, '❌ Неверный или устаревший код подтверждения.');
      }
    } catch (err) {
      console.error('[TELEGRAM BOT DB ERROR]', err);
      bot.sendMessage(chatId, '⚠️ Произошла ошибка на сервере при привязке аккаунта.');
    }
  }
});

// ============================================================================
// 3. АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ АДМИНИСТРАТОРОВ (ADMIN SEEDER)
// ============================================================================
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
           VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 99999)`,
          [adm.login, hashedPassword, adm.email, '+79990000000', adm.name, refCode]
        );
        console.log(`[ADMIN SEED] Администратор ${adm.login} успешно создан.`);
      } else {
        await db.query(
          `UPDATE users SET password = $1, is_admin = 1, is_verified = 1 WHERE login = $2`,
          [hashedPassword, adm.login]
        );
        console.log(`[ADMIN SEED] Администратор ${adm.login} синхронизирован.`);
      }
    } catch (e) {
      console.error(`[ADMIN SEED ERROR] Ошибка инициализации ${adm.login}:`, e.message);
    }
  }
}

// ============================================================================
// 4. МАРШРУТЫ АВТОРИЗАЦИИ И УПРАВЛЕНИЯ ПРОФИЛЕМ (AUTH API) С УСИЛЕННЫМ ЛОГИРОВАНИЕМ
// ============================================================================

app.post('/api/auth/register', async (req, res) => {
  const { login, password, confirmPassword, phone, email } = req.body;

  if (!login || !password || !phone || !email) {
    return res.status(400).json({ success: false, message: 'Заполните все обязательные поля формы регистрации' });
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

    // УСИЛЕННАЯ ПОПЫТКА ОТПРАВКИ ПОЧТЫ С ФОЛБЭКОМ В ЛОГИ
    let mailSentStatus = true;
    try {
      await transporter.sendMail({
        from: '"SMM ARCHIVE" <smmarchiveverefication@gmail.com>',
        to: email,
        subject: 'Подтверждение регистрации — SMM ARCHIVE',
        text: `Здравствуйте, ${login}! Ваш код подтверждения регистрации: ${emailCode}`,
        html: `
          <div style="background:#10081c; color:#f3f0f7; padding:35px; font-family:sans-serif; border-radius:12px; border:1px solid rgba(192,132,252,0.2);">
            <h2 style="color:#c084fc; margin-top:0;">SMM ARCHIVE</h2>
            <p>Здравствуйте, <strong>${login}</strong>!</p>
            <p>Ваш проверочный 4-значный код подтверждения Email:</p>
            <div style="background:#160a28; border:1px dashed #c084fc; padding:15px; font-size:28px; font-weight:bold; letter-spacing:8px; color:#c084fc; text-align:center; margin:20px 0; border-radius:8px;">
              ${emailCode}
            </div>
          </div>
        `
      });
      console.log(`[GMAIL SUCCESS] Письмо с кодом ${emailCode} успешно отправлено на ${email}`);
    } catch (mailErr) {
      mailSentStatus = false;
      console.error('[GMAIL SEND ERROR — ОШИБКА SMTP]', mailErr.message);
      console.log(`\n========================================`);
      console.log(`[РЕЖИМ ОТЛАДКИ / КОД ДЛЯ ${email}]: ${emailCode}`);
      console.log(`========================================\n`);
    }

    res.json({ 
      success: true, 
      userId, 
      debugCode: mailSentStatus ? undefined : emailCode, // Возвращаем в ответе для удобства, если SMTP заблокирован
      message: mailSentStatus ? 'Код подтверждения успешно отправлен на ваш Email' : 'Письмо заблокировано SMTP, но аккаунт создан. Проверьте консоль сервера.' 
    });
  } catch (err) {
    console.error('[REGISTRATION ERROR]', err);
    return res.status(400).json({ success: false, message: 'Указанный логин или Email уже зарегистрированы в системе' });
  }
});

app.post('/api/auth/verify-email', async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) {
    return res.status(400).json({ success: false, message: 'Не указан ID пользователя или код верификации' });
  }

  try {
    const userRes = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];

    if (!user || user.email_code !== code) {
      return res.status(400).json({ success: false, message: 'Введен неверный код подтверждения' });
    }

    await db.query("UPDATE users SET is_verified = 1, email_code = NULL WHERE id = $1", [userId]);
    const token = jwt.sign({ userId: user.id, login: user.login }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token,
      userId: user.id,
      name: user.name, 
      balance: user.balance || 0, 
      referral_code: user.referral_code,
      ref_count: user.ref_count || 0,
      tg_discount_claimed: user.tg_discount_claimed || 0,
      is_admin: user.is_admin || 0
    });
  } catch (err) {
    console.error('[VERIFY ERROR]', err);
    res.status(500).json({ success: false, message: 'Ошибка обновления статуса пользователя' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ success: false, message: 'Введите логин и пароль для входа в систему' });
  }

  try {
    const userRes = await db.query("SELECT * FROM users WHERE login = $1 OR email = $1", [login]);
    const user = userRes.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Неверный логин, email или пароль' });
    }

    if (user.is_verified === 0 && user.is_admin !== 1) {
      return res.status(400).json({ success: false, message: 'Email не подтвержден. Введите проверочный код из письма.' });
    }

    const token = jwt.sign({ userId: user.id, login: user.login, role: user.is_admin === 1 ? 'admin' : 'user' }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token,
      userId: user.id, 
      name: user.name, 
      balance: user.balance || 0, 
      referral_code: user.referral_code,
      ref_count: user.ref_count || 0,
      is_admin: user.is_admin,
      tg_discount_claimed: user.tg_discount_claimed || 0
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Введите Email адрес' });
  }

  try {
    const userRes = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = userRes.rows[0];

    if (user) {
      const resetCode = Math.floor(1000 + Math.random() * 9000).toString();
      await db.query("UPDATE users SET email_code = $1 WHERE id = $2", [resetCode, user.id]);

      try {
        await transporter.sendMail({
          from: '"SMM ARCHIVE" <smmarchiveverefication@gmail.com>',
          to: email,
          subject: 'Восстановление пароля — SMM ARCHIVE',
          text: `Ваш код для сброса пароля: ${resetCode}`,
          html: `
            <div style="background:#10081c; color:#f3f0f7; padding:35px; font-family:sans-serif; border-radius:12px; border:1px solid rgba(192,132,252,0.2);">
              <h2 style="color:#c084fc; margin-top:0;">SMM ARCHIVE</h2>
              <p>Ваш проверочный 4-значный код для сброса пароля:</p>
              <div style="background:#160a28; border:1px dashed #c084fc; padding:15px; font-size:28px; font-weight:bold; letter-spacing:8px; color:#c084fc; text-align:center; margin:20px 0; border-radius:8px;">
                ${resetCode}
              </div>
            </div>
          `
        });
      } catch (mailErr) {
        console.error('[FORGOT MAIL ERROR]', mailErr.message);
        console.log(`[ДЕБАГ СБРОСА ПАРОЛЯ ДЛЯ ${email}]: ${resetCode}`);
      }
    }

    res.json({ success: true, message: 'Если такой Email зарегистрирован, на него отправлен код сброса.' });
  } catch (err) {
    console.error('[FORGOT PASSWORD ERROR]', err);
    res.status(500).json({ success: false, message: 'Ошибка отправки письма с кодом' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword, confirmPassword } = req.body;
  if (!email || !code || !newPassword || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'Заполните все поля' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Новые пароли не совпадают' });
  }

  try {
    const userRes = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = userRes.rows[0];

    if (!user || user.email_code !== code) {
      return res.status(400).json({ success: false, message: 'Введен неверный код или истек срок его действия' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = $1, email_code = NULL WHERE id = $2", [hashedPassword, user.id]);

    res.json({ success: true, message: 'Пароль успешно изменен. Теперь вы можете войти.' });
  } catch (err) {
    console.error('[RESET PASSWORD ERROR]', err);
    res.status(500).json({ success: false, message: 'Ошибка сброса пароля на сервере' });
  }
});

// ============================================================================
// 5. TELEGRAM INTEGRATION API (Генерация кода для привязки Telegram)
// ============================================================================
app.post('/api/auth/generate-tg-code', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Не указан ID пользователя' });
  }

  const tgCode = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    await db.query("UPDATE users SET tg_code = $1 WHERE id = $2", [tgCode, userId]);
    res.json({ 
      success: true, 
      code: tgCode, 
      botUsername: 'smmarchive_bot',
      message: 'Код сгенерирован. Отправьте его нашему Telegram-боту.' 
    });
  } catch (err) {
    console.error('[GENERATE TG CODE ERROR]', err);
    res.status(500).json({ success: false, message: 'Ошибка генерации Telegram кода' });
  }
});

// ============================================================================
// 6. КАТАЛОГ И ТОВАРЫ (PRODUCTS API)
// ============================================================================
app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products ORDER BY created_at DESC");
    const formatted = result.rows.map(p => ({ 
      ...p, 
      sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : (p.sizes || []), 
      photos: typeof p.photos === 'string' ? JSON.parse(p.photos || '[]') : (p.photos || []) 
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 7. НОВОСТИ И ОТЗЫВЫ (NEWS & REVIEWS API)
// ============================================================================
app.get('/api/news', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM news ORDER BY created_at DESC");
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const result = await db.query(`SELECT reviews.*, users.name FROM reviews LEFT JOIN users ON reviews.user_id = users.id WHERE reviews.status = 'approved' ORDER BY reviews.created_at DESC`);
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 8. ЗАКАЗЫ И ДОСТАВКА (ORDERS API)
// ============================================================================
app.post('/api/orders', async (req, res) => {
  const { userId, number, total, delivery, address, items } = req.body;
  const orderId = 'ord-' + Date.now();
  const trackingNumber = 'RU-' + Math.floor(Math.random() * 90000000 + 10000000);

  try {
    await db.query(`INSERT INTO orders (id, userId, number, total, status, delivery, address, items, track) VALUES ($1, $2, $3, $4, 'Оплачен', $5, $6, $7, $8)`,
      [orderId, userId, number, total, delivery, address, JSON.stringify(items), trackingNumber]);
    
    if (userId) {
      await db.query("UPDATE users SET balance = GREATEST(0, balance - $1) WHERE id = $2", [total, userId]);
    }

    res.json({ success: true, orderId, number, track: trackingNumber, message: 'Заказ успешно оформлен!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 9. СЛУЖБА ПОДДЕРЖКИ (SUPPORT API)
// ============================================================================
app.get('/api/support/messages', async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM support_messages ORDER BY id ASC");
    if (result.rows.length === 0) {
      return res.json([{ sender: 'manager', text: 'Здравствуйте! Добро пожаловать в SMM ARCHIVE.' }]);
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/support/messages', async (req, res) => {
  const { userId, text } = req.body;
  if (!text) return res.status(400).json({ success: false, message: 'Пустое сообщение' });

  try {
    await db.query("INSERT INTO support_messages (user_id, sender, text) VALUES ($1, 'you', $2)", [userId || 'guest', text]);
    res.json({ success: true, message: 'Сообщение отправлено' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 10. ЗАПУСК СЕРВЕРА
// ============================================================================
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`SMM ARCHIVE BACKEND RUNNING ON PORT ${PORT}`);
  await seedAdmins();
});
