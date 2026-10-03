# Intranet de gestión de empleados

Aplicación web interna para gestionar la plantilla de una empresa: directorio de empleados, departamentos,
vacaciones y ausencias con flujo de aprobación, registro de jornada (fichaje) y tablón de anuncios.

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
| **Fichaje** | Registro de entrada y salida, historial por periodo, correcciones auditadas (quién y cuándo) y exportación CSV para la inspección de trabajo. |
| **Anuncios** | Tablón de comunicaciones internas con anuncios fijados. |
| **Mi perfil** | Datos propios, cambio de teléfono y de contraseña. |

## Puesta en marcha

```bash
cd intranet-empleados
npm start              # arranca en http://localhost:3000
```

En el primer arranque se crea el usuario **admin@empresa.local** y su contraseña aleatoria se muestra **una sola
vez** en la consola. Puedes fijarla tú mismo:

```bash
ADMIN_EMAIL=admin@miempresa.es ADMIN_PASSWORD='una-clave-segura' npm start
```

### Probar con datos de ejemplo

```bash
npm run demo
```

Carga departamentos, 10 empleados, solicitudes, anuncios y fichajes. Todos los usuarios de ejemplo usan la
contraseña `demo1234`:

| Usuario | Rol |
| --- | --- |
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
| `DB_FILE` | `data/intranet.db` | Ruta del fichero SQLite. |
| `ADMIN_EMAIL` | `admin@empresa.local` | Email del administrador inicial (solo con la base de datos vacía). |
| `ADMIN_PASSWORD` | aleatoria | Contraseña del administrador inicial. |
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
| Corregir fichajes y exportar el registro completo | | | ✔ | ✔ |
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
  server.js        Arranque, variables de entorno y datos iniciales
  app.js           Enrutado HTTP, sesiones, CSRF y cabeceras de seguridad
  db.js            Esquema SQLite, administrador inicial y datos de demo
  routes/          API REST: auth, employees, departments, leaves, time, announcements, dashboard
  permissions.js   Reglas de roles
  validate.js      Validación de datos y cálculo de días laborables
public/
  index.html       Aplicación de una sola página
  js/              Módulos ES (vistas en js/views/)
  css/styles.css   Estilos (claro/oscuro, responsive)
test/api.test.js   Tests de la API (node:test)
```

## API

Todas las rutas están bajo `/api` y devuelven JSON (salvo las exportaciones CSV).

| Método y ruta | Descripción |
| --- | --- |
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

## Limitaciones conocidas

- Los días de ausencia se calculan de lunes a viernes; no se descuentan festivos nacionales ni locales.
- Las vacaciones se imputan al año de la fecha de inicio (las que cruzan de año deben pedirse por separado).
- No envía notificaciones por email.
