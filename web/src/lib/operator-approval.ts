/** Sends explicit dashboard approval clicks using the existing browser session. */

/** Marks a browser approval request without prompting for or storing another secret. */
export async function operatorApprovalFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Pio-Dashboard-Approval", "1");
  return fetch(url, { ...init, headers, credentials: "same-origin" });
}
