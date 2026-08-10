import { Actor, type Conn } from "@base44/sdk";
import { formatMessage } from "./helper.js";

export default class ChatRoom extends Actor {
  handleConnect(_conn: Conn) {}
  handleMessage(conn: Conn, msg: unknown) {
    conn.send(formatMessage(msg));
  }
  handleTick() {}
  handleClose(_conn: Conn) {}
}
