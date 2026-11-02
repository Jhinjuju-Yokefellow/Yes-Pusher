import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { runWebSocketLoad } from "./stress-godot-websocket.mjs";

// Local mock ONLY verifies the 100-client harness; it does not prove Godot
// server throughput. The real Godot acceptance run requires a disposable
// staging machine with no production Neon, blockchain, or wallet operations.
const server = createServer();
const sockets = new Set();
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\n"
    + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
    + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n");
  sockets.add(socket);
  socket.on("data", data => {
    if ((data[0] & 15) === 8) {
      socket.write(Buffer.from([0x88, 0x00]));
      socket.end();
    }
  });
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  const target = "ws://127.0.0.1:" + address.port;
  const result = await runWebSocketLoad({
    url: target, clients: 100, reconnectRounds: 2,
    holdMs: 80, connectTimeoutMs: 5000,
  });
  assert.equal(result.attempted, 200);
  assert.equal(result.opened, 200);
  assert.equal(result.failed, 0);
  assert.equal(result.unexpectedDisconnects, 0);
  assert.equal(result.kind, "godot_websocket_transport_only");
  assert(result.p95ConnectMs >= 0);
  await assert.rejects(runWebSocketLoad({
    url: "wss://yes-pusher-recovery-machine-production.up.railway.app",
    clients: 1, holdMs: 20, allowStaging: true,
  }), /production WebSocket/);
  console.log("PASS isolated WebSocket harness: 100 simultaneous spectators, 100 reconnects, production target blocked");
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
