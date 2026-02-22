import JSON5 from "json5";
import { InvalidInputError } from "@/core/errors.js";
import { readJsonFile } from "@/core/utils/fs.js";

interface RecordDataOptions {
  data?: string;
  file?: string;
}

export async function parseRecordData(
  options: RecordDataOptions,
  exampleHint?: string,
): Promise<Record<string, unknown>> {
  if (options.data && options.file) {
    throw new InvalidInputError(
      "Cannot use both --data and --file. Choose one.",
      {
        hints: [
          {
            message: `Pass --data for inline JSON or --file for a JSON file path, not both.`,
          },
        ],
      },
    );
  }

  if (options.data) {
    try {
      return JSON5.parse(options.data);
    } catch {
      throw new InvalidInputError(
        "Invalid JSON in --data flag. Provide valid JSON.",
        exampleHint
          ? { hints: [{ message: `Example: --data '${exampleHint}'` }] }
          : undefined,
      );
    }
  }

  if (options.file) {
    return readJsonFile(options.file) as Promise<Record<string, unknown>>;
  }

  throw new InvalidInputError(
    "Provide record data with --data or --file flag",
    exampleHint
      ? {
          hints: [
            {
              message: `Example: --data '${exampleHint}' or --file record.json`,
            },
          ],
        }
      : undefined,
  );
}
