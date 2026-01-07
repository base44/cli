export class AuthApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AuthApiError";
  }
}

export class AuthValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ message: string; path: string[] }>
  ) {
    super(message);
    this.name = "AuthValidationError";
  }
}
