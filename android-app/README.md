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

## Probar en el emulador (checklist)

Esto no se puede automatizar desde este entorno (sin GUI ni SDK de Android), así que es el paso a paso para probarlo en tu máquina:

**1. Backend arriba**
- [ ] `cd backend && node server.js` (requiere Node.js 22.5+).
- [ ] Verifica en el navegador o con `curl http://localhost:3000/api/products` que devuelve el catálogo de 8 productos.
- [ ] Deja esta terminal abierta; la app le hablará a este proceso durante toda la prueba.

**2. Emulador arriba**
- [ ] Abre Android Studio → Device Manager → crea un AVD si no tienes uno (cualquier Pixel con API 26+) → Play (▶) para iniciarlo.
- [ ] Espera a que el emulador termine de bootear a la pantalla de inicio de Android.

**3. Instalar y correr la app**
- [ ] Abre la carpeta `android-app` como proyecto en Android Studio (`File → Open`).
- [ ] Espera el "Gradle sync" (barra inferior); resuelve cualquier SDK faltante que Android Studio te proponga instalar.
- [ ] Selecciona el emulador en el dropdown de dispositivos y pulsa Run (▶).
- [ ] La `BASE_URL` por defecto (`http://10.0.2.2:3000/`) ya apunta al backend corriendo en tu máquina; no necesitas cambiar nada si usas el emulador (no un dispositivo físico).

**4. Camino feliz**
- [ ] Al abrir la app se ve un spinner y luego el menú con los 8 productos (si en vez de eso ves "No se pudo cargar el menú...", confirma que el backend del paso 1 sigue corriendo y que estás en el emulador, no en un dispositivo físico).
- [ ] Toca "+" en 2-3 productos → el ícono del carrito muestra el contador actualizado.
- [ ] Entra al carrito → ajusta cantidades con +/-, quita un producto con ✕ → el total se recalcula.
- [ ] Escribe un nombre y una nota → toca "Confirmar pedido" → el botón cambia a "Enviando..." y luego navega a la pantalla de confirmación con un número de pedido y el total.
- [ ] Vuelve al menú → en la terminal del backend, corre `curl http://localhost:3000/api/orders` → el pedido que acabas de hacer debe aparecer ahí con el mismo total.

**5. Casos de error (opcional pero recomendado)**
- [ ] Con la app abierta, detén el backend (`Ctrl+C` en su terminal) y toca "Reintentar" en el menú (o reinicia la app) → debe mostrar el mensaje de error, no crashear.
- [ ] Reinicia el backend y toca "Reintentar" → el menú vuelve a cargar normalmente.

Si algo de esto falla, copia el mensaje de error (o el logcat de Android Studio) y lo reviso.

## Próximos pasos sugeridos

- Servir el backend con HTTPS y quitar `usesCleartextTraffic` antes de publicar la app.
- Añadir autenticación de clientes si se necesita historial de pedidos por usuario.
- Añadir notificaciones push para avisar el estado del pedido.
