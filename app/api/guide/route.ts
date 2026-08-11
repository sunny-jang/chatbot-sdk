import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const html = fs.readFileSync(
    path.join(process.cwd(), "public/guide.html"),
    "utf-8"
  );

  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const styles = styleMatch ? styleMatch[1] : "";

  const contentMatch = html.match(/<main class="content">([\s\S]*?)<\/main>/);
  const content = contentMatch ? contentMatch[1] : "";

  // Return a self-contained HTML document (no sidebar) for use as iframe srcdoc
  const doc = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --blue: #2563eb; --blue-light: #eff6ff;
  --green: #16a34a; --green-light: #f0fdf4;
  --purple: #7c3aed; --purple-light: #f5f3ff;
  --gray-50: #f9fafb; --gray-100: #f3f4f6; --gray-200: #e5e7eb;
  --gray-500: #6b7280; --gray-700: #374151; --gray-900: #111827;
}
${styles}
body { background: #fff; }
.content { max-width: none; margin: 0; padding: 32px 36px; }
</style>
</head>
<body>
<main class="content">${content}</main>
<script>
function copyCode(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.textContent = '✓ 복사됨';
    setTimeout(() => btn.textContent = '복사', 2000);
  });
}
// Listen for scroll-to-section messages from parent
window.addEventListener('message', (e) => {
  if (e.data?.type === 'scrollTo') {
    if (e.data.id === 'overview') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const el = document.getElementById(e.data.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});
</script>
</body>
</html>`;

  return new NextResponse(doc, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
