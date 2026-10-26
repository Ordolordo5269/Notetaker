-- Cost preferences chosen by the user in Ajustes.
--   transcription_mode: 'realtime' streams the microphone to the live model (best latency,
--                       ~0.017 $/min); 'turns' sends each finished turn to the file model
--                       (~0.0045 $/min, text arrives a few seconds after each pause).
--   notes_quality:      'max' drafts and reviews every section with the notes model;
--                       'economy' keeps the outline on the notes model but drafts and
--                       reviews with the fast model (roughly a tenth of the cost).
ALTER TABLE profiles ADD COLUMN transcription_mode TEXT NOT NULL DEFAULT 'realtime'
  CHECK (transcription_mode IN ('realtime', 'turns'));
ALTER TABLE profiles ADD COLUMN notes_quality TEXT NOT NULL DEFAULT 'max'
  CHECK (notes_quality IN ('max', 'economy'));
