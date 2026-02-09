import chalk from "chalk";
import { useEffect, useRef } from "react";
import type { Logger } from "./createDevLogger";
import { createDevServer, type ProxyMode } from "./dev-server/main";

export const useDevServer = (
  logger: Logger,
  readyCb?: (mode: ProxyMode) => void
) => {
  const serverApiRef = useRef<{
    setProxyMode: (mode: ProxyMode) => void;
    getProxyMode: () => ProxyMode;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    createDevServer(logger).then(
      ({ port, setProxyMode, cleanup, getProxyMode }) => {
        logger.log(
          `Dev server is available at ${chalk.underline.blue(`http://localhost:${port}`)}`
        );
        serverApiRef.current = { setProxyMode, getProxyMode };
        cleanupRef.current = cleanup;
        readyCb?.(getProxyMode());
      }
    );

    return () => {
      cleanupRef.current?.();
    };
  }, [logger, readyCb]);

  return {
    setProxyMode: (mode: ProxyMode) => {
      serverApiRef.current?.setProxyMode(mode);
    },
    getProxyMode: () => {
      return serverApiRef.current?.getProxyMode();
    },
  };
};
