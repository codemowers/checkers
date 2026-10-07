/** Only transport failures are recoverable here; malformed JSON and coding errors propagate. */
export class NetworkError extends Error {}
export class RequestError extends Error {}

export async function fetchResponse(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (response.status === 401 && response.headers.get("X-Checkers-Session-Reset") === "1" && typeof window !== "undefined") {
      window.location.assign(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    return response;
  }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new NetworkError("Connection interrupted. Please try again.", { cause: error });
  }
}

export async function readJson<T = any>(response: Response): Promise<T> {
  try { return await response.json(); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new NetworkError("Connection interrupted. Please try again.", { cause: error });
  }
}

export async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try { return await reader.read(); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new NetworkError("Game stream disconnected.", { cause: error });
  }
}
