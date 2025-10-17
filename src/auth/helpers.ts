import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppContext, User } from "./types";

/**
 * Get organization ID from user token
 * Checks multiple possible claim names for org_id
 */
export function getOrgId(ctx: Context<AppContext>): string {
  const { org_id } = ctx.var.user;

  if (!org_id) {
    throw new HTTPException(403, {
      message: "Organization context required. Please select an organization.",
    });
  }

  return org_id;
}
