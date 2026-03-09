import { isEmpty } from "lodash";
import { stringify } from "yaml";

export const YAML_INDENT = 2;

type YamlReplacer = NonNullable<Parameters<typeof stringify>[1]>;

interface FormatYamlOptions {
  /** Strip keys whose value is null, undefined, or empty array/string (default: true) */
  stripEmpty?: boolean;
}

const stripEmptyReplacer: YamlReplacer = (_key, value) => {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (isEmpty(value)) return undefined;
  return value;
};

/**
 * Format a data object as YAML, stripping empty values by default.
 */
export function formatYaml(
  data: unknown,
  options: FormatYamlOptions = {},
): string {
  const { stripEmpty = true } = options;
  const replacer = stripEmpty ? stripEmptyReplacer : undefined;
  return stringify(data, replacer, { indent: YAML_INDENT }).trimEnd();
}
