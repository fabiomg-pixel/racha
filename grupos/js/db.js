// Camada de dados: cliente Supabase + auth + CRUD + RPCs.
// O cliente vem do CDN como ES module (sem build). Config (URL + chave anon pública)
// fica no localStorage — a chave anon é pública por design; o RLS é que protege os dados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CFG_KEY = "racha.sb";
let _client = null;

export function getSbConfig(){
  try{ return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }catch(_){ return null; }
}
export function setSbConfig(url, anon){
  localStorage.setItem(CFG_KEY, JSON.stringify({ url: String(url).trim(), anon: String(anon).trim() }));
  _client = null;
}
export function hasConfig(){ const c = getSbConfig(); return !!(c && c.url && c.anon); }

export function sb(){
  if(_client) return _client;
  const c = getSbConfig();
  if(!c || !c.url || !c.anon) throw new Error("Configure a URL e a chave do Supabase em ⚙.");
  _client = createClient(c.url, c.anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return _client;
}

const unwrap = ({ data, error }) => { if(error) throw error; return data; };

/* ---------------- auth ---------------- */
export async function currentUser(){
  const { data } = await sb().auth.getUser();
  return data?.user || null;
}
export function onAuthChange(cb){
  return sb().auth.onAuthStateChange((_e, session) => cb(session?.user || null));
}
export async function sendMagicLink(email){
  const redirect = location.origin + location.pathname;   // volta pra esta página
  return unwrap(await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } }));
}
export async function signOut(){ await sb().auth.signOut(); }

/* ---------------- perfil ---------------- */
export async function getMyProfile(){
  const u = await currentUser(); if(!u) return null;
  return unwrap(await sb().from("profiles").select("*").eq("id", u.id).maybeSingle());
}
export async function saveProfile(patch){
  const u = await currentUser(); if(!u) throw new Error("não autenticado");
  return unwrap(await sb().from("profiles").update(patch).eq("id", u.id).select().single());
}

/* ---------------- grupos ---------------- */
export async function myGroups(){
  // grupos onde sou membro (via group_members) — traz o grupo aninhado
  const rows = unwrap(await sb().from("group_members")
    .select("group:groups(id,name,currency,created_by,created_at)")
    .order("created_at", { ascending: false }));
  return (rows || []).map(r => r.group).filter(Boolean);
}
export async function createGroup(name){
  const u = await currentUser(); if(!u) throw new Error("não autenticado");
  const g = unwrap(await sb().from("groups").insert({ name: name.trim(), created_by: u.id }).select().single());
  const prof = await getMyProfile();
  await sb().from("group_members").insert({ group_id: g.id, user_id: u.id, display_name: prof?.name || "Eu", role: "admin" });
  return g;
}
export async function renameGroup(groupId, name){
  return unwrap(await sb().from("groups").update({ name: name.trim() }).eq("id", groupId).select().single());
}
export async function deleteGroup(groupId){
  return unwrap(await sb().from("groups").delete().eq("id", groupId));
}
export async function groupMembers(groupId){
  return unwrap(await sb().from("group_members")
    .select("id,user_id,display_name,role").eq("group_id", groupId).order("display_name"));
}
export async function addGhost(groupId, displayName){
  return unwrap(await sb().from("group_members")
    .insert({ group_id: groupId, display_name: displayName.trim() }).select().single());
}
export async function removeMember(memberId){
  return unwrap(await sb().from("group_members").delete().eq("id", memberId));
}

/* ---------------- convite (RPCs) ---------------- */
export async function groupNameOf(groupId){ return unwrap(await sb().rpc("group_name", { g: groupId })); }
export async function ghostsOf(groupId){ return unwrap(await sb().rpc("group_ghosts", { g: groupId })); }
export async function joinGroup(groupId, claim = null){ return unwrap(await sb().rpc("join_group", { g: groupId, claim })); }

/* ---------------- despesas ---------------- */
export async function listExpenses(groupId){
  return unwrap(await sb().from("expenses")
    .select("id,description,place,spent_at,total,created_at")
    .eq("group_id", groupId).order("spent_at", { ascending: false }).order("created_at", { ascending: false }));
}
export async function getExpense(id){
  return unwrap(await sb().from("expenses")
    .select("*, items:expense_items(*, shares:item_shares(member_id,weight)), payers:expense_payers(member_id,amount), shares:expense_shares(member_id,amount)")
    .eq("id", id).single());
}
// payload já com shares calculados (split.js) — RPC insere tudo numa transação
export async function saveExpense(payload){ return unwrap(await sb().rpc("create_expense", { payload })); }
export async function deleteExpense(id){ return unwrap(await sb().from("expenses").delete().eq("id", id)); }

/* ---------------- saldos e acertos ---------------- */
export async function balances(groupId){ return unwrap(await sb().rpc("group_balances", { g: groupId })); }
export async function listSettlements(groupId){
  return unwrap(await sb().from("settlements")
    .select("*").eq("group_id", groupId).order("settled_at", { ascending: false }));
}
export async function addSettlement({ groupId, from, to, amount, method = "pix", note = null }){
  const u = await currentUser();
  return unwrap(await sb().from("settlements")
    .insert({ group_id: groupId, from_member: from, to_member: to, amount, method, note, created_by: u?.id })
    .select().single());
}

/* ---------------- realtime (mesa ao vivo) ---------------- */
export function subscribeGroup(groupId, onChange){
  const ch = sb().channel("grp:" + groupId);
  ["expenses", "expense_items", "item_shares", "expense_payers", "expense_shares", "settlements", "group_members"]
    .forEach(t => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => onChange()));
  ch.subscribe();
  return () => sb().removeChannel(ch);
}

/* pega a chave pix do recebedor (membro com conta) pra montar o copia-e-cola */
export async function memberPix(userId){
  if(!userId) return null;
  return unwrap(await sb().from("profiles").select("pix_key,pix_name,name").eq("id", userId).maybeSingle());
}
