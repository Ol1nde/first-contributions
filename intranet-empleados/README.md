# Intranet de gestión de empleados

Aplicación web interna para gestionar la plantilla de una empresa: directorio de empleados, departamentos,
vacaciones y ausencias con flujo de aprobación, registro de jornada (fichaje) y tablón de anuncios.

- **Un solo archivo para Windows**: `Intranet-Empleados.exe` funciona con doble clic, sin instalar nada.
- **Sin dependencias externas**: Node.js ≥ 22.13 y su SQLite integrado (`node:sqlite`). No hace falta `npm install`.
- **Base de datos en un único fichero** (`data/intranet.db`), fácil de copiar para hacer copias de seguridad.
- **Interfaz en español**, adaptable a móvil y con tema claro/oscuro automático.

## Funcionalidades

| Módulo | Qué permite |
| --- | --- |
| **Inicio** | Indicadores (plantilla activa, departamentos, solicitudes por revisar, ausentes hoy), fichaje rápido, saldo de vacaciones, anuncios recientes, ausencias de los próximos 14 días, cumpleaños e incorporaciones. |
| **Empleados** | Directorio con búsqueda y filtros, ficha de cada empleado, alta/edición/baja, jerarquía (responsable y equipo a cargo), restablecer contraseñas y exportación a CSV. |
| **Departamentos** | Alta, edición y eliminación (solo si no tienen empleados). |
| **Ausencias** | Solicitudes de vacaciones, asuntos propios, baja médica, permisos…; cálculo de días laborables, control de saldo y solapamientos; aprobación o rechazo por el responsable o RR. HH. |
| **Grupos sin coincidencia** | RR. HH. elige grupos de empleados que no pueden estar de vacaciones a la vez (p. ej. «Recepción»). Mientras un miembro tenga vacaciones pedidas o aprobadas, el resto del grupo no puede solicitar fechas que se solapen, y no se puede aprobar ninguna que coincida. |
| **Fichaje** | Registro de entrada y salida **desde el PC o con tarjeta NFC** en un terminal en la puerta. Historial por periodo con el origen de cada fichaje, correcciones auditadas (quién y cuándo), aviso de salidas olvidadas y exportación CSV para la inspección de trabajo. |
| **Anuncios** | Tablón de comunicaciones internas con anuncios fijados. Cada anuncio nuevo se avisa a la plantilla: contador en el menú, mensaje emergente y número en la pestaña del navegador, notificación de escritorio (en `localhost` o https) y, opcionalmente, email a todos los empleados activos. |
| **Configuración** | (Administrador) Cuenta de correo SMTP para los avisos por email, con envío de prueba. |
| **Mi perfil** | Datos propios, cambio de teléfono y de contraseña. |

## Instalación en Windows (sin instalar nada más)

1. Crea una carpeta para la intranet, por ejemplo `C:\Intranet`, y copia dentro **`Intranet-Empleados.exe`**.
   Los datos se guardarán en la subcarpeta `data` que se crea a su lado.
2. Haz doble clic en `Intranet-Empleados.exe`.
   - Si Windows muestra «Windows protegió su PC», pulsa **Más información → Ejecutar de todas formas**
     (el ejecutable no está firmado digitalmente).
   - Si el Firewall pregunta, pulsa **Permitir acceso** para que otros equipos de la red puedan entrar.
3. Se abre el navegador. La primera vez aparece **«Configura tu intranet»**: crea tu cuenta de administrador.
4. Da de alta los departamentos y empleados desde **Empleados → Nuevo empleado**, asignando a cada uno una
   contraseña inicial.
5. Los demás equipos entran con la dirección «Desde otros equipos» que aparece en la ventana negra
   (por ejemplo `http://192.168.1.20:3000`).

La ventana negra es el servidor: **debe quedarse abierta** mientras se use la intranet (puedes minimizarla).
Para que arranque sola, crea un acceso directo al `.exe` en la carpeta de inicio (`Win + R` → `shell:startup`).

**Copia de seguridad**: cierra la ventana y copia la carpeta `data`.

**Contraseña del administrador olvidada**: abre una consola en la carpeta del programa y ejecuta
`Intranet-Empleados.exe --restablecer-clave tu@email.es`; se mostrará una contraseña nueva.

Opciones del ejecutable: `--sin-navegador` (no abre el navegador), `--demo` (carga datos de ejemplo),
`--restablecer-clave <email>`. Las variables de entorno de [Configuración](#configuración) también se aplican.

## Fichaje con tarjeta NFC en la puerta

**Material:** un equipo con navegador (PC, portátil, mini PC o tablet) conectado a la red de la intranet y un
**lector NFC/RFID USB de tipo teclado** («HID», «emulación de teclado»): al acercar una tarjeta escribe su código
y pulsa Intro, sin instalar controladores. Debe ser de la misma frecuencia que las tarjetas (13,56 MHz para
MIFARE/NFC; 125 kHz para las de proximidad antiguas).

1. **Crear el terminal:** como administrador, en **Configuración → Terminales de fichaje → Nuevo terminal**
   (por ejemplo «Puerta principal»). Después, elige:
   - **Usar este equipo como terminal**, si estás en el equipo de la puerta: el navegador queda como terminal y se
     cierra tu sesión; o
   - copia el **enlace de activación** y ábrelo una vez en el equipo de la puerta.
2. **Asignar tarjetas:** en la ficha de cada empleado, **Editar → Tarjeta NFC**, pon el cursor en el campo y acerca
   la tarjeta a un lector conectado a ese equipo (o escribe su código). Si una tarjeta no está asignada, el terminal
   muestra su código al pasarla.
3. **Modo quiosco** (recomendado, para que la pantalla no pierda el foco): abre el navegador así, por ejemplo con un
   acceso directo en la carpeta de inicio de Windows:
   `msedge --kiosk "http://192.168.1.20:3000/terminal.html" --edge-kiosk-type=fullscreen`
   (o `chrome --kiosk …`).

Cada lectura alterna entrada y salida y la pantalla saluda al empleado. Una segunda lectura en menos de 60 s no
cuenta (evita fichar la salida por pasar la tarjeta dos veces). Si alguien olvidó fichar la salida (jornada abierta
más de 16 h), esa jornada se cierra marcada como **«Falta la salida»** para que RR. HH. la corrija, y se registra la
nueva entrada. En el historial se ve el origen de cada fichaje: *PC*, *Tarjeta · Puerta principal* o *Corrección*.

Los lectores con conexión de red propia pueden fichar directamente con
`POST /api/kiosk/punch` (cabecera `Authorization: Bearer <token del terminal>`, cuerpo `{"card": "<código>"}`).

En el modo demo hay un terminal ya creado (`/terminal.html#activar=demo-terminal`) y las tarjetas `DEMO0002` a
`DEMO0011`: escribe el código y pulsa Intro para simular el lector.

### Generar el ejecutable

Requiere Node.js ≥ 22.13 en el equipo donde se genera:

```bash
cd intranet-empleados
npm install
npm run build            # dist/Intranet-Empleados.exe y el ejecutable del sistema actual
npm run build -- win     # solo Windows (se puede generar desde Linux o macOS)
```

Usa [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) de Node.js:
el resultado (~80 MB) incluye Node.js, la aplicación y la interfaz web. El de macOS solo puede generarse en un Mac.

## Instalación con Node.js (cualquier sistema)

```bash
cd intranet-empleados
npm start              # arranca en http://localhost:3000 (no necesita npm install)
```

Abre `http://localhost:3000` **en el mismo equipo** para crear la cuenta de administrador (por seguridad,
la configuración inicial no se permite desde otros equipos). También puedes crearla sin navegador:

```bash
ADMIN_EMAIL=admin@miempresa.es ADMIN_PASSWORD='una-clave-segura' npm start
```

Contraseña olvidada: `npm run restablecer-clave -- admin@miempresa.es`.

### Probar con datos de ejemplo

```bash
npm run demo
```

Carga departamentos, 10 empleados, solicitudes, anuncios y fichajes. Todos los usuarios de ejemplo, incluido
`admin@empresa.local`, usan la contraseña `demo1234`:

| Usuario | Rol |
| --- | --- |
| admin@empresa.local | Administrador |
| javier.ruiz@empresa.local | RR. HH. |
| elena.sanchez@empresa.local | Responsable (equipo de Tecnología) |
| ana.garcia@empresa.local | Empleada |

> No uses el modo demo en producción.

### Tests

```bash
npm test
```

## Configuración

Variables de entorno (todas opcionales):

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP. |
| `HOST` | `0.0.0.0` | Interfaz de red en la que escucha. |
| `DB_FILE` | `data/intranet.db` | Ruta del fichero SQLite (junto al ejecutable o en la carpeta del proyecto). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Crean el administrador al arrancar con la base de datos vacía, sin pasar por la pantalla de configuración. |
| `SESSION_HOURS` | `12` | Duración de la sesión. |
| `COOKIE_SECURE` | `0` | Pon `1` cuando se sirva por HTTPS. |
| `TRUST_PROXY` | `0` | Pon `1` detrás de un proxy inverso (usa `X-Forwarded-For` / `X-Forwarded-Host`). |
| `TZ` | sistema | Zona horaria para fechas y fichajes, p. ej. `Europe/Madrid`. |

## Roles y permisos

| Acción | Empleado | Responsable | RR. HH. | Admin |
| --- | :---: | :---: | :---: | :---: |
| Ver directorio, departamentos y anuncios | ✔ | ✔ | ✔ | ✔ |
| Fichar y solicitar ausencias propias | ✔ | ✔ | ✔ | ✔ |
| Ver ausencias y fichajes de su equipo directo | | ✔ | ✔ | ✔ |
| Aprobar/rechazar ausencias de su equipo directo | | ✔ | ✔ | ✔ |
| Aprobar/rechazar cualquier ausencia | | | ✔ | ✔ |
| Ver datos personales (nacimiento, rol, saldo…) de otros | | | ✔ | ✔ |
| Alta/edición de empleados, departamentos y anuncios | | | ✔ | ✔ |
| Crear grupos de vacaciones sin coincidencia | | | ✔ | ✔ |
| Corregir fichajes y exportar el registro completo | | | ✔ | ✔ |
| Publicar anuncios y avisar por email a la plantilla | | | ✔ | ✔ |
| Configurar el correo saliente (SMTP) | | | | ✔ |
| Asignar tarjetas NFC a los empleados | | | ✔ | ✔ |
| Crear y dar de baja terminales de fichaje | | | | ✔ |
| Asignar los roles RR. HH. y Admin, modificar administradores | | | | ✔ |
| Eliminar empleados | | | | ✔ |

Nadie puede aprobar sus propias solicitudes. Un empleado con estado **Baja** no puede iniciar sesión y desaparece
del directorio (RR. HH. lo sigue viendo). Los empleados con fichajes no se pueden eliminar, para conservar el
registro de jornada (obligatorio durante 4 años): hay que marcarlos como «Baja».

## Seguridad

- Contraseñas con `scrypt` y sal aleatoria; sesiones con token aleatorio guardado como hash.
- Cookie de sesión `HttpOnly` y `SameSite=Strict`; las peticiones que modifican datos exigen JSON y mismo origen (CSRF).
- Bloqueo temporal tras 5 intentos de inicio de sesión fallidos.
- Permisos comprobados siempre en el servidor; consultas SQL parametrizadas.
- Cabeceras `Content-Security-Policy`, `X-Frame-Options`, `nosniff`…; la interfaz no usa `innerHTML`.
- CSV protegidos contra inyección de fórmulas.
- Los terminales de fichaje se identifican con un token aleatorio (se guarda solo su hash) y pueden darse de baja.
- Emails enviados con cifrado (STARTTLS o SSL/TLS) verificando el certificado del servidor; destinatarios en copia oculta.

## Despliegue en producción

1. Copia la carpeta al servidor (Node.js ≥ 22.13).
2. Crea un servicio, por ejemplo con systemd (`/etc/systemd/system/intranet.service`):

   ```ini
   [Unit]
   Description=Intranet de empleados
   After=network.target

   [Service]
   WorkingDirectory=/opt/intranet-empleados
   ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
   Environment=PORT=3000 HOST=127.0.0.1 TZ=Europe/Madrid COOKIE_SECURE=1 TRUST_PROXY=1
   Restart=on-failure
   User=intranet

   [Install]
   WantedBy=multi-user.target
   ```

3. Publica la aplicación con HTTPS mediante un proxy inverso (nginx):

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Host $host;
   }
   ```

4. **Copias de seguridad**: `sqlite3 data/intranet.db ".backup copia.db"` (o copia `data/` con el servicio parado).

## Estructura

```
src/
  start.js         Arranque, variables de entorno y datos iniciales
  server.js        Entrada para `npm start`
  sea-main.js      Entrada del ejecutable autónomo (interfaz embebida)
  mailer.js        Cliente SMTP para los avisos por email
  app.js           Enrutado HTTP, sesiones, CSRF y cabeceras de seguridad
  db.js            Esquema SQLite, administrador inicial y datos de demo
  routes/          API REST: auth, employees, departments, leaves, time, announcements, dashboard
  permissions.js   Reglas de roles
  validate.js      Validación de datos y cálculo de días laborables
public/
  index.html       Aplicación de una sola página
  terminal.html    Pantalla del terminal de fichaje con tarjeta
  js/              Módulos ES (vistas en js/views/)
  css/styles.css   Estilos (claro/oscuro, responsive)
scripts/build.mjs  Genera los ejecutables (npm run build)
test/api.test.js   Tests de la API (node:test)
```

## API

Todas las rutas están bajo `/api` y devuelven JSON (salvo las exportaciones CSV).

| Método y ruta | Descripción |
| --- | --- |
| `GET/POST /api/setup` | Primer uso: crear la cuenta de administrador (solo desde el propio equipo) |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Sesión |
| `PUT /api/auth/password` · `PUT /api/auth/profile` | Cambiar contraseña / teléfono propio |
| `GET /api/dashboard` | Datos de la página de inicio |
| `GET/POST /api/employees` · `GET/PUT/DELETE /api/employees/:id` | Empleados (`?q=&department_id=&status=`) |
| `PUT /api/employees/:id/password` · `GET /api/employees/export.csv` | Restablecer contraseña / exportar |
| `GET/POST /api/departments` · `PUT/DELETE /api/departments/:id` | Departamentos |
| `GET/POST /api/leaves` · `GET /api/leaves/balance` | Ausencias (`?scope=mine\|review&status=&year=&employee_id=`) |
| `PUT /api/leaves/:id/review` · `PUT /api/leaves/:id/cancel` | Aprobar/rechazar · cancelar |
| `GET /api/time/status` · `POST /api/time/clock-in` · `POST /api/time/clock-out` | Fichaje |
| `GET /api/time` · `GET /api/time/export.csv` · `PUT /api/time/:id` | Historial · exportar · corregir |
| `GET/POST /api/announcements` · `PUT/DELETE /api/announcements/:id` | Anuncios |
| `GET/POST /api/vacation-groups` · `PUT/DELETE /api/vacation-groups/:id` | Grupos sin coincidencia de vacaciones (`member_ids`) |
| `GET /api/announcements/unread` · `POST /api/announcements/seen` | Anuncios sin leer · marcarlos como leídos |
| `GET/PUT /api/settings/email` · `POST /api/settings/email/test` | Correo saliente (solo admin) · email de prueba |
| `GET/POST /api/kiosks` · `DELETE /api/kiosks/:id` | Terminales de fichaje (solo admin) |
| `GET /api/kiosk/status` · `POST /api/kiosk/punch` | Uso desde el terminal (`Authorization: Bearer <token>`) |

## Limitaciones conocidas

- Los días de ausencia se calculan de lunes a viernes; no se descuentan festivos nacionales ni locales.
- Las vacaciones se imputan al año de la fecha de inicio (las que cruzan de año deben pedirse por separado).
- Los grupos sin coincidencia se aplican solo a las vacaciones (no a bajas, permisos ni asuntos propios).
- Las notificaciones de escritorio solo las permiten los navegadores en `http://localhost` o con https; en los
  demás equipos se avisa con el contador, el mensaje emergente y el email.
- El fichaje con tarjeta usa el identificador (UID) de la tarjeta, que puede copiarse con equipos especializados:
  sirve para registrar la jornada, no como control de acceso de seguridad.
- El terminal necesita conexión con la intranet: si se cae la red, avisa de que no se ha registrado el fichaje.
- La contraseña del correo saliente se guarda en la base de datos (necesaria para enviar): protege la carpeta `data`.
- No envía notificaciones por email.
