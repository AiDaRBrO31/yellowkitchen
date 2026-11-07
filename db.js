const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'yellowkitchen.db'));
db.pragma('foreign_keys = ON');

// ---------- Таблицы ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurants (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    category TEXT NOT NULL,
    image    TEXT NOT NULL,
    logo     TEXT NOT NULL,
    pin_top  REAL NOT NULL,   -- позиция пина на карте, в %
    pin_left REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dishes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
    name          TEXT NOT NULL,
    price         REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    address    TEXT,
    mode       TEXT NOT NULL DEFAULT 'delivery',
    fee        REAL NOT NULL,
    total      REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    dish_id  INTEGER NOT NULL REFERENCES dishes(id),
    name     TEXT NOT NULL,
    price    REAL NOT NULL,
    qty      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscribers (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE
);
`);

// ---------- Миграции (добавляют колонки в уже существующую БД) ----------
function addColumn(table, column, definition) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
addColumn('orders', 'status', "TEXT NOT NULL DEFAULT 'new'");
addColumn('restaurants', 'active', 'INTEGER NOT NULL DEFAULT 1'); // 0 = скрыт с сайта
addColumn('dishes', 'active', 'INTEGER NOT NULL DEFAULT 1');

// ---------- Администратор по умолчанию ----------
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@yellowkitchen.com').toLowerCase();
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'admin')")
        .run('Admin', adminEmail, bcrypt.hashSync(adminPass, 10));
    console.log(`Admin account created: ${adminEmail} / ${adminPass}`);
}

// ---------- Тестовые данные (только если БД пустая) ----------
const count = db.prepare('SELECT COUNT(*) AS c FROM restaurants').get().c;

if (count === 0) {
    const addRest = db.prepare(
        'INSERT INTO restaurants (name, category, image, logo, pin_top, pin_left) VALUES (?,?,?,?,?,?)'
    );
    const addDish = db.prepare(
        'INSERT INTO dishes (restaurant_id, name, price) VALUES (?,?,?)'
    );

    const seed = db.transaction(() => {
        const burger = addRest.run("Burger D'Lice", 'burger',
            'img/burger/burger.png', 'img/burger/burger-logo.png', 32, 46).lastInsertRowid;
        addDish.run(burger, 'Classic Cheeseburger', 9.5);
        addDish.run(burger, 'Double Bacon Burger', 12.9);
        addDish.run(burger, 'Sweet Potato Fries', 4.5);

        const risotto = addRest.run('Il Pastificio', 'risotto',
            'img/past/Past.png', 'img/past/il_paster.png', 42, 34).lastInsertRowid;
        addDish.run(risotto, 'Mushroom Risotto', 13.0);
        addDish.run(risotto, 'Seafood Risotto', 15.5);
        addDish.run(risotto, 'Tiramisu', 6.0);

        const salads = addRest.run('Believe', 'salads',
            'img/salad/Salad1.png', 'img/salad/Believe.png', 50, 42).lastInsertRowid;
        addDish.run(salads, 'Caesar Salad', 10.0);
        addDish.run(salads, 'Greek Salad', 9.0);
        addDish.run(salads, 'Fresh Lemonade', 3.5);

        const asian = addRest.run('Vietnamese Bo', 'asian',
            'img/viet/viet.png', 'img/viet/vietnamese.png', 58, 56).lastInsertRowid;
        addDish.run(asian, 'Pho Bo', 11.5);
        addDish.run(asian, 'Spring Rolls (6 pcs)', 7.0);
        addDish.run(asian, 'Bun Cha', 12.0);
    });
    seed();
}

module.exports = db;
