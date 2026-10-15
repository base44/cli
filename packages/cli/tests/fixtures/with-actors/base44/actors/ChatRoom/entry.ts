import { Actor } from "base44:runtime/actors";
import { maxMessageLength } from "../../shared/limits.ts";
import { greeting } from "./lib/message.ts";

export default class ChatRoom extends Actor {
  handleConnect(conn) { conn.send(greeting); }
  handleMessage(conn, message) {
    if (String(message).length <= maxMessageLength) this.broadcast(message);
  }
  handleClose() {}
  handleTick() {}
}
