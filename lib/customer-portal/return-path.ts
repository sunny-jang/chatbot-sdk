/** Local customer routes only; do not accept external destinations or auth loops. */
export function customerReturnPath(value: unknown) {
  if (typeof value !== 'string' || !/^\/customer(?:\/|$)/.test(value) || /[\\\u0000-\u0020]/.test(value)) return '/customer';
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || /^\/customer\/(login|forgot-password|reset-password)(?:\/|$)/.test(url.pathname)) return '/customer';
  return url.pathname + url.search + url.hash;
}
