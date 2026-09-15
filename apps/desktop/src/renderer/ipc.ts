/**
 * Thin renderer helper that unwraps IpcResult<T> from the preload bridge,
 * throwing the structured AppError on failure so callers can use try/catch.
 */

import type { AppError, IpcResult } from "../shared/types";

export class BridgeError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "BridgeError";
  }
}

export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const result = await p;
  if (result.ok) return result.value;
  throw new BridgeError(result.error);
}

export function errorMessage(err: unknown): string {
  if (err instanceof BridgeError) return err.appError.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}
