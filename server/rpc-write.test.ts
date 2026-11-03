import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrError, herdrRpc, socketAddress } from "./herdr/client.ts";

// Adapted from upstream #2625: use an owned real peer, not mocked socket callbacks.
async function peer(accept: (socket: Socket) => void) {
  const root = mkdtempSync(join(tmpdir(), "herdr-rpc-write-"));
  const path = join(root, "rpc.sock");
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    accept(socket);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketAddress(path), resolve); });
  return { path, connections: () => connections, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  } };
}

it.each(["x", "🙂"])("delivers a complete large %s frame under backpressure", async (character) => {
  const text = character.repeat(2 * 1024 * 1024);
  const chunks: Buffer[] = [];
  const started = Promise.withResolvers<void>();
  let lines = 0;
  const fixture = await peer((socket) => {
    socket.pause();
    void started.promise.then(() => socket.resume());
    socket.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      if (!chunk.includes(10)) return;
      const request = JSON.parse(Buffer.concat(chunks).toString()) as { id: string; params: { text: string } };
      lines++;
      socket.end(`${JSON.stringify({ id: request.id, result: request.params.text })}\n`);
    });
  });
  try {
    let writes = 0;
    const result = await herdrRpc<string>("fixture.write", { text }, fixture.path, 5_000, () => { writes++; started.resolve(); return true; });
    expect(result).toBe(text);
    expect(writes).toBeGreaterThan(1);
    expect(lines).toBe(1);
    expect(fixture.connections()).toBe(1);
  } finally { await fixture.close(); }
});

it("cuts a partial request without replay when authority expires", async () => {
  const chunks: Buffer[] = [];
  const started = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<void>();
  const fixture = await peer((socket) => {
    socket.pause();
    socket.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => ended.resolve());
    void started.promise.then(() => socket.resume());
  });
  try {
    let asks = 0;
    const error = await herdrRpc("fixture.write", { text: "y".repeat(8 * 1024 * 1024) }, fixture.path, 5_000, () => {
      asks++; if (asks === 1) { started.resolve(); return true; } return false;
    }).catch((e: unknown) => e);
    await ended.promise;
    const received = Buffer.concat(chunks);
    expect(error).toBeInstanceOf(HerdrError);
    expect((error as HerdrError).code).toBe("socket_error");
    expect(asks).toBeGreaterThan(1);
    expect(received.length).toBeGreaterThan(0);
    expect(received.includes(10)).toBe(false);
    expect(fixture.connections()).toBe(1);
  } finally { await fixture.close(); }
});

it("does not classify a connected serialization failure as connect_failed", async () => {
  const fixture = await peer(() => {});
  try {
    const error = await herdrRpc("fixture.write", { toJSON() { throw new Error("fixture serialization failed"); } }, fixture.path, 5_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HerdrError);
    expect((error as HerdrError).code).toBe("socket_error");
  } finally { await fixture.close(); }
});

it("does not reconnect after the peer closes during a request", async () => {
  const fixture = await peer((socket) => socket.once("data", () => socket.destroy()));
  try {
    const error = await herdrRpc("fixture.write", { text: "x".repeat(8 * 1024 * 1024) }, fixture.path, 5_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HerdrError);
    expect(["closed", "socket_error"]).toContain((error as HerdrError).code);
    expect(fixture.connections()).toBe(1);
  } finally { await fixture.close(); }
});
