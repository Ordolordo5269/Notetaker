# Despliegue en Cloudflare

StudyFlow AI se ejecuta como un único Worker de Cloudflare generado con `@opennextjs/cloudflare`. El mismo Worker expone la aplicación Next.js, la clase de Workflow que procesa los trabajos largos y un cron de mantenimiento.

## 1. Recursos

```bash
npx wrangler login
npx wrangler d1 create studyflow            # copia el database_id resultante
npx wrangler r2 bucket create studyflow-files
```

Edita `wrangler.jsonc` y sustituye `database_id` por el identificador real. El bucket R2 **no** debe hacerse público: toda descarga pasa por la aplicación, que comprueba la propiedad.

## 2. Esquema de base de datos

```bash
npm run db:migrate:remote
```

Las migraciones viven en `migrations/*.sql` y son la fuente de verdad del esquema (restricciones, disparador de la máquina de estados, FTS5). `src/lib/db/schema.ts` las refleja para el ORM.

## 3. Secretos y variables

| Nombre                  | Tipo          | Obligatorio | Descripción                                                                            |
| ----------------------- | ------------- | ----------- | -------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`        | secreto       | sí          | Clave de proyecto de OpenAI. Solo se usa en el servidor.                               |
| `ALLOWED_SIGNUP_EMAILS` | secreto o var | recomendado | Correos autorizados a crear cuenta (`a@b.c,*@uni.es`). Vacío = solo la primera cuenta. |
| `OPENAI_BASE_URL`       | var           | no          | Endpoint alternativo (regional).                                                       |
| `OPENAI_PROXY_AUTH`     | var           | no          | `1` si un proxy de salida inyecta la credencial.                                       |
| `OPENAI_*_MODEL`        | var           | no          | Modelos por tarea; valores por defecto en `wrangler.jsonc`.                            |
| `APP_ENV`               | var           | no          | `production` activa los límites de registro más estrictos.                             |

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ALLOWED_SIGNUP_EMAILS
```

Notas:

- El Worker se compila con la bandera `global_fetch_strictly_public`: solo puede hacer peticiones salientes a hosts públicos. Si configuras `OPENAI_BASE_URL`, debe ser un endpoint público (no una IP privada ni `localhost`).
- `OPENAI_PROXY_AUTH=1` existe para entornos corporativos con proxy que inyecta la credencial; en Cloudflare usa siempre `OPENAI_API_KEY` como secreto.
- Las variables `OPENAI_*_MODEL` permiten cambiar de modelo sin tocar código; la tabla de precios (`src/lib/cost/pricing.ts`) indica la fecha en que se comprobaron los precios y debe revisarse al cambiar de modelo.

## 4. Límites del plan

- **Workflows** y `limits.cpu_ms = 300000` requieren el plan Workers Paid. En el plan Free, elimina `limits` de `wrangler.jsonc`; la generación de apuntes se ejecutará igualmente paso a paso dentro del Workflow (hasta 10 ms de CPU por paso en Free no es suficiente para clases largas: usa Paid).
- D1: 10 GB por base de datos en Paid. Una clase de 90 minutos ocupa del orden de 200–400 KB de texto; el audio va a R2 (≈ 20–40 MB por clase con Opus a 48 kbps).

## 5. Despliegue

```bash
npm run deploy
```

`npm run deploy` ejecuta `opennextjs-cloudflare build` (que a su vez ejecuta `next build`) y `opennextjs-cloudflare deploy`. También puedes conectar el repositorio a Workers Builds con:

- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx opennextjs-cloudflare deploy`

## 6. Después del primer despliegue

1. Abre la URL del Worker y crea la primera cuenta (se convierte en propietaria si `ALLOWED_SIGNUP_EMAILS` está vacío).
2. En **Ajustes**, define límites de gasto mensual y por tarea.
3. Haz una grabación corta de prueba y comprueba en el panel de Cloudflare (D1 → tablas `audio_chunks`, `transcript_segments`) que los datos llegan.

## 7. Verificación previa al despliegue

```bash
npm run typecheck && npm run lint && npm test
npm run preview                                  # build OpenNext + wrangler dev en workerd (http://localhost:8787)
E2E_BASE_URL=http://localhost:8787 npm run test:e2e -- tests/e2e/documents.spec.ts tests/e2e/security.spec.ts
```

En la vista previa, D1, R2 y el Workflow son emulaciones locales de Miniflare con la misma semántica que producción (incluido el límite de 100 parámetros por consulta de D1 y los pasos duraderos del Workflow). La extracción de PDF/DOCX/PPTX, el cifrado de contraseñas y la generación de apuntes se han comprobado en este runtime (véase `docs/PROGRESS.md`).

## 8. Mantenimiento

El cron diario (`17 3 * * *`) borra sesiones de autenticación caducadas, marca como fallidos los trabajos que dejaron de responder y aplica la retención de audio configurada por cada usuario. Puedes ejecutarlo manualmente con `npx wrangler dev --test-scheduled` y una petición a `/__scheduled`.
