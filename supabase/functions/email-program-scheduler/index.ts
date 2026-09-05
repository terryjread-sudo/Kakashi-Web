import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ProgramKey = "reengagement" | "weekly_recap" | "monthly_sensei_letter" | "onboarding_nudge";
type Recipient = { id: string; email: string; name: string };

const programs: Record<ProgramKey, { templateKey: string; scheduled: (now: Record<string, string>) => boolean; eligible: (user: Record<string, unknown>, now: Date) => boolean; subject: string; eyebrow: string; title: string; body: (name: string) => string; cta: string }> = {
  reengagement: { templateKey: "journey_waiting", scheduled: now => now.weekday === "Fri" && now.hour === "17", eligible: (user, now) => Boolean(user.last_sign_in_at) && new Date(String(user.last_sign_in_at)).getTime() <= now.getTime() - 7 * 86400000, subject: "Your Japanese journey is waiting", eyebrow: "A small nudge from Sensei", title: "A few Japanese words are waiting for you", body: name => `Hello ${name}, it has been a little while since you last visited. A short review is a lovely way to keep the words you have met feeling familiar.`, cta: "Continue my journey" },
  weekly_recap: { templateKey: "weekly_recap", scheduled: now => now.weekday === "Sun" && now.hour === "10", eligible: (user, now) => Boolean(user.last_sign_in_at) && new Date(String(user.last_sign_in_at)).getTime() > now.getTime() - 7 * 86400000, subject: "A gentle weekly note from Sensei", eyebrow: "Your week in Japanese", title: "Keep your Japanese close this week", body: name => `Hello ${name}, thank you for making time for Japanese this week. A few minutes of review is a calm way to carry your words into the week ahead.`, cta: "Open my journey" },
  monthly_sensei_letter: { templateKey: "monthly_sensei_letter", scheduled: now => now.day === "01" && now.hour === "10", eligible: user => Boolean(user.last_sign_in_at), subject: "A new month of Japanese with Sensei", eyebrow: "A note from Sensei", title: "A small step is enough", body: name => `Hello ${name}, a new month is a lovely moment to return to the words you know and meet one more. Your Japanese journey is ready whenever you are.`, cta: "Continue my journey" },
  onboarding_nudge: { templateKey: "onboarding_nudge", scheduled: now => now.hour === "10", eligible: (user, now) => { const created = new Date(String(user.created_at)).getTime(); const lastSignIn = new Date(String(user.last_sign_in_at || user.created_at)).getTime(); return created <= now.getTime() - 3 * 86400000 && created > now.getTime() - 10 * 86400000 && lastSignIn <= created + 5 * 60000; }, subject: "Your first Japanese words are ready", eyebrow: "A welcome from Sensei", title: "Your journey is ready when you are", body: name => `Hello ${name}, your Kaishi Japanese journey is ready to begin. Start with one small lesson and let the next step appear when you are ready.`, cta: "Start my journey" },
};

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function londonParts() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts();
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function email(program: ProgramKey, recipient: Recipient, token: string, appUrl: string, unsubscribeBase: string) {
  const template = programs[program];
  const unsubscribe = `${unsubscribeBase}?unsubscribe=${encodeURIComponent(token)}`;
  const logo = `${appUrl.replace(/\/$/, "")}/media/branding/kaishi-japanese-mark.png`;
  return { subject: template.subject, html: `<div style="margin:0;padding:28px 14px;background:#eef4f0;font-family:Georgia,'Hiragino Mincho ProN',serif;color:#173d32"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;background:#fffdf7;border-radius:22px;overflow:hidden;border:1px solid #d7e5dc"><tr><td style="padding:28px 34px 18px;background:#173d32;color:#fff"><img src="${logo}" width="54" height="54" alt="Kaishi Japanese" style="display:block;margin-bottom:12px"><div style="font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:#f7d676">${template.eyebrow}</div><h1 style="margin:8px 0 0;font-size:28px;line-height:1.15;color:#fff">${template.title}</h1></td></tr><tr><td style="padding:30px 34px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#25352f"><p style="margin-top:0">${template.body(escape(recipient.name))}</p><p style="margin:26px 0"><a href="${appUrl}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#16835f;color:#fff;text-decoration:none;font-weight:bold">${template.cta}</a></p><p style="margin-bottom:0;color:#64736d;font-size:13px">You are receiving this because you have a Kaishi Japanese account. <a href="${unsubscribe}" style="color:#176c52">Unsubscribe from learning emails</a> or manage your preferences in Settings.</p></td></tr></table></td></tr></table></div>` };
}

async function unsubscribeToken(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: existing } = await admin.from("kaishi_email_unsubscribe_tokens").select("token").eq("user_id", userId).maybeSingle();
  if (existing?.token) return existing.token;
  const token = crypto.randomUUID();
  await admin.from("kaishi_email_unsubscribe_tokens").insert({ token, user_id: userId });
  return token;
}

async function send(admin: ReturnType<typeof createClient>, resendKey: string, from: string, appUrl: string, unsubscribeBase: string, program: ProgramKey, recipient: Recipient, campaignKey: string) {
  const { data: log, error: claimError } = await admin.from("kaishi_email_send_log").insert({ recipient_id: recipient.id, template_key: programs[program].templateKey, campaign_key: campaignKey }).select("id").maybeSingle();
  if (claimError || !log) return "skipped";
  const token = await unsubscribeToken(admin, recipient.id);
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [recipient.email], ...email(program, recipient, token, appUrl, unsubscribeBase) }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { await admin.from("kaishi_email_send_log").update({ status: "failed", error_message: `Resend ${response.status}` }).eq("id", log.id); return "failed"; }
  await admin.from("kaishi_email_send_log").update({ status: "sent", resend_message_id: payload.id || null, sent_at: new Date().toISOString() }).eq("id", log.id);
  return "sent";
}

Deno.serve(async request => {
  if (request.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  if (request.headers.get("x-kaishi-cron-secret") !== Deno.env.get("KAISHI_EMAIL_CRON_SECRET")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const from = Deno.env.get("KAISHI_FROM_EMAIL")!;
  const appUrl = Deno.env.get("KAISHI_APP_URL") || "https://www.kaishi.uk/";
  const admin = createClient(supabaseUrl, serviceKey);
  const london = londonParts(), now = new Date(), results: Record<string, unknown> = {};
  for (const [key, program] of Object.entries(programs) as [ProgramKey, typeof programs[ProgramKey]][]) {
    if (!program.scheduled(london)) { results[key] = "outside-schedule"; continue; }
    const runKey = `${key}:${london.year}-${london.month}-${london.day}-${london.hour}`;
    const { data: claimed, error: claimError } = await admin.rpc("claim_kaishi_email_program", { p_program_key: key, p_run_key: runKey });
    if (claimError) { results[key] = `claim failed: ${claimError.message}`; continue; }
    if (!claimed) { results[key] = "disabled-or-already-run"; continue; }
    let page = 1, sent = 0, failed = 0;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) { failed++; break; }
      for (const user of data.users || []) {
        if (!user.email || !program.eligible(user as Record<string, unknown>, now)) continue;
        const { data: preference } = await admin.from("kaishi_notification_preferences").select("learning_email").eq("user_id", user.id).maybeSingle();
        if (preference?.learning_email === false) continue;
        const outcome = await send(admin, resendKey, from, appUrl, `${supabaseUrl}/functions/v1/admin-email`, key, { id: user.id, email: user.email, name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.user_name || "learner") }, runKey);
        if (outcome === "sent") sent++; else if (outcome === "failed") failed++;
      }
      if ((data.users || []).length < 200) break;
      page++;
    }
    const result = failed ? `Completed with ${failed} failed delivery attempt(s).` : "Completed successfully.";
    await admin.rpc("finish_kaishi_email_program", { p_program_key: key, p_sent_count: sent, p_result: result });
    results[key] = { sent, failed };
  }
  return Response.json({ results });
});
