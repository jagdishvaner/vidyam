/** NestJS error bodies carry a readable `message`; validation errors may carry a list. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : fallback;
}
