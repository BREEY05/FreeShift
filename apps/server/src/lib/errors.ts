export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFound(what: string): AppError {
  return new AppError(404, 'NOT_FOUND', what + '不存在');
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(422, 'VALIDATION_ERROR', message, details);
}
