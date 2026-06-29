// Camada de dados: cliente Supabase + auth + CRUD + RPCs.
// O cliente vem do CDN como ES module, carregado SOB DEMANDA (import dinâmico) — assim a aba
// Racha (calculadora) funciona offline mesmo sem Supabase. Config (URL + chave anon pública)
// fica no localStorage — a chave anon é pública por design; o RLS é que protege os dados.

const CFG_KEY = "racha.sb";
let _client = null, _createClient = null;

// Config embutida (opcional): se preenchida, TODO navegador já abre conectado — ninguém vê
// "Ative os Grupos" nem configura nada. A chave anon é pública por design (o RLS protege os
// dados; ela já vai nos links de convite). Deixe vazio pra exigir config manual.
const BAKED = {
  url: "https://hqiotsgwxpsmuujaciwn.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxaW90c2d3eHBzbXV1amFjaXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzQ3MTYsImV4cCI6MjA5NzkxMDcxNn0.n6I6Av5OR_ezSgBfkmDmKw3o-PlKR-dkH4qwrFYidE0",
};
export function getSbConfig(){
  try{ const c = JSON.parse(localStorage.getItem(CFG_KEY)); if(c && c.url && c.anon) return c; }catch(_){}
  return (BAKED.url && BAKED.anon) ? { url: BAKED.url, anon: BAKED.anon } : null;
}
// Conserta os erros comuns: URL do painel colada em vez da API, só o ref, ou barra no fim.
export function normalizeSupabaseUrl(raw){
  let u = String(raw || "").trim();
  if(!u) return "";
  const dash = u.match(/dashboard\/project\/([a-z0-9]{16,})/i);   // colou a URL do painel
  if(dash) return `https://${dash[1]}.supabase.co`;
  if(/^[a-z0-9]{16,}$/i.test(u)) return `https://${u}.supabase.co`; // colou só o ref do projeto
  if(!/^https?:\/\//i.test(u)) u = "https://" + u;
  const origin = u.match(/^https?:\/\/[^/]+/i);                    // só esquema + host (corta /rest/v1, barras, etc.)
  return origin ? origin[0] : u.replace(/\/+$/, "");
}
export function setSbConfig(url, anon){
  localStorage.setItem(CFG_KEY, JSON.stringify({ url: normalizeSupabaseUrl(url), anon: String(anon).trim() }));
  _client = null;
}
export function hasConfig(){ const c = getSbConfig(); return !!(c && c.url && c.anon); }

// CDNs pra carregar a lib do Supabase (ESM). Tenta na ordem; o +esm do jsDelivr vem num
// arquivo só (sem sub-requisições), mais robusto em redes que filtram domínios.
const CDNS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
  "https://esm.sh/@supabase/supabase-js@2",
  "https://unpkg.com/@supabase/supabase-js@2/dist/module/index.js",
];
// Carrega a lib (uma vez) e cria o cliente. Chamar no boot quando houver config.
export async function init(){
  if(!hasConfig()) return false;
  if(!_createClient){
    let lastErr;
    for(const url of CDNS){
      try{ const m = await import(url); _createClient = m.createClient || m.default?.createClient; if(_createClient) break; }
      catch(e){ lastErr = e; }
    }
    if(!_createClient) throw new Error("Não consegui carregar a biblioteca do Supabase — algum CDN pode estar bloqueado na sua rede. " + (lastErr?.message || ""));
  }
  // flowType 'implicit': o token volta no próprio link de retorno — funciona quando o e-mail
  // abre em outro navegador/dispositivo (PKCE exigiria o mesmo navegador que pediu o link).
  if(!_client){ const c = getSbConfig(); _client = _createClient(c.url, c.anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } }); }
  return true;
}

export function sb(){
  if(_client) return _client;
  throw new Error("Supabase não inicializado — configure a conexão em ⚙.");
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
  // o link de retorno carrega a conexão (igual ao convite) — assim o login fecha em
  // QUALQUER navegador, mesmo um que nunca foi configurado. adoptConfigFromLink() adota no boot.
  const c = getSbConfig();
  const base = location.origin + location.pathname;
  const redirect = c ? `${base}?s=${encodeURIComponent(c.url)}&k=${encodeURIComponent(c.anon)}` : base;
  return unwrap(await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } }));
}
// alternativa à prova de PWA: o usuário digita o código de 6 dígitos que veio no e-mail
export async function verifyCode(email, token){
  return unwrap(await sb().auth.verifyOtp({ email: email.trim(), token: String(token).trim(), type: "email" }));
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
