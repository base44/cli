import { createClient, type ActorNameRegistry } from "@base44/sdk";

export const client = createClient({ appId: "actor-type-test" });
export const room: keyof ActorNameRegistry = "ChatRoom";
export const counter: keyof ActorNameRegistry = "Counter";
// @ts-expect-error The generated registry contains only discovered actors.
export const missing: keyof ActorNameRegistry = "Missing";
