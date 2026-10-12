export type ApiErrorBody = {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
  requestId?: string;
};

/** A failed API call, carrying the server's standard error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorBody['details'];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK',
      message: 'Cannot reach the server — check your connection',
    });
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? { code: 'INTERNAL', message: `Request failed (${res.status})` },
    );
  }
  return data as T;
}
