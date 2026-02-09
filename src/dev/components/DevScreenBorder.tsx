import { Box } from "ink";
import type { FC, ReactNode } from "react";

export const DevScreenBorder: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <Box
      flexDirection="column"
      borderTop
      borderLeft={false}
      borderBottom={false}
      borderRight={false}
      borderStyle="round"
      borderColor="blueBright"
      width="95%"
    >
      {children}
    </Box>
  );
};
