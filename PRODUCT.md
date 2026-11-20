# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Empleados de Audatex que usan la web desde escritorio, solo dentro de la VPN corporativa (no hay uso en móvil). Cuatro roles:

- **Técnico (empleado):** solicita extracciones de tiempos de reparación por fabricante, sigue su progreso y descarga el resultado. Es el uso intensivo.
- **Coordinador:** aprueba o rechaza las solicitudes de su equipo. Uso ocasional.
- **Administrador:** gestiona usuarios y revisa el estado de la infraestructura. Uso ocasional.
- **Soporte:** no usa la interfaz; recibe por correo los avisos de fallo.

El uso es mixto: los técnicos la usan de forma intensiva y el resto de roles solo de forma ocasional.

## Product Purpose

Portal interno para solicitar y seguir extracciones técnicas de datos de fabricantes (Renault Labour Times, BMW/MINI por typekey, Mercedes-Benz por modelo; VAG y piezas como próximas integraciones). Cada solicitud lleva AX Code, edición IMC, fecha de finalización, tiempos y comentarios, y se ejecuta de forma asíncrona sobre los servicios reader y transformer de cada fabricante. El éxito es que el técnico solicite sin errores, sepa en todo momento en qué punto está cada extracción y descargue el resultado correcto.

## Positioning

Una única entrada, con autorización por roles y trazabilidad, para solicitar extracciones de varios fabricantes. Sustituye a ejecutar cada reader por separado y deja registro de quién pidió qué, quién lo aprobó y cómo terminó.

## Operating Context

- Acceso con el email y la contraseña de Active Directory (LDAP). La sesión va en una cookie firmada.
- Solo accesible desde la VPN de la empresa y desde escritorio.
- Las solicitudes pasan por aprobación del coordinador antes de ejecutarse. Las extracciones tardan y se siguen en el historial, que se actualiza solo.
- Mercedes-Benz tiene coste por llamada de pago a su API (unas 3000 por modelo); BMW comprueba la disponibilidad de los typekeys antes de enviar.
- Hay avisos por correo al solicitante y a soporte.
- Interfaz en español.

## Capabilities and Constraints

- Formulario por pasos con varios vehículos o modelos por solicitud, borrador guardado y comprobación de disponibilidad (BMW).
- Historial por usuario con progreso, reanudación y descarga protegida del resultado.
- Aprobaciones para coordinadores; administración de usuarios e infraestructura para administradores.
- Comparación de ficheros `.LST` y carga de tablas mediante el transformer.
- Next.js (App Router), PostgreSQL con Drizzle, Oracle como autoridad organizativa, Tailwind 4. Sin conexión a internet pública.

## Brand Commitments

Ninguna vinculante. La identidad visual actual es neutra (Geist, zinc) y se puede evolucionar. Texto de la interfaz en español.

## Evidence on Hand

Código y README del proyecto. No hay guía de estilo, logotipo corporativo ni research de usuarios en el repositorio; no se deben inventar.

## Product Principles

- **El estado es lo primero:** el usuario debe ver de un vistazo en qué punto está cada extracción y qué puede hacer.
- **Prevenir antes que corregir:** validar y avisar antes de enviar, sobre todo donde hay coste o no hay vuelta atrás (Mercedes, reemplazo de tablas).
- **Densidad útil:** es una herramienta de trabajo. Se prioriza la escaneabilidad y la consistencia sobre la expresión.
- **Trazabilidad:** quién pidió, quién aprobó y cómo terminó debe quedar siempre visible y no se pierde.

## Accessibility & Inclusion

Ningún estándar obligatorio. Se mantienen las buenas prácticas ya presentes: foco visible, áreas táctiles amplias, navegación por teclado y respeto de `prefers-reduced-motion`.
