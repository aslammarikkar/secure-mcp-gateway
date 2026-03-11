import type { AuthenticatedUser } from "../auth/authorization.js";
import type { RequestAuthContext } from "./auth-context.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      mcpAuth?: RequestAuthContext;
    }
  }
}

export {};