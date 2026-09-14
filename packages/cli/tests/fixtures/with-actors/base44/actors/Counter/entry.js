import { Actor } from "base44:runtime/actors";

export default class Counter extends Actor {
  handleConnect(conn) { conn.send({ count: 0 }); }
  handleMessage(conn, message) { this.broadcast(message); }
  handleClose() {}
}
