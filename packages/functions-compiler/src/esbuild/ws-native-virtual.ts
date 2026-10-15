import type { Plugin } from "esbuild";

const NAMESPACE = "base44-ws-native";

// Bare `ws` from a dependency, or `npm:ws[@version]` from user code. Subpaths
// (`ws/lib/...`) are internals no client code reaches for, so they resolve as-is.
const WS_SPECIFIER = /^(npm:)?ws(@[^/]+)?$/;

// The `ws` package's exports map sends the "browser" condition to a stub that
// throws on use, and its Node build needs node:net. workerd has a native
// WebSocket client, so serve a `ws`-shaped client over it. CommonJS so both
// `import WebSocket from "ws"` and `require("ws")` get the class.
//
// The native constructor cannot send request headers, so when the caller passes
// `options.headers` (Stagehand's `cdpHeaders`, e.g. a remote browser's auth
// token) the socket is opened with a fetch upgrade instead, which can. A lone
// User-Agent (Stagehand always sends one) is not worth leaving the native path.
const ADAPTER = `"use strict";
const toBuffer = (value) => (globalThis.Buffer ? globalThis.Buffer.from(value) : value);
const READY_STATES = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const upgradeHeaders = (options) => {
  const headers = new Headers(options?.headers);
  for (const name of headers.keys()) if (name !== "user-agent") return headers;
  return null;
};
class WebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  #socket = null;
  #state = 0;
  #url;
  #closeRequested = null;
  #listeners = new Map();
  constructor(address, protocols, options) {
    if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }
    this.#url = String(address);
    const headers = upgradeHeaders(options);
    if (headers) {
      this.#upgrade(headers, protocols);
    } else {
      this.#attach(new globalThis.WebSocket(this.#url, protocols));
    }
  }
  get readyState() { return this.#socket ? this.#socket.readyState : this.#state; }
  get url() { return this.#url; }
  get protocol() { return this.#socket ? this.#socket.protocol ?? "" : ""; }
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
      if (!this.#socket) {
        throw new Error("WebSocket is not open: readyState " + this.#state + " (" + READY_STATES[this.#state] + ")");
      }
      this.#socket.send(data);
      done?.();
    } catch (error) {
      if (!done) throw error;
      done(error);
    }
  }
  close(code, reason) {
    if (this.#socket) this.#socket.close(code, reason);
    else if (this.#state === 0) {
      // Upgrade still in flight: close as soon as it lands.
      this.#closeRequested = [code, reason];
      this.#state = 2;
    }
  }
  terminate() { this.close(); }
  #attach(socket) {
    this.#socket = socket;
    try { socket.binaryType = "arraybuffer"; } catch {}
    socket.addEventListener("open", () => this.emit("open"));
    socket.addEventListener("message", (event) => {
      const isBinary = typeof event.data !== "string";
      this.emit("message", toBuffer(isBinary ? new Uint8Array(event.data) : event.data), isBinary);
    });
    socket.addEventListener("error", (event) => this.emit("error", event.error ?? new Error(event.message || "WebSocket error")));
    socket.addEventListener("close", (event) => this.emit("close", event.code, toBuffer(event.reason ?? "")));
  }
  #upgrade(headers, protocols) {
    headers.set("Upgrade", "websocket");
    if (protocols) headers.set("Sec-WebSocket-Protocol", [].concat(protocols).join(", "));
    const httpUrl = this.#url.replace(/^ws(s?):/i, "http$1:");
    const fail = (error) => {
      this.#state = 3;
      this.emit("error", error);
      this.emit("close", 1006, toBuffer(""));
    };
    // Two-argument then(): an exception from an "open" listener must not be
    // reported as a failed upgrade.
    fetch(httpUrl, { headers }).then((response) => {
      const socket = response.webSocket;
      if (!socket) {
        response.body?.cancel();
        return fail(new Error("Unexpected server response: " + response.status));
      }
      socket.accept();
      this.#attach(socket);
      if (this.#closeRequested) return socket.close(...this.#closeRequested);
      // accept() opens the socket without dispatching an "open" event.
      this.emit("open");
    }, fail);
  }
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
