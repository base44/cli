import { Actor } from "base44:runtime/actors";
import { formatMessage } from "./helper.js";

interface TestConnection {
  send(message: string): void;
}

export default class ChatRoom extends Actor {
  handleConnect(_conn: TestConnection) {}
  handleMessage(conn: TestConnection, msg: unknown) {
    conn.send(formatMessage(msg));
  }
  handleTick() {}
  handleClose(_conn: TestConnection) {}
}
