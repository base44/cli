// Stands in for a framework dev server: announces its URL the way Vite does
// (with the port bolded), then echoes what each request arrived with.
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ url: req.url, headers: req.headers }));
});

// Stands in for the framework's HMR socket: completes the handshake so a test
// can tell the upgrade was forwarded.
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`  \u001b[32m➜\u001b[39m  Local: \u001b[36mhttp://localhost:\u001b[1m${port}\u001b[22m/\u001b[39m`);
});
