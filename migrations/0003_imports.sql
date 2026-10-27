-- Lectures imported from an audio file (iPhone voice memos, mp3, wav…).
--   origin:           'live' (recorded in the browser) or 'import' (uploaded file, cut into
--                     chunks in the browser and transcribed by the recovery_transcription job).
--   source_file_name: original file name of an import, shown on the lecture page.
ALTER TABLE lecture_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'live'
  CHECK (origin IN ('live', 'import'));
ALTER TABLE lecture_sessions ADD COLUMN source_file_name TEXT
  CHECK (source_file_name IS NULL OR length(source_file_name) BETWEEN 1 AND 255);
