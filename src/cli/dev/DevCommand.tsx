import { useMemo } from "react";
import { BaseLogo } from "./components/BaseLogo";
import { DevScreenBorder } from "./components/DevScreenBorder";
import { createDevLogger } from "./createDevLogger";
import { useDevServer } from "./useDevServer";

export const DevCommand = () => {
  const logger = useMemo(() => createDevLogger(), []);
  useDevServer(logger);

  return (
    <DevScreenBorder>
      <BaseLogo />
    </DevScreenBorder>
  );
};
