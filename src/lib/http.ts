export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function friendly(provider: string, status: number, detail: string): string {
  if (status === 401 || status === 403) return `${provider} rejected the API key. Check it in Settings.`;
  if (status === 404) return `${provider} doesn't recognise that model or endpoint. Pick another model in Settings. (${detail})`;
  if (status === 413) return `${provider}: the request was too large.`;
  if (status === 429) return `${provider} free-tier limit reached. Wait a bit or switch provider in Settings.`;
  return `${provider} error ${status}: ${detail}`;
}

/**
 * fetch() that retries rate limits and server errors with backoff (honouring Retry-After),
 * and turns failures into readable messages.
 */
export async function request(provider: string, url: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      if (attempt >= retries) throw new ApiError(`Couldn't reach ${provider}. Check your internet connection.`, 0);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2000 * 2 ** attempt);
      continue;
    }

    let detail = response.statusText;
    try {
      const body = await response.text();
      const json = JSON.parse(body);
      detail = json?.error?.message ?? json?.message ?? json?.detail ?? body;
    } catch {
      // keep statusText
    }
    throw new ApiError(friendly(provider, response.status, String(detail).slice(0, 300)), response.status);
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
