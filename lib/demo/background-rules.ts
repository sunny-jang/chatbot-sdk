/**
 * Client-safe demo background rules (no server imports), shared by the demo
 * page, the demo manager and the upload API.
 */
export const DEMO_BACKGROUND_MAX_BYTES = 3 * 1024 * 1024;
/**
 * The demo page is served over HTTPS, so browsers block an http:// homepage in
 * its iframe as mixed content. Such demos skip straight to the fallback screen.
 */
export function demoBackgroundBlocked(siteUrl: string) {
  return /^http:\/\//i.test(siteUrl.trim());
}
