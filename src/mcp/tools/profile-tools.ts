import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Permission } from "../../auth/authorization.js";
import { getGraphAccessTokenOnBehalfOf } from "../../auth/obo.js";
import type { ToolExecutionContext } from "../../types/auth-context.js";
import { jsonResult } from "../tool-helpers.js";
import type { ToolDefinition } from "../tool-types.js";

const GetMyProfileInputSchema = z.object({});

const GetMyProfileOutputSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable().optional(),
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string().nullable().optional(),
});

export const profileTools: ToolDefinition[] = [
  {
    name: "get_my_profile",
    description:
      "Get the signed-in user's Microsoft Graph profile using On-Behalf-Of token exchange. Returns the user's basic profile details from Microsoft Graph.",
    requiredPermissions: [Permission.READ_PROFILE],
    inputSchema: zodToJsonSchema(GetMyProfileInputSchema),
    outputSchema: zodToJsonSchema(GetMyProfileOutputSchema),
    async execute(_: Record<string, never>, context?: ToolExecutionContext) {
      const tracer = trace.getTracer("todo-tools");
      const span = tracer.startSpan("get_my_profile", {
        attributes: {
          "user.id": context?.user?.id || "unknown",
          "user.email": context?.user?.email || "unknown",
        },
      });

      try {
        if (!context?.accessToken) {
          throw new Error("No incoming user access token available for OBO exchange");
        }

        const graphToken = await getGraphAccessTokenOnBehalfOf(context.accessToken);
        const response = await fetch(
          "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
          {
            headers: {
              Authorization: `Bearer ${graphToken}`,
            },
          }
        );

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Graph request failed (${response.status}): ${body}`);
        }

        const profile = await response.json();
        const structuredContent = {
          id: profile.id,
          displayName: profile.displayName ?? null,
          mail: profile.mail ?? null,
          userPrincipalName: profile.userPrincipalName ?? null,
        };

        span.setAttributes({
          "graph.user_id": structuredContent.id,
          "operation.success": true,
        });
        span.setStatus({
          code: SpanStatusCode.OK,
          message: "Microsoft Graph profile retrieved successfully",
        });

        return jsonResult(structuredContent);
      } catch (error) {
        span.addEvent("graph.profile_error", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  },
];