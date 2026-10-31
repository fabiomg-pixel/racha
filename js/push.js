// Notificação push (Web Push): inscreve/desinscreve ESTE aparelho. Quem manda é a Edge Function "notify".
// Desligar = remover a inscrição; sem inscrição o servidor não tem pra onde avisar.
import { sb, currentUser } from "./db.js";

export const VAPID_PUBLIC = "BA7oBNQW5F_2HWTZ5Mqb3fdgF2ZXa1EVgMs_rbuFIm3p6thqd2kA7bOObIITN99qeUEcQWV5d2CQtdErJfLqing";   // chave pública (a privada fica só nos secrets do Supabase)

export function urlB64ToUint8(b64){
  const pad = "=".repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// "unsupported" (ex.: iPhone fora da Tela de Início) · "denied" · "on" · "off"
export async function pushStatus(){
  if(typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if(Notification.permission === "denied") return "denied";
  try{
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  }catch(_){ return "off"; }
}

export async function enablePush(){
  if(await pushStatus() === "unsupported") throw new Error("Este aparelho não suporta notificação. No iPhone, instale o app na Tela de Início.");
  const u = await currentUser(); if(!u) throw new Error("Entre na sua conta pra ativar.");
  if(await Notification.requestPermission() !== "granted") throw new Error("O navegador não deixou. Dá pra liberar nas configurações do site.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
  const j = sub.toJSON();
  const { error } = await sb().from("push_subs").upsert({ user_id: u.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  if(error) throw error;
}

export async function disablePush(){
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if(!sub) return;
  try{ await sb().from("push_subs").delete().eq("endpoint", sub.endpoint); }catch(_){}
  await sub.unsubscribe();
}
