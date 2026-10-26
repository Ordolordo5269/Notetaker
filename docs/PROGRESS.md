# Registro de progreso

Documento vivo. Cada fase indica qué se implementó, cómo se verificó y qué queda. Al final hay un informe de entrega honesto: qué funciona, qué se verificó con credenciales reales, qué necesita una prueba manual y cómo comprobarlo.

## Fase 1 — Núcleo funcional

### Implementado

- Proyecto Next.js 16 (App Router, TypeScript estricto, Tailwind 4) desplegable en Cloudflare Workers con OpenNext; D1, R2 y Workflows enlazados desde `wrangler.jsonc`.
- Esquema D1 completo (`migrations/0001_init.sql`): usuarios, sesiones de autenticación, perfiles, asignaturas, clases, fragmentos de audio, segmentos de transcripción, marcadores, adjuntos, documentos de estudio con versiones, fuentes para recuperación, preguntas e intentos de examen, flashcards y revisiones, chat, trabajos y pasos, consumo. Restricciones CHECK, índices, FTS5 y disparador que impide transiciones de estado inválidas.
- Autenticación propia (PBKDF2 vía WebCrypto, sesiones opacas con hash en base de datos, cookies HttpOnly/SameSite, limitación de intentos por cuenta y por IP, comprobación de origen en toda mutación). Alta cerrada por defecto (`ALLOWED_SIGNUP_EMAILS`).
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

- Unitarias y E2E con micrófono simulado y voz sintética real: transcripción en inglés, español y mezcla sin traducción; marcadores; pausa/reanudación; finalización; audio servido con el tamaño correcto; exportación; reproducción; recarga con recuperación de fragmento parcial e intervalo anotado.
- Comprobado con la API real de OpenAI: creación de credenciales temporales para sesiones de transcripción con `languages: ["es","en"]`, `keywords`, `delay`, `noise_reduction`; rechazo documentado de `turn_detection` para `gpt-live-transcribe`; transcripción de archivos con `gpt-transcribe` devolviendo `languages`; Responses API con salida estructurada; embeddings.

## Fase 2 — Apuntes con IA

### Implementado

- Motor de trabajos: tabla `processing_jobs` + `job_steps` (cada paso guarda su resultado, por lo que un reintento reanuda donde se quedó), etapas reales visibles, cancelación, reintento, estimación de coste previa, límites de gasto, deduplicación (un trabajo activo por tipo y clase). En producción corre en un **Cloudflare Workflow** (`worker/workflow.ts`, pasos con reintentos y tiempo límite); en `next dev` corre en el propio proceso. Un trabajo sin señal de vida durante 10 minutos se marca como fallido al consultarlo (reintentable) y el cron diario limpia el resto.
- Pipeline de apuntes (`src/lib/notes/pipeline.ts`): consolidación de la transcripción en bloques (huecos y saltos anotados) → extracción por bloque con el modelo rápido (temas, definiciones, normas, ejemplos, excepciones, comparaciones, avisos de examen, ambigüedades) → índice global con el modelo principal (marcadores del alumno incluidos) → redacción de cada sección con los pasajes citables ⟦sN hh:mm:ss⟧ y las páginas de las diapositivas (concurrencia 3; las secciones con subsecciones se redactan como introducción breve para no duplicar) → revisión de cobertura contra la lista de control → segunda pasada solo en las secciones con omisiones → documento versionado con índice navegable, referencias `[[ref:a-b]]` resueltas a tramos de audio, ambigüedades por sección, huecos y «puntos no ubicados». Reglas de fidelidad en todos los prompts: no inventar, no traducir, marcar «Explicación complementaria» y «según las diapositivas».
- Resúmenes (rápido, completo, última hora) derivados de los apuntes; preguntas de examen (test, cortas, desarrollo, oral por niveles 1–4, casos) con respuesta modelo, criterios y referencias al audio.
- Visor de documentos: índice lateral activo, pie de procedencia por sección («Basado en la explicación entre…»), citas clicables que mueven el reproductor, avisos de huecos/ambigüedades.

### Verificado

- Con la API real: apuntes de la clase de prueba (18 min, inglés + español, Derecho internacional privado) — 20–21 secciones, ≈ 7.000–9.700 palabras, todas las secciones con citas al audio, 0 puntos sin ubicar, coste 0,33–0,40 $ (estimación previa 0,25 $); resúmenes y 30 preguntas de examen con referencias correctas comprobadas por muestreo contra la transcripción.
- Reanudación: un trabajo interrumpido a mitad (15/20 secciones) se reintentó y terminó reutilizando los pasos guardados (coste adicional 0,08 $ en lugar de repetir todo).

## Fase 3 — Experiencia académica completa

### Implementado

- **Chat** con recuperación híbrida sobre ventanas de transcripción, secciones de apuntes y páginas de documentos (FTS5 con términos de contenido + embeddings `text-embedding-3-small`, fusión por rango recíproco, cuota mínima de transcripción, segunda pasada anclada en la diapositiva cuando la pregunta nombra una página). Respuestas con «Basado en tu clase» (citas a minutos, secciones y páginas, verificables con un clic) y «Explicación adicional» separadas; reconoce lo que no se trató; propone preguntas de seguimiento; conversaciones persistentes.
- **Flashcards** con repetición espaciada (variante SM‑2, `again/hard/good/easy`), repaso por clase y repaso global en `/review`, edición y eliminación.
- **Modo examen**: preguntas priorizadas (no respondidas, conceptos débiles), corrección local de tipo test y corrección con modelo de respuestas abiertas (puntuación, veredicto y comentario basados en la respuesta modelo), historial de intentos.
- **Documentos del profesor**: subida de PDF/DOCX/PPTX (≤ 25 MB, tipo comprobado por bytes mágicos) a R2 privado, extracción por página/diapositiva/fragmento (`unpdf`, `mammoth`, `jszip`) como trabajo en segundo plano, PDF escaneado marcado honestamente como ilegible, visor por páginas, «Preguntar» → chat con la pregunta prellenada, cita del chat → página resaltada. Las páginas se usan en la redacción de apuntes y en el chat.
- **Editor de apuntes** (Tiptap, ida y vuelta Markdown sin pérdidas, marcas `[[ref]]` conservadas): cada guardado crea una versión `user` con la sección marcada «Editado manualmente»; historial con previsualización y restauración; regeneración de **una sola sección** con indicaciones del estudiante (trabajo `section`, versión `ai_section`), avisando de que no se inventa contenido.
- **Exportación** generada en el dispositivo (la API key no interviene): PDF con pdfmake y la fuente Geist (portada, índice con páginas, procedencia por sección, citas temporales en gris, tablas, listas, citas, pie con paginación); DOCX con índice real de Word, estilos de encabezado, listas y tablas; Markdown y TXT. Disponible para transcripción (original y limpia), apuntes y resúmenes.

### Verificado

- Navegador real (Playwright): subida y extracción de PDF/PPTX/DOCX y PDF escaneado; edición de sección con conservación exacta del resto del documento y de las 7 referencias del texto; historial y restauración; regeneración de una sección (tabla añadida, resto intacto, 0,008 $); descargas PDF/DOCX/PDF de transcripción abiertas y leídas de nuevo con `unpdf` y `mammoth` (28 páginas, índice y pie correctos).
- Chat con diapositivas: «¿Qué explicó el profesor sobre la diapositiva 4?» cita la diapositiva, los minutos 05:24–08:01 de la grabación y enumera lo que el profesor añadió oralmente (Color Drack, Marinari, Kalfelis) que no está en la diapositiva.

## Fase 4 — Robustez, seguridad, pruebas y documentación

### Implementado

- Suites E2E sin coste de IA: grabación, documentos y seguridad (14 accesos cruzados → 404, CSRF, 401, cookie, bloqueo de intentos). Suite de IA opcional (`E2E_AI=1`). 40 pruebas unitarias.
- Límite de intentos por IP ampliado (200/15 min) para redes universitarias con NAT; detección de trabajos muertos al consultarlos; etiquetas de adjuntos separadas del extractor para no arrastrar librerías de servidor al navegador; pestañas activas siempre visibles en móvil.
- Documentación: `README.md`, `docs/DEPLOY.md`, `docs/TESTING.md`, `.env.example` y `.dev.vars.example`.

### Verificado

- `npm run typecheck`, `npm run lint` (0 errores), `npm test` (42/42), `npm run test:e2e` (grabación, documentos, seguridad, accesibilidad) contra `next dev`.
- **Runtime real de Workers** (`opennextjs-cloudflare build` + `wrangler dev`, workerd con D1, R2 y Workflows locales): alta, siembra de clase, subida y extracción de PDF en el Worker, suites E2E de documentos y seguridad, generación completa de apuntes a través del **Workflow** (20 secciones, 6.949 palabras, diapositivas consumidas, 0,34 $, reanudación tras interrupción) y chat con citas a diapositiva y transcripción.

## Fase 5 — Integración continua, clases largas, accesibilidad y PWA

### Implementado

- **CI en GitHub Actions** (`.github/workflows/ci.yml`): typecheck, lint, unitarias, migraciones D1 locales, E2E sin coste (documentos, seguridad, accesibilidad) y build de producción con OpenNext en cada pull request. La suite de grabación se ejecuta solo si el repositorio tiene el secreto `OPENAI_API_KEY`.
- **Clases largas**: las llamadas con salida estructurada reintentan automáticamente una respuesta incompleta por `max_output_tokens` con más presupuesto y menos razonamiento; los presupuestos del índice y la revisión crecen con el número de bloques; la extracción por bloques se ejecuta con concurrencia 3; el contador de progreso es monótono con trabajos concurrentes; un trabajo reintentado no se confunde con uno muerto.
- **Guardia de presupuesto durante el trabajo**: además de la estimación previa, el trabajo se detiene (conservando los pasos hechos) si supera en un 10 % el límite por tarea o si el gasto mensual rebasa el límite.
- **Estimador recalibrado** con dos ejecuciones reales (18 y 88 minutos) y protegido por una prueba unitaria: nunca por debajo del coste medido y como mucho un 60 % por encima.
- **Accesibilidad**: cero violaciones de axe (WCAG 2.1 AA + buenas prácticas) en 16 pantallas en modo claro y oscuro, comprobado por una prueba E2E que CI ejecuta.
- **PWA**: service worker con shell offline y página `/offline`; manifest `standalone`; el editor Tiptap se carga bajo demanda.
- Fixture sintética de 88 minutos (`npm run fixtures:long`, generada con el modelo rápido) para pruebas de escala.

### Verificado

- Pipeline completo sobre la clase de 88 minutos (396 turnos, 12.900 palabras, bilingüe): 11 bloques, índice de 40 secciones, 24.015 palabras de apuntes, 40/40 secciones con citas al audio, 4 puntos no ubicados señalados, diapositivas consumidas, coste real 1,88 $ (estimación anterior 0,81 $, nueva 1,99 $), 7 minutos de proceso tras el reintento. El primer intento falló en el índice por `max_output_tokens`: ese fallo motivó los cambios anteriores y el reintento reutilizó los 11 pasos de extracción ya guardados.
- Chat sobre la clase larga: respuesta anclada en los minutos 25:50–28:07 con el aviso de examen literal del profesor.
- Service worker activo en la vista previa de workerd, página offline servida sin red, manifest válido.
- Peso de cliente medido en la vista previa de producción: 0,7 MB de JS sin comprimir en panel y ajustes, 0,85 MB en grabación, 1,6 MB en la página de clase antes de diferir el editor.

## Informe de entrega

### Lo que funciona y se ha probado

- Grabación robusta con guardado progresivo, recuperación y transcripción fiel en el idioma hablado (ruta por turnos verificada de extremo a extremo con audio sintético real en EN/ES/mezcla).
- Apuntes multi‑etapa con trazabilidad al audio, resúmenes, examen interactivo, flashcards, chat con citas, documentos del profesor, editor con versiones, exportación PDF/DOCX/MD/TXT.
- Aislamiento por usuario, almacenamiento privado, API key solo en servidor (el navegador recibe únicamente credenciales temporales `ek_…`), registro de consumo con estimación previa y límites.
- Build de producción y ejecución en workerd con Workflows.

### Lo que requiere credenciales o entorno real para confirmarlo

- **Transcripción en directo por WebSocket** (`gpt-live-transcribe`): el entorno donde se construyó el proyecto bloquea los upgrades de WebSocket (405), así que la conexión real desde el navegador no pudo ejecutarse. El cliente sigue la documentación oficial (se verificó la emisión de credenciales temporales con los parámetros exactos) y, si falla, cae sin intervención a la transcripción por turnos, que sí está verificada. Primera prueba manual recomendada: una clase corta mirando el indicador «En directo».
- **Safari e iOS**: la lógica tiene en cuenta `audio/mp4` y la rotación de 30 s, pero solo se ha probado en Chromium. Comprobar en iPhone el comportamiento con pantalla bloqueada.
- **Despliegue real en Cloudflare** (cuenta, `database_id`, secretos, plan Paid para Workflows y CPU extendida): no se ha podido ejecutar desde aquí; `docs/DEPLOY.md` detalla los pasos y la verificación previa.
- **Clase de 90 minutos con audio real**: el pipeline se probó de extremo a extremo con una transcripción sintética de 88 minutos (1,88 $ de apuntes); falta comprobar la grabación continua de 90 minutos con micrófono real (rotación de fragmentos, memoria del navegador, subida en segundo plano).

### Limitaciones conocidas

- Las marcas de tiempo son por fragmento (turno de voz), no por palabra.
- Los PDF escaneados no se leen (sin OCR); se adjuntan y se avisa.
- El índice del DOCX es un campo de Word: pide «actualizar campos» al abrirlo.
- Sin PWA/instalación en pantalla de inicio todavía (sí hay `manifest` e iconos); la grabación requiere la pestaña abierta.
- Un trabajo largo sobrevive a reinicios en producción (Workflow duradero); en `next dev` o en `wrangler dev` un reinicio del servidor lo deja sin señal y se marca fallido a los 10 minutos (reintentable, reutiliza pasos).

### Cómo ejecutar, desplegar y comprobar

- Local: `npm install`, `cp .dev.vars.example .dev.vars` (API key), `npm run db:migrate:local`, `npm run dev`. Clase de prueba sin grabar: `npm run seed -- --base http://localhost:3000 --email tu@correo --password tu-contraseña`.
- Producción: `docs/DEPLOY.md` (recursos, migraciones, secretos, `npm run deploy`, verificación en `npm run preview`).
- Probar una grabación real y la calidad de los apuntes: protocolo manual en `docs/TESTING.md` (pasos 1–19), en especial 10–12 (fidelidad, huecos, referencias temporales) y 16 (diapositiva ↔ explicación oral).
