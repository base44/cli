// Named entry.ts by mistake: discovery treats every entry file under the actors
// directory as an actor, so this resolves to the nested name "BoardRoom/lib".
export function formatMessage(message: unknown): string {
  return JSON.stringify(message);
}
