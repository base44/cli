import { readAllRealtimeHandlers } from "@/core/resources/realtime-handler/config.js";
import { deployRealtimeHandlersSequentially } from "@/core/resources/realtime-handler/deploy.js";
import type { RealtimeHandler } from "@/core/resources/realtime-handler/schema.js";
import type { Resource } from "@/core/resources/types.js";

export const realtimeHandlerResource: Resource<RealtimeHandler> = {
  readAll: readAllRealtimeHandlers,
  push: (handlers) => deployRealtimeHandlersSequentially(handlers),
};
