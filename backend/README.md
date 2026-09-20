# Backend de Pedidos

API REST con base de datos SQLite para la app Android de pedidos (`../android-app`). No requiere `npm install`: usa únicamente módulos nativos de Node.js, incluyendo el módulo experimental `node:sqlite`.

## Requisitos

- Node.js 22.5 o superior (necesario para `node:sqlite`).

## Ejecutar

```bash
cd backend
node server.js
```

El servidor arranca en `http://localhost:3000` y crea automáticamente el archivo de base de datos en `backend/data/app.db` (con el catálogo de productos precargado) si no existe.

## Endpoints

| Método | Ruta                     | Descripción                                              |
|--------|--------------------------|-----------------------------------------------------------|
| GET    | `/api/products`          | Lista el catálogo de productos.                           |
| GET    | `/api/orders`            | Lista todos los pedidos, más reciente primero.             |
| GET    | `/api/orders/:id`        | Obtiene un pedido por id.                                  |
| POST   | `/api/orders`            | Crea un pedido nuevo.                                      |
| PATCH  | `/api/orders/:id/status` | Actualiza el estado de un pedido.                          |

### Crear un pedido

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
        "customerName": "Ana",
        "notes": "sin cebolla",
        "items": [
          { "productId": "1", "quantity": 2 },
          { "productId": "5", "quantity": 1 }
        ]
      }'
```

El precio y el total se calculan siempre en el servidor a partir del catálogo, nunca se confía en un precio enviado por el cliente.

### Actualizar el estado de un pedido

```bash
curl -X PATCH http://localhost:3000/api/orders/E5A7C7D6/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "preparing" }'
```

Estados válidos: `pending`, `preparing`, `ready`, `delivered`, `cancelled`.

## Base de datos

Tablas en `backend/data/app.db` (SQLite):

- `products (id, name, description, price, emoji)`
- `orders (id, customer_name, notes, status, total, placed_at)`
- `order_items (id, order_id, product_id, product_name, unit_price, quantity)`

## Conectar la app Android

- **Emulador Android**: usa `http://10.0.2.2:3000/` como base URL (ya configurado por defecto en la app, ver `android-app/README.md`).
- **Dispositivo físico**: reemplaza la base URL por la IP de la máquina donde corre este backend dentro de la misma red (por ejemplo `http://192.168.1.50:3000/`).

## Próximos pasos sugeridos

- Migrar a una base de datos gestionada (PostgreSQL/MySQL) para producción.
- Añadir autenticación para el panel de administración de pedidos.
- Exponer un endpoint de WebSocket/push para notificar cambios de estado en tiempo real.
