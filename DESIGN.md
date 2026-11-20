---
name: Extracciones
description: Portal interno de extracciones de fabricantes; neutro, plano y legible de un vistazo.
colors:
  canvas: "#f4f4f5"
  surface: "#ffffff"
  ink: "#18181b"
  ink-strong: "#09090b"
  ink-secondary: "#3f3f46"
  ink-muted: "#52525b"
  line: "#d4d4d8"
  line-soft: "#e4e4e7"
  surface-sunken: "#fafafa"
  hover-fill: "#27272a"
  accent-focus: "#0369a1"
  accent-ink: "#0c4a6e"
  accent-wash: "#f0f9ff"
  danger-ink: "#991b1b"
  danger-wash: "#fef2f2"
  success-ink: "#065f46"
  success-wash: "#ecfdf5"
  info-ink: "#1d4ed8"
  info-wash: "#eff6ff"
  pending-ink: "#92400e"
  pending-wash: "#fffbeb"
  running-ink: "#075985"
  running-wash: "#f0f9ff"
  issue-ink: "#9a3412"
  issue-wash: "#fff7ed"
  neutral-ink: "#3f3f46"
  neutral-wash: "#f4f4f5"
typography:
  body:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  meta:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  title:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-strong}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.hover-fill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "24px"
---

# Design System: Extracciones

## Overview

**Creative North Star: "El Taller Ordenado"**

Un puesto de trabajo donde cada cosa tiene su sitio. La interfaz es neutra, plana y densa en información útil: el estado de cada solicitud se lee de un vistazo y nada compite con el trabajo. La identidad vive en los detalles precisos (alineación, bordes finos, foco visible), no en el adorno.

El sistema parte de un lienzo gris muy claro con superficies blancas, tinta casi negra y un único acento azul reservado al foco y a las acciones secundarias. Los colores de estado (rojo, verde, azul) aparecen solo para comunicar significado. Las esquinas son amables, con radios de 8 a 12 px, y la separación se hace con bordes de 1 px en lugar de sombras.

**Key Characteristics:**
- Una sola familia tipográfica (Geist) con Geist Mono para códigos y metadatos técnicos.
- Superficies planas con borde fino; la profundidad solo aparece en lo que flota.
- Botón primario oscuro y sólido; el acento azul solo en foco y acciones secundarias.
- Objetivos de 44 px de alto como mínimo en todo control.
- Solo tema claro y solo escritorio (herramienta interna por VPN).

## Colors

Una paleta neutra de grises fríos (escala zinc) con un acento azul de uso muy escaso y tres lavados semánticos.

### Primary
- **Tinta Negra de Trabajo** (#09090b): fondo de los botones primarios, del enlace de navegación activo y del avatar. Es la marca visual del sistema.

### Secondary
- **Azul de Foco** (#0369a1): contorno de foco en botones secundarios y bordes de acciones secundarias. Con **Azul Hondo** (#0c4a6e) para el texto sobre fondo claro y **Lavado Azul** (#f0f9ff) para el hover.

### Neutral
- **Lienzo Gris** (#f4f4f5): fondo de página y de campos deshabilitados.
- **Superficie Blanca** (#ffffff): tarjetas, campos y menús.
- **Tinta Casi Negra** (#18181b): texto principal y borde de foco.
- **Tinta Secundaria** (#3f3f46): etiquetas de campo.
- **Tinta Apagada** (#52525b): texto auxiliar y de campos deshabilitados. Contraste AA sobre blanco y sobre el lienzo.
- **Superficie Hundida** (#fafafa): hover de botones secundarios y fondos de zonas anidadas.
- **Línea** (#d4d4d8): borde de campos y botones secundarios.
- **Línea Suave** (#e4e4e7): borde de tarjetas y separadores.

### Estado
- **Peligro** (#991b1b sobre #fef2f2): errores y rechazos.
- **Éxito** (#065f46 sobre #ecfdf5): confirmaciones y completadas.
- **Información** (#1d4ed8 sobre #eff6ff): rol de coordinador y avisos neutros.
- **Pendiente** (#92400e sobre #fffbeb): pendiente de aprobación o de ejecución.
- **En curso** (#075985 sobre #f0f9ff): extracción en proceso.
- **Incidencias** (#9a3412 sobre #fff7ed): completada con incidencias o respuesta inesperada. Es un estado propio, distinto de pendiente.
- **Neutro** (#3f3f46 sobre #f4f4f5): cancelada, sin configurar.

Cada par tiene además un borde (`*-line`) de un tono más claro. Todos están definidos como tokens en `@theme` de `app/globals.css` (`--color-pending-ink`, `--color-pending-wash`, `--color-pending-line`, etc.) y se consumen con utilidades como `bg-success-wash` o `text-danger-ink`.

### Named Rules
**The Quiet Accent Rule.** El azul no decora. Solo marca foco y acciones secundarias; si aparece como relleno grande, sobra.

**The Meaning-Only Color Rule.** Rojo, verde y azul comunican estado. Nunca se usan para dar ambiente.

## Typography

**Display Font:** Geist (con Arial, Helvetica como respaldo)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono, para AX Code, typekeys y datos técnicos

**Character:** Una sola familia sans geométrica y neutra; la jerarquía se construye con el peso (400, 500, 600) y el tamaño, no con cambios de fuente.

### Hierarchy
- **Headline** (600, 1.5rem, 1.25, `text-headline`): título de cada página.
- **Title** (600, 1.25rem, 1.3, `text-title`): títulos de tarjeta y de sección.
- **Label** (600, 0.875rem): etiquetas de campo y texto de botón.
- **Body** (400, 0.875rem, 1.5, `text-body`): contenido de tablas, listas y párrafos. Longitud de línea máxima de 65 a 75 caracteres en texto corrido.
- **Meta** (500, 0.75rem, `text-meta`): fechas, contadores y estados secundarios. Solo para metadatos, no para contenido útil.
- **Code** (500, 0.8125rem, Geist Mono, `text-code`): códigos AX, typekeys y rutas.

### Named Rules
**The Meta-Only Small Text Rule.** El texto de 12 px es para metadatos. El contenido que el usuario necesita leer va en 14 px o más.

## Layout

Contenedor central de ancho máximo de 72 rem (`max-w-6xl`) con encabezado fijo arriba y pie. Es una herramienta de escritorio por VPN, así que no se diseña para móvil. La densidad es media-alta: tablas, listas y formularios por pasos con rejillas de 2 a 6 columnas. El ritmo de espaciado es de 4, 8, 16, 24 y 32 px. Tarjetas con 24 px de relleno y 24 a 32 px entre secciones. Se reserva el aire generoso para el inicio de sesión y los estados vacíos.

## Elevation & Depth

El sistema es **plano**: las superficies se separan con bordes de 1 px (Línea Suave) sobre el Lienzo Gris, no con sombras. La profundidad solo aparece en lo que flota sobre el contenido (menús desplegables y diálogos), con la sombra `shadow-floating` (`0 4px 16px rgb(0 0 0 / 0.06)`).

### Named Rules
**The Flat-By-Default Rule.** En reposo, ninguna tarjeta ni tabla lleva sombra. Si necesitas separar, usa borde.

## Shapes

Esquinas amables y consistentes: **8 px** en botones (`rounded-lg`), **10 px** en campos (`rounded-field`) y **12 px** en tarjetas y contenedores (`rounded-xl`). Las pastillas (9999 px) se reservan para badges de estado y el avatar. Bordes siempre de 1 px.

### Focus
Un solo estilo en todo el sistema, definido en `@layer base` de `app/globals.css`: contorno de 2 px en Azul de Foco (#0369a1) con separación de 2 px, sobre `a`, `button`, `input`, `select`, `textarea`, `summary` y `[tabindex]`. No se redefine en cada componente.

## Components

### Buttons
- **Shape:** esquinas de 8 px, altura mínima de 44 px.
- **Primary:** fondo Tinta Negra de Trabajo (#09090b), texto blanco, peso 600, relleno de 10 px por 16 px. Hover a #27272a. Deshabilitado con opacidad reducida y cursor de espera.
- **Secondary:** fondo blanco, borde Línea (#d4d4d8), texto Tinta Casi Negra. Hover con un gris muy claro.
- **Destructive:** borde y texto rojos con lavado rojo en hover. El rechazo exige confirmación en dos pasos.
- **Focus:** el contorno único del sistema (ver Focus).
- **Implementación:** `components/ui/button.tsx` (`Button` y `buttonStyles()` para enlaces) con las variantes `primary`, `secondary`, `danger` y `ghost`. `SubmitButton` los reutiliza. No se escriben clases de botón en línea.

### Cards / Containers
- **Corner Style:** 12 px.
- **Background:** blanco sobre el lienzo gris.
- **Shadow Strategy:** ninguna en reposo (ver Elevation & Depth).
- **Border:** 1 px Línea Suave.
- **Internal Padding:** 24 px.

### Inputs / Fields
- **Style:** fondo blanco, borde Línea de 1 px, esquina de 10 px, altura mínima de 44 px, texto de 14 px.
- **Focus:** borde en Azul de Foco más el contorno único del sistema; sin halo.
- **Validación:** `:user-invalid` y `aria-invalid="true"` tiñen el borde de Peligro. Clases `.field-control` y `.field-label` en `app/globals.css`.
- **Error / Disabled:** error con `aria-invalid` y mensaje debajo; deshabilitado con fondo gris y texto apagado.

### Navigation
- Barra superior con enlaces de texto de 14 px y peso 600. El enlace activo es un botón negro sólido de esquina de 8 px; los demás son texto sin relleno. Menú de usuario con avatar redondo oscuro y menú desplegable.

### Status Badges
- Pastilla con lavado semántico, borde fino y texto del color intenso, más un icono de 14 px (reloj, flecha circular, check, aspa, triángulo, información, guion). Estados: pendiente, en curso, completada, con incidencias, fallida, rechazada, cancelada. Se distinguen por icono y texto, no solo por color.
- **Implementación:** `components/ui/badge.tsx` (`Badge` con `tone`: `pending`, `running`, `success`, `danger`, `issue`, `info`, `neutral`, `solid`). `icon={false}` para etiquetas que no son estados (marca, rol).

### Progress Bar (componente distintivo)
- Barra fina con relleno de acento para seguir el avance de una extracción. Se actualiza sola en el historial y respeta `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** separar las superficies con un borde de 1 px (#e4e4e7) y no con sombra.
- **Do** usar un radio de 8 px en botones, 10 px en campos y 12 px en tarjetas.
- **Do** mantener todo control interactivo en 44 px de alto como mínimo.
- **Do** dar a cada estado texto o icono además de color.
- **Do** usar Geist Mono para AX Code, typekeys y otros datos técnicos.
- **Do** respetar `prefers-reduced-motion` y mantener el foco siempre visible.

### Don't:
- **Don't** usar `shadow-sm`, `shadow-lg` ni radios de 16 px (`rounded-2xl`) en tarjetas.
- **Don't** usar azul, verde o rojo como decoración; solo comunican significado.
- **Don't** poner texto de contenido en 12 px; ese tamaño es solo para metadatos.
- **Don't** introducir degradados, emojis, glassmorphism ni fondos decorativos.
- **Don't** diseñar para móvil ni crear tablas apiladas: la herramienta es de escritorio.
- **Don't** repetir las clases de botón o de estado en línea; deben salir de componentes y tokens compartidos.
