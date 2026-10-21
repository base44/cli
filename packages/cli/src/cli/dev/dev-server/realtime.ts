import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

export type EntityEventType = "create" | "update" | "delete";

export interface EntityEvent {
  type: EntityEventType;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
}

export type BroadcastEntityEvent = (
  appId: string,
  entityName: string,
  event: EntityEvent,
) => void;

/** The path the entity-events socket owns; no other transport may claim it. */
export const REALTIME_PATH = "/ws-user-apps/socket.io/";

export function createRealtimeServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: REALTIME_PATH,
    cors: {
      origin: /^http:\/\/localhost(:\d+)?$/,
      credentials: true,
    },
    transports: ["websocket"],
  });

  io.on("connection", (socket) => {
    socket.on("join", (room: string) => {
      socket.join(room);
    });

    socket.on("leave", (room: string) => {
      socket.leave(room);
    });
  });

  return io;
}

export function broadcastEntityEvent(
  io: SocketIOServer,
  appId: string,
  entityName: string,
  event: EntityEvent,
): void {
  const room = `entities:${appId}:${entityName}`;
  io.to(room).emit("update_model", {
    room,
    data: JSON.stringify(event),
  });
}
