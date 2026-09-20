# App de Pedidos (Android)

App nativa de Android (Kotlin + Jetpack Compose) para que los clientes de un negocio puedan ver el menú, armar un carrito y enviar su pedido. Consume el backend en [`../backend`](../backend), que expone el catálogo de productos y guarda los pedidos en una base de datos SQLite.

## Funcionalidad

- **Menú**: carga el catálogo desde el backend, con estado de carga y de error con botón de reintento.
- **Carrito**: revisar los productos elegidos, ajustar cantidades, quitar productos, ver el total, e ingresar nombre del cliente y notas opcionales antes de confirmar.
- **Confirmación**: envía el pedido al backend y muestra el número de pedido y el total una vez aceptado.

## Estructura del proyecto

```
android-app/
├── app/
│   └── src/main/java/com/example/orderapp/
│       ├── MainActivity.kt
│       ├── model/          # Product, CartItem, Order (modelos de dominio)
│       ├── network/        # ApiService (Retrofit), DTOs y NetworkModule
│       ├── data/           # OrderRepository: traduce DTOs de red a modelos de dominio
│       └── ui/             # Pantallas Compose, ViewModel y tema
├── build.gradle.kts
└── settings.gradle.kts
```

## Cómo ejecutarla

1. Arranca el backend primero: `cd ../backend && node server.js` (ver `../backend/README.md`).
2. Abre la carpeta `android-app` con Android Studio (versión Koala o superior recomendada).
3. Deja que Android Studio sincronice Gradle (generará el wrapper automáticamente).
4. Ejecuta la app en un emulador o dispositivo con Android 8.0 (API 26) o superior.

Requisitos: JDK 17, Android SDK con `compileSdk 34`.

### Configurar la URL del backend

La URL base está en `app/src/main/java/com/example/orderapp/network/NetworkModule.kt`:

- **Emulador de Android** (por defecto): `http://10.0.2.2:3000/`, que el emulador redirige al `localhost` de tu máquina.
- **Dispositivo físico**: cámbiala por la IP de tu máquina en la red local, por ejemplo `http://192.168.1.50:3000/`.

Durante desarrollo la app permite tráfico HTTP sin cifrar (`usesCleartextTraffic="true"` en el manifest) para poder hablar con el backend local; para producción se debería servir el backend con HTTPS y quitar ese flag.

## Próximos pasos sugeridos

- Servir el backend con HTTPS y quitar `usesCleartextTraffic` antes de publicar la app.
- Añadir autenticación de clientes si se necesita historial de pedidos por usuario.
- Añadir notificaciones push para avisar el estado del pedido.
