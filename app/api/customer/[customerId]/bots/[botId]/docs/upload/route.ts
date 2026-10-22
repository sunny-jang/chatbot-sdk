import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import {
  customerBot,
  uploadCustomerDocument,
} from "@/lib/customer-portal/bots";
import {
  failure,
  sameOrigin,
  PortalError,
  text,
} from "@/lib/customer-portal/input";
import { extractText, getExtension } from "@/lib/knowledge/file-text";
import { uploadForm } from "@/lib/knowledge/upload";
import { getEmbedding } from "@/lib/embeddings";
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
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    )
      throw new PortalError("5MB 이하 문서를 선택해주세요.");
    if (
      ![
        ".txt",
        ".md",
        ".markdown",
        ".csv",
        ".json",
        ".xml",
        ".html",
        ".htm",
        ".pdf",
        ".docx",
        ".hwp",
        ".hwpx",
      ].includes(getExtension(file.name))
    )
      throw new PortalError("지원하지 않는 문서 형식입니다.");
    const content = text(
        await extractText(file.name, await file.arrayBuffer()),
        "문서 본문",
        50000,
      ),
      title = text(file.name.replace(/\.[^.]+$/, ""), "제목", 300),
      folderId = form.get("folder_id");
    const vec = await getEmbedding(
      content.slice(0, 8000),
      await getTenantApiKeyByTenantId(grant.tenant_id),
    );
    const result = await sql.begin((tx) =>
      uploadCustomerDocument(
        tx as unknown as AccessDatabase,
        user.id,
        p.customerId,
        p.botId,
        { title, content, folder_id: folderId || null },
        vec,
      ),
    );
    return Response.json(result, {
      status: result.updated || result.skipped ? 200 : 201,
    });
  } catch (e) {
    return failure(e);
  }
}
