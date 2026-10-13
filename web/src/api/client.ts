export type ApiErrorBody = {
  code: string;
  message: string;
  /** Field errors as [{ path, message }], or error-specific data (e.g. row counts). */
  details?: unknown;
  requestId?: string;
};

/** A failed API call, carrying the server's standard error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

async function request(path: string, init: { method?: string; body?: unknown } = {}) {
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
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      data?.error ?? { code: 'INTERNAL', message: `Request failed (${res.status})` },
    );
  }
  return res;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await request(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches a file and saves it under the server's filename (errors stay readable ApiErrors). */
export async function download(path: string) {
  const res = await request(path);
  const filename =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
