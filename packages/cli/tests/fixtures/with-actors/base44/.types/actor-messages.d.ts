import "@base44/sdk";

declare module "@base44/sdk" {
  interface ActorRegistry {
    ChatRoom: { toClient: { type: "hello" }; toServer: { type: "message"; text: string } };
  }
}
