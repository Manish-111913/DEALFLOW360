/**
 * Business-rule failures, distinct from programming errors.
 *
 * Each carries an HTTP status so a route handler can translate without a
 * switch, and `field` so a form can highlight the input that is wrong rather
 * than showing a banner.
 */

export class ValidationError extends Error {
  readonly status = 422;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
