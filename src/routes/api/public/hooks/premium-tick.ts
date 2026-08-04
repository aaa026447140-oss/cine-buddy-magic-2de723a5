import { createFileRoute } from "@tanstack/react-router";
import { processPremiumTick } from "@/lib/telegram/premium";

async function run() {
  try {
    const result = await processPremiumTick();
    return Response.json({ ok: true, result });
  } catch (e: any) {
    console.error("premium tick error:", e?.message || e);
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/premium-tick")({
  server: { handlers: { POST: run, GET: run } },
});
