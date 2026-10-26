import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getEnv } from "@/lib/cf";
import { getDb, type Db } from "@/lib/db";
import { readConfig, type AppConfig } from "@/lib/env";
import { AppError, badRequest, forbidden, unauthorized } from "@/lib/errors";
import { SESSION_COOKIE, validateSession, type SessionUser } from "@/lib/auth/sessions";

export interface BaseContext<P> {
  req: NextRequest;
  params: P;
  env: CloudflareEnv;
  db: Db;
  config: AppConfig;
}
export interface AuthedContext<P> extends BaseContext<P> {
  user: SessionUser;
}

type RouteArgs<P> = { params: Promise<P> };
type Handler<C> = (ctx: C) => Promise<Response | unknown>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated mutations: the request must come
 * from our own origin. Combined with SameSite=Lax cookies.
 */
export function assertSameOrigin(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden("Origen no válido");
    }
    if (!host || originHost !== host) throw forbidden("Origen no permitido");
    return;
  }
  if (req.headers.get("sec-fetch-site") === "same-origin") return;
  throw forbidden("Origen no permitido");
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Datos no válidos",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("invalid_status_transition")) {
    return NextResponse.json(
      { error: { code: "invalid_status_transition", message: "Transición de estado no permitida" } },
      { status: 409 },
    );
  }
  if (message.includes("UNIQUE constraint failed")) {
    return NextResponse.json({ error: { code: "conflict", message: "El recurso ya existe" } }, { status: 409 });
  }
  // Log the failure without request bodies or user content.
  console.error("[api] unhandled error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return NextResponse.json(
    { error: { code: "internal_error", message: "Error interno. Inténtalo de nuevo." } },
    { status: 500 },
  );
}

async function baseContext<P>(req: NextRequest, args: RouteArgs<P>): Promise<BaseContext<P>> {
  const env = await getEnv();
  return {
    req,
    params: await args.params,
    env,
    db: getDb(env.DB),
    config: readConfig(env),
  };
}

/** Authenticated JSON route. Rejects cross-origin mutations and anonymous calls. */
export function authedRoute<P = Record<string, never>>(handler: Handler<AuthedContext<P>>) {
  return async (req: NextRequest, args: RouteArgs<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const ctx = await baseContext(req, args);
      const user = await validateSession(ctx.db, req.cookies.get(SESSION_COOKIE)?.value);
      if (!user) throw unauthorized();
      return toResponse(await handler({ ...ctx, user }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Unauthenticated route (sign-in, sign-up). Still same-origin only. */
export function publicRoute<P = Record<string, never>>(handler: Handler<BaseContext<P>>) {
  return async (req: NextRequest, args: RouteArgs<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return toResponse(await handler(await baseContext(req, args)));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw badRequest("Cuerpo de la petición demasiado grande");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw badRequest("Cuerpo de la petición demasiado grande");
    raw = text ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest("JSON no válido");
  }
  return schema.parse(raw);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
