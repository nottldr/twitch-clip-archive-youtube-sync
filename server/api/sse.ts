export interface SSEClient {
  id: string;
  send(event: string, data: unknown): void;
  close(): void;
}

export function createSSEManager() {
  const clients = new Map<string, SSEClient>();
  const streams = new Map<string, ReadableStream>();

  function addClient(id: string): { client: SSEClient; stream: ReadableStream } {
    const stream = new ReadableStream({
      start(controller) {
        const client: SSEClient = {
          id,
          send(event: string, data: unknown) {
            try {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              removeClient(id);
            }
          },
          close() {
            try {
              controller.close();
            } catch {
              // Already closed
            }
            removeClient(id);
          },
        };

        clients.set(id, client);
        client.send("connected", { clientId: id });
      },
      cancel() {
        removeClient(id);
      },
    });

    streams.set(id, stream);
    return { client: clients.get(id) ?? { id, send() {}, close() {} }, stream };
  }

  function removeClient(id: string): void {
    clients.delete(id);
    streams.delete(id);
  }

  function broadcast(event: string, data: unknown): void {
    for (const client of clients.values()) {
      client.send(event, data);
    }
  }

  function getClientCount(): number {
    return clients.size;
  }

  return {
    addClient,
    removeClient,
    broadcast,
    getClientCount,
  };
}

export type SSEManager = ReturnType<typeof createSSEManager>;
