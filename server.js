const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const FREE_DELIVERY_FROM = 29; // евро
const DELIVERY_FEE = 3.5;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Авторизация (JWT) ----------
function readUser(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    try {
        return jwt.verify(token, SECRET);
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const user = readUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    req.user = user;
    next();
}

function optionalAuth(req, res, next) {
    req.user = readUser(req);
    next();
}

function makeToken(user) {
    return jwt.sign({ id: user.id, name: user.name, email: user.email }, SECRET, { expiresIn: '7d' });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/register', (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (name.length < 2) return res.status(400).json({ error: 'Name is too short' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        return res.status(409).json({ error: 'This email is already registered' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const id = db
        .prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
        .run(name, email, hash).lastInsertRowid;

    const user = { id, name, email, role: 'user' };
    res.status(201).json({ token: makeToken(user), user });
});

app.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        return res.status(401).json({ error: 'Wrong email or password' });
    }

    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    res.json({ token: makeToken(user), user });
});

// ---------- Рестораны и блюда ----------
app.get('/api/restaurants', (req, res) => {
    const { category } = req.query;
    const rows =
        category && category !== 'all'
            ? db.prepare('SELECT * FROM restaurants WHERE active = 1 AND category = ?').all(category)
            : db.prepare('SELECT * FROM restaurants WHERE active = 1').all();
    res.json(rows);
});

app.get('/api/restaurants/:id/dishes', (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ? AND active = 1').get(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const dishes = db.prepare('SELECT * FROM dishes WHERE restaurant_id = ? AND active = 1').all(restaurant.id);
    res.json({ restaurant, dishes });
});

// ---------- Заказы ----------
app.post('/api/orders', optionalAuth, (req, res) => {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const mode = req.body.mode === 'takeout' ? 'takeout' : 'delivery';
    const items = req.body.items;

    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
    if (mode === 'delivery' && !address) return res.status(400).json({ error: 'Address is required for delivery' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    // Цены берём из БД, а не от клиента — чтобы их нельзя было подделать
    const getDish = db.prepare('SELECT id, name, price FROM dishes WHERE id = ? AND active = 1');
    const lines = [];
    let subtotal = 0;

    for (const it of items) {
        const dish = getDish.get(Number(it.dish_id));
        const qty = Math.floor(Number(it.qty));
        if (!dish || !(qty >= 1 && qty <= 50)) {
            return res.status(400).json({ error: 'Invalid item in cart' });
        }
        subtotal += dish.price * qty;
        lines.push({ dish, qty });
    }

    const fee = mode === 'takeout' || subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
    const total = Math.round((subtotal + fee) * 100) / 100;

    const createOrder = db.transaction(() => {
        const orderId = db
            .prepare('INSERT INTO orders (user_id, name, phone, address, mode, fee, total) VALUES (?,?,?,?,?,?,?)')
            .run(req.user ? req.user.id : null, name, phone, mode === 'delivery' ? address : null, mode, fee, total)
            .lastInsertRowid;

        const addItem = db.prepare(
            'INSERT INTO order_items (order_id, dish_id, name, price, qty) VALUES (?,?,?,?,?)'
        );
        for (const { dish, qty } of lines) addItem.run(orderId, dish.id, dish.name, dish.price, qty);
        return orderId;
    });

    const id = createOrder();
    res.status(201).json({ id, fee, total });
});

app.get('/api/orders/my', requireAuth, (req, res) => {
    const orders = db
        .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
        .all(req.user.id);
    const getItems = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
    for (const o of orders) o.items = getItems.all(o.id);
    res.json(orders);
});

// ---------- Подписка ----------
app.post('/api/subscribe', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const result = db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
    res.json({ ok: true, already: result.changes === 0 });
});

// ================== АДМИНКА ==================
const STATUSES = ['new', 'cooking', 'delivering', 'done', 'cancelled'];
const CATEGORIES = ['burger', 'risotto', 'asian', 'salads'];

// Роль проверяем по БД при каждом запросе, а не по токену:
// если у пользователя отобрали права, они пропадают сразу.
function requireAdmin(req, res, next) {
    const user = readUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(user.id);
    if (!row || row.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    req.user = user;
    next();
}

const admin = express.Router();
admin.use(requireAdmin);
app.use('/api/admin', admin);

function parseRestaurant(b) {
    const name = String(b.name || '').trim();
    const category = String(b.category || '');
    const image = String(b.image || '').trim();
    const logo = String(b.logo || '').trim();
    const pin_top = Number(b.pin_top);
    const pin_left = Number(b.pin_left);

    if (!name) return { error: 'Name is required' };
    if (!CATEGORIES.includes(category)) return { error: 'Unknown category' };
    if (!image || !logo) return { error: 'Image and logo paths are required' };
    if (!(pin_top >= 0 && pin_top <= 100 && pin_left >= 0 && pin_left <= 100)) {
        return { error: 'Pin position must be between 0 and 100' };
    }
    return { value: { name, category, image, logo, pin_top, pin_left, active: b.active ? 1 : 0 } };
}

function parseDish(b) {
    const name = String(b.name || '').trim();
    const price = Number(b.price);
    if (!name) return { error: 'Dish name is required' };
    if (!(price > 0 && price < 1000)) return { error: 'Price must be between 0 and 1000' };
    return { value: { name, price: Math.round(price * 100) / 100, active: b.active ? 1 : 0 } };
}

// --- Статистика ---
admin.get('/stats', (req, res) => {
    const n = sql => db.prepare(sql).get().c;
    res.json({
        restaurants: n('SELECT COUNT(*) AS c FROM restaurants'),
        dishes: n('SELECT COUNT(*) AS c FROM dishes'),
        users: n("SELECT COUNT(*) AS c FROM users WHERE role = 'user'"),
        orders: n('SELECT COUNT(*) AS c FROM orders'),
        newOrders: n("SELECT COUNT(*) AS c FROM orders WHERE status = 'new'"),
        subscribers: n('SELECT COUNT(*) AS c FROM subscribers'),
        revenue: db.prepare("SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE status != 'cancelled'").get().s
    });
});

// --- Заказы ---
admin.get('/orders', (req, res) => {
    const { status } = req.query;
    const filter = STATUSES.includes(status);
    const orders = db.prepare(`
        SELECT o.*, u.email AS user_email
        FROM orders o LEFT JOIN users u ON u.id = o.user_id
        ${filter ? 'WHERE o.status = ?' : ''}
        ORDER BY o.id DESC LIMIT 200
    `).all(...(filter ? [status] : []));

    const getItems = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
    for (const o of orders) o.items = getItems.all(o.id);
    res.json(orders);
});

admin.patch('/orders/:id', (req, res) => {
    const status = req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
});

// --- Рестораны ---
admin.get('/restaurants', (req, res) => {
    res.json(db.prepare(`
        SELECT r.*, (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = r.id) AS dish_count
        FROM restaurants r ORDER BY r.id
    `).all());
});

admin.post('/restaurants', (req, res) => {
    const { error, value: v } = parseRestaurant(req.body);
    if (error) return res.status(400).json({ error });
    const id = db.prepare(
        'INSERT INTO restaurants (name, category, image, logo, pin_top, pin_left, active) VALUES (?,?,?,?,?,?,?)'
    ).run(v.name, v.category, v.image, v.logo, v.pin_top, v.pin_left, v.active).lastInsertRowid;
    res.status(201).json({ id });
});

admin.put('/restaurants/:id', (req, res) => {
    const { error, value: v } = parseRestaurant(req.body);
    if (error) return res.status(400).json({ error });
    const r = db.prepare(
        'UPDATE restaurants SET name=?, category=?, image=?, logo=?, pin_top=?, pin_left=?, active=? WHERE id=?'
    ).run(v.name, v.category, v.image, v.logo, v.pin_top, v.pin_left, v.active, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ ok: true });
});

admin.delete('/restaurants/:id', (req, res) => {
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM dishes WHERE restaurant_id = ?').run(req.params.id);
            const r = db.prepare('DELETE FROM restaurants WHERE id = ?').run(req.params.id);
            if (r.changes === 0) throw new Error('NOT_FOUND');
        })();
        res.json({ ok: true });
    } catch (e) {
        if (e.message === 'NOT_FOUND') return res.status(404).json({ error: 'Restaurant not found' });
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
            return res.status(409).json({ error: 'Dishes of this restaurant are used in existing orders. Hide the restaurant instead of deleting it.' });
        }
        throw e;
    }
});

// --- Блюда ---
admin.get('/restaurants/:id/dishes', (req, res) => {
    res.json(db.prepare('SELECT * FROM dishes WHERE restaurant_id = ? ORDER BY id').all(req.params.id));
});

admin.post('/restaurants/:id/dishes', (req, res) => {
    if (!db.prepare('SELECT id FROM restaurants WHERE id = ?').get(req.params.id)) {
        return res.status(404).json({ error: 'Restaurant not found' });
    }
    const { error, value: v } = parseDish(req.body);
    if (error) return res.status(400).json({ error });
    const id = db.prepare('INSERT INTO dishes (restaurant_id, name, price, active) VALUES (?,?,?,?)')
        .run(req.params.id, v.name, v.price, v.active).lastInsertRowid;
    res.status(201).json({ id });
});

admin.put('/dishes/:id', (req, res) => {
    const { error, value: v } = parseDish(req.body);
    if (error) return res.status(400).json({ error });
    const r = db.prepare('UPDATE dishes SET name = ?, price = ?, active = ? WHERE id = ?')
        .run(v.name, v.price, v.active, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Dish not found' });
    res.json({ ok: true });
});

admin.delete('/dishes/:id', (req, res) => {
    try {
        const r = db.prepare('DELETE FROM dishes WHERE id = ?').run(req.params.id);
        if (r.changes === 0) return res.status(404).json({ error: 'Dish not found' });
        res.json({ ok: true });
    } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
            return res.status(409).json({ error: 'This dish is used in existing orders. Hide it instead of deleting.' });
        }
        throw e;
    }
});

// --- Подписчики ---
admin.get('/subscribers', (req, res) => {
    res.json(db.prepare('SELECT id, email FROM subscribers ORDER BY id DESC').all());
});

app.listen(PORT, () => {
    console.log(`YellowKitchen running: http://localhost:${PORT}`);
});
