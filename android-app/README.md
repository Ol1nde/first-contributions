# App de Pedidos (Android)

App nativa de Android (Kotlin + Jetpack Compose) para que los clientes de un negocio puedan ver el menú, armar un carrito y enviar su pedido.

## Funcionalidad

- **Menú**: lista de productos con nombre, descripción y precio, con un botón para añadirlos al carrito.
- **Carrito**: revisar los productos elegidos, ajustar cantidades, quitar productos, ver el total, e ingresar nombre del cliente y notas opcionales antes de confirmar.
- **Confirmación**: muestra el número de pedido y el total una vez enviado.

Los datos del menú están en `app/src/main/java/com/example/orderapp/data/ProductCatalog.kt`; puedes reemplazarlos por los productos reales del negocio, o conectar esa capa a una API/backend propio para sincronizar pedidos en tiempo real.

## Estructura del proyecto

```
android-app/
├── app/
│   └── src/main/java/com/example/orderapp/
│       ├── MainActivity.kt
│       ├── model/          # Product, CartItem, Order
│       ├── data/           # Catálogo de productos
│       └── ui/             # Pantallas Compose, ViewModel y tema
├── build.gradle.kts
└── settings.gradle.kts
```

## Cómo ejecutarla

1. Abre la carpeta `android-app` con Android Studio (versión Koala o superior recomendada).
2. Deja que Android Studio sincronice Gradle (generará el wrapper automáticamente).
3. Ejecuta la app en un emulador o dispositivo con Android 8.0 (API 26) o superior.

Requisitos: JDK 17, Android SDK con `compileSdk 34`.

## Próximos pasos sugeridos

- Conectar el catálogo y el envío de pedidos a un backend real (por ejemplo, con Retrofit/Ktor) en vez de guardarlos solo en memoria.
- Añadir autenticación de clientes si se necesita historial de pedidos por usuario.
- Añadir notificaciones push para avisar el estado del pedido.
