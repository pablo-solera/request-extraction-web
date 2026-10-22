import "server-only";

export class ReaderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status = 502,
  ) {
    super(message);
    this.name = "ReaderError";
  }
}
