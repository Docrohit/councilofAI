import http from "node:http";
export function sandboxRequest(
  owner: string,
  action: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const socketPath = process.env.COUNCIL_SANDBOX_SOCKET;
  if (!socketPath)
    return Promise.reject(
      new Error(
        "Hosted sandboxes are not enabled on this installation. Use an OpenCode worker.",
      ),
    );
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path: "/",
        method: "POST",
        signal,
        timeout: 40_000,
        headers: { "Content-Type": "application/json" },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 400_000)
            request.destroy(new Error("Sandbox response is too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const result = JSON.parse(body);
            if (response.statusCode !== 200 || result.error)
              reject(new Error(result.error || "Sandbox operation failed"));
            else resolve(result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Sandbox request timed out")),
    );
    request.on("error", (error) =>
      reject(
        new Error(
          signal?.aborted
            ? "Sandbox request cancelled; a running command expires within 30 seconds."
            : `Sandbox unavailable: ${error.message}`,
        ),
      ),
    );
    request.end(JSON.stringify({ ...action, owner }));
  });
}
