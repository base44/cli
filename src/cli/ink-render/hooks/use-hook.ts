import { useApp } from "ink";
import { useCallback } from "react";

export type ExitFn = (error?: unknown) => void;

export function useExit(): ExitFn {
  const { exit } = useApp();
  return useCallback(
    (error) => {
      if (error instanceof Error) {
        exit(error);
      } else if (error !== undefined) {
        exit(new Error(JSON.stringify(error)));
      } else {
        exit();
      }
    },
    [exit]
  );
}
