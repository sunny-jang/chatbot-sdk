import test from "node:test";
import assert from "node:assert/strict";
import { uploadForm } from "../lib/knowledge/upload";
import { extractText, getExtension } from "../lib/knowledge/file-text";
test("document text extraction shares the existing supported formats", async () => {
  assert.equal(getExtension("FAQ.DOCX"), ".docx");
  assert.equal(
    await extractText("faq.txt", new TextEncoder().encode("고객 안내").buffer),
    "고객 안내",
  );
  assert.equal(
    await extractText(
      "faq.html",
      new TextEncoder().encode("<h1>안내</h1><p>내용</p>").buffer,
    ),
    "안내 내용",
  );
});
test("multipart reads enforce a streaming limit without content length", async () => {
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: "x".repeat(30),
  });
  await assert.rejects(() => uploadForm(request, 20), { status: 413 });
});
test("multipart rejects malformed content and retains the file field", async () => {
  await assert.rejects(
    () =>
      uploadForm(
        new Request("http://localhost/upload", {
          method: "POST",
          body: "invalid",
        }),
      ),
    { status: 400 },
  );
  const form = new FormData();
  form.set("file", new File(["안내"], "faq.txt", { type: "text/plain" }));
  const result = await uploadForm(
    new Request("http://localhost/upload", { method: "POST", body: form }),
  );
  assert.equal((result.get("file") as File).name, "faq.txt");
});
