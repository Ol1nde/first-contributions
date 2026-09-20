const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    emoji TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    total REAL NOT NULL,
    placed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL
  );
`);

const SEED_PRODUCTS = [
  ['1', 'Hamburguesa clásica', 'Carne, lechuga, tomate y queso', 8.50, '🍔'],
  ['2', 'Pizza margarita', 'Tomate, mozzarella y albahaca', 10.90, '🍕'],
  ['3', 'Ensalada César', 'Pollo, lechuga, crutones y parmesano', 7.20, '🥗'],
  ['4', 'Tacos al pastor', 'Tres tacos con piña y cilantro', 9.00, '🌮'],
  ['5', 'Refresco', 'Botella 500ml', 2.00, '🥤'],
  ['6', 'Papas fritas', 'Porción grande con sal', 3.50, '🍟'],
  ['7', 'Helado', 'Vainilla, chocolate o fresa', 4.00, '🍨'],
  ['8', 'Café', 'Espresso o americano', 2.50, '☕']
];

const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
if (productCount === 0) {
  const insertProduct = db.prepare(
    'INSERT INTO products (id, name, description, price, emoji) VALUES (?, ?, ?, ?, ?)'
  );
  for (const product of SEED_PRODUCTS) {
    insertProduct.run(...product);
  }
}

module.exports = db;
