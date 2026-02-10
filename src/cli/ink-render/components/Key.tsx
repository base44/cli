import { Text as InkText } from "ink";
import type { FC } from "react";

export interface KeyProps {
  value: string;
  skin?: "main" | "secondary";
}

export const Key: FC<KeyProps> = ({ value, skin }) => {
  if (skin === "secondary") {
    return (
      <InkText>
        <InkText inverse> {value} </InkText>
        <InkText>░</InkText>
      </InkText>
    );
  }
  return (
    <InkText>
      <InkText backgroundColor="blueBright"> {value} </InkText>
      <InkText color="blueBright">░</InkText>
    </InkText>
  );
};
