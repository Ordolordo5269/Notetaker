// Generates a realistic ~90-minute bilingual lecture transcript fixture with the fast model,
// for scale tests of the pipelines (blocks, D1 limits, Workflow steps, costs).
// Usage: node scripts/make-long-fixture.mjs [--minutes 90] [--out tests/fixtures/lecture-long-transcript.json]
// Needs OPENAI_API_KEY (or an egress proxy that injects it; then NODE_USE_ENV_PROXY=1).
import fs from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : [])).filter((p) => p.length));
const minutes = Number(args.minutes ?? 90);
const out = args.out ?? "tests/fixtures/lecture-long-transcript.json";
const model = process.env.OPENAI_FAST_MODEL ?? "gpt-6-luna";
const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const headers = { "content-type": "application/json", ...(process.env.OPENAI_API_KEY ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}) };

const PARTS = [
  "Introducción: para qué sirve el Reglamento Roma I, relación con Bruselas I bis, ámbito material y temporal (art. 1 y 28), carácter universal (art. 2).",
  "Autonomía de la voluntad (art. 3): elección expresa y tácita, elección parcial, cambio de ley, límites con leyes imperativas internas y de la UE. Ejemplos de cláusulas.",
  "Ley aplicable a falta de elección (art. 4): catálogo de contratos del apartado 1, prestación característica del apartado 2, cláusula de escape del apartado 3 y cierre del apartado 4. Caso práctico de compraventa y de distribución.",
  "Contratos de transporte (art. 5) y contratos de consumo (art. 6): condiciones, protección del consumidor, actividad dirigida y jurisprudencia Pammer/Alpenhof.",
  "Contratos de seguro (art. 7) y contrato individual de trabajo (art. 8): lugar habitual de trabajo, establecimiento de contratación, cláusula de vínculos más estrechos (Koelzsch, Voogsgeerd, Schlecker).",
  "Leyes de policía (art. 9): concepto, leyes del foro y del lugar de ejecución, caso Nikiforidis; orden público (art. 21). Preguntas típicas de examen.",
  "Consentimiento y validez material (art. 10), validez formal (art. 11), capacidad (art. 13) y ámbito de la ley aplicable (art. 12): interpretación, cumplimiento, consecuencias del incumplimiento, prescripción.",
  "Cesión de créditos y subrogación (arts. 14 a 16), compensación (art. 17), carga de la prueba (art. 18). Repaso de errores frecuentes y método para resolver un caso práctico en el examen.",
];
const segmentsPerPart = Math.max(8, Math.round((minutes * 60) / PARTS.length / 28)); // ~28 s per segment

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["segments"],
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "language"],
        properties: {
          text: { type: "string", description: "Intervención oral literal del profesor, 45-90 palabras, con muletillas ocasionales, sin títulos ni formato." },
          language: { type: "string", enum: ["es", "en", "mixed"] },
        },
      },
    },
  },
};

async function structured(system, user) {
  const res = await fetch(`${base}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 12000,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: { format: { type: "json_schema", name: "lecture_part", schema, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  let text = "";
  let buffer = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.type === "response.output_text.delta") text += data.delta;
      if (data.type === "response.failed" || data.type === "error") throw new Error(JSON.stringify(data).slice(0, 300));
    }
  }
  return JSON.parse(text);
}

const system = `Eres un profesor universitario de Derecho internacional privado en una universidad española con grupo bilingüe. Hablas alternando español e inglés de forma natural (code-switching): algunas intervenciones enteras en inglés, otras en español, y algunas mezcladas dentro de la misma frase. Explicas con ejemplos concretos, repites ideas importantes, avisas de lo que cae en el examen ("this comes up in the exam every year", "esto es pregunta de examen"), haces alguna digresión y a veces te corriges. Produce una transcripción ORAL realista (como si la hubiera reconocido un sistema de dictado): sin títulos, sin listas, sin formato Markdown, con alguna muletilla ("eh", "vale", "okay") pero sin exagerar. Cada segmento es una intervención continua de 45 a 90 palabras. No inventes números de artículo falsos: usa los del Reglamento Roma I (593/2008). Devuelve exactamente ${segmentsPerPart} segmentos.`;

const all = [];
let t = 0;
for (let i = 0; i < PARTS.length; i++) {
  const user = `Parte ${i + 1} de ${PARTS.length} de una clase de ${minutes} minutos sobre el Reglamento Roma I. Contenido de esta parte: ${PARTS[i]}${i > 0 ? `\nEnlaza brevemente con lo anterior (${PARTS[i - 1].split(":")[0]}).` : ""}`;
  const started = Date.now();
  const { segments } = await structured(system, user);
  for (const s of segments) {
    const words = s.text.split(/\s+/).length;
    all.push({ startS: Math.round(t * 10) / 10, text: s.text.trim(), language: s.language === "mixed" ? "mixed" : s.language });
    t += words * 0.38 + 1.2 + Math.random() * 2; // ~2.6 words/s plus pauses
  }
  console.error(`part ${i + 1}/${PARTS.length}: ${segments.length} segments, ${Math.round((Date.now() - started) / 1000)}s, running time ${Math.round(t / 60)} min`);
}
const fixture = {
  title: "Applicable law to contracts: Rome I Regulation (long lecture)",
  subject: "Private International Law",
  note: `Synthetic ${Math.round(t / 60)}-minute bilingual lecture generated with ${model} for scale tests.`,
  segments: all,
};
fs.writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
console.log(JSON.stringify({ out, segments: all.length, minutes: Math.round(t / 60), words: all.reduce((n, s) => n + s.text.split(/\s+/).length, 0) }));
