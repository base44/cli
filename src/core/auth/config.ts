import { getAuthFilePath } from "../consts.js";
import { readJsonFile, writeJsonFile, deleteFile } from "../utils/fs.js";
import { AuthDataSchema } from "./schema.js";
import type { AuthData } from "./schema.js";

export async function readAuth(): Promise<AuthData> {
  try {
    const parsed = await readJsonFile(getAuthFilePath());
    const result = AuthDataSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid authentication data: ${result.error.issues
          .map((e) => e.message)
          .join(", ")}`
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Authentication")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("File not found")) {
      throw new Error("Authentication file not found. Please login first.");
    }
    throw new Error(
      `Failed to read authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function writeAuth(authData: AuthData): Promise<void> {
  const result = AuthDataSchema.safeParse(authData);

  if (!result.success) {
    throw new Error(
      `Invalid authentication data: ${result.error.issues
        .map((e) => e.message)
        .join(", ")}`
    );
  }

  try {
    await writeJsonFile(getAuthFilePath(), result.data);
  } catch (error) {
    throw new Error(
      `Failed to write authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function deleteAuth(): Promise<void> {
  try {
    await deleteFile(getAuthFilePath());
  } catch (error) {
    throw new Error(
      `Failed to delete authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
