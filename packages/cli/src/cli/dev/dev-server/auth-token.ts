import jwt from "jsonwebtoken";

const LOCAL_DEV_SECRET = "LOCAL_DEV_SECRET";

export const createJwtToken = (email: string): string => {
  return jwt.sign({ email, sub: email }, LOCAL_DEV_SECRET, {
    expiresIn: "360d",
  });
};
