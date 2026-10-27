// Client-safe labels for the import dialog (no ffmpeg import, so the dialog bundle stays small).
import type { ImportPhase } from "./audio-import";

export const IMPORT_PHASE_LABEL: Record<ImportPhase, string> = {
  loading: "Descargando el conversor de audio (32 MB, solo la primera vez)",
  reading: "Leyendo el archivo",
  analyzing: "Buscando pausas para cortar sin partir frases",
  cutting: "Troceando el audio",
  uploading: "Subiendo el audio",
  finalizing: "Cerrando la clase",
  done: "Audio subido; la transcripción sigue en el servidor",
};
