import type { JWTPayload } from "jose";
import type { AuthenticatedUser } from "../auth/authorization.js";

export type RequestAuthContext = {
  payload: JWTPayload;
  accessToken: string;
  user: AuthenticatedUser;
};

export type ToolExecutionContext = {
  accessToken?: string | null;
  user?: AuthenticatedUser | null;
};