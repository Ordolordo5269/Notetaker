// R2 object layout. Every key is namespaced by user and lecture so that
// ownership can be checked from the key and a lecture can be purged by prefix.

export function sessionPrefix(userId: string, sessionId: string): string {
  return `u/${userId}/s/${sessionId}/`;
}

const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};

export function audioExtension(mime: string): string {
  return AUDIO_EXT[mime.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}

export function audioChunkKey(userId: string, sessionId: string, seq: number, chunkId: string, mime: string): string {
  return `${sessionPrefix(userId, sessionId)}audio/${String(seq).padStart(6, "0")}-${chunkId}.${audioExtension(mime)}`;
}

export function attachmentKey(userId: string, sessionId: string, attachmentId: string, kind: string): string {
  return `${sessionPrefix(userId, sessionId)}attachments/${attachmentId}.${kind}`;
}

/** Delete every object under a prefix (R2 deletes up to 1000 keys per call). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
