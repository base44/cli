import chalk from "chalk";
import { useEffect, useRef } from "react";
import type { Logger } from "./createDevLogger";
import { createDevServer } from "./dev-server/main";
import { useExit } from '../ink-render/hooks/use-exit';

export const useDevServer = (logger: Logger) => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const exit = useExit();

  useEffect(() => {
    createDevServer(logger)
      .then(({ port, cleanup }) => {
        logger.log(
          `Dev server is available at ${chalk.underline.blue(`http://localhost:${port}`)}`
        );
        cleanupRef.current = cleanup;
      })
      .catch((error) => {
        logger.error("Failed to start dev server", error);
        exit(error);
      });

    return () => {
      cleanupRef.current?.();
    };
  }, [logger]);
};
