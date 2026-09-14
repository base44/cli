import { Actor } from "base44:runtime/actors";
import { greeting } from "./lib/message.ts";

export default class ChatRoom extends Actor {
  handleConnect(conn) { conn.send(greeting); }
  handleMessage(conn, message) { this.broadcast(message); }
  handleClose() {}
  handleTick() {}
}
