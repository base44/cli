import type { TextProps as InkTextProps } from "ink";
import { Text as InkText } from "ink";
import type { FC, ReactNode } from "react";

const skins = {
  standard: {},
  secondary: { color: "gray" },
  success: { color: "green" },
  question: { color: "blue" },
  info: { color: "blueBright" },
  error: { color: "red" },
  warning: { color: "yellow" },
} as const satisfies Record<string, InkTextProps>;

export type TextSkin = keyof typeof skins;

export interface TextProps {
  skin?: TextSkin;
  bold?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  children?: ReactNode;
}

export const Text: FC<TextProps> = ({
  children,
  skin = "standard",
  bold,
  underline,
  strikethrough,
}) => {
  return (
    <InkText
      {...skins[skin]}
      bold={bold}
      underline={underline}
      strikethrough={strikethrough}
    >
      {children}
    </InkText>
  );
};
