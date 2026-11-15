// Server-side catalog lookup. POWER serves the numeric IMERG point series separately.
const ENDPOINT = "https://cmr.earthdata.nasa.gov/mcp/v1";
const PRODUCTS = ["GPM_3IMERGDF", "GPM_3IMERGDL"];
const CACHE_MS = 24 * 60 * 60 * 1000;
let cached, pending;

async function lookup() {
  const headers = { accept: "application/json, text/event-stream", "content-type": "application/json" };
  const signal = AbortSignal.timeout(12000);
  let id = 0;
  async function rpc(method, params, notification = false) {
    const request = { jsonrpc: "2.0", method, ...(params && { params }) };
    if (!notification) request.id = ++id;
    const response = await fetch(ENDPOINT, { method: "POST", headers, signal, body: JSON.stringify(request) });
    if (!response.ok) throw new Error(`Earthdata MCP HTTP ${response.status}`);
    const session = response.headers.get("mcp-session-id");
    if (session) headers["Mcp-Session-Id"] = session;
    if (notification) return;
    const isStream = response.headers.get("content-type")?.includes("text/event-stream");
    let reply;
    if (isStream) {
      const stream = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        while (!reply) {
          const { value, done } = await stream.read();
          if (done) break;
          buffer = (buffer + value).replaceAll("\r\n", "\n");
          const events = buffer.split("\n\n");
          buffer = events.pop();
          for (const event of events) {
            const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (data) { const candidate = JSON.parse(data); if (candidate.id === request.id) reply = candidate; }
          }
        }
      } finally { await stream.cancel().catch(() => {}); }
    } else reply = await response.json();
    if (reply?.id !== request.id || reply.error) throw new Error(reply?.error?.message || `Invalid Earthdata MCP response: ${method}`);
    return reply.result;
  }

  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Rooti", version: "1.0" } });
  headers["MCP-Protocol-Version"] = init.protocolVersion;
  await rpc("notifications/initialized", undefined, true);
  const collections = await Promise.all(PRODUCTS.map(async (shortName) => {
    const reply = await rpc("tools/call", { name: "get_collections", arguments: { short_name: shortName, limit: 10,
      fields: ["concept_id", "short_name", "version", "time_start", "time_end", "is_ongoing", "bounding_box"] } });
    const data = reply.structuredContent ?? JSON.parse(reply.content?.find((item) => item.type === "text")?.text || "null");
    if (reply.isError || data?.status === "error") throw new Error(`Earthdata MCP collection unavailable: ${shortName}`);
    const matches = (data?.collections || []).filter((c) => c.short_name === shortName && c.concept_id && /^\d{4}-\d{2}-\d{2}/.test(c.time_start));
    return matches.sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))[0];
  }));
  if (!collections.some(Boolean)) throw new Error("Earthdata MCP found no IMERG daily collections");
  return { source: ENDPOINT, retrievedAt: new Date().toISOString(), collections: collections.filter(Boolean) };
}

export function imergCatalog() {
  if (cached && Date.now() - Date.parse(cached.retrievedAt) < CACHE_MS) return Promise.resolve(cached);
  if (!pending) pending = lookup().then((value) => (cached = value)).finally(() => { pending = null; });
  return pending;
}
