/** Error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Recurso") => new AppError(404, "not_found", `${what} no encontrado`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = () => new AppError(401, "unauthorized", "Inicia sesión para continuar");
export const forbidden = (message = "No tienes permiso para esta acción") => new AppError(403, "forbidden", message);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);

/** Thrown when an operation would exceed the user's configured spending limit. */
export class BudgetExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(402, "budget_exceeded", message, details);
    this.name = "BudgetExceededError";
  }
}
