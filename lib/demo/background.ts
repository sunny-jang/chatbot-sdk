/**
 * The demo page is served over HTTPS, so browsers block an http:// homepage in
 * its iframe as mixed content. Such demos skip straight to the fallback screen.
 * Kept free of server imports so client components can use it.
 */
export function demoBackgroundBlocked(siteUrl: string) {
  return /^http:\/\//i.test(siteUrl.trim());
}
