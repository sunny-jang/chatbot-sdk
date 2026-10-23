import type { NextRequest } from "next/server";
import { authConfig, handlers } from "@/auth";
import {
  dedicatedAuthHost,
  handleCustomerPortalAuth,
} from "@/lib/customer-portal/auth-host";

// Exact desk/master-host requests run against their canonical URL with their own provider set;
// everything else keeps next-auth's AUTH_URL handling.
const route =
  (handler: (req: NextRequest) => Promise<Response>) =>
  (req: NextRequest) => {
    const dedicated = dedicatedAuthHost(req);
    return dedicated
      ? handleCustomerPortalAuth(req, dedicated.origin, authConfig, dedicated.providers)
      : handler(req);
  };
export const GET = route(handlers.GET);
export const POST = route(handlers.POST);
