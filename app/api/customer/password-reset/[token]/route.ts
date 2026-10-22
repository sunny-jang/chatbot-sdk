import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import {
  body,
  failure,
  sameOrigin,
  tokenHash,
} from "@/lib/customer-portal/input";
import { resetCustomerPassword } from "@/lib/customer-portal/password-reset";
import { requireReady } from "@/lib/customer-portal/auth";
import { enforceRateLimit } from "@/lib/support";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    sameOrigin(req);
    await requireReady();
    const { token } = await params;
    if (
      !(await enforceRateLimit(
        "customer-reset-use:" + tokenHash(token),
        req,
        6,
      ))
    )
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const input = await body(req);
    await sql.begin((tx) =>
      resetCustomerPassword(
        tx as unknown as AccessDatabase,
        token,
        input.password,
      ),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
