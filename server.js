'use strict';
// SMM ARCHIVE — backend. Все секреты только из переменных окружения (см. .env.example).
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');

const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) { console.error('JWT_SECRET (минимум 32 символа) не задан'); process.exit(1); }
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://smmarchive.store,https://www.smmarchive.store').split(',').map(s => s.trim());
const MAIL_FROM = process.env.MAIL_FROM || 'SMM ARCHIVE <support@smmarchive.store>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const PAID = ['Оплачен', 'Собирается', 'Отправлен', 'Доставлен'];
const STATUSES = ['Ожидает оплаты', ...PAID, 'Отменён'];
const DELIVERIES = ['Почта России', 'СДЭК', 'Яндекс Доставка', 'DPD'];

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: (o, cb) => cb(null, !o || ORIGINS.includes(o)) }));
app.use(express.json({ limit: '8mb' }));

// ---------- утилиты ----------
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const httpErr = (status, message) => Object.assign(new Error(message), { status, expose: true });
const toId = v => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const hashCode = c => crypto.createHash('sha256').update(c + JWT_SECRET).digest('hex');

const hits = new Map();
const limit = (name, max, ms) => (req, res, next) => {
  const k = name + ':' + req.ip, now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < ms);
  if (h.length >= max) return fail(res, 429, 'Слишком много попыток. Попробуйте позже.');
  h.push(now); hits.set(k, h); next();
};
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < 3600000)) hits.delete(k); }, 600000).unref();

async function tx(fn) {
  const c = await db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

const pub = u => ({ id: u.id, userId: u.id, login: u.login, name: u.name || u.login, email: u.email, phone: u.phone,
  balance: u.balance, referral_code: u.referral_code, is_admin: u.is_admin, is_tg_verified: u.is_tg_verified });
const sign = u => jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '7d' });

const auth = ah(async (req, res, next) => {
  let p;
  try { p = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), JWT_SECRET); }
  catch { return fail(res, 401, 'Требуется вход'); }
  const r = await db.query('SELECT * FROM users WHERE id = $1 AND is_verified = 1', [p.uid]);
  if (!r.rows[0]) return fail(res, 401, 'Пользователь не найден');
  req.user = r.rows[0]; next();
});
const admin = [auth, (req, res, next) => (req.user.is_admin === 1 ? next() : fail(res, 403, 'Нет доступа'))];

// ---------- почта и Telegram ----------
async function issueCode(user, subject, title) {
  const code = String(crypto.randomInt(100000, 1000000));
  await db.query(`UPDATE users SET email_code = $1, email_code_expires = now() + interval '15 minutes', email_attempts = 0 WHERE id = $2`, [hashCode(code), user.id]);
  if (!resend) throw new Error('RESEND_API_KEY не задан');
  const r = await resend.emails.send({ from: MAIL_FROM, to: [user.email], subject,
    html: `<div style="font-family:Arial,sans-serif;background:#10081c;color:#f3f0f7;padding:32px;border-radius:12px"><h2 style="color:#c084fc;margin:0 0 12px">SMM ARCHIVE</h2><p>${title}</p><div style="font-size:30px;font-weight:bold;letter-spacing:6px;color:#c084fc;text-align:center;padding:14px;border:1px dashed #c084fc">${code}</div><p style="color:#b4a5c9;font-size:12px">Код действует 15 минут. Если вы не запрашивали его, просто проигнорируйте письмо.</p></div>` });
  if (r.error) throw new Error(r.error.message);
}
async function checkCode(email, code) {
  const u = (await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [str(email, 254)])).rows[0];
  if (!u || !u.email_code || !u.email_code_expires || new Date(u.email_code_expires) < new Date()) return { error: 'Код недействителен или истёк' };
  if (u.email_attempts >= 5) return { error: 'Слишком много попыток. Запросите новый код.' };
  if (u.email_code !== hashCode(str(code, 12))) { await db.query('UPDATE users SET email_attempts = email_attempts + 1 WHERE id = $1', [u.id]); return { error: 'Неверный код' }; }
  return { user: u };
}

let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  bot.on('polling_error', e => console.error('[TG polling]', e.code, e.message));
  bot.on('message', async msg => {
    try {
      const text = (msg.text || '').trim();
      if (text.startsWith('/start')) return void bot.sendMessage(msg.chat.id, 'Добро пожаловать в SMM ARCHIVE! Отправьте 6-значный код привязки из личного кабинета на сайте.');
      if (!/^\d{6}$/.test(text)) return;
      const r = await db.query(`UPDATE users SET tg_id = $1, is_tg_verified = 1, tg_code = NULL, tg_code_expires = NULL WHERE tg_code = $2 AND tg_code_expires > now() RETURNING id`, [String(msg.chat.id), text]);
      bot.sendMessage(msg.chat.id, r.rows[0] ? 'Telegram привязан к вашему профилю SMM ARCHIVE.' : 'Неверный или устаревший код привязки.');
    } catch (e) { console.error('[TG]', e.message); }
  });
}
const notify = async (tgId, text) => { if (bot && tgId) try { await bot.sendMessage(tgId, text); } catch (e) { console.error('[TG send]', e.message); } };
const notifyAdmins = async text => { try { for (const a of (await db.query(`SELECT tg_id FROM users WHERE is_admin = 1 AND tg_id IS NOT NULL`)).rows) await notify(a.tg_id, text); } catch (e) { console.error(e.message); } };

// ---------- служебное ----------
app.get('/', (req, res) => res.send('SMM ARCHIVE API'));
app.get('/api/health', ah(async (req, res) => { await db.query('SELECT 1'); res.json({ ok: true, db: true, mail: !!resend, telegram: !!bot }); }));

// ---------- авторизация ----------
app.post('/api/auth/register', limit('reg', 10, 3600e3), ah(async (req, res) => {
  const b = req.body || {}, login = str(b.login, 32), email = str(b.email, 254).toLowerCase(), password = String(b.password || '');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(login)) return fail(res, 400, 'Логин: 3–32 символа, латиница, цифры, _ . -');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Некорректный email');
  if (password.length < 8 || password.length > 72) return fail(res, 400, 'Пароль: от 8 до 72 символов');
  if (b.confirmPassword !== undefined && b.confirmPassword !== password) return fail(res, 400, 'Пароли не совпадают');
  const ex = (await db.query('SELECT id, is_verified FROM users WHERE lower(login) = lower($1) OR lower(email) = $2', [login, email])).rows;
  if (ex.some(u => u.is_verified === 1)) return fail(res, 409, 'Логин или email уже заняты');
  if (ex.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [ex.map(u => u.id)]); // недоверифицированные хвосты
  const u = (await db.query('INSERT INTO users (login, password_hash, email, phone, name, referral_code) VALUES ($1, $2, $3, $4, $1, $5) RETURNING *',
    [login, await bcrypt.hash(password, 10), email, str(b.phone, 32), 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase()])).rows[0];
  try { await issueCode(u, 'Подтверждение регистрации — SMM ARCHIVE', 'Код подтверждения email:'); }
  catch (e) { console.error('[MAIL]', e.message); await db.query('DELETE FROM users WHERE id = $1', [u.id]); return fail(res, 502, 'Не удалось отправить письмо с кодом. Попробуйте позже.'); }
  res.json({ success: true, email, message: 'Код отправлен на почту' });
}));

app.post('/api/auth/resend-code', limit('resend', 5, 3600e3), ah(async (req, res) => {
  const u = (await db.query('SELECT * FROM users WHERE lower(email) = lower($1) AND is_verified = 0', [str(req.body.email, 254)])).rows[0];
  if (u) { try { await issueCode(u, 'Подтверждение регистрации — SMM ARCHIVE', 'Код подтверждения email:'); } catch (e) { console.error('[MAIL]', e.message); return fail(res, 502, 'Не удалось отправить письмо'); } }
  res.json({ success: true, message: 'Если аккаунт ожидает подтверждения, код отправлен' });
}));

app.post('/api/auth/verify-email', limit('verify', 20, 3600e3), ah(async (req, res) => {
  const c = await checkCode(req.body.email, req.body.code);
  if (c.error) return fail(res, 400, c.error);
  const u = (await db.query('UPDATE users SET is_verified = 1, email_code = NULL, email_code_expires = NULL WHERE id = $1 RETURNING *', [c.user.id])).rows[0];
  res.json({ success: true, token: sign(u), user: pub(u), ...pub(u) });
}));

app.post('/api/auth/login', limit('login', 20, 900e3), ah(async (req, res) => {
  const u = (await db.query('SELECT * FROM users WHERE lower(login) = lower($1) OR lower(email) = lower($1)', [str(req.body.login, 254)])).rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return fail(res, 401, 'Неверный логин или пароль');
  if (u.is_verified !== 1) return fail(res, 403, 'Email не подтверждён', { code: 'NOT_VERIFIED', email: u.email });
  res.json({ success: true, token: sign(u), user: pub(u), ...pub(u) });
}));

app.post('/api/auth/forgot-password', limit('forgot', 5, 3600e3), ah(async (req, res) => {
  const u = (await db.query('SELECT * FROM users WHERE lower(email) = lower($1) AND is_verified = 1', [str(req.body.email, 254)])).rows[0];
  if (u) { try { await issueCode(u, 'Сброс пароля — SMM ARCHIVE', 'Код для сброса пароля:'); } catch (e) { console.error('[MAIL]', e.message); return fail(res, 502, 'Не удалось отправить письмо'); } }
  res.json({ success: true, message: 'Если такой email зарегистрирован, код отправлен' });
}));

app.post('/api/auth/reset-password', limit('reset', 10, 3600e3), ah(async (req, res) => {
  const pw = String(req.body.newPassword || '');
  if (pw.length < 8 || pw.length > 72) return fail(res, 400, 'Пароль: от 8 до 72 символов');
  const c = await checkCode(req.body.email, req.body.code);
  if (c.error) return fail(res, 400, c.error);
  await db.query('UPDATE users SET password_hash = $1, email_code = NULL, email_code_expires = NULL WHERE id = $2', [await bcrypt.hash(pw, 10), c.user.id]);
  res.json({ success: true, message: 'Пароль изменён' });
}));

app.get('/api/auth/profile', auth, (req, res) => res.json({ success: true, user: pub(req.user) }));

app.post('/api/auth/generate-tg-code', auth, ah(async (req, res) => {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); }
  while ((await db.query('SELECT 1 FROM users WHERE tg_code = $1 AND tg_code_expires > now()', [code])).rows[0]);
  await db.query(`UPDATE users SET tg_code = $1, tg_code_expires = now() + interval '10 minutes' WHERE id = $2`, [code, req.user.id]);
  res.json({ success: true, code });
}));

// ---------- публичные данные ----------
app.get('/api/products', ah(async (req, res) => res.json((await db.query('SELECT id, title, category, price, badge, description, sizes, photos, created_at FROM products WHERE is_active ORDER BY id DESC')).rows)));
app.get('/api/news', ah(async (req, res) => res.json((await db.query('SELECT id, title, text, photo, created_at FROM news ORDER BY id DESC')).rows)));
app.get('/api/reviews', ah(async (req, res) => res.json((await db.query(`SELECT r.id, r.rating, r.comment, r.created_at, COALESCE(u.name, u.login) AS name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.status = 'approved' ORDER BY r.id DESC`)).rows)));

app.post('/api/reviews', auth, limit('review', 5, 3600e3), ah(async (req, res) => {
  const rating = parseInt(req.body.rating, 10), comment = str(req.body.comment, 1500);
  if (!(rating >= 1 && rating <= 5) || comment.length < 5) return fail(res, 400, 'Укажите оценку и текст отзыва (от 5 символов)');
  await db.query('INSERT INTO reviews (user_id, rating, comment) VALUES ($1, $2, $3)', [req.user.id, rating, comment]);
  res.json({ success: true, message: 'Спасибо! Отзыв появится после проверки администратором.' });
}));

async function calcPromo(q, code, subtotal, lock) {
  if (!code) return { discount: 0, code: null };
  const p = (await q.query(`SELECT * FROM promo_codes WHERE upper(code) = upper($1) AND is_active AND (max_uses IS NULL OR uses_count < max_uses) ${lock ? 'FOR UPDATE' : ''}`, [str(code, 40)])).rows[0];
  if (!p) throw httpErr(400, 'Промокод недействителен');
  const d = p.type === 'percent' ? Math.floor(subtotal * p.value / 100) : p.value;
  return { discount: Math.min(d, subtotal), code: p.code, id: p.id };
}
app.post('/api/promo/check', limit('promo', 30, 600e3), ah(async (req, res) => {
  const subtotal = parseInt(req.body.subtotal, 10) || 0, r = await calcPromo(db, req.body.code, subtotal, false);
  res.json({ success: true, code: r.code, discount: r.discount });
}));

// ---------- заказы ----------
app.post('/api/orders', auth, limit('order', 20, 3600e3), ah(async (req, res) => {
  const b = req.body || {}, name = str(b.name, 80), phone = str(b.phone, 32), address = str(b.address, 300), delivery = str(b.delivery, 40);
  const method = b.paymentMethod === 'balance' ? 'balance' : 'online';
  if (!name || !phone || !address || !DELIVERIES.includes(delivery)) return fail(res, 400, 'Заполните имя, телефон, службу доставки и адрес');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return fail(res, 400, 'Корзина пуста');
  const order = await tx(async c => {
    const ids = b.items.map(i => toId(i.id));
    if (ids.some(i => !i)) throw httpErr(400, 'Некорректный состав заказа');
    const prod = new Map((await c.query('SELECT id, title, price, sizes FROM products WHERE id = ANY($1) AND is_active', [ids])).rows.map(p => [p.id, p]));
    let subtotal = 0; const lines = [];
    for (const i of b.items) {
      const p = prod.get(toId(i.id)), q = parseInt(i.quantity, 10), size = str(i.size, 12);
      if (!p || !(q >= 1 && q <= 20)) throw httpErr(400, 'Товар недоступен или неверное количество');
      if (p.sizes.length && !p.sizes.includes(size)) throw httpErr(400, `Выберите размер: «${p.title}»`);
      subtotal += p.price * q; lines.push({ id: p.id, title: p.title, size, quantity: q, price: p.price });
    }
    const pr = await calcPromo(c, b.promoCode, subtotal, true), total = subtotal - pr.discount;
    if (pr.id) await c.query('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = $1', [pr.id]);
    let status = 'Ожидает оплаты', paid = 0;
    if (method === 'balance') {
      const bal = (await c.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0].balance;
      if (bal < total) throw httpErr(400, 'Недостаточно средств на балансе');
      await c.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [total, req.user.id]);
      status = 'Оплачен'; paid = total;
    }
    const o = (await c.query(`INSERT INTO orders (user_id, customer_name, phone, delivery, address, items, subtotal, discount, total, promo_code, payment_method, balance_paid, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, total, status`,
      [req.user.id, name, phone, delivery, address, JSON.stringify(lines), subtotal, pr.discount, total, pr.code, method, paid, status])).rows[0];
    if (paid) await c.query('INSERT INTO balance_log (user_id, amount, reason) VALUES ($1, $2, $3)', [req.user.id, -paid, `Оплата заказа #${o.id}`]);
    return o;
  });
  notifyAdmins(`Новый заказ #${order.id} на ${order.total} ₽ (${order.status})`);
  res.json({ success: true, order, message: method === 'online' ? 'Заказ создан. Онлайн-оплата пока не подключена: с вами свяжется администратор.' : 'Заказ оплачен с баланса.' });
}));
app.get('/api/orders/my', auth, ah(async (req, res) => res.json((await db.query('SELECT id, items, subtotal, discount, total, promo_code, delivery, address, status, track, created_at FROM orders WHERE user_id = $1 ORDER BY id DESC', [req.user.id])).rows)));

// ---------- поддержка ----------
app.get('/api/support', auth, ah(async (req, res) => res.json((await db.query('SELECT id, sender, text, created_at FROM support_messages WHERE user_id = $1 ORDER BY id', [req.user.id])).rows)));
app.post('/api/support', auth, limit('support', 30, 3600e3), ah(async (req, res) => {
  const text = str(req.body.text, 2000); if (!text) return fail(res, 400, 'Пустое сообщение');
  await db.query(`INSERT INTO support_messages (user_id, sender, text) VALUES ($1, 'user', $2)`, [req.user.id, text]);
  notifyAdmins(`Сообщение в поддержку от ${req.user.login}: ${text.slice(0, 200)}`);
  res.json({ success: true });
}));

// ---------- админка ----------
app.get('/api/admin/stats', ...admin, ah(async (req, res) => res.json({ success: true, ...(await db.query(`SELECT
  (SELECT count(*) FROM users WHERE is_verified = 1)::int AS users, (SELECT count(*) FROM orders)::int AS orders,
  (SELECT COALESCE(sum(total), 0) FROM orders WHERE status = ANY($1))::int AS revenue,
  (SELECT count(*) FROM orders WHERE status = 'Ожидает оплаты')::int AS unpaid_orders,
  (SELECT count(*) FROM reviews WHERE status = 'pending')::int AS pending_reviews`, [PAID])).rows[0] })));

app.get('/api/admin/users', ...admin, ah(async (req, res) => {
  const q = str(req.query.q, 80), params = []; let where = '';
  if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); where = `WHERE login ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1${/^\d{1,9}$/.test(q) ? ' OR id = ' + parseInt(q, 10) : ''}`; }
  res.json((await db.query(`SELECT id, login, email, phone, balance, is_admin, is_verified, is_tg_verified, created_at FROM users ${where} ORDER BY id DESC LIMIT 50`, params)).rows);
}));
app.post('/api/admin/users/:id/balance', ...admin, ah(async (req, res) => {
  const id = toId(req.params.id), amount = parseInt(req.body.amount, 10);
  if (!id || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) return fail(res, 400, 'Некорректная сумма');
  const u = await tx(async c => {
    const r = (await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING id, login, balance, tg_id', [amount, id])).rows[0];
    if (!r) { const e = (await c.query('SELECT 1 FROM users WHERE id = $1', [id])).rows[0]; throw httpErr(e ? 400 : 404, e ? 'Баланс не может стать отрицательным' : 'Клиент с таким ID не найден'); }
    await c.query('INSERT INTO balance_log (user_id, admin_id, amount, reason) VALUES ($1, $2, $3, $4)', [id, req.user.id, amount, str(req.body.reason, 200) || 'Изменение администратором']);
    return r;
  });
  notify(u.tg_id, `Баланс изменён на ${amount} ₽. Текущий баланс: ${u.balance} ₽`);
  res.json({ success: true, user: { id: u.id, login: u.login, balance: u.balance } });
}));

const prodFields = b => {
  const photos = Array.isArray(b.photos) ? b.photos.filter(p => typeof p === 'string').slice(0, 8) : undefined;
  const sizes = Array.isArray(b.sizes) ? b.sizes.map(s => str(s, 12)).filter(Boolean).slice(0, 20) : undefined;
  const price = b.price === undefined ? undefined : parseInt(b.price, 10);
  if (price !== undefined && !(price > 0 && price <= 10000000)) throw httpErr(400, 'Некорректная цена');
  return [b.title === undefined ? null : str(b.title, 120), b.category === undefined ? null : str(b.category, 40), price ?? null,
    b.badge === undefined ? null : str(b.badge, 20), b.description === undefined ? null : str(b.description, 3000),
    sizes ? JSON.stringify(sizes) : null, photos ? JSON.stringify(photos) : null];
};
app.post('/api/admin/products', ...admin, ah(async (req, res) => {
  const f = prodFields(req.body); if (!f[0] || !f[1] || !f[2]) return fail(res, 400, 'Укажите название, категорию и цену');
  const r = await db.query(`INSERT INTO products (title, category, price, badge, description, sizes, photos) VALUES ($1,$2,$3,$4,$5,COALESCE($6::jsonb,'["S","M","L","XL"]'::jsonb),COALESCE($7::jsonb,'[]'::jsonb)) RETURNING id`, f);
  res.json({ success: true, id: r.rows[0].id, message: 'Товар добавлен' });
}));
app.put('/api/admin/products/:id', ...admin, ah(async (req, res) => {
  const id = toId(req.params.id); if (!id) return fail(res, 400, 'Некорректный ID');
  const r = await db.query(`UPDATE products SET title = COALESCE($1, title), category = COALESCE($2, category), price = COALESCE($3, price), badge = COALESCE($4, badge), description = COALESCE($5, description), sizes = COALESCE($6::jsonb, sizes), photos = COALESCE($7::jsonb, photos), is_active = COALESCE($8, is_active) WHERE id = $9`,
    [...prodFields(req.body), typeof req.body.is_active === 'boolean' ? req.body.is_active : null, id]);
  r.rowCount ? res.json({ success: true }) : fail(res, 404, 'Товар не найден');
}));
app.delete('/api/admin/products/:id', ...admin, ah(async (req, res) => { const r = await db.query('DELETE FROM products WHERE id = $1', [toId(req.params.id)]); r.rowCount ? res.json({ success: true }) : fail(res, 404, 'Товар не найден'); }));

app.post('/api/admin/news', ...admin, ah(async (req, res) => {
  const title = str(req.body.title, 160), text = str(req.body.text, 10000); if (!title || !text) return fail(res, 400, 'Укажите заголовок и текст');
  await db.query('INSERT INTO news (title, text, photo) VALUES ($1, $2, $3)', [title, text, typeof req.body.photo === 'string' ? req.body.photo : null]);
  res.json({ success: true, message: 'Новость опубликована' });
}));
app.delete('/api/admin/news/:id', ...admin, ah(async (req, res) => { await db.query('DELETE FROM news WHERE id = $1', [toId(req.params.id)]); res.json({ success: true }); }));

app.get('/api/admin/orders', ...admin, ah(async (req, res) => res.json((await db.query('SELECT o.*, u.login, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 300')).rows)));
app.put('/api/admin/orders/:id', ...admin, ah(async (req, res) => {
  const id = toId(req.params.id), status = req.body.status === undefined ? null : str(req.body.status, 30), track = req.body.track === undefined ? null : str(req.body.track, 60);
  if (!id) return fail(res, 400, 'Некорректный ID');
  if (status && !STATUSES.includes(status)) return fail(res, 400, 'Недопустимый статус');
  const o = await tx(async c => {
    const old = (await c.query('SELECT o.*, u.tg_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1 FOR UPDATE OF o', [id])).rows[0];
    if (!old) throw httpErr(404, 'Заказ не найден');
    if (status === 'Отменён' && old.status !== 'Отменён' && old.balance_paid > 0) {
      await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [old.balance_paid, old.user_id]);
      await c.query('INSERT INTO balance_log (user_id, admin_id, amount, reason) VALUES ($1, $2, $3, $4)', [old.user_id, req.user.id, old.balance_paid, `Возврат за заказ #${id}`]);
    }
    await c.query('UPDATE orders SET status = COALESCE($1, status), track = COALESCE($2, track) WHERE id = $3', [status, track, id]);
    return old;
  });
  if ((status && status !== o.status) || (track && track !== o.track)) notify(o.tg_id, `Заказ #${id}: ${status || o.status}${track ? '. Трек-номер: ' + track : ''}`);
  res.json({ success: true });
}));

app.get('/api/admin/reviews', ...admin, ah(async (req, res) => res.json((await db.query('SELECT r.*, u.login FROM reviews r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 300')).rows)));
app.put('/api/admin/reviews/:id', ...admin, ah(async (req, res) => {
  if (!['approved', 'rejected', 'pending'].includes(req.body.status)) return fail(res, 400, 'Недопустимый статус');
  await db.query('UPDATE reviews SET status = $1 WHERE id = $2', [req.body.status, toId(req.params.id)]); res.json({ success: true });
}));
app.delete('/api/admin/reviews/:id', ...admin, ah(async (req, res) => { await db.query('DELETE FROM reviews WHERE id = $1', [toId(req.params.id)]); res.json({ success: true }); }));

app.get('/api/admin/promos', ...admin, ah(async (req, res) => res.json((await db.query('SELECT * FROM promo_codes ORDER BY id DESC')).rows)));
app.post('/api/admin/promos', ...admin, ah(async (req, res) => {
  const code = str(req.body.code, 40).toUpperCase(), value = parseInt(req.body.value, 10), type = req.body.type === 'fixed' ? 'fixed' : 'percent', max = parseInt(req.body.max_uses, 10) || null;
  if (!/^[A-Z0-9_-]{3,40}$/.test(code) || !(value > 0) || (type === 'percent' && value > 100)) return fail(res, 400, 'Некорректные данные промокода');
  await db.query('INSERT INTO promo_codes (code, type, value, max_uses) VALUES ($1, $2, $3, $4)', [code, type, value, max]); res.json({ success: true });
}));
app.delete('/api/admin/promos/:id', ...admin, ah(async (req, res) => { await db.query('DELETE FROM promo_codes WHERE id = $1', [toId(req.params.id)]); res.json({ success: true }); }));

app.get('/api/admin/support', ...admin, ah(async (req, res) => res.json((await db.query(`SELECT * FROM (SELECT DISTINCT ON (m.user_id) m.user_id, u.login, m.sender, m.text, m.created_at FROM support_messages m JOIN users u ON u.id = m.user_id ORDER BY m.user_id, m.id DESC) t ORDER BY created_at DESC`)).rows)));
app.get('/api/admin/support/:userId', ...admin, ah(async (req, res) => res.json((await db.query('SELECT id, sender, text, created_at FROM support_messages WHERE user_id = $1 ORDER BY id', [toId(req.params.userId)])).rows)));
app.post('/api/admin/support/:userId', ...admin, ah(async (req, res) => {
  const id = toId(req.params.userId), text = str(req.body.text, 2000), u = (await db.query('SELECT tg_id FROM users WHERE id = $1', [id])).rows[0];
  if (!u) return fail(res, 404, 'Клиент не найден'); if (!text) return fail(res, 400, 'Пустое сообщение');
  await db.query(`INSERT INTO support_messages (user_id, sender, text) VALUES ($1, 'admin', $2)`, [id, text]);
  notify(u.tg_id, `Ответ поддержки SMM ARCHIVE: ${text}`); res.json({ success: true });
}));

// ---------- ошибки ----------
app.use((req, res) => fail(res, 404, 'Не найдено'));
app.use((err, req, res, next) => {
  if (err.expose) return fail(res, err.status, err.message);
  if (err.code === '23505') return fail(res, 409, 'Такая запись уже существует');
  if (err.type === 'entity.too.large') return fail(res, 413, 'Слишком большой запрос (фото)');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Некорректный JSON');
  console.error('[ERROR]', req.method, req.path, err);
  fail(res, 500, 'Ошибка сервера. Попробуйте позже.');
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log('SMM ARCHIVE API on port ' + PORT);
  try { await db.query('SELECT 1'); console.log('[DB] подключено'); } catch (e) { console.error('[DB] НЕ подключено:', e.message); }
});
