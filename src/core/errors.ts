export class AuthApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AuthApiError";
  }
}

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

export class ConnectorApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ConnectorApiError";
  }
}

export class ConnectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorValidationError";
  }
}
