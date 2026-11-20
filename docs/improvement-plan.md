# Plan de mejora

Origen: auditoría con las skills del proyecto (impeccable, minimalist-ui, modern-web-guidance, vercel-react-best-practices, supabase-postgres-best-practices, security-best-practices, next-dev-loop). Fecha: 2026-11-20.

Esfuerzo: **S** pequeño · **M** medio · **L** grande.

## Cómo trabajar este plan

- Una tarea = un commit atómico (Conventional Commits, en inglés). El mensaje sugerido va en cada tarea.
- Antes de cada commit: `npm run lint`, `npm run typecheck` y `npm test`. Si fallan, no se commitea.
- Marcar `[x]` la tarea en el mismo commit que la implementa, o en un commit `docs(plan)` posterior.
- Una rama por fase siguiendo GitFlow (`feature/<fase>`), fusionada con merge. Preguntar antes de cada commit y de cada push.
- Las tareas de base de datos requieren probar la migración en un clon antes de tocar producción.
- Ejecución autorizada por el usuario el 2026-11-20: commits locales en la rama de cada fase y fusión con `--no-ff` a `main` al terminar la fase. **Nunca se hace push** sin pedirlo.
- Si durante una tarea aparece trabajo nuevo, se añade a este archivo en el mismo commit (en la fase que corresponda) para que no se olvide.
- `DISABLE_TELEMETRY=1` en cualquier comando de `modern-web-guidance`, `skills` o `impeccable`.
- Los comandos largos de instalación pueden cortarse si el servidor de OpenCode se reinicia: comprobar el resultado antes de commitear.

## Decisiones tomadas

- **LDAP se queda en `ldap://`:** no hay TLS de red ni HTTPS, así que no se puede pasar a `ldaps://`. Riesgo aceptado. Tampoco se añade STARTTLS.
- **Sin límite de intentos de login:** no se implementa rate limiting.
- **Cuentas de prueba siempre activas:** `TEST_ACCOUNTS_ENABLED` no se restringe en producción ni se quita del seed de `db:deploy`.
- **Solo escritorio:** es una aplicación interna accesible solo por VPN. Se descarta todo lo específico de móvil (tablas apiladas, menú de navegación en móvil, filas del formulario en tablet).
- **`minimalist-ui`:** se descartan el macro-espaciado, las animaciones de entrada escalonadas y los fondos decorativos, por ser una herramienta densa en datos. La serif editorial solo en los títulos de página.

---

## Fase 1: seguridad y configuración

Rama: `feature/security-hardening`

- [x] **1.1 Sesiones revocables** (M) — `lib/auth/session.ts:7,38-50`, `lib/auth/guards.ts:41`
  - Comprobar que el usuario sigue activo en cada petición (flag `active` o `disabledAt` en `users`). Añadir `tokenVersion` o `jti`. Reducir la duración a 1–2 h con renovación.
  - Commit: `feat(auth): make sessions revocable and check the user is active`
- [x] **1.2 Comprobación de `Origin` en los `POST` de Route Handlers** (S)
  - Helper común que valide `Origin` contra `APP_BASE_URL` en `requests/[id]/comparisons`, `report/retry`, `load/retry` e `internal/reconcile`. Revisar `allowedOrigins` si hay proxy inverso.
  - Hecho: el helper `lib/security/origin.ts` acepta `Origin` igual a `Host`, `X-Forwarded-Host` o `APP_BASE_URL`. `internal/reconcile` queda fuera a propósito: se autentica con `Bearer` (sin cookie, no hay CSRF) y sus llamadores no envían `Origin`. Pendiente: si hay proxy inverso, `serverActions.allowedOrigins` en `next.config.ts` solo hace falta si el proxy reescribe `Host` sin `X-Forwarded-Host`.
  - Commit: `fix(api): validate request origin on state-changing route handlers`
- [x] **1.3 Subida de ficheros más segura** (M) — `app/api/requests/[id]/comparisons/route.ts:16-28`, `next.config.ts:8`
  - Contar los bytes leídos del stream, comprobar la firma `PK\x03\x04` del ZIP y que el LST sea texto. Verificar contra la documentación de `node_modules/next/dist/docs/` que `proxyClientMaxBodySize` en `experimental` es válido en esta versión.
  - Hecho: `experimental.proxyClientMaxBodySize` es válido (documentado en `proxyClientMaxBodySize.md`, versión experimental), se mantiene en `26mb`. El tamaño se cuenta ahora sobre los bytes leídos del stream y la firma se valida en `uploadComparison`.
  - Commit: `fix(api): enforce streamed size limit and validate uploaded file signatures`
- [x] **1.4 Límite de uso de los lectores externos** (S) — `app/api/readers/*`
  - Limitar el consumo por usuario y cachear respuestas. Confirmar que `extractions/[id]/route.ts` comprueba propiedad con `getManageableExtraction`.
  - Hecho: tope de 120 consultas/min por usuario en memoria (`lib/readers/usage.ts`, 429 con `Retry-After`; válido mientras la app sea una sola instancia). BMW y Mercedes ya cachean en sus clientes; se añadió caché de 1 h a las familias de Renault. `extractions/[id]/route.ts` comprueba propiedad con `listOwnedExtractions(user.id)` (solo el propietario, más estricto que `getManageableExtraction`).
  - Commit: `feat(readers): cap per-user reader usage and cache responses`
- [x] **1.5 Completar variables de entorno** (S)
  - Faltan en `.env`: `BMW_READER_LANGUAGE`, `MERCEDES_READER_BASE_URL`, `MERCEDES_TRANSFORMER_BASE_URL`, `RENAULT_TRANSFORMER_BASE_URL`, `VAG_READER_BASE_URL`, `VAG_TRANSFORMER_BASE_URL`. Confirmar si son opcionales; si no, definirlas y documentarlas en `.env.example` y `README.md`.
  - Hecho: `BMW_READER_LANGUAGE` (por defecto `en-GB`), `MERCEDES_TRANSFORMER_BASE_URL`, `RENAULT_TRANSFORMER_BASE_URL` y las dos de VAG son opcionales; `MERCEDES_READER_BASE_URL` es obligatoria para pedir extracciones Mercedes-Benz. Documentado en `.env.example` y `README.md`; no se ha tocado `.env`.
  - Commit: `docs(config): document reader and transformer environment variables`
- [x] **1.6 Logs sin el objeto de error completo** (S) — `login/actions.ts:38`, `reconcile/route.ts:31`, `history/actions.ts:22`
  - Registrar solo `error.name` y `error.code`, como `mail/notifications.ts:44`.
  - Hecho en todos los `console.error` con un error (19 archivos, no solo los tres citados) mediante `lib/logging/describe-error.ts`.
  - Commit: `fix(logging): avoid logging full error objects`

---

## Fase 2: base de datos

Rama: `feature/database-hardening`. Probar cada migración en un clon antes de producción.

- [x] **2.1 Índice para `findLoadedTable`** (S) — `lib/transformer/repository.ts:26-35`
  - `CREATE INDEX` sobre `(brand, imc_edition, upper(ax_code))` parcial (`manufacturer_group='BMW'` y `load_status IN ('queued','running','completed')`). `CONCURRENTLY` no puede ir en la transacción de `drizzle-kit migrate`: usar índice normal (tabla pequeña) o un archivo fuera de transacción.
  - Commit: `perf(db): add index for loaded table lookup`
- [x] **2.2 Índices parciales de "listas para cargar/informe"** (S) — `repository.ts:16-17,183-184`
  - `(created_at) WHERE status='approved' AND manufacturer_group='BMW' AND load_status IS NULL` y el equivalente de Mercedes con `report_status IS NULL`.
  - Commit: `perf(db): add partial indexes for reconciliation queries`
- [x] **2.3 Paginación de los listados** (M) — `lib/extractions/repository.ts:257-278,316-324`
  - Paginación por keyset sobre `(created_at DESC, id DESC)`. `listPendingRequests` debe paginar por solicitud y no por fila del join. Índice `extractions_created_idx`. Cambia la API y la interfaz del historial: hacerlo en un solo cambio con la tarea 4.3.
  - Commit: `feat(extractions): paginate extraction and pending-request listings`
  - Hecho junto con 4.3 en `feat(history): compact rows with search and status filter`. La paginación es por solicitud (keyset `(created_at DESC, request_group_id DESC)` sobre `extraction_requests`) y no por fila, para no partir un grupo entre páginas; por eso los índices (`extraction_requests_created_idx` y `extraction_requests_requester_created_idx`) están en `extraction_requests` y no en `extractions`. Migración `0040_request_pagination_indexes` (sin ejecutar): **renumerar al fusionar si otra rama ya usa ese número, y mantener el `when` del journal mayor que el de la última migración aplicada**. El historial pagina de 20 en 20 con «Cargar más»; aprobaciones, con «Ver más solicitudes». La búsqueda por AX es en servidor; el filtro por estado actúa sobre las solicitudes ya cargadas.
- [x] **2.4 Unificar el camino de migraciones** (M) — `scripts/apply-migrations.ts`, `scripts/migrations.ts`, `package.json`, `db/migrations/meta`
  - Un único camino con `drizzle-kit migrate`. Resolver la ausencia de snapshots en `meta/` (verificarla antes de actuar). `psql` con `--single-transaction` si se mantiene `docker:setup-db`. No generar nunca una migración con `when` menor que la última aplicada.
  - Hecho: `meta/` solo tiene `_journal.json` (verificado), así que `db:generate` queda desactivado (`scripts/db-generate-disabled.mjs`) y las migraciones se escriben a mano; `docker:setup-db` ahora es `drizzle-kit migrate` y se elimina `scripts/apply-migrations.ts`. `scripts/migrations.ts` se mantiene para `run-integration-tests.ts` (base temporal).
  - Commit: `build(db): unify migrations on drizzle-kit migrate`
- [x] **2.5 Timeouts del pool** (S) — `db/index.ts:34-47`
  - `statement_timeout` e `idle_in_transaction_session_timeout` en `connection`.
  - Commit: `fix(db): set statement and idle-in-transaction timeouts`
- [x] **2.6 Advisory lock de 64 bits** (S) — `lib/extractions/repository.ts:37`
  - Sustituir `hashtext(userId)` por `hashtextextended(userId, 0)`.
  - Commit: `fix(extractions): use 64-bit advisory lock key`
- [x] **2.7 `RESTRICT` en el FK de los logs de auditoría** (S) — `db/schema.ts:96,137,157,173`
  - `extraction_action_logs.extraction_id` pasa a `RESTRICT`. Migración con `NOT VALID` y luego `VALIDATE`.
  - Commit: `fix(db): protect audit logs from cascade deletion`
- [x] **2.8 Índices redundantes** (S) — `db/schema.ts`
  - `extractions_group_idx` pasa a `(request_group_id, created_at)`. Crear el nuevo antes de eliminar el antiguo.
  - Commit: `perf(db): replace redundant extraction indexes`
- [x] **2.9 Rol de aplicación sin permisos DDL** (M)
  - Rol de migración y rol de aplicación con `SELECT/INSERT/UPDATE`. Actualizar `docker-compose.yml`, `.env.example` y `README.md`.
  - Commit: `feat(db): separate migration and application database roles`
- [x] **2.10 Ajustes menores de base de datos** (S)
  - `drizzle.config.ts` no debe fallar al importarse sin `DATABASE_URL` en `generate`. Codificar la contraseña en `DATABASE_URL` de `docker-compose.yml`. Normalizar `fallback_email` a minúsculas en `findUserByFallbackEmail`. Valorar `now()` de la BD en `updated_at`.
  - Hecho: `drizzle.config.ts` ya no lanza al importarse; `DATABASE_URL_DOCKER` permite una URL ya codificada en Compose (que no puede codificar); `findUserByFallbackEmail` normaliza a minúsculas. `now()` de la BD en `updated_at` se descarta por ahora: implica tocar muchos `set({ updatedAt: new Date() })` sin ganancia relevante.
  - Commit: `fix(db): tolerate missing DATABASE_URL on generate and normalize fallback emails`

---

## Fase 3: rendimiento (React y Next)

Rama: `feature/performance`. Consultar `node_modules/next/dist/docs/` antes de tocar APIs de Next.

- [x] **3.1 `Promise.all` en `getVerifiedUser`** (S) — `lib/auth/guards.ts:17-25`
  - Paralelizar `resolveUserIdentities` y `resolveUserRole`.
  - Commit: `perf(auth): resolve identity and role in parallel`
- [x] **3.2 `Suspense` sobre el header del dashboard** (M) — `app/(dashboard)/layout.tsx:6`
  - Layout síncrono y `AppHeader` async dentro de `<Suspense>`. Las páginas siguen autorizando con `requireUser()`.
  - Commit: `perf(layout): stream the dashboard header behind Suspense`
- [x] **3.3 `matcher` en `proxy.ts`** (S)
  - Excluir estáticos y prefetch, según `content-security-policy.md` de la documentación de Next.
  - Commit: `perf(proxy): restrict proxy matcher to page requests`
- [x] **3.4 Carga diferida en el formulario por pasos** (M) — `components/extractions/extraction-stepper-form.tsx`
  - `next/dynamic` para los selectores por fabricante y `BmwSwapReview`. Medir el bundle antes y después; decidir si `zod` debe quedarse en el cliente.
  - Resultado: `next build --webpack` (Turbopack no resuelve el `node_modules` enlazado en el worktree): JS total 1.130.081 B → 1.134.371 B (el reparto en chunks añade sobrecarga; BmwSwapReview y MercedesModelSelector salen del chunk de la página). `zod` se queda en el cliente (sin medir).
  - Commit: `perf(extractions): lazy-load manufacturer selectors in the stepper form`
- [x] **3.5 Agrupar con `Map` en el historial** (S) — `extraction-history.tsx:260-265`
  - Sustituir el `groups.find` dentro del bucle (O(n·g)) por un `Map`.
  - Commit: `perf(history): group extractions with a map`
- [x] **3.6 Listeners pasivos** (S) — `extraction-history.tsx:49-70`
  - `{ passive: true }` en `scroll` y `resize`. Se absorbe si 4.2 sustituye el menú.
  - Absorbida por 4.4: el menú con `popover` ya no registra listeners de `scroll` ni `resize`. Agrupación con `Map` (3.5) hecha en 4.3.
  - Commit: `perf(history): register scroll listeners as passive`

---

## Fase 4: interfaz y experiencia de usuario

Rama: `feature/ui-refresh`. Orden: tokens (4.1) antes de componentes (4.5) y de los retoques visuales (4.6).

- [x] **4.1 Tokens de diseño** (M) — `app/globals.css`
  - En `@theme`: colores de estado (pares pastel), bordes, fondo, texto secundario con contraste AA y escala tipográfica con nombre. Un solo estilo de foco (hoy hay dos y una regla duplicada en `globals.css:23-26` y `:59-64`).
  - Commit: `feat(ui): define design tokens for color, type and focus`
- [x] **4.2 `ConfirmDialog` con `<dialog>`** (M)
  - Sustituir los 4 `window.confirm` (`extraction-history.tsx:73,131`, `extraction-stepper-form.tsx:311,323`) con consecuencias explícitas en el texto.
  - Commit: `feat(ui): replace window.confirm with a native dialog component`
- [x] **4.3 Historial con filas compactas, búsqueda y filtro por estado** (M) — `extraction-history.tsx:283-310`
  - Fila compacta (AX, marca, estado, progreso, fecha) con detalle al expandir, búsqueda por AX y filtro por estado. Hacerlo junto con 2.3. `content-visibility: auto` en cada grupo.
  - Commit: `feat(history): compact rows with search and status filter`
- [x] **4.4 Menú de acciones con `popover` y anclaje** (M) — `extraction-history.tsx:41-120`
  - Sustituir los listeners y el cálculo manual de posición. Descargar y reanudar como botones visibles. Aplicar el mismo patrón a `components/layout/user-menu.tsx`.
  - Commit: `feat(history): use native popover for row actions and user menu`
- [x] **4.5 Componentes `Badge` y `Button` compartidos** (M)
  - Eliminar las clases repetidas y los estilos de estado duplicados (`extraction-history.tsx:14-17`, `transformer-panel.tsx:10-13`, `infrastructure/page.tsx:19-22`, `users-table.tsx:16`). Icono además del color. Estilo propio para "completada con incidencias".
  - Commit: `refactor(ui): extract shared Badge and Button components`
- [x] **4.6 Retoques visuales de minimalist-ui** (S)
  - Quitar `shadow-sm/lg/xl`, bajar `rounded-2xl` a `rounded-xl`/`rounded-lg`, simplificar la franja oscura y la tarjeta del login. Quitar `animate-pulse` de las barras de progreso. Fondo cálido y bordes finos vía tokens.
  - Commit: `style(ui): flatten shadows and reduce corner radii`
- [x] **4.7 Accesibilidad del formulario por pasos** (S–M) — `extraction-stepper-form.tsx:494-497,149-150`
  - `aria-describedby` hacia `FieldError`, foco en el primer error, `<label>` visible en lugar de `aria-label` (también en `mercedes-model-selector.tsx:84,91`), `:user-invalid`, `pattern`/`minlength` en `axCode` e `imcEdition`, región `aria-live` con el número de resultados del buscador.
  - Commit: `fix(a11y): associate field errors and move focus to the first invalid field`
- [x] **4.8 Copy y flujo** (S)
  - `<Link>` en lugar de `<a href>` (`approvals/page.tsx:28`). Enfocar y exigir el comentario al rechazar (`approval-form.tsx`). Etiqueta corta del comentario. Etiquetas del login con `.field-label` y botón "Mostrar contraseña". Página de error con salida al inicio y `digest`. Título de paso por grupo en lugar de "Tiempos X". "Atrás" con `hidden` en lugar de `invisible`. Hora local en infraestructura. `aria-live` para "Guardando borrador…". `text-xs` solo en metadatos.
  - Commit: `fix(ui): improve copy, links and flow in approvals, login and error pages`

### Pasadas de impeccable (cierre de la Fase 4)

Contexto ya creado: `PRODUCT.md`, `DESIGN.md` y `.impeccable/design.json` (comandos `init` y `document`). Cada comando se ejecuta con el launcher `.agents/skills/impeccable/scripts/impeccable.cmd` y la variable `DISABLE_TELEMETRY=1`. Las pasadas que editan código se commitean aparte, una por comando.

- [x] **4.9 `extract`** (M) — hacerlo junto con 4.1 y 4.5
  - Sacar a tokens y componentes compartidos lo repetido. Actualizar `DESIGN.md` y `.impeccable/design.json` con los valores finales.
  - Commit: `docs(design): refresh DESIGN.md after extracting tokens and components`
- [x] **4.10 `critique`** (S) — sobre historial, formulario por pasos, aprobaciones y login
  - Puntuación heurística antes y después de 4.2 a 4.8. Anotar en esta lista los hallazgos nuevos que no se arreglen en el momento.
  - Sin commit si solo analiza.
  - Hecho (2026-11-20, ejecución inline por no haber herramienta de subagentes; sin navegador porque solo `/login` es visitable; el detector se ejecuta una vez en 4.15). Puntuación **28/40 (Bueno)**; antes de 4.2 a 4.8 ≈ **21/40** (estimación retrospectiva a partir del historial de git: `window.confirm`, errores sin asociar, menú con listeners manuales). Detalle: visibilidad 3, lenguaje 3, control 3, consistencia 3, prevención de errores 3, reconocimiento 3, flexibilidad 2, minimalismo 3, recuperación 3, ayuda 2.
  - Hallazgos que se arreglan en 4.12 a 4.14 y 5.6: **[P1]** el formulario por pasos y los paneles de BMW/Mercedes siguen con paleta cruda (`zinc/sky/red/amber`, `text-sm/xs/lg`) en vez de tokens; el azul se usa como relleno (paso activo, grupo y fabricante elegidos), contra la Quiet Accent Rule. **[P1]** la jerarquía de títulos no sigue la escala (`h1` en `text-3xl`, `h2` en `text-lg/xl`, tarjeta de resumen en `text-2xl`). **[P2]** aprobaciones: los modelos se muestran como una cadena separada por comas, ilegible con decenas de typekeys. **[P2]** alertas y avisos repetidos con clases en línea (5.6). **[P2]** el estado vacío del login/errores usa colores crudos.
  - Hallazgos que **no** se arreglan ahora: **[P2]** el solicitante solo se ve al expandir una solicitud; coordinadores y administradores querrían verlo en la fila compacta. **[P2]** el filtro por estado actúa solo sobre las solicitudes cargadas (limitación conocida de 2.3). **[P3]** flexibilidad: sin atajos de teclado ni acciones masivas entre solicitudes. **[P3]** ayuda: no hay ayuda contextual más allá de los textos junto al campo; términos como «Completion» o «reader» sin glosario.
- [x] **4.11 `audit`** (S) — `components/` y `app/`
  - Accesibilidad, rendimiento y consistencia. Corregir lo bloqueante y anotar el resto.
  - Commit (si corrige): `fix(a11y): address impeccable audit findings`
  - Hecho (revisión de código; el detector queda para 4.15). Puntuación: accesibilidad 3, rendimiento 3, tema/tokens 2 → 3 tras la corrección, responsive n/a (solo escritorio), integridad 3.
  - Corregido: 94 usos de paleta cruda (`zinc/sky/red/amber/emerald`, `bg-white`, `text-white`) sustituidos por tokens en 27 archivos (los textos `zinc-500` pasan a `ink-muted`, que sí cumple AA sobre el lienzo); `aria-labelledby` colgante en las secciones del formulario por pasos (los `h2` no tenían `id`); los cuatro «Reintentar» subrayados pasan a `Button` (objetivo de 44 px); `global-error` importa `globals.css`, sin lo cual se veía sin estilos; hover invisible del botón de sustituir typekey.
  - Pendiente/anotado: el `prefers-reduced-motion` global fuerza `0.01ms` en todo (aceptable porque ninguna transición lleva información que no tenga también texto); restos de clases de móvil (`max-w-[calc(100vw-9rem)]` en el menú, prefijos `sm:`) sin efecto en escritorio; los enlaces «Descargar Excel» del panel del transformer son enlaces en línea de menos de 44 px; `global-error` no carga las fuentes del layout.
- [ ] **4.12 `layout`, `typeset` y `clarify`** (M) — solo donde la crítica lo pida
  - `typeset` hecho: `text-sm/xs` pasan a `text-body/meta`; títulos de sección y tarjeta a `text-title`/`text-headline`/`text-body`; `text-wrap: balance` en `h1-h3` y `pretty` en párrafos desde `@layer base`; eliminados los eyebrows (`PageHeader.Eyebrow`, «Portal interno», «404» sobre el título).
  - `layout` hecho: en el formulario por pasos el azul deja de ser relleno (paso activo/completado, grupo y fabricante elegidos pasan a tinta, con icono de check además del color; el fabricante reutiliza `buttonStyles`; la marca del resumen es un `Badge`); rejilla de escritorio fija en grupos, resumen y barra de acciones; en aprobaciones los modelos son una lista desplazable y enfocable en vez de una cadena con comas.
  - `clarify` hecho: «Completion» pasa a «Fecha de finalización» (formulario, resumen e historial, igual que los mensajes de validación) y el error de LDAP no disponible indica qué hacer.
  - `layout` en historial y formulario, `typeset` para la jerarquía de títulos, `clarify` para textos y errores.
  - Commit por comando: `style(ui): refine layout ...`, `style(ui): refine type hierarchy`, `fix(ui): clarify copy and error messages`
- [x] **4.13 `harden`** (S) — estados vacíos, de error y de carga del historial, aprobaciones y administración
  - Commit: `fix(ui): harden empty, error and loading states`
  - Hecho: `history/actions.ts` estaba guardado en Latin-1 (los acentos de los mensajes salían como `�`) y registraba el objeto de error completo; ahora es UTF-8 y usa `describeError`. El historial ofrece «Reintentar» tras un fallo de búsqueda o de «Cargar más» y avisa de que el filtro solo cubre lo cargado cuando quedan solicitudes sin cargar. Aprobaciones gana «Volver a la primera página» al paginar y un vacío específico en páginas posteriores. Ya existían y se revisan sin cambios: esqueletos de `loading.tsx` en historial, aprobaciones, usuarios e infraestructura, vacío del historial y de usuarios, error de sincronización y límite de errores del dashboard.
- [x] **4.14 `polish`** (S) — pasada final de toda la interfaz
  - Commit: `style(ui): final polish pass`
  - Hecho: ritmo vertical único entre secciones (`space-y-6`, antes 6, 7 y 8 según la página, también en los esqueletos); eliminados los restos de móvil y tablet (`sm:`, `md:`, `lg:`, el ancho calculado del menú con desplazamiento) y las rejillas quedan fijas para escritorio.
- [x] **4.15 Detector** (S)
  - `impeccable.cmd detect --json --changed` sobre la interfaz terminada, una sola vez. Arreglar los hallazgos reales y anotar los falsos positivos en `.impeccable/critique/ignore.md`.
  - Hecho: sin hallazgos. `detect --json --changed` devolvió `[]` (árbol limpio tras los commits); se repitió con los 33 `.tsx` cambiados respecto a `main` y con `app/` y `components/` completos: `[]` en ambos. Sin falsos positivos, así que no se crea `.impeccable/critique/ignore.md`. No hay commit de código.
  - Commit: `style(ui): resolve design detector findings`
- [ ] **4.16 Capturas con `impeccable shot`** (S) — solo `/login` sin sesión (el resto requiere LDAP)
  - Comprobar a 1280 y 1536 px de ancho que el login queda bien tras 4.6. Es solo de escritorio.
  - **Bloqueada:** `npx next dev -p 3106` se niega a arrancar porque ya hay un `next dev` en este directorio (puerto 3000, PID ajeno): Next permite un solo servidor de desarrollo por proyecto. Alternativas descartadas por tocar el servidor del usuario (`next build` escribe en `.next`). Reintentar cuando el servidor del 3000 esté parado: `impeccable shot http://localhost:PUERTO/login --viewport 1280x800,1536x864`.

---

## Fase 5: opcional y a medio plazo

Rama: `feature/housekeeping`

- [ ] **5.1 Dark mode** (L) — `color-scheme: light dark` y `light-dark()` con tokens. Depende de 4.1.
  - Commit: `feat(ui): add dark color scheme`
- [x] **5.2 Allowlist de origen en la descarga del transformer** (S) — `lib/transformer/client.ts:166-172`
  - Igual que Renault, y rechazar IPs privadas y de metadatos.
  - Commit: `fix(transformer): restrict report download to trusted origins`
- [x] **5.3 Dependabot y auditoría en CI** (S) — `.github/workflows`
  - Commit: `ci: add dependency audit and Dependabot`
- [x] **5.4 Docker** (S)
  - Puerto 3000 en `127.0.0.1`, imágenes fijadas por digest y `HEALTHCHECK` en el `Dockerfile`.
  - Commit: `build(docker): pin images, bind loopback and add healthcheck`
- [x] **5.5 Serif editorial en los títulos de página** (S) — solo en los `h1`, vía `next/font`.
  - Hecho: Newsreader (variable `--font-newsreader`, token `--font-serif` y `--text-display` en `@theme`) en `PageHeader.Title`, el `h1` del login, `not-found` y el error del dashboard. `global-error` queda en sans: no carga las fuentes del layout.
  - Commit: `style(ui): use a serif face for page titles`
- [x] **5.6 Refinamientos menores** (S)
  - Debounce con `useDeferredValue` en los buscadores (`users-table.tsx:37`, `mercedes-model-selector.tsx:100`). Animar el progreso con `transform: scaleX`. Caché de `fetch` entre pasos del formulario. Unificar alertas con los tokens de color.
  - Commit: `perf(ui): defer search filtering and animate progress with transform`
  - Hecho: `useDeferredValue` en los filtros locales del formulario (Mercedes, Renault y typekeys de BMW); `users-table` se queda con el debounce porque su búsqueda navega al servidor y `useDeferredValue` no reduce ese viaje. Barra de progreso con `transform: scaleX()`. Caché de 5 min en memoria de las listas de opciones entre pasos (`lib/client/cached-json.ts`; solo respuestas válidas). Componente `Alert` en `components/ui/alert.tsx` para unificar los avisos con tokens (login, aprobaciones, historial, formulario, disponibilidad BMW).
- [ ] **5.7 Pasada autenticada** (M)
  - Revisar con `next-dev-loop` y un usuario de pruebas `/extractions`, `/history`, `/approvals` y `/admin/*` (consola y Web Vitals). No se pudo hacer en la auditoría.

---

## Descartado

- Pasar LDAP a `ldaps://` o STARTTLS (sin TLS de red).
- Limitar los intentos de login.
- Restringir las cuentas de prueba en producción.
- Todo lo específico de móvil y tablet: tablas apiladas, menú de navegación en móvil, filas del formulario en tablet.

## Notas

- Si el equipo decide más adelante habilitar TLS en LDAP, retomar el hallazgo A1 del informe de seguridad.
- Las líneas de las migraciones que dio la auditoría de Postgres eran aproximadas: verificar antes de editar.
- `modern-web-guidance`: usar `DISABLE_TELEMETRY=1` (ya definido a nivel de usuario) en cualquier comando de su CLI.
