import { AuthDataSchema, type AuthData } from "../schemas/auth.js";
import { AUTH_FILE_PATH } from "./constants.js";
import {
  fileExists,
  readJsonFile,
  writeJsonFile,
  deleteFile,
} from "../utils/fs.js";

export async function readAuth(): Promise<AuthData> {
  try {
    const parsed = await readJsonFile(AUTH_FILE_PATH);
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
    await writeJsonFile(AUTH_FILE_PATH, result.data);
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
    await deleteFile(AUTH_FILE_PATH);
  } catch (error) {
    throw new Error(
      `Failed to delete authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

