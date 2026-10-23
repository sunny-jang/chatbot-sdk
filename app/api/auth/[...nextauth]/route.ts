import type { NextRequest } from "next/server";
import { authConfig, handlers } from "@/auth";
import {
  customerPortalAuthOrigin,
  handleCustomerPortalAuth,
} from "@/lib/customer-portal/auth-host";

// Exact desk-host requests run against the canonical desk URL; everything else keeps next-auth's AUTH_URL handling.
const route =
  (handler: (req: NextRequest) => Promise<Response>) =>
  (req: NextRequest) => {
    const origin = customerPortalAuthOrigin(req);
    return origin
      ? handleCustomerPortalAuth(req, origin, authConfig)
      : handler(req);
  };
export const GET = route(handlers.GET);
export const POST = route(handlers.POST);
