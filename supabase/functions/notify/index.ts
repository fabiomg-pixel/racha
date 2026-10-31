// Racha — Edge Function "notify": manda o push quando entra despesa ou acerto.
// Chamada pelo gatilho do banco (0006_push.sql). Deploy com "Verify JWT" DESLIGADO;
// quem chama prova quem é pelo header x-notify-secret.
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, NOTIFY_SECRET  (SUPABASE_URL / SERVICE_ROLE_KEY já vêm prontas)
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const first = (n?: string | null) => String(n || "").trim().split(/\s+/)[0] || "Alguém";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.headers.get("x-notify-secret") !== Deno.env.get("NOTIFY_SECRET")) return json({ error: "forbidden" }, 403);
  const { kind, id } = await req.json().catch(() => ({}));
  if (!id || (kind !== "expense" && kind !== "settlement")) return json({ error: "bad request" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails("mailto:fabiomg@biof.ufrj.br", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

  const { data: row } = await sb.from(kind === "expense" ? "expenses" : "settlements").select("*").eq("id", id).maybeSingle();
  if (!row) return json({ sent: 0 });
  const author = row.created_by as string | null;

  const [{ data: group }, { data: members }] = await Promise.all([
    sb.from("groups").select("name, kind").eq("id", row.group_id).maybeSingle(),
    sb.from("group_members").select("id, user_id, display_name").eq("group_id", row.group_id),
  ]);
  const who = first((members || []).find((m) => m.user_id && m.user_id === author)?.display_name);
  const isCouple = group?.kind === "couple";
  const title = isCouple ? "Racha" : `Racha · ${group?.name || "grupo"}`;
  let body: string;
  if (kind === "expense") {
    const desc = String(row.description || "Despesa").replace(/\s*\(\d+\/\d+\)$/, "");
    body = `${who} lançou ${desc} · ${brl(row.total)}`;
  } else {
    body = `${who} registrou um acerto de ${brl(row.amount)}`;
  }

  // quem recebe: os outros membros com conta (quem lançou não precisa ser avisado)
  const users = [...new Set((members || []).map((m) => m.user_id).filter((u) => u && u !== author))] as string[];
  if (!users.length) return json({ sent: 0 });
  const { data: subs } = await sb.from("push_subs").select("*").in("user_id", users);

  const route = isCouple ? "#casal" : `#g/${row.group_id}`;
  const payload = JSON.stringify({ title, body, tag: `racha-${row.group_id}`, url: `./${route}` });
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);   // aparelho desinscrito
    }
  }
  return json({ sent });
});
