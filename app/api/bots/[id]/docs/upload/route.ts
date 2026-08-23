import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import JSZip from "jszip";
import mammoth from "mammoth";
import sql from "@/lib/neon";
import { Document } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { randomUUID } from "crypto";

export const maxDuration = 120;

const SUPPORTED_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".json", ".xml",
  ".html", ".htm", ".pdf", ".docx", ".hwp", ".hwpx",
]);

const CONCURRENCY = 5;

function getExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function extractText(filename: string, buffer: ArrayBuffer): Promise<string> {
  const ext = getExtension(filename);
  if (ext === ".pdf") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(Buffer.from(buffer));
    return result.text.trim();
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return result.value.trim();
  }
  if (ext === ".hwpx") {
    const hwpxZip = await JSZip.loadAsync(buffer);
    const texts: string[] = [];
    for (const [path, entry] of Object.entries(hwpxZip.files)) {
      if (entry.dir || !path.startsWith("Contents/") || !path.endsWith(".xml")) continue;
      const xml = await entry.async("text");
      const matches = xml.match(/<hp:t[^>]*>([^<]*)<\/hp:t>/g) ?? [];
      for (const m of matches) {
        const t = m.replace(/<[^>]+>/g, "").trim();
        if (t) texts.push(t);
      }
    }
    return texts.join("\n").trim();
  }
  if (ext === ".hwp") {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    let i = 0;
    while (i < bytes.length - 1) {
      const cp = bytes[i] | (bytes[i + 1] << 8);
      if ((cp >= 0x0020 && cp <= 0x007e) || (cp >= 0xac00 && cp <= 0xd7a3) ||
          (cp >= 0x3131 && cp <= 0x318e) || cp === 0x000a || cp === 0x000d) {
        chunks.push(String.fromCharCode(cp));
      } else if (chunks.length > 0 && chunks[chunks.length - 1] !== "\n") {
        chunks.push("\n");
      }
      i += 2;
    }
    return chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (ext === ".html" || ext === ".htm") {
    return stripHtml(new TextDecoder().decode(buffer));
  }
  return new TextDecoder().decode(buffer).trim();
}

async function saveDoc(
  botId: string, folderId: string | null, filename: string, buffer: ArrayBuffer, apiKey?: string | null
): Promise<Document | null> {
  try {
    const content = await extractText(filename, buffer);
    if (!content) return null;
    const title = filename.replace(/\.[^.]+$/, "");
    const embedding = await getEmbedding(content.slice(0, 8000), apiKey);
    const docId = randomUUID();
    const rows = await sql`
      INSERT INTO documents (id, bot_id, folder_id, title, content, embedding)
      VALUES (${docId}, ${botId}, ${folderId ?? null}, ${title}, ${content}, ${JSON.stringify(embedding)})
      RETURNING id, bot_id, folder_id, title, content, created_at
    `;
    return rows[0] as unknown as Document;
  } catch (err) {
    console.error("[docs/upload] saveDoc failed:", filename, err);
    return null;
  }
}

async function processBatch(
  tasks: { filename: string; buffer: ArrayBuffer; folderId: string | null }[],
  botId: string,
  apiKey: string | null,
  created: Document[],
  skipped: string[]
) {
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((t) => saveDoc(botId, t.folderId, t.filename, t.buffer, apiKey))
    );
    for (let j = 0; j < results.length; j++) {
      const doc = results[j];
      if (doc) created.push(doc);
      else skipped.push(batch[j].filename);
    }
  }
}

async function getTenantId() {
  const jar = await cookies();
  return jar.get("tenant_id")?.value ?? null;
}

async function botBelongsToTenant(botId: string, tenantId: string) {
  const rows = await sql`SELECT id FROM bots WHERE id = ${botId} AND tenant_id = ${tenantId}`;
  return !!rows[0];
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await getTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await botBelongsToTenant(id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const apiKey = await getTenantApiKeyByTenantId(tenantId);
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  const paths = formData.getAll("paths") as string[]; // webkitRelativePath per file
  const rootFolderId = formData.get("folder_id") as string | null;

  if (!files.length) return NextResponse.json({ error: "파일을 선택해주세요" }, { status: 400 });

  const created: Document[] = [];
  const skipped: string[] = [];

  // ── Folder upload mode (paths provided) ──────────────────────────────
  if (paths.length === files.length && paths.some((p) => p.includes("/"))) {
    // Build dir → folder_id map, creating folders top-down
    const dirToId = new Map<string, string>();

    const allDirs = new Set<string>();
    for (const p of paths) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        allDirs.add(parts.slice(0, i).join("/"));
      }
    }

    const sortedDirs = Array.from(allDirs).sort(
      (a, b) => a.split("/").length - b.split("/").length
    );

    for (const dirPath of sortedDirs) {
      const parts = dirPath.split("/");
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join("/");
      const parentId = parentPath ? (dirToId.get(parentPath) ?? rootFolderId) : rootFolderId;

      const fId = randomUUID();
      await sql`
        INSERT INTO doc_folders (id, bot_id, name, parent_id)
        VALUES (${fId}, ${id}, ${name}, ${parentId ?? null})
      `;
      dirToId.set(dirPath, fId);
    }

    const tasks: { filename: string; buffer: ArrayBuffer; folderId: string | null }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = paths[i];
      const filename = file.name;
      const ext = getExtension(filename);

      if (filename.startsWith(".") || filename.startsWith("__") || !SUPPORTED_EXTENSIONS.has(ext)) {
        skipped.push(relPath);
        continue;
      }

      const parts = relPath.split("/");
      const dirPath = parts.slice(0, -1).join("/");
      const folderId = dirPath ? (dirToId.get(dirPath) ?? rootFolderId) : rootFolderId;

      tasks.push({ filename, buffer: await file.arrayBuffer(), folderId });
    }

    await processBatch(tasks, id, apiKey, created, skipped);
    return NextResponse.json({ created, skipped }, { status: 201 });
  }

  // ── File upload mode ──────────────────────────────────────────────────
  const tasks: { filename: string; buffer: ArrayBuffer; folderId: string | null }[] = [];

  for (const file of files) {
    const filename = file.name;
    const ext = getExtension(filename);
    const buffer = await file.arrayBuffer();

    if (ext === ".zip") {
      const zip = await JSZip.loadAsync(buffer);
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const innerName = relativePath.split("/").pop() ?? relativePath;
        if (innerName.startsWith(".") || innerName.startsWith("__")) continue;
        if (!SUPPORTED_EXTENSIONS.has(getExtension(innerName))) { skipped.push(innerName); continue; }
        tasks.push({ filename: innerName, buffer: await zipEntry.async("arraybuffer"), folderId: rootFolderId });
      }
    } else if (SUPPORTED_EXTENSIONS.has(ext)) {
      tasks.push({ filename, buffer, folderId: rootFolderId });
    } else {
      skipped.push(filename);
    }
  }

  await processBatch(tasks, id, apiKey, created, skipped);
  return NextResponse.json({ created, skipped }, { status: 201 });
}
