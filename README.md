# StudyFlow AI

Aplicación web para estudiantes universitarios: graba la clase, la transcribe en directo **en el idioma en que se habla** (español, inglés o mezcla, sin traducir), conserva siempre el audio original y convierte la clase en apuntes, resúmenes, preguntas de examen, flashcards y un chat con referencias.

> Estado del proyecto: en desarrollo activo. Consulta [`docs/PROGRESS.md`](docs/PROGRESS.md) para saber qué está implementado, qué se ha verificado y qué queda pendiente.

## Stack

| Capa | Tecnología |
| --- | --- |
| Interfaz | Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind CSS 4, Radix UI, Lucide |
| Despliegue | Cloudflare Workers mediante [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) |
| Datos | Cloudflare D1 (SQLite) con Drizzle ORM; FTS5 para búsqueda |
| Archivos | Cloudflare R2 (bucket privado: audio y documentos) |
| Trabajos largos | Cloudflare Workflows (pasos duraderos y reintentables) |
| Recuperación local | IndexedDB (fragmentos de audio, segmentos y marcadores pendientes) |
| IA | OpenAI: `gpt-live-transcribe` (directo), `gpt-transcribe` (archivos/turnos), modelos GPT para apuntes y chat, `text-embedding-3-small` |

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

`next dev` usa emulaciones locales de D1 y R2 (vía `initOpenNextCloudflareForDev`). Los trabajos largos se ejecutan en el propio proceso cuando no hay Workflows.

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

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:e2e` | Pruebas end-to-end (Playwright, micrófono simulado con audio real) |
| `npm run preview` | Build para Workers y vista previa local |
| `npm run deploy` | Build y despliegue en Cloudflare |

## Privacidad y grabación de clases

Grabar a una persona puede requerir su consentimiento o estar regulado por tu universidad. La aplicación muestra este aviso antes de la primera grabación y no puede garantizar que una grabación sea lícita. La API key de OpenAI nunca llega al navegador: la transcripción en directo usa credenciales temporales emitidas por el servidor.
