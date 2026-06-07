import { createFileRoute } from "@tanstack/react-router";
import { handleUpdate } from "@/lib/telegram/handler";

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Optional secret token check (Telegram sends X-Telegram-Bot-Api-Secret-Token)
        const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (expected) {
          const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
          if (got !== expected) return new Response("Unauthorized", { status: 401 });
        }
        let update: any;
        try {
          update = await request.json();
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        // Must await — in the Worker runtime, detached promises are cancelled
        // when the response is returned, so /start etc. never get processed.
        try {
          await handleUpdate(update);
        } catch (e) {
          console.error("update err:", e);
        }
        return new Response("ok");
      },
      GET: async () => new Response("Telegram webhook endpoint", { status: 200 }),
    },
  },
});