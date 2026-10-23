import { test } from "node:test";
import assert from "node:assert/strict";
import { sitemapEntries } from "../lib/operations/site-discovery";

const base = new URL("https://example.com/");

test("sitemap index yields child sitemaps on the same host only", () => {
  const r = sitemapEntries(
    `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
      <sitemap><loc>https://cdn.other.com/sitemap.xml</loc></sitemap>
    </sitemapindex>`,
    base,
  );
  assert.deepEqual(r.children, ["https://example.com/sitemap-posts.xml"]);
  assert.deepEqual(r.pages, []);
});

test("urlset yields page urls, dropping files, other hosts and fragments", () => {
  const r = sitemapEntries(
    `<urlset><url><loc>https://example.com/faq#top</loc></url>
     <url><loc> https://example.com/pricing </loc></url>
     <url><loc>https://example.com/brochure.pdf</loc></url>
     <url><loc>https://example.com/logo.png</loc></url>
     <url><loc>https://other.com/page</loc></url>
     <url><loc>http://example.com:8080/admin</loc></url></urlset>`,
    base,
  );
  assert.deepEqual(r.pages, [
    "https://example.com/faq",
    "https://example.com/pricing",
  ]);
});

test("malformed xml yields nothing instead of throwing", () => {
  const r = sitemapEntries("<not really xml", base);
  assert.deepEqual(r, { children: [], pages: [] });
});
