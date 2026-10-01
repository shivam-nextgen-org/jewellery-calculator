/**
 * Error thrown by auth guards. Route handlers translate it into a JSON
 * response using `status`. Lives in its own module so security code can
 * throw it without importing session.ts (which would create a cycle).
 */
export class AuthError extends Error {
  status: number;
  /** Optional machine-readable reason, e.g. DEVICE_PENDING_APPROVAL. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
