import { copyMessage, editMessageText, pinChatMessage, sendMessage } from "./api";
import {
  claimBroadcastJob,
  getBroadcastJob,
  GROUP_CURSOR_START,
  markGroupInactive,
  nextGroupBatch,
  nextUserBatch,
  updateBroadcastJob,
  type BroadcastJob,
} from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderStatus(job: BroadcastJob, done: boolean, waitSec = 0) {
  const progress = job.sent + job.failed;
  const pct = job.total ? Math.floor((progress / job.total) * 100) : 0;
  return (
    (done ? "✅ <b>שידור הסתיים</b>\n\n" : "📤 <b>שידור בתהליך...</b>\n\n") +
    `יעד: ${job.target}\n` +
    `סה״כ: <b>${job.total.toLocaleString()}</b>\n` +
    `נשלח: <b>${job.sent.toLocaleString()}</b>\n` +
    `נכשל: <b>${job.failed.toLocaleString()}</b>\n` +
    `התקדמות: <b>${progress}/${job.total}</b> (${pct}%)` +
    (waitSec ? `\n⏳ <b>קיבלתי באן זמני מטלגרם — ממתין ${waitSec} שניות</b>` : "")
  );
}

async function pushStatus(job: BroadcastJob, done: boolean, waitSec = 0) {
  const text = renderStatus(job, done, waitSec);
  // Mirror the live progress to the requesting sub-admin when the job was
  // approved by the main admin on their behalf.
  if (job.notify_chat_id) {
    if (job.notify_msg_id) {
      await editMessageText(job.notify_chat_id, job.notify_msg_id, text).catch(() => {});
    } else if (done) {
      await sendMessage(job.notify_chat_id, text).catch(() => {});
    }
  }
  if (job.status_msg_id) {
    const ok = await editMessageText(job.admin_chat_id, job.status_msg_id, text).catch(() => null);
    if (ok || !done) return;
  }
  await sendMessage(job.admin_chat_id, text).catch(() => {});
}

/**
 * Processes a slice of the oldest running broadcast job within a time budget.
 * The job state lives in the DB, so a cron tick can resume it until every
 * recipient has been served — even if a worker invocation is cut short.
 */
export async function processBroadcastTick(budgetMs = 20_000, jobId?: number): Promise<string> {
  const started = Date.now();
  let job = jobId ? await getBroadcastJob(jobId) : await claimBroadcastJob();
  if (!job || job.status !== "running") return "no-job";

  let lastStatusAt = 0;

  // Legacy/reset safety: a groups phase must never start at 0 because group
  // chat ids are negative and would all be skipped by the cursor.
  if (job.phase === "groups" && job.cursor_id >= 0) {
    job = { ...job, cursor_id: GROUP_CURSOR_START };
    await updateBroadcastJob(job.id, { cursor_id: GROUP_CURSOR_START } as any);
  }

  while (Date.now() - started < budgetMs) {
    if (job.phase === "done") break;

    const batch =
      job.phase === "groups"
        ? await nextGroupBatch(job.cursor_id, 25)
        : await nextUserBatch(job.cursor_id, 25);

    if (!batch.length) {
      if (job.phase === "groups" && (job.target === "all" || job.target === "private")) {
        job = { ...job, phase: "private", cursor_id: 0 };
        await updateBroadcastJob(job.id, { phase: "private", cursor_id: 0 });
        continue;
      }
      job = { ...job, phase: "done" };
      break;
    }

    const isGroupPhase = job.phase === "groups";
    for (const chatId of batch) {
      let delivered = false;
      for (let attempt = 0; attempt < 4 && !delivered; attempt++) {
        try {
          const copied: any = await copyMessage(chatId, job.from_chat_id, job.message_id);
          job.sent++;
          delivered = true;
          if (isGroupPhase && copied?.message_id) {
            await pinChatMessage(chatId, copied.message_id, true).catch(() => {});
          }
        } catch (e: any) {
          const retryAfter = Number(e?.parameters?.retry_after ?? 0);
          if (e?.code === 429 && retryAfter > 0) {
            if (retryAfter > 25) {
              // Long flood-wait: persist progress and let the next tick resume.
              await updateBroadcastJob(job.id, {
                cursor_id: job.cursor_id,
                sent: job.sent,
                failed: job.failed,
                phase: job.phase,
                resume_after: new Date(Date.now() + (retryAfter + 2) * 1000).toISOString(),
                locked_at: null,
              } as any);
              await pushStatus(job, false, retryAfter);
              return "flood-wait";
            }
            await pushStatus(job, false, retryAfter);
            await sleep((retryAfter + 1) * 1000);
            continue;
          }
          job.failed++;
          delivered = true;
          const desc: string = e?.description || "";
          if (e?.code === 403 || /blocked|deactivated|kicked|chat not found/i.test(desc)) {
            // Only groups are deactivated automatically. Private users are NEVER
            // auto-blocked — is_blocked is reserved for manual admin bans.
            if (isGroupPhase) await markGroupInactive(chatId).catch(() => {});
          }
        }
      }
      job.cursor_id = chatId;
    }

    await updateBroadcastJob(job.id, {
      cursor_id: job.cursor_id,
      sent: job.sent,
      failed: job.failed,
      phase: job.phase,
      locked_at: new Date().toISOString(),
    } as any);

    if (Date.now() - lastStatusAt > 1500) {
      lastStatusAt = Date.now();
      await pushStatus(job, false);
    }
    // Stay well under Telegram's ~30 msg/sec limit.
    await sleep(1000);
  }

  if (job.phase === "done") {
    await updateBroadcastJob(job.id, {
      status: "done",
      phase: "done",
      sent: job.sent,
      failed: job.failed,
      locked_at: null,
    } as any);
    await pushStatus(job, true);
    return "done";
  }

  // Out of time: release the lease so the next cron tick continues the job.
  await updateBroadcastJob(job.id, {
    cursor_id: job.cursor_id,
    sent: job.sent,
    failed: job.failed,
    phase: job.phase,
    locked_at: null,
    resume_after: new Date().toISOString(),
  } as any);
  await pushStatus(job, false);
  return "paused";
}
