import ms, { type StringValue } from "ms";

const HAS_TIMEZONE_SUFFIX = /Z$|[+-]\d{2}:\d{2}$/;

export function normalizeDatetime(value: string): string {
  const duration = ms(value as StringValue);
  if (duration !== undefined) {
    return new Date(Date.now() - duration).toISOString();
  }
  if (HAS_TIMEZONE_SUFFIX.test(value)) return value;
  return `${value}Z`;
}
