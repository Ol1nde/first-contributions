const crypto = require('node:crypto');
const db = require('./db');

const VALID_STATUSES = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];

function listProducts() {
  return db.prepare('SELECT id, name, description, price, emoji FROM products ORDER BY CAST(id AS INTEGER)').all();
}

function getProductById(id) {
  return db.prepare('SELECT id, name, description, price, emoji FROM products WHERE id = ?').get(id);
}

function attachItems(order) {
  const items = db
    .prepare('SELECT product_id, product_name, unit_price, quantity FROM order_items WHERE order_id = ?')
    .all(order.id);

  return {
    id: order.id,
    customerName: order.customer_name,
    notes: order.notes,
    status: order.status,
    total: order.total,
    placedAt: order.placed_at,
    items: items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      unitPrice: item.unit_price,
      quantity: item.quantity
    }))
  };
}

function listOrders() {
  const orders = db.prepare('SELECT * FROM orders ORDER BY placed_at DESC').all();
  return orders.map(attachItems);
}

function getOrderById(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  return attachItems(order);
}

class ValidationError extends Error {}

function validateCreateOrderPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('El cuerpo de la petición debe ser un objeto JSON.');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new ValidationError('El pedido debe incluir al menos un producto en "items".');
  }
  for (const item of payload.items) {
    if (!item || typeof item.productId !== 'string' || !item.productId.trim()) {
      throw new ValidationError('Cada producto debe tener un "productId" válido.');
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError('Cada producto debe tener una "quantity" entera mayor que 0.');
    }
  }
}

function createOrder(payload) {
  validateCreateOrderPayload(payload);

  const resolvedItems = payload.items.map((item) => {
    const product = getProductById(item.productId);
    if (!product) {
      throw new ValidationError(`No existe un producto con id "${item.productId}".`);
    }
    return {
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity: item.quantity
    };
  });

  const total = resolvedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const id = crypto.randomUUID().split('-')[0].toUpperCase();
  const placedAt = new Date().toISOString();
  const customerName = (payload.customerName || '').trim() || 'Cliente';
  const notes = (payload.notes || '').trim();

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO orders (id, customer_name, notes, status, total, placed_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, customerName, notes, 'pending', total, placedAt);

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of resolvedItems) {
      insertItem.run(id, item.productId, item.productName, item.unitPrice, item.quantity);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getOrderById(id);
}

function updateOrderStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError(`"status" debe ser uno de: ${VALID_STATUSES.join(', ')}.`);
  }
  const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  return getOrderById(id);
}

module.exports = {
  ValidationError,
  listProducts,
  listOrders,
  getOrderById,
  createOrder,
  updateOrderStatus
};
