# Registro de progreso

Documento vivo. Cada fase indica qué se implementó, cómo se verificó y qué queda.

## Fase 1 — Núcleo funcional

### Implementado

- Proyecto Next.js 16 (App Router, TypeScript estricto, Tailwind 4) desplegable en Cloudflare Workers con OpenNext; D1, R2 y Workflows enlazados desde `wrangler.jsonc`.
- Esquema D1 completo (`migrations/0001_init.sql`): usuarios, sesiones de autenticación, perfiles, asignaturas, clases, fragmentos de audio, segmentos de transcripción, marcadores, adjuntos, documentos de estudio con versiones, fuentes para recuperación, preguntas e intentos de examen, flashcards y revisiones, chat, trabajos y pasos, consumo. Restricciones CHECK, índices, FTS5 y disparador que impide transiciones de estado inválidas.
- Autenticación propia (PBKDF2 vía WebCrypto, sesiones opacas con hash en base de datos, cookies HttpOnly/SameSite, limitación de intentos, comprobación de origen en toda mutación). Alta cerrada por defecto (`ALLOWED_SIGNUP_EMAILS`).
- Panel, asignaturas (crear/editar/archivar/eliminar), biblioteca por asignatura, búsqueda global (FTS5), ajustes (latencia, idioma de apuntes, retención, límites de gasto).
- Pantalla de grabación:
  - Captura con `getUserMedia` + AudioWorklet → PCM16 24 kHz; medidor de nivel; selección y cambio de micrófono; detección de pérdida del dispositivo; permiso denegado.
  - VAD en cliente para segmentar turnos (la sesión de `gpt-live-transcribe` se configura con `turn_detection: null`, como exige la documentación).
  - Cliente Realtime por WebSocket con credencial temporal (`/v1/realtime/client_secrets`), reconexión con retroceso, mapeo `item_id` → turno, textos provisionales y definitivos, orden por tiempo de audio y no por llegada.
  - Degradación automática a transcripción por turnos (`gpt-transcribe` vía HTTP) cuando el WebSocket no está disponible o se corta; el audio de cada turno se conserva hasta tener transcripción definitiva.
  - Grabación persistente con rotación de `MediaRecorder` (archivos independientes de 60 s, 30 s en Safari, con solape de 300 ms), partes cada 5 s en IndexedDB, suma SHA-256 verificada por el servidor, subidas idempotentes a R2, estado «guardado» solo tras confirmación.
  - Marcadores (importante, posible examen, no entendido, nota), pausa/reanudación, finalización con comprobación de fragmentos faltantes, recuperación tras recarga con intervalo no grabado anotado.
  - Estados visibles reales: en directo / reconectando / por turnos / sin conexión / fragmentos pendientes / micrófono desconectado.
- Página de clase: reproductor sobre los fragmentos (línea de tiempo unificada, salto a segmento y a marcador), transcripción original y vista limpia (párrafos, muletillas opcionales, sin cambiar palabras), búsqueda interna, etiquetas de idioma (modelo o estimación), exportación a Markdown/TXT, edición y eliminación.
- Control de costes: tabla de precios con fecha de comprobación, registro de consumo por sesión, límites mensual y por tarea aplicados antes de cada operación.

### Verificado

- Unitarias: 18 pruebas (`npm test`).
- E2E con micrófono simulado y voz sintética real (`npm run test:e2e`): transcripción en inglés, español y mezcla sin traducción; marcadores; pausa/reanudación; finalización; audio servido con el tamaño correcto; exportación; reproducción; recarga con recuperación de fragmento parcial e intervalo anotado.
- Comprobado con la API real de OpenAI: creación de credenciales temporales para sesiones de transcripción con `languages: ["es","en"]`, `keywords`, `delay`, `noise_reduction`; rechazo documentado de `turn_detection` para `gpt-live-transcribe`; transcripción de archivos con `gpt-transcribe` devolviendo `languages`; Responses API con salida estructurada; embeddings.
- Build de producción con `opennextjs-cloudflare build` y ejecución en `wrangler dev` (workerd) de D1, R2 y Workflow.

### No verificado / limitaciones actuales

- La conexión WebSocket real a `wss://api.openai.com/v1/realtime?intent=transcription` desde el navegador no pudo probarse en el entorno de desarrollo (el proxy de salida devuelve 405 a los upgrades de WebSocket). El cliente sigue la documentación oficial y, si falla, la aplicación cae de forma controlada a la transcripción por turnos (sí verificada). Requiere una prueba manual con credenciales reales.
- Safari/iOS y comportamiento en segundo plano: no probados en esta fase (solo Chromium).
- Los fragmentos parciales recuperados tras un cierre brusco en Safari (`audio/mp4`) pueden no reproducirse; se marcan como tales.
- Pendiente en fases siguientes: apuntes con IA, resúmenes, exámenes, flashcards, chat, adjuntos PDF, editor, exportación PDF/DOCX, PWA.
