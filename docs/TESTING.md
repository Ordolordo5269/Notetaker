# Guía de pruebas

## Automáticas

| Comando | Qué cubre |
| --- | --- |
| `npm test` | Unitarias (Vitest): detector de voz (VAD), WAV, identificación de idioma, limpieza de transcripción, configuración de la sesión de transcripción, máquina de estados (y su coherencia con la migración SQL), precios y límites. |
| `npm run test:e2e` | Playwright con Chromium y un **micrófono simulado** que reproduce `tests/fixtures/lecture-es-en.wav` (voz sintética real en inglés, español y mezcla). Recorre: alta, asignatura, nueva clase, grabación, transcripción en el idioma original, marcadores, pausa/reanudación, finalización, reproducción y exportación; y una recarga accidental durante la grabación con recuperación. |

Las pruebas E2E necesitan una API key de OpenAI en `.dev.vars` (o `OPENAI_PROXY_AUTH=1` detrás de un proxy que la inyecte) y `ALLOWED_SIGNUP_EMAILS=*` para poder crear cuentas de prueba. Con el servidor ya levantado: `E2E_BASE_URL=http://localhost:3000 npm run test:e2e`.

> Limitación conocida del entorno de desarrollo usado para construir el proyecto: el proxy de salida no admite WebSockets, por lo que la ruta de transcripción **en directo** (`gpt-live-transcribe`) se ha verificado con la API REST de credenciales temporales y por revisión de la documentación, no con una conexión WebSocket real. La ruta por turnos (`gpt-transcribe`) sí está verificada de extremo a extremo. Véase `docs/PROGRESS.md`.

## Protocolo manual (MacBook + Safari/Chrome)

1. **Inglés** — Di: *"Today we're studying international humanitarian law."* Debe aparecer en inglés, sin traducir.
2. **Español** — Di: *"Hoy vamos a estudiar el derecho internacional humanitario."* Debe aparecer en español.
3. **Mezcla** — *"Article 24 establishes exclusive jurisdiction. Ahora vamos a ver una excepción."* Primera frase en inglés, segunda en español, etiqueta `ES·EN`.
4. **Terminología** — Pronuncia: Brussels I bis Regulation, Rome I Regulation, Article 24, exclusive jurisdiction, applicable law, Reglamento Bruselas I bis, competencia judicial internacional. Comprueba que no se insertan términos que no hayas dicho.
5. **Clase larga** — Graba 90 minutos (o reproduce un podcast). Verifica: el cronómetro sigue, los fragmentos de audio se sincronizan (indicador «Grabación guardada»), no hay segmentos duplicados, la clase se abre con audio completo y transcripción.
6. **Corte de conexión** — Desactiva el Wi-Fi 2 minutos durante la grabación. Debe mostrarse «Sin conexión. Seguimos grabando en este dispositivo»; al volver, los turnos pendientes se transcriben y los fragmentos se suben.
7. **Recarga accidental** — Recarga la pestaña mientras grabas. Al volver aparece «Sesión interrumpida» con el tiempo grabado y lo pendiente de subir; al continuar, la transcripción anota el intervalo no grabado.
8. **Calidad académica** — Tras generar apuntes, compara con la transcripción: cobertura de temas, ejemplos conservados, ausencia de afirmaciones no dichas, referencias temporales que llevan al fragmento correcto.
9. **Seguridad** — Con dos cuentas, intenta abrir `/api/sessions/<id-de-otra-cuenta>` y `/api/sessions/<id>/chunks/0/audio`: debe responder 404.
10. **Exportación** — Exporta transcripción (TXT/Markdown) y, cuando estén disponibles, PDF y DOCX; abre los archivos y comprueba que no hay secciones vacías.
