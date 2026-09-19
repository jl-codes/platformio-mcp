/** Operator capability entry; kept only for one approval request, never browser storage. */
import { createElement } from "react";
import { Input, Modal } from "antd";

/** Requests the separately configured operator secret without deriving it from dashboard access. */
export function requestOperatorCapability(): Promise<string | null> {
  return new Promise((resolve) => {
    let value = "";
    Modal.confirm({
      title: "Operator approval capability",
      content: createElement(Input.Password, {
        autoComplete: "off",
        placeholder: "Separate operator capability",
        onChange: (event) => {
          value = event.target.value;
        },
      }),
      okText: "Submit approval",
      cancelText: "Cancel",
      onOk: () => resolve(value || null),
      onCancel: () => resolve(null),
    });
  });
}

/** Adds authority only to approval routes; callers cannot silently reuse the ordinary dashboard token. */
export async function operatorApprovalFetch(
  url: string,
  init: RequestInit,
  requestCapability = requestOperatorCapability,
): Promise<Response> {
  const capability = await requestCapability();
  if (!capability)
    return new Response(
      JSON.stringify({ error: "Operator approval cancelled." }),
      { status: 403 },
    );
  const headers = new Headers(init.headers);
  headers.set("X-Pio-Approval-Token", capability);
  return fetch(url, { ...init, headers });
}
