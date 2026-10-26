import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export function getDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/** D1 accepts at most 100 bound parameters per statement. */
export const D1_MAX_PARAMS = 100;

/** Split rows so that each insert stays under the bound-parameter limit. */
export function chunkForInsert<T>(rows: T[], columnsPerRow: number): T[][] {
  const size = Math.max(1, Math.floor(D1_MAX_PARAMS / columnsPerRow));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export { schema };
