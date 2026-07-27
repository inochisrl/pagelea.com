export function createAbortError(
  message = "The operation was aborted.",
): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(
  signal?: AbortSignal,
  message?: string,
): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

export interface AwaitBoundedOptions<Value> {
  abortMessage?: string;
  onLateResolve?: (value: Value) => void;
  signal?: AbortSignal;
  timeoutMessage?: string;
  timeoutMs: number;
}

/**
 * Bounds an otherwise non-cancellable promise. A value arriving after abort
 * or timeout is handed to `onLateResolve`, allowing callers to dispose
 * resources that the underlying API could not cancel.
 */
export function awaitBounded<Value>(
  operation: PromiseLike<Value>,
  options: AwaitBoundedOptions<Value>,
): Promise<Value> {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs));

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () =>
      rejectOnce(
        createAbortError(
          options.abortMessage ?? "The operation was aborted.",
        ),
      );
    const timer = setTimeout(() => {
      const error = new Error(
        options.timeoutMessage ??
          `The operation exceeded its ${timeoutMs} ms runtime limit.`,
      );
      error.name = "TimeoutError";
      rejectOnce(error);
    }, timeoutMs);

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, {
      once: true,
    });

    Promise.resolve(operation).then(
      (value) => {
        if (settled) {
          try {
            options.onLateResolve?.(value);
          } catch {
            // Late cleanup is best-effort and cannot change the settled result.
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
