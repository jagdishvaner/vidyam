/** Errors raised by use cases; the HTTP layer maps them to status codes (see DomainErrorFilter). */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "forbidden" | "conflict" | "invalid",
  ) {
    super(message);
    this.name = new.target.name;
  }
}
