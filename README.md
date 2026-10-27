# Request Extraction Web

Portal interno para solicitar y seguir extracciones técnicas de distintos fabricantes. La primera integración disponible es Renault Labour Times mediante el servicio `renault-reader`.

## Funcionalidad

- Inicio de sesión con email y contraseña de Active Directory mediante LDAP simple.
- Sesión firmada en cookie `HttpOnly`.
- Formulario con AX Code, Edición IMC, Completion, tiempos, comentarios y múltiples vehículos.
- Creación y seguimiento asíncrono de exportaciones Renault TM01.
- Historial privado por usuario y descarga protegida del ZIP.
- Extracciones BMW/MINI por typekey. Al pulsar "Continuar" en el paso "Modelos" el formulario comprueba, de tres en tres, que BMW Flat Rates tenga tiempos para cada typekey (`GET /api/readers/bmw/availability`, que consulta `GET /v1/models/availability` del reader). Los no disponibles (`CGWATB0085`) se revisan en ese mismo paso: si su tipo base tiene datos se muestra en qué características difiere y el técnico decide con un tick (sustituir) o una cruz (quitar el typekey de la solicitud); sin tipo base con datos solo se puede quitar. El paso "Resumen" mantiene el bloqueo del envío como red de seguridad. Si BMW no responde, se permite continuar y el reader lo rechaza con `422 NOT_AVAILABLE` si procede.
- Mercedes, Grupo VAG y piezas visibles como próximas integraciones.

El envío de correo y el correo en copia no forman parte de esta aplicación.

## Requisitos

- Node.js 22 o posterior.
- Docker Desktop para levantar PostgreSQL localmente, o PostgreSQL instalado.
- Acceso al Active Directory corporativo por LDAP simple, igual que `work-from-home`.
- `renault-reader` ejecutando API y worker, junto con Redis y su almacenamiento S3.

## Configuración

Parte de `.env.example` y proporciona los secretos mediante `.env.local` o el gestor de secretos del entorno. Nunca versiones credenciales, certificados privados ni URLs prefirmadas.

Variables principales:

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL de la aplicación. |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
| `INTEGRATION_LDAP_URL` | Endpoint obligatorio `ldap://`, normalmente Global Catalog en el puerto 3268. |
| `INTEGRATION_LDAP_ACCESSACCOUNT_UPN` | UPN de la cuenta de servicio usada para buscar usuarios. |
| `INTEGRATION_LDAP_ACCESSACCOUNT_PWD` | Contraseña de la cuenta de servicio. |
| `INTEGRATION_LDAP_USER_BASESEARCHGROUP` | Base DN de búsqueda. |
| `INTEGRATION_LDAP_ALLOWED_GROUP_DN` | Grupo AD anidado opcional para restringir el acceso. |
| `RENAULT_READER_BASE_URL` | URL interna del reader; HTTP solo se admite por loopback. |
| `RENAULT_READER_FORMAT` | Valor exacto autorizado por `/labours/options`. |
| `RENAULT_READER_LANGUAGE` | Idioma autorizado por `/labours/options`. |
| `RENAULT_READER_RANGE` | Rango Renault, inicialmente `active`. |
| `RENAULT_READER_DOWNLOAD_ORIGIN` | Origen HTTPS S3 permitido para redirecciones de descarga. |
| `BMW_READER_BASE_URL` | URL interna de BMW Reader; HTTP solo se admite por loopback. |
| `BMW_READER_LANGUAGE` | Idioma de series y etiquetas BMW/MINI; por defecto `en-GB`. |
| `BMW_TRANSFORMER_BASE_URL` | URL de `bmw-transformer` (HTTP solo por loopback). Sin ella no se cargan datos ni se comparan `.LST`. |
| `MAIL_ENABLED` | `true` para enviar correos; por defecto no se envía ninguno. |
| `SMTP_HOST`, `SMTP_PORT` | Relay SMTP interno (puerto 25 por defecto, sin usuario ni contraseña; se usa STARTTLS si el servidor lo ofrece). |
| `SMTP_SECURE` | `true` solo para TLS implícito (puerto 465). |
| `SMTP_FROM` | Remitente; por defecto `extracciones@audatex.es`. |
| `MAIL_SUPPORT_TO` | Buzón de soporte que recibe los avisos de fallo; por defecto `DL-ESMA-D-Acciona@audatexdatos.es`. |
| `MAIL_REDIRECT_TO` | Solo en desarrollo: todos los correos llegan a esta dirección, con el destinatario real en el asunto. |
| `APP_BASE_URL` | URL pública de la web para los enlaces de los correos (`request-extraction-peuwaxprvdacc03.axadmin.net`; si no lleva `http(s)://` se añade `https://`). |
| `RECONCILE_SECRET` | Token aleatorio de al menos 32 caracteres para el trabajo programado. |
| `DATABASE_CA_CERT_PATH` | CA pública opcional para PostgreSQL remoto. |

## Conexión LDAP

La conexión usa LDAP simple sin cifrado para igualar el comportamiento de `work-from-home`. La aplicación exige `ldap://`, utiliza el Global Catalog del puerto 3268 y configura timeouts de ocho segundos.

Las contraseñas del usuario y de la cuenta de servicio viajan sin cifrar por la red. Mantén el servicio en una red interna controlada y no expongas el endpoint LDAP fuera de la red corporativa.

Los valores sensibles de `work-from-home` no se copian al repositorio. Deben suministrarse al despliegue de forma segura.

## Base de datos

La tabla única `extractions` contiene una fila por vehículo y dominio. Las filas del mismo envío comparten `request_group_id`; los parámetros variables del reader se conservan en `reader_params` junto con su versión.

Ejecuta las migraciones antes de iniciar la aplicación:

```bash
npm run db:migrate
```

Para desarrollo local puedes levantar únicamente PostgreSQL con Docker Compose:

```bash
docker compose up -d postgres
npm run db:migrate
```

El servicio solo publica PostgreSQL en `127.0.0.1:5432` y guarda los datos en el volumen `postgres_data`. Puedes personalizar `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` mediante `.env`.

Para generar una migración después de modificar `db/schema.ts`:

```bash
npm run db:generate
```

## Desarrollo

Arranca `renault-reader` en otro puerto porque Next.js utiliza el 3000:

```bash
PORT=3001 bun run start
bun run worker
```

Después inicia la web:

```bash
npm install
npm run db:migrate
npm run dev
```

## Validación

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Arquitectura

El navegador nunca accede directamente a `renault-reader`. Next.js actúa como BFF, comprueba la sesión y propiedad de cada solicitud, valida los datos y proyecta una respuesta pública sin IDs remotos ni claves S3.

El estado del historial permanece en PostgreSQL. La descarga depende de que el estado correspondiente siga disponible en Redis dentro del TTL configurado por `renault-reader`.

Configura un trabajo programado para ejecutar cada minuto `POST /api/internal/reconcile` con `Authorization: Bearer <RECONCILE_SECRET>`. Esta reconciliación actualiza las solicitudes aunque ningún usuario tenga abierto el historial y debe ejecutarse con una frecuencia menor que `STATE_TTL_SECONDS` del reader.

## Carga en BMW_Labour y comparación con el .LST

Cuando **todos** los typekeys de una solicitud BMW/MINI aprobada terminan bien, la web envía la solicitud en el mismo instante en que se detecta el último "Completada" (al sincronizar el estado, ya sea desde el historial o desde la reconciliación). La reconciliación (`POST /api/internal/reconcile`) queda como red de seguridad y reintenta las que no se pudieron enviar (por ejemplo, si el transformer estaba caído). Cada solicitud se envía una sola vez: el estado de carga pasa de vacío a `queued`/`running`/`completed`/`failed` y solo vuelve a vacío con "Reintentar carga". La web envía la solicitud a `bmw-transformer` (`POST /loads`, con la serie y el código de desarrollo de cada typekey y la edición IMC tal cual, p. ej. `05/0`). El transformer crea o reemplaza la tabla `[AxCode]_[Edicion]` en BMW_Labour y guarda el pivote en S3. Una solicitud con incidencias no se carga; "Volver a solicitar" (disponible en cualquier solicitud sin trabajo pendiente, también en las completadas) abre el formulario con todos sus typekeys para extraer otra vez los datos de hoy y, al completarse, vuelve a cargar. No existe repetir un solo typekey: la tabla `[AxCode]_[Edicion]` se reemplaza entera y quedaría con solo ese typekey.

En el historial, dentro de cada solicitud, el panel "Carga en BMW_Labour y comparación" muestra el estado de la carga (con "Reintentar carga" si falla). Cuando está cargada, el solicitante, su coordinador y los administradores pueden subir el listado maestro (`.LST` o `.ZIP`, máx. 25 MB) y la web descarga el Excel `DDA contra BMW` a través de `GET /api/comparisons/{id}/download`, sin exponer el almacenamiento interno.

## Correos

Con `MAIL_ENABLED=true` la web envía, a través del relay SMTP interno (mismo modelo que `work-from-home`):

- **Al solicitante**, cuando la extracción termina y sus datos ya están cargados en BMW_Labour: "ya puedes generar la comparativa", con un enlace a `/history?request=<id>` que abre esa solicitud para subir el `.LST`.
- **A soporte** (`MAIL_SUPPORT_TO`), cuando algo falla: typekeys fallidos cuando la solicitud ya ha terminado, la carga en BMW_Labour o la comparación con el `.LST`.

Cada aviso se envía una sola vez por evento (tabla `mail_notifications`, reserva atómica en Postgres), aunque el historial y la reconciliación lo detecten a la vez. Si el servidor SMTP falla, se reintenta en la siguiente detección, hasta 3 veces; los errores se registran sin direcciones de correo. Recargar los datos o repetir la solicitud genera avisos nuevos. Para probar sin escribir a nadie real, usa `MAIL_REDIRECT_TO`.
