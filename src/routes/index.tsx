import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Movie Search Bot · Telegram" },
      { name: "description", content: "Webhook endpoint for the Telegram movie search bot." },
      { property: "og:title", content: "Movie Search Bot · Telegram" },
      { property: "og:description", content: "Webhook endpoint for the Telegram movie search bot." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-2xl space-y-4 text-center">
        <h1 className="text-3xl font-bold">🎬 Movie Search Telegram Bot</h1>
        <p className="text-muted-foreground">
          The bot backend is running. Webhook endpoint:
          <code className="block mt-2 px-3 py-2 rounded bg-muted text-sm">/api/public/telegram/webhook</code>
        </p>
        <p className="text-sm text-muted-foreground">
          Open Telegram and send <code>/start</code> to your bot. Admins can send <code>/admin</code> to manage settings.
        </p>
      </div>
    </div>
  );
}
