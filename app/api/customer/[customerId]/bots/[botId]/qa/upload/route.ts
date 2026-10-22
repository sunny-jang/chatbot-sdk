import * as XLSX from "xlsx";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import { customerBot, mutateKnowledge } from "@/lib/customer-portal/bots";
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
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      sheetRows: 102,
    });
    const rows: { question: string; answer: string }[] = [];
    for (const sheet of workbook.SheetNames.slice(0, 7)) {
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[sheet],
        { defval: "" },
      );
      for (const item of data) {
        rows.push({
          question: text(item["질문"] ?? item.question, "질문", 2000),
          answer: text(
            item["답변"] ?? item["질문상세"] ?? item.answer,
            "답변",
            20000,
          ),
        });
        if (rows.length > 100)
          throw new PortalError("한 번에 100개 이하 Q&A를 가져와주세요.");
      }
    }
    if (!rows.length)
      throw new PortalError("질문·답변 열과 내용을 확인해주세요.");
    const vectors = await getEmbeddings(
      rows.map((r) => r.question),
      await getTenantApiKeyByTenantId(grant.tenant_id),
    );
    await sql.begin(async (tx) => {
      for (let i = 0; i < rows.length; i++)
        await mutateKnowledge(
          tx as unknown as AccessDatabase,
          user.id,
          p.customerId,
          p.botId,
          "qa",
          "POST",
          { ...rows[i], folder_id: form.get("folder_id") || null },
          null,
          vectors[i],
        );
    });
    return Response.json({ count: rows.length }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
