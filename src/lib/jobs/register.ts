// Side-effect import that registers every job handler. Imported by the
// Workflow entry point and by API routes that may run jobs in-process.
import "@/lib/notes/pipeline";
import "@/lib/study/flashcards-pipeline";
import "@/lib/documents/pipeline";
