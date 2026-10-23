import * as XLSX from "xlsx";
import { parseQaWorkbook } from "@/lib/knowledge/qa-workbook";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import { customerBot, importCustomerQa } from "@/lib/customer-portal/bots";
import {
  failure,
  sameOrigin,
  PortalError,
  text,
} from "@/lib/customer-portal/input";
import { uploadForm } from "@/lib/knowledge/upload";
import { getEmbeddings } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { enforceRateLimit } from "@/lib/support";
export const maxDuration = 120;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ customerId: string; botId: string }> },
) {
  try {
    sameOrigin(req);
    const p = await params,
      user = await portalUser(),
      { grant } = await customerBot(
        sql,
        user.id,
        p.customerId,
        p.botId,
        "knowledge.manage",
      );
    if (!(await enforceRateLimit("customer-upload:" + user.id, req, 10)))
      return Response.json(
        { error: "잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    const form = await uploadForm(req),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 5 * 1024 * 1024 ||
      !/[.](xlsx|csv)$/i.test(file.name)
    )
      throw new PortalError("5MB 이하 XLSX·CSV 파일을 선택해주세요.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const report = { skippedSheets: [] as string[] };
    const rows = parseQaWorkbook(workbook, report).map((item) => {
      try {
        return {
          ...item,
          question: text(item.question, "질문", 2000),
          answer: text(item.answer, "답변", 20000),
        };
      } catch (e) {
        // Name the sheet and row so a 100-row workbook can be fixed without guessing.
        throw new PortalError(
          `${item.folder} 시트 ${item.line}행: ${e instanceof Error ? e.message : "내용을 확인해주세요."}`,
        );
      }
    });
    if (rows.length > 100)
      throw new PortalError("한 번에 100개 이하 Q&A를 가져와주세요.");
    if (!rows.length)
      throw new PortalError("질문·답변 열과 내용을 확인해주세요.");
    const vectors = await getEmbeddings(
      rows.map((r) => r.question),
      await getTenantApiKeyByTenantId(grant.tenant_id),
    );
    const result = await sql.begin((tx) =>
      importCustomerQa(
        tx as unknown as AccessDatabase,
        user.id,
        p.customerId,
        p.botId,
        rows,
        form.get("folder_id") ? text(form.get("folder_id"), "폴더", 200) : null,
        vectors,
      ),
    );
    return Response.json(
      { count: rows.length, ...result, skippedSheets: report.skippedSheets },
      { status: 201 },
    );
  } catch (e) {
    return failure(e);
  }
}
