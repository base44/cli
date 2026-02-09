import { useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Key } from "@/cli/ink-render/components/Key";
import { Text } from "@/cli/ink-render/components/Text";
import { theme } from "@/cli/utils/theme";
import { DevScreenBorder } from "./components/DevScreenBorder";
import { createDevLogger } from "./createDevLogger";
import type { ProxyMode } from "./dev-server/main";
import { useDevServer } from "./useDevServer";

export const DevCommand = () => {
  const logger = useMemo(() => createDevLogger(), []);
  const [proxyMode, setProxyMode] = useState<ProxyMode | null>(null);
  const serverApi = useDevServer(
    logger,
    useCallback((mode: ProxyMode) => {
      setProxyMode(mode);
    }, [])
  );

  useEffect(() => {
    console.log(theme.colors.base44OrangeBackground(" Base 44 "));
  }, []);

  useInput(async (input) => {
    if (input === "L" || input === "l") {
      const newLocal =
        serverApi?.getProxyMode() === "local" ? "proxy" : "local";
      serverApi?.setProxyMode(newLocal);
      setProxyMode(newLocal);
    }
  });

  return (
    <DevScreenBorder>
      <Text>
        Serving from{" "}
        <Text skin="info" bold underline>
          {proxyMode === "local" ? "local" : "remote"}
        </Text>
      </Text>
      <Text skin="secondary">
        (Press <Key value="L" skin="secondary" /> toggle local/remote mode)
      </Text>
    </DevScreenBorder>
  );
};
