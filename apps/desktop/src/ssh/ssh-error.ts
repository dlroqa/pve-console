import { ErrorCode, type AppError } from "../shared/types";

/** An expected SSH/profile failure that is safe to show in the renderer. */
export class SshError extends Error {
  readonly appError: AppError;

  constructor(message: string, code: ErrorCode = ErrorCode.NETWORK_ERROR) {
    super(message);
    this.name = "SshError";
    this.appError = { code, message };
  }
}
