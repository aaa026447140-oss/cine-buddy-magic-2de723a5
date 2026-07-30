import { createFileRoute } from "@tanstack/react-router";
import { processBroadcastTick } from "@/lib/telegram/broadcast";

async function run() {
  try {
    const result = await processBroadcastTick(20_000);
    return Response.json({ ok: true, result });
  } catch (e: any) {
    console.error("broadcast tick error:", e?.message || e);
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/broadcast-tick")({
  server: { handlers: { POST: run, GET: run } },
});
