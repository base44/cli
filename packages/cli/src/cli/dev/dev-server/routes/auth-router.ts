import { randomInt } from "node:crypto";
import type { Request } from "express";
import { json, Router } from "express";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import * as z from "zod";
import { theme } from "@/cli/utils/theme.js";
import type { DevLogger } from "../../createDevLogger.js";
import {
  type Database,
  PRIVATE_USER_COLLECTION,
  USER_COLLECTION,
} from "../db/database.js";
import { getNowISOTimestamp } from "../utils.js";

const LOCAL_DEV_SECRET = "LOCAL_DEV_SECRET";
const TEN_MINUTES = 10 * 60 * 1000;

const generateCode = () => {
  return randomInt(100000, 1000000).toString();
};

const createJwtToken = (email: string) => {
  return jwt.sign({ sub: email }, LOCAL_DEV_SECRET, {
    expiresIn: "360d",
  });
};

const LoginBody = z.object({ email: z.email(), password: z.string() });
const VerifyOtpBody = z.object({ email: z.email(), otp_code: z.string() });

type UserRegister = {
  id: string;
  email: string;
  otpCode?: string;
  password: string;
  createdAt: number;
};

export function createAuthRouter(db: Database, logger: DevLogger): Router {
  const router = Router({ mergeParams: true });
  const parseBody = json();

  router.post("/login", parseBody, async (req, res) => {
    const { email, password } = LoginBody.parse(req.body);

    const result = await db
      .getCollection(USER_COLLECTION)
      ?.findOneAsync({ email });

    if (result) {
      const privateUserData = await db
        .getCollection(PRIVATE_USER_COLLECTION)
        ?.findOneAsync({ email });
      if (result.role === "admin" || privateUserData?.password === password) {
        res.json({
          access_token: createJwtToken(email),
          success: true,
          user: {},
        });
      } else {
        res.status(400).json({
          detail: "Invalid email or password",
          error_type: "HTTPException",
          message: "Invalid email or password",
          request_id: null,
          traceback: "",
        });
      }

      return;
    }

    res.status(401).json({ error: "Unauthorized" });
  });

  router.post("/register", parseBody, async (req, res) => {
    const { email, password } = LoginBody.parse(req.body);

    if ((password || "").length < 8) {
      res.status(400).json({
        detail: "Password must be at least 8 characters long",
        error_type: "HTTPException",
        message: "Password must be at least 8 characters long",
        request_id: null,
        traceback: "",
      });

      return;
    }

    const result = await db
      .getCollection(USER_COLLECTION)
      ?.findOneAsync({ email });

    if (result) {
      res.status(400).json({
        detail: "A user with this email already exists",
        error_type: "HTTPException",
        message: "A user with this email already exists",
        request_id: null,
        traceback: "",
      });
      return;
    }

    const privateUserCollection = db.getCollection(PRIVATE_USER_COLLECTION);
    const privateUserData = (await privateUserCollection?.findOneAsync({
      email,
    })) as UserRegister | undefined;
    const otpCode = generateCode();
    const id = privateUserData ? privateUserData.id : nanoid();
    if (!privateUserData) {
      await privateUserCollection?.insertAsync({
        id,
        email,
        otpCode,
        password,
        createdAt: Date.now(),
      });
    } else {
      // Here user is calling `/register` again before he called `/verify-otp`
      // Apper in this case is creating new otp code, therefore I'm overriding the one that is in DB.
      await privateUserCollection?.updateAsync(
        {
          email,
        },
        {
          $set: {
            otpCode,
            createdAt: Date.now(),
          },
        },
      );
    }

    logger.log(
      theme.styles.info(
        `\nIn order to complete registration use this verification code: ${otpCode}\n`,
      ),
    );

    res.json({
      id,
      message:
        "Registration successful. Please check your email for the verification code.",
      otp_expires_in_minutes: 10,
    });
  });

  router.post(
    "/verify-otp",
    parseBody,
    async (req: Request<{ appId: string }>, res) => {
      const { email, otp_code } = VerifyOtpBody.parse(req.body);

      const privateUserCollection = db.getCollection(PRIVATE_USER_COLLECTION);
      const privateUserData = (await privateUserCollection?.findOneAsync({
        email,
      })) as UserRegister | undefined;

      if (!privateUserData || privateUserData.otpCode !== otp_code) {
        const appId = req.params.appId;
        res.status(500).json({
          detail: `{'email': '${email}', 'app_id': '${appId}}'} -> Object not found`,
          error_type: "ObjectNotFoundError",
          message: `{'email': '${email}', 'app_id': '${appId}}'} -> Object not found`,
          request_id: null,
          traceback: "",
        });
        return;
      }

      if (+Date.now() - privateUserData.createdAt > TEN_MINUTES) {
        res.status(400).json({
          detail: "Verification code has expired",
          error_type: "HTTPException",
          message: "Verification code has expired",
          request_id: null,
          traceback: "",
        });
      } else {
        await privateUserCollection?.updateAsync(
          {
            email,
          },
          {
            $unset: { otpCode: true },
          },
        );

        const collection = db.getCollection(USER_COLLECTION);
        const now = getNowISOTimestamp();
        const nameFromEmailMatch = /^([^@]+)/.exec(email);
        const fullName = nameFromEmailMatch ? nameFromEmailMatch[1] : email;
        await collection?.insertAsync({
          id: privateUserData.id,
          email: email,
          full_name: fullName,
          is_service: false,
          is_verified: true,
          disabled: null,
          role: "user",
          collaborator_role: "editor",
          created_date: now,
          updated_date: now,
        });
        res.json({
          id: privateUserData.id,
          access_token: createJwtToken(email),
          message: "Email verified successfully. You are now logged in.",
          success: true,
        });
      }
    },
  );

  return router;
}
