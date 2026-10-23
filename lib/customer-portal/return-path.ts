/** Local customer routes only; external destinations, protocol-relative URLs and auth loops fall back to /customer. */
export function customerReturnPath(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\/customer(?:\/|$)/.test(value) ||
    /[\\\u0000- ]/.test(value)
  )
    return "/customer";
  const url = new URL(value, "https://local.invalid");
  // Re-check after normalization so "/customer/../admin" cannot leave the customer scope.
  if (
    url.origin !== "https://local.invalid" ||
    !/^\/customer(?:\/|$)/.test(url.pathname) ||
    /^\/customer\/(login|forgot-password|reset-password)(?:\/|$)/.test(
      url.pathname,
    )
  )
    return "/customer";
  return url.pathname + url.search + url.hash;
}
