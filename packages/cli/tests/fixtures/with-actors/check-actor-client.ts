import { createClient } from "@base44/sdk";

const client = createClient({ appId: "actor-type-test" });
const room = client.actors.ChatRoom("lobby").connect();
room.send({ type: "message", text: "hello" });
// @ts-expect-error Message types come from the user-owned ActorRegistry.
room.send({ type: "invalid" });
room.subscribe((message) => {
  const type: "hello" = message.type;
  return type;
});
client.actors.Counter("counter").connect().close();
// The SDK intentionally permits dynamically named actors.
client.actors.DynamicRoom("lobby").connect().close();
