import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void;

/** A real HTTP server standing in for the API, so tests exercise Axios end to end. */
export async function startFakeApi(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${String(port)}/api`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Minimal in-memory implementation of the browser Storage interface. */
export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Storage whose every operation throws, like a browser with site data blocked. */
export class BrokenStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('SecurityError');
  }
  override setItem(): void {
    throw new Error('QuotaExceededError');
  }
  override removeItem(): void {
    throw new Error('SecurityError');
  }
}
