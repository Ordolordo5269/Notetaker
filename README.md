# StudyFlow AI

Aplicación web para estudiantes universitarios: graba la clase, la transcribe en directo **en el idioma en que se habla** (español, inglés o mezcla, sin traducir), conserva siempre el audio original y convierte la clase en apuntes, resúmenes, preguntas de examen, flashcards y un chat con referencias.

> Consulta [`docs/PROGRESS.md`](docs/PROGRESS.md) para saber qué está implementado, cómo se ha verificado y qué queda pendiente o requiere credenciales reales.

## Qué hace

- **Grabación fiable**: micrófono con medidor de nivel, cambio de dispositivo, pausa/reanudación, marcadores (importante · posible examen · no entendido · nota), audio troceado y guardado en IndexedDB y en R2 con verificación SHA‑256, recuperación tras recarga o cierre, estados reales (en directo / por turnos / sin conexión / pendiente de subir).
- **Transcripción fiel** en el idioma hablado (español, inglés o mezcla, nunca traducida): `gpt-live-transcribe` por WebSocket con credenciales temporales y, si falla, `gpt-transcribe` por turnos; sin duplicados ni transcripciones paralelas; etiquetas de idioma por fragmento; vista original y vista limpia (párrafos, muletillas opcionales).
- **Apuntes universitarios** en varias etapas (consolidación → extracción por bloques → índice global → redacción por secciones → revisión de cobertura → documento versionado) con citas `hh:mm–hh:mm` que llevan al audio, avisos de huecos y ambigüedades, y «Explicación complementaria» para lo que no procede de la clase.
- **Resúmenes** (rápido, completo, última hora), **preguntas de examen** (test, cortas, desarrollo, oral por niveles, casos) con modo examen y corrección, **flashcards** con repetición espaciada, **chat** con recuperación híbrida (FTS5 + embeddings) que distingue «Basado en tu clase» de «Explicación adicional» y cita minutos, secciones y páginas.
- **Documentos del profesor** (PDF, DOCX, PPTX): texto por página integrado en apuntes y chat («¿Qué explicó sobre la diapositiva 12?»).
- **Editor de apuntes** por secciones (Tiptap) con historial de versiones, restauración y regeneración de una sola sección.
- **Exportación profesional** generada en el dispositivo: PDF (índice, citas, pie de página), Word (DOCX con índice real), Markdown y TXT.
- **Seguridad y costes**: cuentas propias, aislamiento por usuario, almacenamiento privado, API key solo en el servidor, registro de consumo, estimación previa y límites mensual/por tarea.

## Stack

| Capa               | Tecnología                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Interfaz           | Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind CSS 4, Radix UI, Lucide                                               |
| Despliegue         | Cloudflare Workers mediante [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)                                             |
| Datos              | Cloudflare D1 (SQLite) con Drizzle ORM; FTS5 para búsqueda                                                                             |
| Archivos           | Cloudflare R2 (bucket privado: audio y documentos)                                                                                     |
| Trabajos largos    | Cloudflare Workflows (pasos duraderos y reintentables)                                                                                 |
| Recuperación local | IndexedDB (fragmentos de audio, segmentos y marcadores pendientes)                                                                     |
| IA                 | OpenAI: `gpt-live-transcribe` (directo), `gpt-transcribe` (archivos/turnos), modelos GPT para apuntes y chat, `text-embedding-3-small` |

## Requisitos

- Node.js 22+
- Una cuenta de Cloudflare (plan Workers Paid para Workflows y CPU extendida; la grabación/transcripción básica funciona en Free)
- Una API key de OpenAI con acceso a los modelos de transcripción

## Puesta en marcha local

```bash
npm install
cp .dev.vars.example .dev.vars          # y rellena OPENAI_API_KEY
npm run db:migrate:local                # crea el esquema en la D1 local (.wrangler/state)
npm run dev                             # http://localhost:3000
```

`next dev` usa emulaciones locales de D1 y R2 (vía `initOpenNextCloudflareForDev`). Los trabajos largos se ejecutan en el propio proceso cuando no hay Workflows. Para tener una clase con la que probar apuntes, chat y exámenes sin grabar: `npm run seed -- --base http://localhost:3000 --email tu@correo --password tu-contraseña`.

Para probar en el runtime real de Workers:

```bash
npm run preview                         # build con OpenNext + wrangler dev
```

## Despliegue en Cloudflare

1. Crea los recursos y copia el `database_id` en `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create studyflow
   npx wrangler r2 bucket create studyflow-files
   ```
2. Aplica las migraciones y configura el secreto:
   ```bash
   npm run db:migrate:remote
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put ALLOWED_SIGNUP_EMAILS   # p. ej. tu-correo@dominio.com
   ```
3. Despliega:
   ```bash
   npm run deploy
   ```

Documentación detallada: [`docs/DEPLOY.md`](docs/DEPLOY.md). Guía de pruebas: [`docs/TESTING.md`](docs/TESTING.md).

## Scripts

| Comando                                          | Descripción                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                                    | Servidor de desarrollo                                                                         |
| `npm run typecheck`                              | `tsc --noEmit`                                                                                 |
| `npm run lint`                                   | ESLint                                                                                         |
| `npm test`                                       | Pruebas unitarias (Vitest)                                                                     |
| `npm run test:e2e`                               | Pruebas end-to-end sin coste de IA (grabación con micrófono simulado, documentos, seguridad)   |
| `npm run test:e2e:ai`                            | Prueba end-to-end de pago con los modelos reales (apuntes y chat)                              |
| `npm run seed -- --base http://localhost:3000`   | Crea una clase terminada con una transcripción de prueba                                       |
| `npm run fixtures`                               | Regenera los documentos de prueba (PDF/PPTX/DOCX)                                              |
| `npm run fixtures:long`                          | Genera una transcripción sintética de 90 minutos para pruebas de escala (usa el modelo rápido) |
| `npm run preview`                                | Build para Workers y vista previa local en workerd                                             |
| `npm run deploy`                                 | Build y despliegue en Cloudflare                                                               |
| `npm run db:migrate:local` / `db:migrate:remote` | Aplica las migraciones de D1                                                                   |

## Privacidad y grabación de clases

Grabar a una persona puede requerir su consentimiento o estar regulado por tu universidad. La aplicación muestra este aviso antes de la primera grabación y no puede garantizar que una grabación sea lícita. La API key de OpenAI nunca llega al navegador: la transcripción en directo usa credenciales temporales emitidas por el servidor.
