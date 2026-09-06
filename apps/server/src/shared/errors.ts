/** Domain error carrying an HTTP status and a stable machine code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthorized: (msg = "Not authenticated") => new AppError(401, "unauthorized", msg),
  forbidden: (msg = "Not allowed") => new AppError(403, "forbidden", msg),
  notFound: (msg = "Not found") => new AppError(404, "not_found", msg),
  conflict: (msg = "Conflict") => new AppError(409, "conflict", msg),
  badRequest: (msg = "Bad request") => new AppError(400, "bad_request", msg),
  tooMany: (msg = "Too many requests") => new AppError(429, "too_many", msg),
};
