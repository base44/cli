/**
 * Auth namespace for the SDK.
 * Provides authentication operations (login, logout, etc.).
 * Auth is global (not project-scoped), so methods are static.
 */

import {
  generateDeviceCode,
  getTokenFromDeviceCode,
  getUserInfo,
} from "@/core/internal/auth/api.js";
import {
  isLoggedIn as _isLoggedIn,
  requireAuth as _requireAuth,
  deleteAuth,
  readAuth,
  writeAuth,
} from "@/core/internal/auth/config.js";
import type {
  AuthData,
  UserInfoResponse,
} from "@/core/internal/auth/schema.js";

// biome-ignore lint/complexity/noStaticOnlyClass: Intentional design for SDK facade pattern - grouping related auth operations
export class AuthNamespace {
  /**
   * Check if user is currently logged in.
   */
  static async isLoggedIn(): Promise<boolean> {
    return _isLoggedIn();
  }

  /**
   * Ensure user is authenticated, throws if not.
   */
  static async requireAuth(): Promise<void> {
    return _requireAuth();
  }

  /**
   * Get current user info, or null if not logged in.
   */
  static async getUser(): Promise<UserInfoResponse | null> {
    try {
      const auth = await readAuth();
      return await getUserInfo(auth.accessToken);
    } catch {
      return null;
    }
  }

  /**
   * Log out the current user by deleting stored credentials.
   */
  static async logout(): Promise<void> {
    await deleteAuth();
  }

  /**
   * Get the current auth data (tokens, user info).
   * Throws if not logged in.
   */
  static async getAuthData(): Promise<AuthData> {
    return readAuth();
  }

  /**
   * Start the device code login flow.
   * Returns device code info for displaying to user.
   */
  static async startDeviceCodeFlow() {
    return generateDeviceCode();
  }

  /**
   * Poll for token after user completes device code flow.
   * Returns null if user hasn't completed auth yet.
   */
  static async pollForToken(deviceCode: string) {
    return getTokenFromDeviceCode(deviceCode);
  }

  /**
   * Save auth data after successful login.
   */
  static async saveAuth(authData: AuthData): Promise<void> {
    await writeAuth(authData);
  }
}
