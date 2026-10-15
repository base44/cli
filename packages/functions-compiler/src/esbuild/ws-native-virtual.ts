import type { Plugin } from "esbuild";

const NAMESPACE = "base44-ws-native";

// Bare `ws` from a dependency, or `npm:ws[@version]` from user code. Subpaths
// (`ws/lib/...`) are internals no client code reaches for, so they resolve as-is.
const WS_SPECIFIER = /^(npm:)?ws(@[^/]+)?$/;

// The `ws` package's exports map sends the "browser" condition to a stub that
// throws on use, and its Node build needs node:net. workerd has a native
// WebSocket client, so serve a `ws`-shaped client over it. CommonJS so both
// `import WebSocket from "ws"` and `require("ws")` get the class.
const ADAPTER = `"use strict";
const toBuffer = (value) => (globalThis.Buffer ? globalThis.Buffer.from(value) : value);
class WebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  #socket;
  #listeners = new Map();
  constructor(address, protocols) {
    this.#socket = new globalThis.WebSocket(String(address), typeof protocols === "string" || Array.isArray(protocols) ? protocols : undefined);
    try { this.#socket.binaryType = "arraybuffer"; } catch {}
    this.#socket.addEventListener("open", () => this.emit("open"));
    this.#socket.addEventListener("message", (event) => {
      const isBinary = typeof event.data !== "string";
      this.emit("message", toBuffer(isBinary ? new Uint8Array(event.data) : event.data), isBinary);
    });
    this.#socket.addEventListener("error", (event) => this.emit("error", event.error ?? new Error(event.message || "WebSocket error")));
    this.#socket.addEventListener("close", (event) => this.emit("close", event.code, toBuffer(event.reason ?? "")));
  }
  get readyState() { return this.#socket.readyState; }
  get url() { return this.#socket.url; }
  get protocol() { return this.#socket.protocol; }
  on(name, listener) { return this.#add(name, listener, false); }
  addListener(name, listener) { return this.#add(name, listener, false); }
  once(name, listener) { return this.#add(name, listener, true); }
  off(name, listener) { return this.removeListener(name, listener); }
  removeListener(name, listener) {
    const listeners = this.#listeners.get(name);
    if (listeners) this.#listeners.set(name, listeners.filter((entry) => entry.listener !== listener));
    return this;
  }
  removeAllListeners(name) {
    if (name === undefined) this.#listeners.clear();
    else this.#listeners.delete(name);
    return this;
  }
  emit(name, ...args) {
    const listeners = this.#listeners.get(name) ?? [];
    this.#listeners.set(name, listeners.filter((entry) => !entry.once));
    for (const entry of listeners) entry.listener.apply(this, args);
    return listeners.length > 0;
  }
  send(data, options, callback) {
    const done = typeof options === "function" ? options : callback;
    try {
      this.#socket.send(data);
      done?.();
    } catch (error) {
      if (!done) throw error;
      done(error);
    }
  }
  close(code, reason) { this.#socket.close(code, reason); }
  terminate() { this.#socket.close(); }
  #add(name, listener, once) {
    const listeners = this.#listeners.get(name) ?? [];
    listeners.push({ listener, once });
    this.#listeners.set(name, listeners);
    return this;
  }
}
class WebSocketServer {
  constructor() {
    throw new Error("ws WebSocketServer is not available in Base44 functions: a function can open WebSocket connections but cannot listen for them.");
  }
}
module.exports = WebSocket;
module.exports.WebSocket = WebSocket;
module.exports.WebSocketServer = WebSocketServer;
module.exports.default = WebSocket;
`;

export function wsNativeVirtualPlugin(): Plugin {
  return {
    name: "base44-ws-native",
    setup(build) {
      // Every namespace (user files and dependencies), one shared module path.
      build.onResolve({ filter: WS_SPECIFIER }, () => ({
        path: "ws",
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: ADAPTER,
        loader: "js",
      }));
    },
  };
}
