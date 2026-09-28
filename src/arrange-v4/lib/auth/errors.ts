export class InteractiveAuthenticationRequiredError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Your session needs attention before TODO data can be refreshed.');
    this.name = 'InteractiveAuthenticationRequiredError';
    this.cause = cause;
  }
}

export function isInteractiveAuthenticationRequiredError(
  error: unknown,
): error is InteractiveAuthenticationRequiredError {
  return error instanceof InteractiveAuthenticationRequiredError;
}
