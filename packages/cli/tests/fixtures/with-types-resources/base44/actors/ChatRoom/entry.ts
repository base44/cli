import { Actor, type Conn } from "@base44/sdk";

export class ChatRoom extends Actor {
  handleConnect(_conn: Conn) {}
  handleMessage(_conn: Conn, _msg: unknown) {}
  handleTick() {}
  handleClose(_conn: Conn) {}
}
