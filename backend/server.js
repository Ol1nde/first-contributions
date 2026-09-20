const http = require('node:http');
const { listProducts, listOrders, getOrderById, createOrder, updateOrderStatus, ValidationError } = require('./orders');

const PORT = process.env.PORT || 3000;

function sendJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new ValidationError('El cuerpo de la petición es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('El cuerpo de la petición no es JSON válido.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  try {
    if (req.method === 'GET' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'products') {
      return sendJson(res, 200, listProducts());
    }

    if (req.method === 'GET' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'orders') {
      return sendJson(res, 200, listOrders());
    }

    if (req.method === 'POST' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'orders') {
      const payload = await readJsonBody(req);
      const order = createOrder(payload);
      return sendJson(res, 201, order);
    }

    if (req.method === 'GET' && segments.length === 3 && segments[0] === 'api' && segments[1] === 'orders') {
      const order = getOrderById(segments[2]);
      if (!order) return sendJson(res, 404, { error: 'Pedido no encontrado.' });
      return sendJson(res, 200, order);
    }

    if (
      req.method === 'PATCH' &&
      segments.length === 4 &&
      segments[0] === 'api' &&
      segments[1] === 'orders' &&
      segments[3] === 'status'
    ) {
      const payload = await readJsonBody(req);
      const order = updateOrderStatus(segments[2], payload.status);
      if (!order) return sendJson(res, 404, { error: 'Pedido no encontrado.' });
      return sendJson(res, 200, order);
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    if (error instanceof ValidationError) {
      return sendJson(res, 400, { error: error.message });
    }
    console.error(error);
    return sendJson(res, 500, { error: 'Error interno del servidor.' });
  }
});

server.listen(PORT, () => {
  console.log(`Backend de pedidos escuchando en http://localhost:${PORT}`);
});
