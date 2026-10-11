// Racha — controlador único (PWA estático, sem build). Três abas:
//  • Racha  = calculadora de UMA conta (local, funciona sem login)
//  • Casal  = livro-razão do casal NA NUVEM (Supabase, grupo kind="couple"): igual em todo aparelho, os dois lançam
//  • Grupos = livro-razão multiusuário (Supabase): saldo acumulado, acerto por Pix
// Pontes: o resultado do Racha pode ir pro Casal ("Guardar no casal") ou virar despesa de um grupo.
import * as db from "./db.js";
import { ocrImage, ocrConfigured, ocrError, fileToImage } from "./ocr.js";
import { computeShares, allocateByWeights } from "./split.js";
import { simplifyDebts, netFromRows } from "./ledger.js";
import { buildPixPayload } from "./pix.js";
import { parseBill } from "./parse.js";
import { parseMoney, brl } from "./money.js";
import { buildExpense, entryNet, ledgerBalances, coupleSummary, createStore, removeEntry, toRpcPayload, ledgerFromCloud, expandSeries, dueEntries, countUntil, addDays, todayISO } from "./model.js";

const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmtDate = iso => { try{ return new Date(iso + "T12:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" }); }catch(_){ return iso; } };
const round2 = n => Math.round((Number(n)||0) * 100) / 100;
const norm = s => String(s||"").trim().toLowerCase();

function initials(name){ const p = String(name||"?").trim().split(/\s+/); return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase() || "?"; }
function colorFor(seed){ let h = 0; for(const c of String(seed||"")) h = (h*31 + c.charCodeAt(0)) % 360; return `hsl(${h} 52% 42%)`; }
const avatar = name => `<span class="av" style="background:${colorFor(name)}">${esc(initials(name))}</span>`;

/* ---------- visual (direção C): ícones de traço, categorias, datas e valores ---------- */
// Nada de emoji como ícone: SVG de traço numa grade de 24, herdando a cor do texto.
const ICON_PATHS = {
  cart:   '<circle cx="9.5" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/><path d="M2.8 3.5h2.4l2.4 11.8h11"/><path d="M6.6 7.4h14l-1.4 5.9H7.8"/>',
  food:   '<path d="M6.5 2.8v7a2.3 2.3 0 0 0 2.3 2.3v9.1"/><path d="M4.6 2.8v4.3M8.4 2.8v4.3"/><path d="M17.6 2.8c-1.5.9-2.4 2.8-2.4 5.2s.9 4.3 2.4 5.2v8"/>',
  beer:   '<path d="M6 7h10v12.5a1.7 1.7 0 0 1-1.7 1.7H7.7A1.7 1.7 0 0 1 6 19.5z"/><path d="M16 10h1.6a2.4 2.4 0 0 1 0 4.8H16"/><path d="M6.2 7a2.6 2.6 0 0 1 4.6-2.1 2.6 2.6 0 0 1 4.9 1.4"/>',
  home:   '<path d="M3.5 10.6L12 3.5l8.5 7.1"/><path d="M5.8 9v11.2h12.4V9"/><path d="M10 20.2v-5.6h4v5.6"/>',
  car:    '<path d="M3.6 16.4h16.8"/><path d="M3.6 16.4v-3.8l2-5.2h12.8l2 5.2v3.8z"/><path d="M6.2 16.4v2.2M17.8 16.4v2.2"/><circle cx="7.6" cy="13.4" r=".9"/><circle cx="16.4" cy="13.4" r=".9"/>',
  plane:  '<path d="M21 15.6L13.4 11V5.2a1.6 1.6 0 0 0-3.2 0V11L2.6 15.6v2l7.6-2.4v4.2l-2.2 1.6v1.4l3.6-1 3.6 1v-1.4l-2.2-1.6v-4.2l7.6 2.4z"/>',
  fun:    '<path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.6 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  pill:   '<rect x="2.8" y="8.6" width="18.4" height="6.8" rx="3.4"/><path d="M12 8.6v6.8"/>',
  bill:   '<path d="M6.2 2.6h11.6v18.8l-1.9-1.4-1.9 1.4-1.9-1.4-1.9 1.4-1.9-1.4-1.9 1.4z"/><path d="M9.2 8.2h5.6M9.2 12.4h5.6"/>',
  gift:   '<rect x="3.4" y="8" width="17.2" height="4.4" rx="1"/><path d="M5 12.4v8.4h14v-8.4M12 8v12.8"/><path d="M12 8C10.5 4.6 7 4.4 7 6.4S10.6 8 12 8zm0 0c1.5-3.4 5-3.6 5-1.6S13.4 8 12 8z"/>',
  tag:    '<path d="M3.2 12.3V4.4a1.2 1.2 0 0 1 1.2-1.2h7.9l9.2 9.2a1.2 1.2 0 0 1 0 1.7l-7.4 7.4a1.2 1.2 0 0 1-1.7 0z"/><circle cx="8" cy="8" r="1.3"/>',
  swap:   '<path d="M4 8h14.5l-3.5-3.5M20 16H5.5l3.5 3.5"/>',
  camera: '<path d="M3.2 8.4a1.6 1.6 0 0 1 1.6-1.6h2.4L8.8 4.6h6.4l1.6 2.2h2.4a1.6 1.6 0 0 1 1.6 1.6v9.8a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z"/><circle cx="12" cy="13" r="3.6"/>',
  image:  '<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2"/><circle cx="8.6" cy="9.4" r="1.6"/><path d="M20.8 15.6l-4.8-4.8-9.4 8.8"/>',
  text:   '<path d="M6 2.8h8.4L19 7.4v13.8H6z"/><path d="M14.2 2.8v4.8H19M9 12h7M9 15.6h7"/>',
  plus:   '<path d="M12 5.5v13M5.5 12h13"/>',
  close:  '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back:   '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  heart:  '<path d="M12 20.4s-7.4-4.6-7.4-9.6A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.4 2.6c0 5-7.4 9.6-7.4 9.6z"/>',
  gear:   '<circle cx="12" cy="12" r="3"/><path d="M19.9 14.6a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3.4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3.4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
function icon(name, size = 20, sw = 1.7){
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.tag}</svg>`;
}
// categoria continua guardada como "🛒 Mercado" (compatível com o que já foi salvo e com os Grupos); a tela mostra ícone + nome
const catLabel = cat => String(cat || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
function catIcon(cat){
  const k = catLabel(cat).toLowerCase();
  const map = [["comida","food"],["bar","beer"],["mercado","cart"],["casa","home"],["transporte","car"],["viagem","plane"],["lazer","fun"],["saúde","pill"],["saude","pill"],["contas","bill"],["outros","gift"]];
  return (map.find(([p]) => k.startsWith(p)) || [, "tag"])[1];
}
const MONTHS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const fmtShort = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : ""; };
const money2 = n => (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => (n > 0.004 ? "+" : n < -0.004 ? "−" : "") + money2(Math.abs(n));   // +123,90 · −34,20 (menos de verdade)
const tone = n => Math.abs(n) < 0.005 ? "zero" : n > 0 ? "pos" : "neg";
const brlNB = n => brl(n).replace(/\s/g, "\u00a0");   // "R$ 110,60" nunca parte no meio da linha
// os quatro jeitos de trazer itens (foto/galeria/texto/manual) — mesmos ids de antes, só o visual muda
function srcTiles(prefix){
  return [["Cam", "camera", "Foto"], ["Gal", "image", "Galeria"], ["Text", "text", "Texto"], ["Manual", "plus", "Manual"]]
    .map(([id, ic, label]) => `<button class="opt src" id="${prefix}${id}">${icon(ic, 21)}<span>${label}</span></button>`).join("");
}

let toastT;
function toast(msg, ms = 2600){
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
function loading(msg = "Carregando…"){ app.innerHTML = `<div class="card" style="text-align:center"><div class="spin"></div><p class="mut sm">${esc(msg)}</p></div>`; }
async function guard(fn, msg){ try{ return await fn(); }catch(e){ console.error(e); toast(msg || (e?.message || "Algo deu errado"), 4500); throw e; } }

let ME = null, PROFILE = null, INIT_ERR = null, LIVE = null;
let ITEM_SINK = null;   // pra onde foto/texto mandam os itens lidos (definido por cada aba)

// Atualização das telas compartilhadas. O tempo real do Supabase é o caminho rápido, mas ele se perde
// (celular bloqueado, app em segundo plano, rede que caiu). Então a tela também se confere sozinha:
// ao voltar pro app, ao reconectar e a cada poucos segundos enquanto está aberta. REFRESH é definido pela tela atual.
let REFRESH = null, refreshBusy = false;
async function softRefresh(){
  if(!REFRESH || refreshBusy || document.hidden || !navigator.onLine || document.querySelector("dialog[open]")) return;
  refreshBusy = true;
  try{ await REFRESH(); }catch(e){ console.warn("refresh", e); }finally{ refreshBusy = false; }
}
document.addEventListener("visibilitychange", softRefresh);
window.addEventListener("focus", softRefresh);
window.addEventListener("online", softRefresh);
window.addEventListener("pageshow", softRefresh);
setInterval(softRefresh, 10000);

/* ============================ boot ============================ */
// Convite "pronto pra usar": o link carrega a conexão (URL + chave anon pública).
// Quem abre adota a config automaticamente e só precisa fazer login — nada de ⚙.
function adoptConfigFromLink(){
  const q = new URLSearchParams(location.search);
  const s = q.get("s"), k = q.get("k"), join = q.get("join"), to = q.get("to");
  let changed = false;
  if(s && k){ try{ db.setSbConfig(s, k); }catch(_){} q.delete("s"); q.delete("k"); changed = true; }
  if(join){ try{ localStorage.setItem("racha.join", join); }catch(_){} q.delete("join"); changed = true; }   // alvo do convite sobrevive ao login
  if(to === "casal"){ try{ localStorage.setItem("racha.after", to); }catch(_){} q.delete("to"); changed = true; }   // logou pela aba Casal → volta pra ela
  if(changed){
    const qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }
  return changed;
}
async function boot(){
  wireHeader(); wireTabs(); wireConfig(); wireCamera();
  // chegou voltando de um link de login? (token no hash, ou code na query) → depois do login, cai nos Grupos
  let cameFromAuth = /access_token=|[?&]code=/.test(location.hash + location.search);
  adoptConfigFromLink();
  if(db.hasConfig()){
    try{
      await db.init();
      ME = await db.currentUser();
      PROFILE = ME ? await db.getMyProfile() : null;
      db.onAuthChange(async (u) => {
        ME = u; PROFILE = u ? await db.getMyProfile() : null; paintAcct();
        if(!u) COUPLE = null;
        const pending = localStorage.getItem("racha.join");
        if(ME && pending && location.hash.indexOf("join") < 0){ localStorage.removeItem("racha.join"); return go("join/" + pending); }
        const after = localStorage.getItem("racha.after");
        if(ME && after){ localStorage.removeItem("racha.after"); cameFromAuth = false; if(location.hash.replace(/^#\/?/, "") === after) return route(); return go(after); }
        if(ME && cameFromAuth){ cameFromAuth = false; return go("grupos"); }   // login pelo link → abre os Grupos
        route();
      });
    }catch(e){ console.error("supabase init falhou", e); INIT_ERR = e?.message || String(e); }   // não derruba a aba Racha
  }
  paintAcct(); route();
}
// tenta (re)inicializar o cliente; usado no login pra dar o motivo real se falhar
async function ensureInit(){
  if(!db.hasConfig()) return false;
  try{ await db.init(); INIT_ERR = null; return true; }
  catch(e){ INIT_ERR = e?.message || String(e); return false; }
}
window.addEventListener("hashchange", route);

function paintAcct(){
  const b = $("#hAcct");
  if(ME){ b.textContent = initials(PROFILE?.name || ME.email || "?"); b.title = "sair"; }
  else { b.textContent = "entrar"; b.title = "entrar"; }
}
function wireTabs(){
  $("#tabRacha").onclick = () => go("");
  $("#tabCasal").onclick = () => go("casal");
  $("#tabGrupos").onclick = () => go("grupos");
}
function wireHeader(){
  $("#hCfg").onclick = openCfg;
  $("#hAcct").onclick = async () => {
    if(ME){ if(confirm("Sair desta conta?")){ await db.signOut(); ME = null; PROFILE = null; paintAcct(); go("grupos"); } }
    else go("grupos");
  };
}

/* ============================ router ============================ */
function parseHash(){ return { parts: location.hash.replace(/^#\/?/, "").split("/").filter(Boolean) }; }
function activeTab(){
  const h = location.hash.replace(/^#\/?/, "");
  if(h.startsWith("casal")) return "casal";
  return (h.startsWith("grupos") || h.startsWith("g/") || h.startsWith("join")) ? "grupos" : "racha";
}
const go = hash => { location.hash = hash; };

// Casca da direção C: abas no rodapé. O cabeçalho verde some nas telas do Casal (lá o saldo É o cabeçalho);
// formulários escondem as abas e ganham a barra de salvar no rodapé.
function paintShell(tab){
  const { parts } = parseHash();
  const form = (tab === "casal" && (parts[1] === "new" || parts[1] === "e"))
            || (tab === "grupos" && parts[0] === "g" && ["new", "e", "settle"].includes(parts[2]));
  document.body.dataset.tab = tab;
  document.body.dataset.screen = tab === "casal" ? (form ? "casal-form" : "casal-home") : tab;
  document.body.classList.toggle("form", form);
  $("#topTitle").textContent = tab === "grupos" ? "Grupos" : "Racha";
  window.scrollTo(0, 0);
}

function route(){
  const tab = activeTab();
  $("#tabRacha").classList.toggle("on", tab === "racha");
  $("#tabCasal").classList.toggle("on", tab === "casal");
  $("#tabGrupos").classList.toggle("on", tab === "grupos");
  paintShell(tab);
  ITEM_SINK = null; REFRESH = null;
  if(LIVE){ db.unsubscribe(LIVE); LIVE = null; }   // encerra o realtime da tela anterior
  if(tab === "racha") return renderRacha();
  if(tab === "casal") return routeCasal();
  const { parts } = parseHash();
  if(parts[0] === "join" && parts[1]) return renderJoin(parts[1]);
  if(!db.hasConfig()) return renderNeedConfig();
  if(!ME) return renderLogin();
  if(parts[0] === "g" && parts[1]){
    if(parts[2] === "new") return renderNewExpense(parts[1]);
    if(parts[2] === "e" && parts[3]) return renderEditExpense(parts[1], parts[3]);
    if(parts[2] === "settle") return renderSettle(parts[1]);
    return renderGroup(parts[1]);
  }
  return renderGroups();
}

/* ====================================================================== */
/* ============================ ABA RACHA ============================ */
/* ====================================================================== */
const CALC_KEY = "racha.calc";
function loadCalc(){ try{ return JSON.parse(localStorage.getItem(CALC_KEY)); }catch(_){ return null; } }
function saveCalc(){ try{ localStorage.setItem(CALC_KEY, JSON.stringify(CALC)); }catch(_){} }
let CALC = null, _uid = 0;
const nid = () => ++_uid;
function ensureCalc(){
  CALC = loadCalc() || { people: [], items: [], serviceOn: true, serviceRate: 0.10, couvert: 0, discount: 0, billTotal: null };
  _uid = Math.max(0, ...CALC.people.map(p=>p.id||0), ...CALC.items.map(i=>i.id||0));
}

function calcSplit(){
  const items = CALC.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.price)||0) > 0)
    .map(it => ({ qty: it.qty, unitPrice: it.price, consumers: it.assigned }));
  return computeShares(CALC.people.map(p=>p.id), items, { serviceRate: CALC.serviceOn ? CALC.serviceRate : 0, couvert: CALC.couvert, discount: CALC.discount });
}

function renderRacha(){
  if(!CALC) ensureCalc();
  ITEM_SINK = applyToCalc;
  const nameOf = id => CALC.people.find(p => p.id === id)?.name || "?";
  const peopleChips = CALC.people.map(p => `<span class="chip on" data-pp="${p.id}">${esc(p.name)} <span class="x">×</span></span>`).join("");
  const memChips = (it) => CALC.people.map(p => `<span class="chip ${it.assigned.includes(p.id)?"on":""}" data-mid="${p.id}">${esc(p.name)}</span>`).join("");
  const itemsHtml = CALC.items.map((it, i) => `
    <div class="item" data-i="${i}">
      <div class="row" style="gap:8px">
        <input data-f="name" value="${esc(it.name)}" placeholder="item" class="grow">
        <input data-f="qty" type="number" inputmode="decimal" value="${it.qty}" min="0" step="1" style="width:58px">
        <input data-f="price" type="number" inputmode="decimal" value="${it.price}" min="0" step="0.01" style="width:82px">
        <button class="btn ghost" data-rm="${i}" aria-label="remover">${icon("close", 18, 2)}</button>
      </div>
      ${CALC.people.length ? `<div class="row wrap" style="margin-top:8px;gap:6px">${memChips(it)}</div>` : `<div class="sm mut" style="margin-top:6px">adicione pessoas pra marcar quem dividiu</div>`}
    </div>`).join("");

  app.innerHTML = `
    <div class="card">
      <div class="between"><h2 style="margin:0">Pessoas</h2><span class="mut sm">${CALC.people.length}</span></div>
      <div class="row wrap" style="gap:6px;margin:8px 0">${peopleChips || '<span class="mut sm">ninguém ainda</span>'}</div>
      <div class="row"><input id="rcPerson" placeholder="nome da pessoa"><button class="btn sm" id="rcAddP">Add</button></div>
    </div>

    <div class="card">
      <div class="between"><h2 style="margin:0">Itens</h2></div>
      <div class="seg c4" style="margin:10px 0">${srcTiles("rc")}</div>
      <div id="rcItems">${itemsHtml || '<p class="sm mut">Adicione itens por foto, texto ou manual.</p>'}</div>
    </div>

    <div class="card">
      <h3>Ajustes</h3>
      <div class="grid2">
        <label class="fld"><span>Serviço</span>
          <div class="row"><input id="rcSvc" type="number" inputmode="decimal" value="${Math.round(CALC.serviceRate*100)}" step="1" style="width:70px" ${CALC.serviceOn?"":"disabled"}><span class="mut">%</span>
          <span class="chip ${CALC.serviceOn?"on":""}" id="rcSvcOn">${CALC.serviceOn?"incluso":"sem"}</span></div></label>
        <label class="fld"><span>Couvert (total)</span><input id="rcCouvert" type="number" inputmode="decimal" value="${CALC.couvert}" step="0.01"></label>
      </div>
      <label class="fld"><span>Desconto (total)</span><input id="rcDisc" type="number" inputmode="decimal" value="${CALC.discount}" step="0.01"></label>
    </div>

    <div class="card" id="rcResult"></div>

    <div class="row" style="margin-top:4px">
      <button class="btn sec grow" id="rcShare">Compartilhar</button>
      <button class="btn grow" id="rcCouple">${icon("heart", 18, 2)}Guardar no casal</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost grow" id="rcPush">Lançar num grupo →</button>
      <button class="btn ghost grow" id="rcReset">Recomeçar</button>
    </div>`;

  $("#rcCouvert").oninput = e => { CALC.couvert = parseMoney(e.target.value); refreshCalc(); };
  $("#rcDisc").oninput = e => { CALC.discount = parseMoney(e.target.value); refreshCalc(); };
  $("#rcSvc").oninput = e => { CALC.serviceRate = (parseFloat(e.target.value)||0)/100; refreshCalc(); };
  $("#rcSvcOn").onclick = () => { CALC.serviceOn = !CALC.serviceOn; saveCalc(); renderRacha(); };

  $("#rcAddP").onclick = addPerson;
  $("#rcPerson").addEventListener("keydown", e => { if(e.key === "Enter") addPerson(); });
  app.querySelectorAll("[data-pp]").forEach(c => c.onclick = () => { CALC.people = CALC.people.filter(p => p.id != c.dataset.pp); CALC.items.forEach(it => it.assigned = it.assigned.filter(id => id != c.dataset.pp)); saveCalc(); renderRacha(); });

  $("#rcManual").onclick = () => { CALC.items.push({ id: nid(), name: "", qty: 1, price: 0, assigned: CALC.people.map(p=>p.id) }); saveCalc(); renderRacha(); };
  $("#rcText").onclick = textDialog;
  $("#rcGal").onclick = () => wantPhoto("gal");
  $("#rcCam").onclick = () => wantPhoto("cam");

  app.querySelectorAll("#rcItems .item").forEach(node => {
    const i = +node.dataset.i;
    node.querySelectorAll("[data-f]").forEach(inp => inp.oninput = e => { const f = inp.dataset.f; CALC.items[i][f] = f === "name" ? e.target.value : parseMoney(e.target.value); saveCalc(); refreshCalc(); });
    node.querySelector("[data-rm]").onclick = () => { CALC.items.splice(i, 1); saveCalc(); renderRacha(); };
    node.querySelectorAll("[data-mid]").forEach(ch => ch.onclick = () => { const id = ch.dataset.mid, a = CALC.items[i].assigned, k = a.indexOf(id); if(k>=0) a.splice(k,1); else a.push(id); ch.classList.toggle("on"); saveCalc(); refreshCalc(); });
  });

  $("#rcShare").onclick = shareCalc;
  $("#rcCouple").onclick = saveCalcToCouple;
  $("#rcPush").onclick = launchToGroup;
  $("#rcReset").onclick = () => { if(confirm("Recomeçar? Apaga itens e pessoas.")){ CALC = { people:[], items:[], serviceOn:true, serviceRate:0.10, couvert:0, discount:0, billTotal:null }; saveCalc(); renderRacha(); } };
  refreshCalc();
}
function addPerson(){
  const inp = $("#rcPerson"); const name = inp.value.trim(); if(!name) return;
  const id = String(nid()); CALC.people.push({ id, name });
  CALC.items.forEach(it => it.assigned.push(id));   // novo entra dividindo tudo
  saveCalc(); renderRacha();
}
function refreshCalc(){
  const r = calcSplit();
  const nameOf = id => CALC.people.find(p => p.id === id)?.name || "?";
  let check = "";
  if(CALC.billTotal != null && Math.abs(CALC.billTotal - r.total) > 0.05) check = `<div class="banner warn">Os itens somam ${brl(r.total)}, mas a conta diz ${brl(CALC.billTotal)} — confira se faltou ou repetiu item. <a class="link" id="rcClearCheck">ignorar</a></div>`;
  else if(CALC.billTotal != null) check = `<div class="banner ok">✓ Bate com o total da conta (${brl(CALC.billTotal)}).</div>`;
  const rows = CALC.people.length
    ? CALC.people.map(p => `<div class="listrow"><div class="row">${avatar(p.name)}<span>${esc(p.name)}</span></div><span class="b">${brl(r.shares[p.id]||0)}</span></div>`).join("")
    : `<div class="empty">Adicione pessoas e itens pra ver a divisão.</div>`;
  $("#rcResult").innerHTML = `<h3>Divisão</h3>${check}
    <div class="sm mut">Subtotal ${brl(r.subtotal)}${CALC.serviceOn?` · serviço ${brl(r.serviceAmount)}`:""}${CALC.couvert?` · couvert ${brl(CALC.couvert)}`:""}${CALC.discount?` · -${brl(CALC.discount)}`:""}</div>
    ${rows}
    <div class="between" style="margin-top:8px"><span class="b">Total</span><span class="b">${brl(r.total)}</span></div>`;
  const ic = $("#rcClearCheck"); if(ic) ic.onclick = () => { CALC.billTotal = null; saveCalc(); refreshCalc(); };
}
function shareCalc(){
  const r = calcSplit();
  if(r.total <= 0){ toast("Nada pra compartilhar ainda"); return; }
  let t = "💸 Racha da conta\n";
  CALC.people.forEach(p => { t += `• ${p.name}: ${brl(r.shares[p.id]||0)}\n`; });
  if(CALC.serviceOn) t += `(inclui ${Math.round(CALC.serviceRate*100)}% de serviço)\n`;
  t += `Total: ${brl(r.total)}`;
  if(navigator.share){ navigator.share({ text: t }).catch(()=>{}); }
  else { window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank"); }
}
function applyToCalc(parsed){
  if(!parsed.items?.length){ toast("Não achei itens. Tente manual."); return; }
  parsed.items.forEach(p => CALC.items.push({ id: nid(), name: p.name, qty: p.qty, price: parseMoney(p.unitPrice ?? p.price ?? 0), assigned: CALC.people.map(x=>x.id) }));
  if(parsed.total > 0) CALC.billTotal = parsed.total;
  if(parsed.service){ CALC.serviceOn = true; if(parsed.service.rate > 0) CALC.serviceRate = parsed.service.rate/100; }
  saveCalc(); renderRacha();
  toast(`${parsed.items.length} ${parsed.items.length>1?"itens":"item"} lido(s) ✓`);
}

/* ---------- ponte: lançar o racha como despesa de um grupo ---------- */
async function launchToGroup(){
  const r = calcSplit();
  if(r.total <= 0){ toast("Adicione itens com valor primeiro"); return; }
  if(CALC.people.length === 0){ toast("Adicione as pessoas primeiro"); return; }
  if(!db.hasConfig()){ toast("Configure os Grupos (Supabase) em ⚙"); openCfg(); return; }
  if(!ME){ toast("Entre na sua conta pra lançar no grupo"); localStorage.removeItem("racha.join"); return go("grupos"); }

  let groups = [];
  try{ groups = await db.myGroups(); }catch(e){ console.error(e); toast("Não consegui buscar seus grupos"); return; }

  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>Lançar no grupo</h2>
    <p class="sm mut" style="margin-top:0">Vira uma despesa de ${brl(r.total)} no livro-razão. Nomes iguais são casados automaticamente; os novos viram membros.</p>
    <label class="fld"><span>Grupo</span><select id="lgGroup">
      ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}
      <option value="__new">+ novo grupo…</option>
    </select></label>
    <label class="fld" id="lgNewWrap" style="display:${groups.length?"none":"block"}"><span>Nome do novo grupo</span><input id="lgNew" placeholder="ex.: Viagem, República"></label>
    <label class="fld"><span>Quem pagou</span><select id="lgPayer">${CALC.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
    <label class="fld"><span>Descrição</span><input id="lgDesc" value="Racha"></label>
    <div class="row" style="margin-top:6px"><button class="btn grow" id="lgOk">Lançar</button><button class="btn sec" id="lgCancel">Cancelar</button></div>
  </div>`;
  if(!groups.length) dlg.querySelector("#lgGroup").value = "__new";
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#lgGroup").onchange = e => { dlg.querySelector("#lgNewWrap").style.display = e.target.value === "__new" ? "block" : "none"; };
  dlg.querySelector("#lgCancel").onclick = close;
  dlg.querySelector("#lgOk").onclick = async () => {
    const sel = dlg.querySelector("#lgGroup").value;
    const payer = dlg.querySelector("#lgPayer").value;
    const desc = dlg.querySelector("#lgDesc").value.trim() || "Racha";
    dlg.querySelector("#lgOk").disabled = true;
    try{
      let groupId = sel;
      if(sel === "__new"){ const nm = dlg.querySelector("#lgNew").value.trim(); if(!nm){ toast("Dê um nome ao grupo"); dlg.querySelector("#lgOk").disabled = false; return; } groupId = (await db.createGroup(nm)).id; }
      await pushCalcToGroup(groupId, payer, desc, r);
      close(); toast("Lançado no grupo ✓"); go("g/" + groupId);
    }catch(e){ console.error(e); toast(e?.message || "Não consegui lançar", 4500); dlg.querySelector("#lgOk").disabled = false; }
  };
}
async function pushCalcToGroup(groupId, payerPersonId, description, r){
  const members = await db.groupMembers(groupId);
  const byName = {}; members.forEach(m => { byName[norm(m.display_name)] = m.id; });
  const map = {};
  for(const p of CALC.people){
    const key = norm(p.name);
    if(byName[key]) map[p.id] = byName[key];
    else { const m = await db.addGhost(groupId, p.name); map[p.id] = m.id; byName[key] = m.id; }
  }
  const items = CALC.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.price)||0) > 0).map((it, i) => ({
    name: it.name || "item", qty: Number(it.qty)||1, unit_price: Number(it.price)||0, position: i,
    shares: (it.assigned.length ? it.assigned : CALC.people.map(p=>p.id)).map(pid => ({ member_id: map[pid], weight: 1 })),
  }));
  const payload = {
    group_id: groupId, description, place: null, spent_at: todayISO(),
    subtotal: round2(r.subtotal), service_rate: CALC.serviceOn ? CALC.serviceRate : 0,
    service_amount: round2(r.serviceAmount), couvert: round2(CALC.couvert), discount: round2(CALC.discount), total: round2(r.total),
    items, payers: [{ member_id: map[payerPersonId], amount: round2(r.total) }],
    shares: CALC.people.map(p => ({ member_id: map[p.id], amount: round2(r.shares[p.id]||0) })).filter(s => s.amount !== 0),
  };
  fixPennies(payload.shares, payload.total);
  await db.saveExpense(payload);
}

/* ====================================================================== */
/* ============================ ABA CASAL ============================= */
/* ====================================================================== */
// Livro-razão LOCAL do casal: js/model.js + localStorage. Sem conta, sem Supabase.
// Mora no Supabase como um grupo de 2 (kind="couple"): igual em qualquer aparelho, e os dois veem e lançam.
// ledgerFromCloud() devolve o mesmo formato de livro-razão do model.js, então as telas não sabem de onde o dado veio.
// Visual (direção C, "campo de cor"): o saldo num bloco verde; o conteúdo sobe numa folha branca.
let COUPLE = null, COUPLE_SEQ = 0, CASAL_CAT = null;   // CASAL_CAT: categoria filtrada no histórico (null = tudo)
let CASAL_FUT = false;                              // seção "Programado" aberta?
const dueLedger = c => ({ ...c, entries: dueEntries(c.entries, todayISO()) });   // só o que já venceu conta no saldo
const fmtWhen = iso => fmtShort(iso) + (String(iso || "").slice(0, 4) === todayISO().slice(0, 4) ? "" : " " + String(iso || "").slice(0, 4));
const FREQ = { month: "todo mês", week: "toda semana", year: "todo ano" };
const coupleSig = c => (c ? JSON.stringify([c.name, c.people, c.entries]) : "");
const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const LOCAL = createStore();                       // histórico antigo, de quando o casal morava só neste aparelho
function localCouple(){ try{ return LOCAL.list().find(l => l.kind === "couple") || null; }catch(_){ return null; } }
function getCouple(){ return COUPLE; }
const meOf = c => c.people.find(p => p.isMe) || c.people[0];
const otherOf = c => c.people.find(p => !p.isMe && p.userId) || c.people.find(p => !p.isMe) || c.people[1];   // prefere quem já entrou
// pessoa duplicada: o par entrou pelo convite como pessoa nova e o nome antigo (sem conta) ficou sobrando
const strayGhosts = c => (otherOf(c)?.userId ? c.people.filter(p => !p.isMe && !p.userId) : []);
const touches = (e, id) => e.type === "settlement" ? (e.from === id || e.to === id)
  : (e.shares || []).some(x => x.id === id) || (e.payers || []).some(x => x.id === id);
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "?";

async function loadCouple(){
  const g = (await db.myGroups()).find(x => x.kind === "couple");
  if(!g){ COUPLE = null; return null; }
  const [members, expenses, settlements] = await Promise.all([db.groupMembers(g.id), db.ledgerExpenses(g.id), db.listSettlements(g.id)]);
  const pixByUser = {};
  await Promise.all(members.filter(m => m.user_id).map(async m => { try{ pixByUser[m.user_id] = await db.memberPix(m.user_id); }catch(_){} }));
  COUPLE = ledgerFromCloud({ group: g, members, expenses, settlements, myUserId: ME?.id, pixByUser });
  return COUPLE;
}
const casalBox = html => { app.innerHTML = `<div style="padding:16px">${html}</div>`; };

async function routeCasal(){
  const { parts } = parseHash(), sub = parts[1];     // casal · casal/new · casal/e/<id>
  const paint = () => {
    if(sub === "new") return renderCoupleExpense(null);
    if(sub === "e" && parts[2]) return renderCoupleExpense(parts[2]);
    return renderCasal();
  };
  if(!db.hasConfig()){ document.body.dataset.screen = "auth"; return renderNeedConfig(); }
  if(!ME){                                           // casal é compartilhado: precisa saber quem é você
    document.body.dataset.screen = "auth"; document.body.classList.remove("form"); $("#topTitle").textContent = "Casal";
    return renderLogin("casal");
  }
  const seq = ++COUPLE_SEQ;
  if(COUPLE) paint();                                // mostra já o que tem e confere a nuvem por trás
  else casalBox(`<div class="card" style="text-align:center"><div class="spin"></div><p class="mut sm">Buscando o casal…</p></div>`);
  if(COUPLE && sub) return;                          // no meio de um formulário não recarrega (não perde o que foi digitado)
  try{ await loadCouple(); }
  catch(e){
    console.error(e); if(seq !== COUPLE_SEQ) return;
    if(!COUPLE) casalBox(`<div class="card"><h2>Não consegui carregar</h2><div class="banner warn">${esc(e?.message || "Sem conexão com o servidor.")}</div><button class="btn block" id="cpRetry">Tentar de novo</button></div>`);
    if($("#cpRetry")) $("#cpRetry").onclick = route;
    return;
  }
  if(seq !== COUPLE_SEQ || activeTab() !== "casal" || document.querySelector("dialog[open]")) return;
  paint();
}
// Passa pro par (que tem conta) tudo que ficou no nome antigo, e remove o nome antigo.
// Cada despesa é regravada inteira pelo mesmo RPC de edição, que confere as somas; o fantasma só sai no fim,
// então se cair no meio nada se perde e dá pra tocar de novo.
async function mergeStrayGhosts(c){
  const real = otherOf(c), ghosts = strayGhosts(c).map(g => g.id);
  if(!real?.userId || !ghosts.length) return 0;
  const fix = id => (ghosts.includes(id) ? real.id : id);
  const fold = arr => { const m = {}, order = []; (arr || []).forEach(x => { const k = fix(x.id); if(!(k in m)){ m[k] = 0; order.push(k); } m[k] = round2(m[k] + Number(x.amount || 0)); });
    return order.map(id => ({ id, amount: m[id] })); };
  const uniq = a => [...new Set((a || []).map(fix))];
  let n = 0;
  for(const e of c.entries){
    if(!ghosts.some(g => touches(e, g))) continue;
    if(e.type === "settlement"){
      const from = fix(e.from), to = fix(e.to);
      if(from !== to) await db.addSettlement({ groupId: c.id, from, to, amount: e.amount, settledAt: e.createdAt || null });
      await db.deleteSettlement(e.id);
    } else {
      const moved = { ...e, participants: uniq(e.participants), shares: fold(e.shares), payers: fold(e.payers),
        ...(e.items ? { items: e.items.map(it => ({ ...it, consumers: uniq(it.consumers) })) } : {}) };
      await db.updateExpense({ ...toRpcPayload(c.id, moved), id: e.id });
    }
    n++;
  }
  for(const g of ghosts) await db.removeMember(g);
  return n;
}
// depois de gravar: relê a nuvem e volta pra home do casal
async function afterCoupleWrite(msg){
  await loadCouple(); if(msg) toast(msg);
  if(location.hash.replace(/^#\/?/, "") === "casal") renderCasal(); else go("casal");
}

function renderCasal(){
  const c = getCouple();
  if(!c || c.people.length < 2) return renderCoupleSetup(c);
  const me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  const mine = round2(ledgerBalances(dueLedger(c))[me.id] || 0);   // >0: me devem · <0: eu devo (só o que já venceu)
  const link = inviteLink(c.id);
  const invite = other.userId ? "" : `<div class="preview" style="margin-bottom:16px">
      <div class="effect">${you} ainda não entrou</div>
      <div class="sm" style="margin:4px 0 12px;font-weight:500">Mande o convite. ${you} entra com o próprio e-mail e passa a ver e lançar junto com você.</div>
      <div class="row"><a class="btn sm grow" target="_blank" href="https://wa.me/?text=${encodeURIComponent("Entra no nosso racha de casal: " + link)}">Mandar no WhatsApp</a><button class="btn sec sm" id="cpCopy">Copiar link</button></div>
    </div>`;
  const stray = strayGhosts(c);
  const strayN = stray.length ? c.entries.filter(e => stray.some(g => touches(e, g.id))).length : 0;
  const dupCard = stray.length ? `<div class="preview neg" style="margin-bottom:16px">
      <div class="effect">${esc(stray[0].name)} aparece duas vezes</div>
      <div class="sm" style="margin:4px 0 12px;font-weight:500">${you} entrou pelo convite como pessoa nova, e o nome antigo ficou sobrando. ${strayN ? `${strayN} ${strayN === 1 ? "lançamento está" : "lançamentos estão"} no nome antigo, por isso o saldo de vocês não bate.` : "Dá pra remover o nome antigo."}</div>
      <button class="btn block" id="cpMerge">Juntar tudo em ${you}</button>
    </div>` : "";
  const quite = Math.abs(mine) < 0.005;
  const label = quite ? "Tudo certo entre vocês" : mine > 0 ? `${you} te deve` : `Você deve a ${you}`;
  const actions = quite ? "" : mine > 0
    ? `<div class="hero-actions"><button class="hb solid" id="cpSettle">Acertar</button><button class="hb line" id="cpNudge">Cobrar</button></div>`
    : `<div class="hero-actions"><button class="hb solid" id="cpSettle">Pagar ${you}</button></div>`;
  const today = todayISO();
  const sorted = c.entries.slice().reverse().sort((a, b) => String(b.spentAt || "").localeCompare(String(a.spentAt || "")));   // mais recente primeiro
  const entries = sorted.filter(e => String(e.spentAt || "") <= today);            // histórico = o que já venceu
  const future = sorted.filter(e => String(e.spentAt || "") > today).reverse();    // programado, a próxima primeiro
  // detalhamento: filtro por categoria + resumo do que está na tela + total por mês
  const expAll = entries.filter(e => e.type === "expense");
  const cats = [...new Set(expAll.map(e => e.category || ""))];
  if(CASAL_CAT !== null && !cats.includes(CASAL_CAT)) CASAL_CAT = null;
  const shown = CASAL_CAT === null ? entries : expAll.filter(e => (e.category || "") === CASAL_CAT);
  const shownExp = shown.filter(e => e.type === "expense");
  const part = (list, id) => round2(list.reduce((t, e) => t + ((e.shares || []).find(x => x.id === id)?.amount || 0), 0));
  const paid = (list, id) => round2(list.reduce((t, e) => t + ((e.payers || []).find(x => x.id === id)?.amount || 0), 0));
  const spent = list => round2(list.reduce((t, e) => t + (Number(e.total) || 0), 0));
  const catName = k => k ? esc(catLabel(k)) : "Sem categoria";
  const chips = cats.length > 1 ? `<div class="chips">
      <button class="chip ${CASAL_CAT === null ? "on" : ""}" data-cat="*">Tudo</button>
      ${cats.map(k => `<button class="chip ${CASAL_CAT === k ? "on" : ""}" data-cat="${encodeURIComponent(k)}">${icon(catIcon(k), 16)}${catName(k)}</button>`).join("")}
    </div>` : "";
  const summary = shownExp.length ? `<div class="sumbox">
      <div class="between"><span class="b">${CASAL_CAT === null ? "Tudo que vocês gastaram" : catName(CASAL_CAT)}</span><span class="b num">${brlNB(spent(shownExp))}</span></div>
      <div class="sumgrid num">
        <span class="mut">Sua parte</span><span>${brlNB(part(shownExp, me.id))}</span><span class="mut">Você pagou</span><span>${brlNB(paid(shownExp, me.id))}</span>
        <span class="mut">Parte de ${you}</span><span>${brlNB(part(shownExp, other.id))}</span><span class="mut">${you} pagou</span><span>${brlNB(paid(shownExp, other.id))}</span>
      </div>
    </div>` : "";
  let lastMonth = null;
  const monthHead = e => {
    const k = String(e.spentAt || "").slice(0, 7); if(k === lastMonth) return ""; lastMonth = k;
    const m = /^(\d{4})-(\d{2})/.exec(k); if(!m) return "";
    const tot = spent(shownExp.filter(x => String(x.spentAt || "").slice(0, 7) === k));
    return `<div class="mhead"><span>${MONTHS_FULL[+m[2] - 1]} de ${m[1]}</span><span class="num">${tot ? brlNB(tot) : ""}</span></div>`;
  };
  const rows = shown.map(e => monthHead(e) + rowOf(e)).join("");
  function rowOf(e){
    const n = entryNet(e)[me.id] || 0;                          // efeito no MEU saldo
    if(e.type === "settlement"){
      const title = e.from === me.id ? `Você pagou ${you}` : `${you} te pagou`;
      return `<div class="erow" data-entry="${e.id}" role="button" tabindex="0">
        <div class="ico">${icon("swap")}</div>
        <div class="grow" style="min-width:0"><div class="t">${title}</div><div class="s num">${fmtShort(e.spentAt)} · acerto</div></div>
        <div class="v num zero">${signed(n)}</div></div>`;
    }
    const payer = (e.payers || []).length > 1 ? "vocês dois pagaram" : (e.payers?.[0]?.id === me.id ? "você pagou" : `${you} pagou`);
    return `<div class="erow" data-entry="${e.id}" role="button" tabindex="0">
      <div class="ico ${tone(n)}">${icon(catIcon(e.category))}</div>
      <div class="grow" style="min-width:0"><div class="t">${esc(e.description || "Despesa")}</div><div class="s num">${fmtWhen(e.spentAt)} · ${brlNB(e.total)} · ${payer}${e.series?.kind === "repeat" ? " · " + FREQ[e.series.freq] : ""}</div></div>
      <div class="v num ${tone(n)}">${signed(n)}</div></div>`;
  }
  const count = entries.length;
  const futCard = future.length ? `<div class="sumbox" style="padding:0">
      <button class="futhead" id="cpFut"><span><span class="b">Programado</span> <span class="sm mut num">· ${future.length} ${future.length === 1 ? "lançamento" : "lançamentos"} · ${brlNB(spent(future))}</span></span><span class="sm" style="color:var(--accent);font-weight:700">${CASAL_FUT ? "ocultar" : "ver"}</span></button>
      ${CASAL_FUT ? `<div style="padding:0 16px 4px"><div class="sm mut" style="margin-bottom:2px">Ainda não entram no saldo. Cada um entra na sua data.</div>${future.map(rowOf).join("")}</div>` : ""}
    </div>` : "";
  // série sem data pra acabar: programo 12 por vez e aviso quando a última estiver chegando
  const lastOpen = {};
  c.entries.forEach(e => { if(e.series && (!lastOpen[e.series.id] || e.series.n > lastOpen[e.series.id].series.n)) lastOpen[e.series.id] = e; });
  const renew = Object.values(lastOpen).filter(e => e.series.of === 0 && String(e.spentAt) <= addDays(today, 45));
  const renewCard = renew.map(e => `<div class="preview" style="margin-bottom:16px">
      <div class="effect">${esc(e.description)} está programado só até ${fmtWhen(e.spentAt)}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm grow" data-renew="${e.id}">Programar mais 12</button><button class="btn sec sm" data-endser="${e.id}">Encerrar</button></div>
    </div>`).join("");
  app.innerHTML = `
    <section class="hero"><div class="wrapc">
      <div class="hero-top">
        <button class="hero-id" id="cpEdit" aria-label="editar o casal"><span class="mono">${esc(initials(me.name + " " + other.name))}</span><span>${esc(c.name)}</span></button>
        <button class="iconbtn" id="cpCfg" aria-label="configurações">${icon("gear", 19)}</button>
      </div>
      <div class="hero-label">${label}</div>
      <div class="hero-amount num">${quite ? "Quites" : brlNB(Math.abs(mine))}</div>
      ${actions}
    </div></section>
    <section class="sheet"><div class="wrapc">
      <div class="sheet-head"><h2 style="margin:0">Histórico</h2><span class="sm mut">${count ? `${count} ${count === 1 ? "lançamento" : "lançamentos"}` : ""}</span></div>
      ${invite}${dupCard}${renewCard}${futCard}
      ${chips}${summary}
      ${rows || `<div class="empty">Nenhum lançamento ainda.<br>Toque no <b>+</b> pra lançar a primeira despesa — ou rache uma conta na aba <b>Racha</b> e guarde a parte de vocês.</div>`}
    </div></section>
    <button class="fab-plus" id="cpNew" aria-label="nova despesa">${icon("plus", 26, 2.2)}</button>`;
  $("#cpEdit").onclick = () => renderCoupleSetup(c);
  $("#cpCfg").onclick = openCfg;
  $("#cpNew").onclick = () => go("casal/new");
  if($("#cpCopy")) $("#cpCopy").onclick = () => copy(link);
  if($("#cpFut")) $("#cpFut").onclick = () => { CASAL_FUT = !CASAL_FUT; renderCasal(); };
  app.querySelectorAll("[data-renew]").forEach(b => b.onclick = async () => {
    const last = c.entries.find(x => x.id === b.dataset.renew); if(!last) return;
    if(!last.series.start){ toast("Não consegui continuar esta série. Lance de novo como recorrente."); return; }
    b.disabled = true;
    try{
      const more = expandSeries(last, { kind: "repeat", count: 12, freq: last.series.freq, open: true, from: last.series.n, id: last.series.id, start: last.series.start });
      for(let i = 0; i < more.length; i++){ b.textContent = `Programando ${i + 1}/12…`; await db.saveExpense(toRpcPayload(c.id, more[i])); }
      await afterCoupleWrite("Mais 12 programados ✓");
    }catch(e){ console.error(e); toast(e?.message || "Não consegui programar", 5000); try{ await loadCouple(); }catch(_){} renderCasal(); }
  });
  app.querySelectorAll("[data-endser]").forEach(b => b.onclick = async () => {
    const last = c.entries.find(x => x.id === b.dataset.endser); if(!last) return;
    if(!confirm(`Encerrar "${last.description}" em ${fmtWhen(last.spentAt)}? Os lançamentos já feitos continuam.`)) return;
    try{ await db.updateExpense({ ...toRpcPayload(c.id, { ...last, series: { ...last.series, of: last.series.n } }), id: last.id }); await afterCoupleWrite("Encerrado ✓"); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui encerrar", 5000); }
  });
  if($("#cpMerge")) $("#cpMerge").onclick = async () => {
    const btn = $("#cpMerge"); btn.disabled = true; btn.textContent = "Juntando…";
    try{ const n = await mergeStrayGhosts(await loadCouple()); await loadCouple(); toast(`Pronto ✓ ${n} ${n === 1 ? "lançamento corrigido" : "lançamentos corrigidos"}`, 4000); renderCasal(); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui juntar. Tente de novo.", 5000); try{ await loadCouple(); }catch(_){} renderCasal(); }
  };
  app.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { CASAL_CAT = b.dataset.cat === "*" ? null : decodeURIComponent(b.dataset.cat); renderCasal(); });
  // confere a nuvem e só redesenha se algo mudou (não pisca nem perde a rolagem à toa)
  REFRESH = async () => {
    const before = coupleSig(COUPLE);
    await loadCouple();
    if(activeTab() === "casal" && parseHash().parts.length === 1 && coupleSig(COUPLE) !== before) renderCasal();
  };
  if(!LIVE) LIVE = db.subscribeGroup(c.id, () => { clearTimeout(liveTimer); liveTimer = setTimeout(softRefresh, 400); });   // caminho rápido
  if($("#cpSettle")) $("#cpSettle").onclick = coupleSettleDialog;
  if($("#cpNudge")) $("#cpNudge").onclick = () => {
    let msg = `Oi! Só lembrando do nosso racha: você está com *${brl(mine)}* pra me acertar 🙂`;
    if(me.pix?.key) msg += `\nMeu Pix: ${me.pix.key}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };
  app.querySelectorAll("[data-entry]").forEach(r => {
    const open = () => coupleEntryDialog(r.dataset.entry);
    r.onclick = open;
    r.onkeydown = ev => { if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); open(); } };
  });
}

function renderCoupleSetup(c){
  const me = c ? meOf(c) : null, other = c && c.people.length > 1 ? otherOf(c) : null;
  const old = c ? null : localCouple();              // casal antigo, guardado só neste aparelho
  const oldN = old?.entries?.length || 0;
  const ready = c && other;
  app.innerHTML = `
    <section class="hero hero-form"><div class="wrapc">
      <div class="hero-top">
        ${ready ? `<button class="iconbtn" id="csBack" aria-label="voltar">${icon("back", 19, 2)}</button>` : ""}
        <div class="grow hero-title">${ready ? "Editar o casal" : "Vocês dois"}</div>
        <button class="iconbtn" id="csCfg" aria-label="configurações">${icon("gear", 19)}</button>
      </div>
      ${ready ? "" : `<div class="hero-label" style="margin-top:20px;font-size:18px;font-weight:700;opacity:1">As contas de vocês dois, iguais em qualquer aparelho.</div>
      <div class="sm" style="opacity:.82;margin-top:6px">Você cria, manda o convite e os dois passam a ver e lançar.</div>`}
    </div></section>
    <section class="sheet form"><div class="wrapc stack">
      ${oldN ? `<div class="preview"><div class="effect">Achei ${oldN} ${oldN === 1 ? "lançamento" : "lançamentos"} guardados neste aparelho</div><div class="sm" style="margin-top:4px;font-weight:500">Eles sobem junto quando você começar, com o mesmo saldo.</div></div>` : ""}
      <div><div class="flabel">Você</div>
        <div class="stack" style="gap:9px">
          <label class="tile"><span>Nome</span><input id="csMe" value="${esc(me?.name || (old ? meOf(old).name : "") || PROFILE?.name || "")}" placeholder="ex.: Fábio" autocomplete="given-name"></label>
          <label class="tile"><span>Pix</span><input id="csMePix" value="${esc(PROFILE?.pix_key || (old ? meOf(old).pix?.key : "") || "")}" placeholder="pra receber (opcional)"></label>
        </div></div>
      <div><div class="flabel">Parceiro(a)</div>
        <div class="stack" style="gap:9px">
          <label class="tile"><span>Nome</span><input id="csOther" value="${esc(other?.name || (old ? otherOf(old).name : "") || "")}" placeholder="ex.: Ana"></label>
          <div class="sm mut">${other?.userId ? "A chave Pix é a que a própria pessoa cadastrou." : "A chave Pix aparece quando a pessoa entrar pelo convite e cadastrar a dela."}</div>
        </div></div>
      <button class="btn block" id="csSave">${ready ? "Salvar" : "Começar"}</button>
      <div class="sm mut" style="text-align:center">Conectado como ${esc(ME?.email || "")} · <a class="link" id="csOut">sair</a></div>
      ${ready ? `<button class="btn ghost block" id="csWipe" style="color:var(--danger)">Apagar o casal e todo o histórico</button>` : ""}
    </div></section>`;
  $("#csCfg").onclick = openCfg;
  if($("#csBack")) $("#csBack").onclick = renderCasal;
  $("#csOut").onclick = async () => { if(!confirm("Sair desta conta neste aparelho?")) return; await db.signOut(); ME = null; PROFILE = null; COUPLE = null; paintAcct(); route(); };
  $("#csSave").onclick = async () => {
    const meName = $("#csMe").value.trim(), otherName = $("#csOther").value.trim(), mePix = $("#csMePix").value.trim();
    if(!meName || !otherName){ toast("Preencha os dois nomes"); return; }
    const btn = $("#csSave"); btn.disabled = true; btn.textContent = "Salvando…";
    try{
      PROFILE = await db.saveProfile({ name: meName, pix_key: mePix || null, pix_name: PROFILE?.pix_name || meName });
      let moved = 0;
      if(c){
        await db.renameMember(me.id, meName);
        if(other) await db.renameMember(other.id, otherName); else await db.addGhost(c.id, otherName);
        try{ await db.renameGroup(c.id, `${meName} & ${otherName}`); }catch(_){}        // só quem criou consegue renomear
      } else {
        const g = await db.createGroup(`${meName} & ${otherName}`, "couple");
        await db.addGhost(g.id, otherName);
        moved = await importLocalCouple(g.id, old);
      }
      await loadCouple();
      toast(moved ? `Casal criado ✓ · ${moved} ${moved === 1 ? "lançamento subiu" : "lançamentos subiram"}` : ready ? "Salvo ✓" : "Casal criado ✓");
      renderCasal();
    }catch(e){ console.error(e); toast(e?.message || "Não consegui salvar", 5000); btn.disabled = false; btn.textContent = ready ? "Salvar" : "Começar"; }
  };
  if($("#csWipe")) $("#csWipe").onclick = async () => {
    if(!confirm("Apagar o casal e TODO o histórico, pra vocês dois? Não dá pra desfazer.")) return;
    try{ await db.deleteGroup(c.id); await loadCouple(); }catch(e){ console.error(e); toast(e?.message || "Não consegui apagar", 5000); return; }
    if(COUPLE){ toast("Só quem criou o casal pode apagar", 4500); return; }
    toast("Apagado"); renderCasal();
  };
}
// sobe o histórico que morava só neste aparelho pro casal recém-criado (mesmas pessoas, mesmos valores)
async function importLocalCouple(groupId, old){
  if(!old || !old.entries?.length) return 0;
  const members = await db.groupMembers(groupId);
  const mine = members.find(m => m.user_id === ME?.id), ghost = members.find(m => !m.user_id);
  if(!mine || !ghost) return 0;
  const map = { [meOf(old).id]: mine.id, [otherOf(old).id]: ghost.id };
  let n = 0;
  for(const e of old.entries){
    if(e.type === "settlement") await db.addSettlement({ groupId, from: map[e.from], to: map[e.to], amount: e.amount, settledAt: e.spentAt ? e.spentAt + "T12:00:00Z" : null });
    else await db.saveExpense(toRpcPayload(groupId, e, map));
    n++;
  }
  try{ localStorage.setItem("racha.model.v1.subiu", localStorage.getItem("racha.model.v1") || ""); LOCAL.remove(old.id); }catch(_){}   // guarda uma cópia e tira da frente
  return n;
}

/* ---------- nova / editar despesa do casal ---------- */
let CDRAFT = null;
function renderCoupleExpense(editId){
  const c = getCouple(); if(!c) return renderCoupleSetup(null);
  const me = meOf(c);
  const d = CDRAFT = { editId: null, description: "", category: "", spentAt: todayISO(), payer: me.id, mode: "equal", total: 0, exact: {}, items: [], serviceOn: false, serviceRate: 0.10, couvert: 0, discount: 0, billTotal: null, focusValue: true,
    rep: "one", repN: 12, repValue: "total", repFreq: "month", repTimes: "", repUntil: "" };   // rep: uma vez · parcelado · recorrente
  if(editId){
    const e = c.entries.find(x => x.id === editId && x.type === "expense");
    if(!e){ toast("Despesa não encontrada"); return go("casal"); }
    d.editId = e.id; d.focusValue = false; d.description = e.description || ""; d.category = e.category || ""; d.spentAt = e.spentAt || todayISO();
    d.payer = e.payers?.[0]?.id || me.id; d.total = Number(e.total) || 0;
    if(e.method === "item"){
      d.mode = "item"; d.items = (e.items || []).map(it => ({ name: it.name || "", qty: it.qty, unitPrice: it.unitPrice, consumers: [...(it.consumers || [])] }));
      d.serviceOn = (e.opts?.serviceRate || 0) > 0; d.serviceRate = e.opts?.serviceRate || 0.10; d.couvert = e.opts?.couvert || 0; d.discount = e.opts?.discount || 0;
    }
    else if((e.participants || []).length === 1) d.mode = e.participants[0] === me.id ? "mine" : "theirs";
    else if(e.method === "equal") d.mode = "equal";
    else { d.mode = "exact"; (e.shares || []).forEach(s => { d.exact[s.id] = s.amount; }); }
  }
  paintCoupleExpense();
}
// o rascunho da tela vira o átomo do model.js — é ele que calcula e valida (soma no centavo)
function coupleAtom(d, c){
  const me = meOf(c), other = otherOf(c);
  const base = { id: d.editId || undefined, description: d.description || "Despesa", category: d.category || null, spentAt: d.spentAt, payers: d.payer };
  if(d.mode === "equal")  return buildExpense({ ...base, method: "equal", amount: d.total, participants: [me.id, other.id] });
  if(d.mode === "mine")   return buildExpense({ ...base, method: "equal", amount: d.total, participants: [me.id] });
  if(d.mode === "theirs") return buildExpense({ ...base, method: "equal", amount: d.total, participants: [other.id] });
  if(d.mode === "exact")  return buildExpense({ ...base, method: "exact", exact: d.exact, participants: [me.id, other.id] });
  const items = d.items.filter(it => (Number(it.qty) || 0) > 0 && (Number(it.unitPrice) || 0) > 0);
  return buildExpense({ ...base, method: "item", participants: [me.id, other.id], items, opts: { serviceRate: d.serviceOn ? d.serviceRate : 0, couvert: d.couvert, discount: d.discount } });
}
// trocar o jeito de dividir não joga fora o que já foi digitado
function switchCoupleMode(m){
  const d = CDRAFT, c = getCouple(), me = meOf(c), other = otherOf(c);
  let current = 0; try{ current = coupleAtom(d, c).total || 0; }catch(_){}
  if(m === "exact" && !Object.values(d.exact).some(v => Number(v) > 0) && current > 0) d.exact = allocateByWeights(current, { [me.id]: 1, [other.id]: 1 });
  if((m === "equal" || m === "mine" || m === "theirs") && !(d.total > 0) && current > 0) d.total = current;
  d.mode = m; paintCoupleExpense();
}
function paintCoupleExpense(){
  const d = CDRAFT, c = getCouple(), me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  ITEM_SINK = applyToCouple;
  const typed = d.mode === "equal" || d.mode === "mine" || d.mode === "theirs";
  const fmtIn = v => (Number(v) > 0 ? money2(v) : "");
  const heroValue = typed
    ? `<div class="amount num"><span class="cur">R$</span><input id="ceTotal" type="text" inputmode="decimal" autocomplete="off" value="${fmtIn(d.total)}" placeholder="0,00" aria-label="valor da despesa"></div>`
    : `<div class="amount num"><span class="cur">R$</span><span class="val" id="ceTotalView">0,00</span></div><div class="sm" style="opacity:.8;margin-top:2px">${d.mode === "item" ? "soma dos itens" : "soma dos valores"}</div>`;
  const payerBtn = (p, label) => `<button class="opt pick ${d.payer === p.id ? "on" : ""}" data-payer="${p.id}"><span class="mono">${esc(initials(p.name))}</span>${label}</button>`;
  const modeBtn = (val, label) => `<button class="opt ${d.mode === val ? "on" : ""}" data-mode="${val}">${label}</button>`;
  let panel = "";
  if(d.mode === "exact"){
    panel = `<div class="seg c2">
      <label class="tile tight"><span>Eu</span><input data-exact="${me.id}" type="text" inputmode="decimal" value="${fmtIn(d.exact[me.id])}" placeholder="0,00" style="text-align:right"></label>
      <label class="tile tight"><span>${you}</span><input data-exact="${other.id}" type="text" inputmode="decimal" value="${fmtIn(d.exact[other.id])}" placeholder="0,00" style="text-align:right"></label>
    </div>`;
  } else if(d.mode === "item"){
    const itemsHtml = d.items.map((it, i) => `
      <div class="item" data-i="${i}" style="margin:0">
        <div class="row" style="gap:6px">
          <input data-f="name" value="${esc(it.name)}" placeholder="item" class="grow" style="min-width:0" aria-label="item">
          <button class="iconbtn plain" data-rm="${i}" aria-label="remover item">${icon("close", 18, 2)}</button>
        </div>
        <div class="row wrap" style="margin-top:8px;gap:8px">
          <input data-f="qty" type="text" inputmode="numeric" value="${it.qty}" style="width:52px;text-align:center" aria-label="quantidade">
          <span class="mut" aria-hidden="true">×</span>
          <input data-f="unitPrice" type="text" inputmode="decimal" value="${fmtIn(it.unitPrice)}" placeholder="0,00" style="width:96px;text-align:right" aria-label="preço unitário">
          <span class="grow"></span>
          <span class="row" style="gap:6px" role="group" aria-label="quem comeu">${[me, other].map(p => `<button class="chip ${it.consumers.includes(p.id) ? "on" : ""}" data-mid="${p.id}">${p.id === me.id ? "Eu" : you}</button>`).join("")}</span>
        </div>
      </div>`).join("");
    panel = `
      <div class="seg c4">${srcTiles("ce")}</div>
      ${itemsHtml || `<p class="sm mut" style="margin:0">Tire a foto da conta — ou cole o texto, ou adicione à mão — e marque quem comeu cada item.</p>`}
      <div class="seg c2">
        <button class="opt ${d.serviceOn ? "on" : ""}" id="ceSvcOn">${d.serviceOn ? "Com serviço" : "Sem serviço"}</button>
        <label class="tile tight"><span>Taxa</span><input id="ceSvc" type="text" inputmode="decimal" value="${Math.round(d.serviceRate * 100)}" style="text-align:right" ${d.serviceOn ? "" : "disabled"}><span>%</span></label>
      </div>
      <div class="seg c2">
        <label class="tile tight"><span>Couvert</span><input id="ceCouvert" type="text" inputmode="decimal" value="${fmtIn(d.couvert)}" placeholder="0,00" style="text-align:right"></label>
        <label class="tile tight"><span>Desconto</span><input id="ceDisc" type="text" inputmode="decimal" value="${fmtIn(d.discount)}" placeholder="0,00" style="text-align:right"></label>
      </div>`;
  }
  app.innerHTML = `
    <section class="hero hero-form"><div class="wrapc">
      <div class="hero-top">
        <button class="iconbtn" id="ceBack" aria-label="voltar ao casal">${icon("back", 19, 2)}</button>
        <div class="grow hero-title">${d.editId ? "Editar despesa" : "Nova despesa"}</div>
      </div>
      <div class="hero-label" style="margin-top:18px;font-size:12px;font-weight:700;letter-spacing:.8px">VALOR</div>
      ${heroValue}
    </div></section>
    <section class="sheet form"><div class="wrapc stack">
      <div><div class="flabel">Quem pagou</div><div class="seg c2">${payerBtn(me, "Eu")}${payerBtn(other, you)}</div></div>
      <div><div class="flabel">Como dividir</div>
        <div class="seg c2">${modeBtn("equal", "Meio a meio")}${modeBtn("item", "Por item")}</div>
        <div class="seg c3" style="margin-top:9px">${modeBtn("mine", "Só eu")}${modeBtn("theirs", "Só " + you)}${modeBtn("exact", "Valores")}</div>
      </div>
      ${panel ? `<div class="stack" style="gap:10px">${panel}</div>` : ""}
      ${d.editId ? "" : `<div><div class="flabel">Repetir</div>
        <div class="seg c3">${[["one", "Uma vez"], ["parcel", "Parcelado"], ["repeat", "Recorrente"]].map(([v, l]) => `<button class="opt ${d.rep === v ? "on" : ""}" data-rep="${v}">${l}</button>`).join("")}</div>
        ${d.rep === "parcel" ? `<div class="stack" style="gap:9px;margin-top:9px">
          <label class="tile"><span>Parcelas</span><input id="ceRepN" type="text" inputmode="numeric" value="${d.repN}" style="text-align:right" aria-label="número de parcelas"><span style="width:auto">vezes</span></label>
          <div class="seg c2">${[["total", "O valor é o total"], ["each", "O valor é de cada parcela"]].map(([v, l]) => `<button class="opt ${d.repValue === v ? "on" : ""}" data-repval="${v}">${l}</button>`).join("")}</div>
        </div>` : ""}
        ${d.rep === "repeat" ? `<div class="stack" style="gap:9px;margin-top:9px">
          <div class="seg c3">${[["month", "Todo mês"], ["week", "Toda semana"], ["year", "Todo ano"]].map(([v, l]) => `<button class="opt ${d.repFreq === v ? "on" : ""}" data-repfreq="${v}">${l}</button>`).join("")}</div>
          <div class="seg c2">
            <label class="tile tight"><span>Vezes</span><input id="ceRepTimes" type="text" inputmode="numeric" value="${esc(d.repTimes)}" placeholder="sem limite" style="text-align:right"></label>
            <label class="tile tight"><span>Até</span><input id="ceRepUntil" type="date" value="${esc(d.repUntil)}" aria-label="repetir até"></label>
          </div>
          <div class="sm mut">Vezes e data final são opcionais. A primeira é na data da despesa.</div>
        </div>` : ""}
      </div>`}
      <div><div id="ceCheck"></div><div id="cePreview"></div></div>
      <div class="stack" style="gap:9px">
        <label class="tile"><span>Descrição</span><input id="ceDesc" value="${esc(d.description)}" placeholder="ex.: Mercado, Jantar, Uber"></label>
        <div class="seg c2">
          <label class="tile tight"><span id="ceCatIcon" style="color:var(--accent);display:grid">${icon(catIcon(d.category), 18)}</span><select id="ceCat" aria-label="categoria"><option value="">Categoria</option>${CATEGORIES.map(x => `<option value="${esc(x)}" ${d.category === x ? "selected" : ""}>${esc(catLabel(x))}</option>`).join("")}</select></label>
          <label class="tile tight"><input id="ceDate" type="date" value="${d.spentAt}" aria-label="data"></label>
        </div>
      </div>
    </div></section>
    <div class="savebar"><button class="btn" id="ceSave">${d.editId ? "Salvar alterações" : "Salvar despesa"}</button></div>`;
  $("#ceBack").onclick = () => go("casal");
  app.querySelectorAll("[data-rep]").forEach(el => el.onclick = () => { d.rep = el.dataset.rep; paintCoupleExpense(); });
  app.querySelectorAll("[data-repval]").forEach(el => el.onclick = () => { d.repValue = el.dataset.repval; paintCoupleExpense(); });
  app.querySelectorAll("[data-repfreq]").forEach(el => el.onclick = () => { d.repFreq = el.dataset.repfreq; paintCoupleExpense(); });
  if($("#ceRepN")) $("#ceRepN").oninput = e => { d.repN = e.target.value; refreshCouplePreview(); };
  if($("#ceRepTimes")) $("#ceRepTimes").oninput = e => { d.repTimes = e.target.value; refreshCouplePreview(); };
  if($("#ceRepUntil")) $("#ceRepUntil").oninput = e => { d.repUntil = e.target.value; refreshCouplePreview(); };
  $("#ceSave").onclick = saveCoupleExpense;
  $("#ceDesc").oninput = e => d.description = e.target.value;
  $("#ceCat").onchange = e => { d.category = e.target.value; $("#ceCatIcon").innerHTML = icon(catIcon(d.category), 18); };
  $("#ceDate").oninput = e => { d.spentAt = e.target.value; refreshCouplePreview(); };
  app.querySelectorAll("[data-payer]").forEach(el => el.onclick = () => { d.payer = el.dataset.payer; paintCoupleExpense(); });
  app.querySelectorAll("[data-mode]").forEach(el => el.onclick = () => switchCoupleMode(el.dataset.mode));
  if($("#ceTotal")){
    $("#ceTotal").oninput = e => { d.total = parseMoney(e.target.value); refreshCouplePreview(); };
    if(d.focusValue){ d.focusValue = false; try{ $("#ceTotal").focus({ preventScroll: true }); }catch(_){} }
  }
  app.querySelectorAll("[data-exact]").forEach(inp => inp.oninput = e => { d.exact[inp.dataset.exact] = parseMoney(e.target.value); refreshCouplePreview(); });
  if(d.mode === "item"){
    $("#ceCouvert").oninput = e => { d.couvert = parseMoney(e.target.value); refreshCouplePreview(); };
    $("#ceDisc").oninput = e => { d.discount = parseMoney(e.target.value); refreshCouplePreview(); };
    $("#ceSvc").oninput = e => { d.serviceRate = (parseFloat(String(e.target.value).replace(",", ".")) || 0) / 100; refreshCouplePreview(); };
    $("#ceSvcOn").onclick = () => { d.serviceOn = !d.serviceOn; paintCoupleExpense(); };
    $("#ceManual").onclick = () => { d.items.push({ name: "", qty: 1, unitPrice: 0, consumers: [me.id, other.id] }); paintCoupleExpense(); };
    $("#ceText").onclick = textDialog;
    $("#ceGal").onclick = () => wantPhoto("gal");
    $("#ceCam").onclick = () => wantPhoto("cam");
    app.querySelectorAll(".item[data-i]").forEach(node => {
      const i = +node.dataset.i;
      node.querySelectorAll("[data-f]").forEach(inp => inp.oninput = e => { const f = inp.dataset.f; d.items[i][f] = f === "name" ? e.target.value : parseMoney(e.target.value); refreshCouplePreview(); });
      node.querySelector("[data-rm]").onclick = () => { d.items.splice(i, 1); paintCoupleExpense(); };
      node.querySelectorAll("[data-mid]").forEach(ch => ch.onclick = () => { const id = ch.dataset.mid, a = d.items[i].consumers, k = a.indexOf(id); if(k >= 0) a.splice(k, 1); else a.push(id); ch.classList.toggle("on"); refreshCouplePreview(); });
    });
  }
  refreshCouplePreview();
}
// do rascunho pro plano da série (null = uma vez só). Limites: 2–60 parcelas; até 120 repetições.
function repPlan(d){
  if(d.editId || d.rep === "one") return null;
  if(d.rep === "parcel"){
    const n = Math.floor(Number(String(d.repN).replace(/\D/g, "")) || 0);
    return n >= 2 ? { kind: "parcel", count: Math.min(n, 60), freq: "month", valueIs: d.repValue } : null;
  }
  const times = Math.floor(Number(String(d.repTimes).replace(/\D/g, "")) || 0);
  const byDate = d.repUntil ? countUntil(d.spentAt, d.repFreq, d.repUntil) : 0;
  if(d.repUntil && byDate < 1) return { kind: "repeat", count: 1, freq: d.repFreq, bad: "A data final é antes da primeira." };
  if(times && byDate) return { kind: "repeat", count: Math.min(times, byDate), freq: d.repFreq };
  if(times) return { kind: "repeat", count: Math.min(times, 120), freq: d.repFreq };
  if(byDate) return { kind: "repeat", count: byDate, freq: d.repFreq };
  return { kind: "repeat", count: 12, freq: d.repFreq, open: true };      // sem limite: 12 por vez, com aviso pra continuar
}
// Prévia: mostra o SALDO que fica depois desta despesa — e, entre parênteses, quanto ela mexe.
// (Antes dizia "passa a te dever" com o delta, o que lia como saldo final e estava errado.)
function refreshCouplePreview(){
  const d = CDRAFT, c = getCouple(), me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  const box = $("#cePreview"), chk = $("#ceCheck"); if(!box) return;
  let atom; try{ atom = coupleAtom(d, c); }catch(_){ atom = null; }
  if($("#ceTotalView")) $("#ceTotalView").textContent = money2(atom?.total || 0);
  chk.innerHTML = "";
  if(!atom || !(atom.total > 0)){
    box.className = "preview";
    box.innerHTML = `<div class="sm" style="font-weight:600">${d.mode === "item" ? "Adicione itens com valor pra ver a divisão." : d.mode === "exact" ? "Preencha quanto é de cada um." : "Digite o valor pra ver como fica o saldo."}</div>`;
    return;
  }
  const plan = repPlan(d), list = plan ? expandSeries(atom, plan) : [atom], first = list[0], lastOne = list[list.length - 1];
  const counts = String(first.spentAt || "") <= todayISO();                                    // a primeira já vence hoje (ou antes)?
  const sh = Object.fromEntries(first.shares.map(s => [s.id, s.amount]));
  const base = round2(ledgerBalances(dueLedger(d.editId ? removeEntry(c, d.editId) : c))[me.id] || 0);   // saldo SEM esta despesa
  const n = counts ? round2(entryNet(first)[me.id] || 0) : 0;                                  // quanto mexe AGORA
  const after = round2(base + n);
  const delta = ` <span class="delta">(${signed(n)})</span>`;
  const planLine = !plan ? "" : `<div class="rule"></div><div class="sm" style="font-weight:600">${
    plan.bad ? plan.bad
    : plan.kind === "parcel" ? `${list.length} parcelas de ${brlNB(first.total)}, de ${fmtWhen(first.spentAt)} a ${fmtWhen(lastOne.spentAt)}. Total ${brlNB(list.reduce((t, x) => t + x.total, 0))}.`
    : plan.open ? `${brlNB(first.total)} ${FREQ[plan.freq]}, sem data pra acabar. Programo 12 e aviso quando estiver acabando.`
    : `${brlNB(first.total)} ${FREQ[plan.freq]}, ${list.length} ${list.length === 1 ? "vez" : "vezes"}, até ${fmtWhen(lastOne.spentAt)}.`
  }${plan.bad ? "" : " Cada uma entra no saldo na sua data."}</div>`;
  const effect = !counts ? `Entra no saldo em ${fmtWhen(first.spentAt)}.`
    : Math.abs(n) < 0.005 ? "Não muda o saldo entre vocês."
    : Math.abs(after) < 0.005 ? `Vocês ficam quites${delta}`
    : after > 0 ? `${you} passa a te dever ${brlNB(after)}${delta}`
    : `Você passa a dever ${brlNB(-after)} a ${you}${delta}`;
  if(d.mode === "item" && d.billTotal != null && Math.abs(d.billTotal - atom.total) > 0.05) chk.innerHTML = `<div class="banner warn">Os itens somam ${brlNB(atom.total)}, mas a conta diz ${brlNB(d.billTotal)} — confira se faltou ou repetiu item.</div>`;
  else if(d.mode === "item" && d.billTotal != null) chk.innerHTML = `<div class="banner ok">Bate com o total da conta (${brlNB(d.billTotal)}).</div>`;
  box.className = "preview" + (Math.abs(n) >= 0.005 && after < -0.005 ? " neg" : "");   // tom de alerta só quando a despesa te deixa devendo
  box.innerHTML = `
    <div class="between num sm" style="font-weight:700"><span>Eu ${brlNB(sh[me.id] || 0)}</span><span>${you} ${brlNB(sh[other.id] || 0)}</span></div>
    <div class="rule"></div>
    <div class="effect num">${effect}</div>${planLine}`;
}
async function saveCoupleExpense(){
  const d = CDRAFT, c = getCouple();
  let atom; try{ atom = coupleAtom(d, c); }catch(e){ toast(e?.message || "Não consegui montar a despesa"); return; }
  if(!(atom.total > 0)){ toast(d.mode === "exact" ? "Preencha os valores" : d.mode === "item" ? "Adicione itens com valor" : "Informe o valor"); return; }
  const plan = repPlan(d);
  if(d.rep === "parcel" && !plan){ toast("Diga em quantas parcelas (2 ou mais)"); return; }
  if(plan?.bad){ toast(plan.bad); return; }
  const list = plan ? expandSeries(atom, plan) : [atom];
  if(d.editId){ const old = c.entries.find(x => x.id === d.editId); if(old?.series) atom.series = old.series; }   // editar uma parcela não a tira da série
  const btn = $("#ceSave"); btn.disabled = true; btn.textContent = "Salvando…";
  let done = 0;
  try{
    if(d.editId) await db.updateExpense({ ...toRpcPayload(c.id, atom), id: d.editId });
    else for(const a of list){ if(list.length > 1) btn.textContent = `Salvando ${done + 1}/${list.length}…`; await db.saveExpense(toRpcPayload(c.id, a)); done++; }
    await afterCoupleWrite(d.editId ? "Despesa atualizada ✓" : list.length > 1 ? `${list.length} lançamentos programados ✓` : "Despesa salva ✓");
  }catch(e){
    console.error(e);
    if(done > 0){ toast(`Salvei ${done} de ${list.length} e a conexão caiu. Confira em Programado antes de lançar de novo.`, 7000); try{ await afterCoupleWrite(); }catch(_){} return; }
    toast(e?.message || "Não consegui salvar. Confira a internet.", 5000); btn.disabled = false; btn.textContent = d.editId ? "Salvar alterações" : "Salvar despesa";
  }
}
function applyToCouple(parsed){
  if(!parsed.items?.length){ toast("Não achei itens. Tente manual."); return; }
  const c = getCouple(), ids = [meOf(c).id, otherOf(c).id], d = CDRAFT;
  d.mode = "item";   // foto/texto trazem itens → entra no modo "Por item"
  parsed.items.forEach(p => d.items.push({ name: p.name, qty: p.qty, unitPrice: parseMoney(p.unitPrice ?? p.price ?? 0), consumers: [...ids] }));
  if(parsed.total > 0) d.billTotal = parsed.total;
  if(parsed.service){ d.serviceOn = true; if(parsed.service.rate > 0) d.serviceRate = parsed.service.rate / 100; }
  paintCoupleExpense();
  toast(`${parsed.items.length} ${parsed.items.length > 1 ? "itens" : "item"} lido(s) ✓`);
}

/* ---------- detalhe / acerto ---------- */
function coupleEntryDialog(entryId){
  const c = getCouple(), me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  const e = c.entries.find(x => x.id === entryId); if(!e) return;
  const who = id => id === me.id ? "Você" : you;
  const n = entryNet(e)[me.id] || 0;
  let body, effect;
  if(e.type === "settlement"){
    effect = `Abateu ${brlNB(e.amount)} do saldo.`;
    body = `<div class="dlg-head"><div class="ico">${icon("swap")}</div><div style="min-width:0"><h2>Acerto</h2><div class="sm mut num">${fmtShort(e.spentAt)}</div></div></div>
      <p style="margin:16px 0 0"><b>${who(e.from)}</b> pagou <b class="num">${brlNB(e.amount)}</b> ${e.to === me.id ? "a você" : "a " + you}.</p>`;
  } else {
    effect = Math.abs(n) < 0.005 ? "Não mudou o saldo." : n > 0 ? `${you} ficou te devendo ${brlNB(n)}.` : `Você ficou devendo ${brlNB(-n)} a ${you}.`;
    const items = (e.items || []).map(it => `<div class="listrow"><div style="min-width:0"><div>${esc(it.name || "item")}</div><div class="sm mut num">${Number(it.qty)}× ${brlNB(it.unitPrice)} · ${(it.consumers || []).map(id => who(id)).join(", ") || "os dois"}</div></div><div class="num">${brlNB(Number(it.qty) * Number(it.unitPrice))}</div></div>`).join("");
    const shares = (e.shares || []).map(s => `<div class="listrow"><span>${who(s.id)}</span><span class="b num">${brlNB(s.amount)}</span></div>`).join("");
    const payer = (e.payers || []).map(p => p.id === me.id ? "você" : you).join(" e ");
    body = `<div class="dlg-head"><div class="ico ${tone(n)}">${icon(catIcon(e.category))}</div><div style="min-width:0"><h2>${esc(e.description || "Despesa")}</h2><div class="sm mut num">${fmtShort(e.spentAt)}${e.category ? " · " + esc(catLabel(e.category)) : ""} · pagou ${payer}</div></div></div>
      ${e.note ? `<p class="sm mut" style="margin:12px 0 0">${esc(e.note)}</p>` : ""}
      ${items ? `<h3 style="margin-top:18px">Itens</h3>${items}` : ""}
      <h3 style="margin-top:18px">Quanto é de cada um</h3>${shares}
      <div class="between" style="margin-top:8px"><span class="mut">Total</span><span class="b num">${brlNB(e.total)}</span></div>`;
  }
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd">${body}
    <div class="preview${n < -0.004 && e.type !== "settlement" ? " neg" : ""}" style="margin-top:16px;padding:12px 14px"><div class="effect num">${effect}</div></div>
    ${e.series ? `<p class="sm mut" style="margin:10px 0 0">${e.series.kind === "parcel" ? `Parcela ${e.series.n} de ${e.series.of}` : `Recorrente, ${FREQ[e.series.freq]}${e.series.of ? ` · ${e.series.n} de ${e.series.of}` : ""}`}${String(e.spentAt) > todayISO() ? " · ainda não entrou no saldo" : ""}</p>` : ""}
    <div class="row" style="margin-top:16px" id="cdRow"><button class="btn sec grow" id="cdClose">Fechar</button>${e.type === "expense" ? `<button class="btn grow" id="cdEdit">Editar</button>` : ""}<button class="btn danger" id="cdDel">Excluir</button></div>
  </div>`;
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#cdClose").onclick = close;
  if(dlg.querySelector("#cdEdit")) dlg.querySelector("#cdEdit").onclick = () => { close(); go(`casal/e/${e.id}`); };
  const rest = e.series ? c.entries.filter(x => x.series?.id === e.series.id && x.series.n >= e.series.n) : [];
  const wipe = async list => {
    try{ for(const x of list) await (x.type === "settlement" ? db.deleteSettlement(x.id) : db.deleteExpense(x.id)); close(); await afterCoupleWrite(list.length > 1 ? `${list.length} lançamentos excluídos` : "Excluído"); }
    catch(err){ console.error(err); toast(err?.message || "Não consegui excluir", 5000); try{ await loadCouple(); }catch(_){} }
  };
  dlg.querySelector("#cdDel").onclick = async () => {
    if(rest.length > 1){                                 // faz parte de uma série: só esta, ou esta e as que vêm depois?
      dlg.querySelector("#cdRow").outerHTML = `<div class="stack" style="gap:8px;margin-top:16px">
        <button class="btn danger block" id="cdOne">Excluir só esta</button>
        <button class="btn danger block" id="cdRest">Excluir esta e ${rest.length === 2 ? "a seguinte" : `as ${rest.length - 1} seguintes`}</button>
        <button class="btn sec block" id="cdKeep">Cancelar</button></div>`;
      dlg.querySelector("#cdOne").onclick = () => wipe([e]);
      dlg.querySelector("#cdRest").onclick = () => wipe(rest);
      dlg.querySelector("#cdKeep").onclick = close;
      return;
    }
    if(!confirm("Excluir este lançamento? Some pra vocês dois.")) return;
    wipe([e]);
  };
}
function coupleSettleDialog(){
  const c = getCouple(), me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  const t = coupleSummary(dueLedger(c)); if(!t){ toast("Vocês estão quites ✓"); return; }   // acerta só o que já venceu
  const iPay = t.from === me.id, receiver = iPay ? other : me;
  let payload = "";
  if(receiver.pix?.key){ try{ payload = buildPixPayload({ key: receiver.pix.key, name: receiver.pix.name || receiver.name, city: "BRASIL", amount: t.amount, description: "Racha" }); }catch(_){ payload = ""; } }
  const pixBlock = payload
    ? `<p class="sm mut" style="margin:0 0 4px">Pix de <b>${esc(receiver.name)}</b></p><div class="qr" id="stQr"></div><div class="pix-box">${esc(payload)}</div><button class="btn sec block" id="stCopy" style="margin-top:10px">Copiar código Pix</button>`
    : `<div class="banner warn" style="margin:0">${iPay ? you + " não tem" : "Você não tem"} chave Pix cadastrada — dá pra cadastrar tocando no nome do casal. Ou acertem por fora e marquem como pago.</div>`;
  const nudge = `Oi! Nosso racha fechou em *${brl(t.amount)}* pra você me acertar 🙂` + (me.pix?.key ? `\nMeu Pix: ${me.pix.key}` : "");
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd">
    <div class="sm mut" style="font-weight:600">${iPay ? `Você paga ${you}` : `${you} te paga`}</div>
    <div class="settle-amount num">${brlNB(t.amount)}</div>
    ${pixBlock}
    ${!iPay ? `<a class="btn sec block" style="margin-top:10px" target="_blank" href="https://wa.me/?text=${encodeURIComponent(nudge)}">Cobrar no WhatsApp</a>` : ""}
    <div class="row" style="margin-top:16px"><button class="btn grow" id="stDone">Marcar como pago</button><button class="btn sec" id="stClose">Fechar</button></div>
  </div>`;
  dlg.showModal();
  if(payload){
    try{ const qr = qrcode(0, "M"); qr.addData(payload); qr.make(); dlg.querySelector("#stQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 }); }catch(_){ dlg.querySelector("#stQr")?.remove(); }
    dlg.querySelector("#stCopy").onclick = () => copy(payload);
  }
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#stClose").onclick = close;
  dlg.querySelector("#stDone").onclick = async () => {
    dlg.querySelector("#stDone").disabled = true;
    try{ await db.addSettlement({ groupId: c.id, from: t.from, to: t.to, amount: t.amount }); close(); await afterCoupleWrite("Acerto registrado ✓"); }
    catch(err){ console.error(err); toast(err?.message || "Não consegui registrar", 5000); dlg.querySelector("#stDone").disabled = false; }
  };
}

/* ---------- ponte: guardar a parte do casal de uma conta rachada na mesa ---------- */
async function saveCalcToCouple(){
  const r = calcSplit();
  if(r.total <= 0){ toast("Adicione itens com valor primeiro"); return; }
  if(CALC.people.length < 1){ toast("Adicione as pessoas primeiro"); return; }
  if(!ME){ toast("Entre na aba Casal primeiro"); return go("casal"); }
  let c = getCouple();
  if(!c){ try{ c = await loadCouple(); }catch(e){ console.error(e); toast("Sem conexão com o servidor"); return; } }
  if(!c || c.people.length < 2){ toast("Configure o casal primeiro"); return go("casal"); }
  const me = meOf(c), other = otherOf(c), you = esc(firstName(other.name));
  const guess = name => (CALC.people.find(p => norm(p.name) === norm(name)) || CALC.people.find(p => norm(p.name) === norm(firstName(name))))?.id || "";
  const opts = sel => `<option value="">— não está na mesa —</option>` + CALC.people.map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd">
    <div class="dlg-head"><div class="ico pos">${icon("heart")}</div><div><h2>Guardar no casal</h2></div></div>
    <p class="sm mut" style="margin:10px 0 14px">Só a parte de vocês dois entra no saldo do casal. O resto da mesa acerta por fora.</p>
    <label class="fld"><span>Na mesa, você é</span><select id="scMe">${opts(guess(me.name))}</select></label>
    <label class="fld"><span>Na mesa, ${you} é</span><select id="scOther">${opts(guess(other.name))}</select></label>
    <label class="fld"><span>Quem pagou a conta</span><select id="scPayer"><option value="${me.id}">Eu</option><option value="${other.id}">${you}</option></select></label>
    <label class="fld"><span>Descrição</span><input id="scDesc" value="Conta na mesa"></label>
    <div class="row" style="margin-top:6px"><button class="btn grow" id="scOk">Guardar</button><button class="btn sec" id="scCancel">Cancelar</button></div>
  </div>`;
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#scCancel").onclick = close;
  dlg.querySelector("#scOk").onclick = async () => {
    const meCalc = dlg.querySelector("#scMe").value, otherCalc = dlg.querySelector("#scOther").value;
    if(meCalc && otherCalc && meCalc === otherCalc){ toast("Escolha pessoas diferentes"); return; }
    const myShare = meCalc ? round2(r.shares[meCalc] || 0) : 0, herShare = otherCalc ? round2(r.shares[otherCalc] || 0) : 0;
    if(myShare + herShare <= 0){ toast("Vocês dois não têm consumo nessa conta"); return; }
    const atom = buildExpense({
      description: dlg.querySelector("#scDesc").value.trim() || "Conta na mesa", category: "🍽️ Comida", spentAt: todayISO(),
      method: "exact", participants: [me.id, other.id], exact: { [me.id]: myShare, [other.id]: herShare },
      payers: dlg.querySelector("#scPayer").value,
      note: `Mesa com ${CALC.people.length} ${CALC.people.length === 1 ? "pessoa" : "pessoas"} · conta ${brl(r.total)}`,
    });
    dlg.querySelector("#scOk").disabled = true;
    try{ await db.saveExpense(toRpcPayload(c.id, atom)); await loadCouple(); close(); toast("Guardado no casal ✓"); go("casal"); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui guardar", 5000); dlg.querySelector("#scOk").disabled = false; }
  };
}

/* ====================================================================== */
/* ============================ ABA GRUPOS ============================ */
/* ====================================================================== */
function renderNeedConfig(err){
  app.innerHTML = `<div class="card">
    <h2>Ative os Grupos</h2>
    <div class="banner ok">Te convidaram pra um grupo? Abra o <b>link de convite</b> que te mandaram — ele já vem configurado, é só fazer login.</div>
    <p class="mut">Pra <b>criar</b> seus próprios grupos e guardar quem deve quem, conecte um back-end grátis (Supabase) uma vez (depois, quem você convidar não precisa fazer nada disso):</p>
    <ol class="sm mut" style="padding-left:18px">
      <li>Crie um projeto em <b>supabase.com</b>.</li>
      <li>No SQL Editor, rode <code>supabase/migrations/0001_init.sql</code>.</li>
      <li>Em Project Settings → API, copie a <b>URL</b> e a chave <b>anon</b>.</li>
      <li>Toque em <b>⚙</b> e cole as duas.</li>
    </ol>
    ${err ? `<div class="banner warn">${esc(err)}</div>` : ""}
    <button class="btn block" id="ncOpen">Abrir configurações</button>
  </div>`;
  $("#ncOpen").onclick = openCfg;
}
function authError(e){
  let s = (e && typeof e.message === "string") ? e.message : "";
  if(s === "{}") s = "";
  const low = s.toLowerCase();
  const status = e?.status || e?.statusCode || e?.code;
  if(/rate limit|too many|429/.test(low) || status === 429) return "Muitos pedidos seguidos. Espere ~1 min e tente de novo.";
  if(/sending|smtp|magic link email|confirmation email/.test(low) || status === 500 || status === 502 || status === 504 || !s)
    return "O Supabase não conseguiu ENVIAR o e-mail — quase sempre é o SMTP recusando. Veja Logs → Auth (erro 535 = senha de app errada). Pra logar já: desligue o 'custom SMTP' e use o link.";
  return s;
}
function renderLogin(where){
  app.innerHTML = `<div class="card">
    <h2>${where === "casal" ? "Entrar no Casal" : "Entrar nos Grupos"}</h2>
    <p class="mut">${where === "casal" ? "As contas de vocês dois ficam guardadas na nuvem, iguais em qualquer aparelho. " : ""}Coloque seu e-mail; mandamos um link de acesso. Sem senha.</p>
    ${INIT_ERR ? `<div class="banner warn">${esc(INIT_ERR)}</div>` : ""}
    <label class="fld"><span>Seu e-mail</span><input id="loginEmail" type="email" inputmode="email" placeholder="voce@email.com" autocomplete="email"></label>
    <button class="btn block" id="loginBtn">Enviar acesso por e-mail</button>
    <p class="sm mut" id="loginMsg" style="margin-top:10px"></p>
    <div id="codeBox" style="display:none;margin-top:6px">
      <label class="fld"><span>Veio um código de 6 dígitos? Digite aqui</span><input id="loginCode" inputmode="numeric" autocomplete="one-time-code" placeholder="••••••"></label>
      <button class="btn block sec" id="codeBtn">Confirmar código</button>
    </div>
  </div>`;
  let sentEmail = "";
  const send = async () => {
    const email = $("#loginEmail").value.trim();
    if(!/.+@.+\..+/.test(email)){ toast("E-mail inválido"); return; }
    $("#loginBtn").disabled = true; $("#loginMsg").textContent = "Enviando…";
    try{ if(where === "casal") localStorage.setItem("racha.after", "casal"); else localStorage.removeItem("racha.after"); }catch(_){}
    if(!(await ensureInit())){ $("#loginMsg").textContent = INIT_ERR || "Não consegui conectar ao Supabase."; $("#loginBtn").disabled = false; return; }
    try{
      await db.sendMagicLink(email); sentEmail = email;
      $("#loginMsg").innerHTML = `Enviado pra <b>${esc(email)}</b>. Abra o e-mail e toque em <b>Sign in</b>. Pode ser em qualquer navegador ou aparelho. Confira também o spam.
        <br><a class="link" id="showCode">O e-mail trouxe um código de 6 dígitos?</a>`;
      $("#showCode").onclick = () => { $("#codeBox").style.display = "block"; $("#showCode").remove(); };
    }catch(e){ console.error(e); $("#loginMsg").textContent = authError(e); }
    finally{ $("#loginBtn").disabled = false; }
  };
  const verify = async () => {
    const code = $("#loginCode").value.replace(/\D/g, "");
    if(code.length < 6){ toast("Digite os 6 dígitos"); return; }
    $("#codeBtn").disabled = true; $("#loginMsg").textContent = "Conferindo…";
    try{ await db.verifyCode(sentEmail || $("#loginEmail").value, code); /* onAuthChange cuida do redirecionamento */ }
    catch(e){ console.error(e); $("#loginMsg").textContent = "Código inválido ou expirado. Peça outro."; $("#codeBtn").disabled = false; }
  };
  $("#loginBtn").onclick = send;
  $("#loginEmail").addEventListener("keydown", e => { if(e.key === "Enter") send(); });
  $("#codeBtn").onclick = verify;
  $("#loginCode").addEventListener("keydown", e => { if(e.key === "Enter") verify(); });
}

async function renderGroups(){
  loading("Buscando seus grupos…");
  let groups;
  try{ groups = await db.myGroups(); }catch(e){ return renderNeedConfig(e?.message); }
  const bals = await Promise.all(groups.map(g => db.balances(g.id).catch(() => [])));
  const nets = groups.map((g, i) => { const mine = bals[i].find(r => r.user_id === ME?.id); return { g, net: Number(mine?.net || 0) }; });
  const recv = nets.filter(x => x.net > 0.005).reduce((s, x) => s + x.net, 0);
  const pay  = nets.filter(x => x.net < -0.005).reduce((s, x) => s - x.net, 0);
  const summary = groups.length ? `
    <div class="card">
      <h2 style="margin:0 0 .5em">No total</h2>
      <div class="grid2">
        <div><div class="sm mut">a receber</div><div class="b" style="font-size:20px;color:var(--okink)">${brl(recv)}</div></div>
        <div><div class="sm mut">a pagar</div><div class="b" style="font-size:20px;color:var(--warn)">${brl(pay)}</div></div>
      </div>
    </div>` : "";
  const row = ({ g, net }, friend) => {
    const cls = Math.abs(net) < 0.005 ? "zero" : net > 0 ? "pos" : "neg";
    const txt = Math.abs(net) < 0.005 ? "quite" : (net > 0 ? "recebe " : "deve ") + brl(Math.abs(net));
    return `<div class="listrow" data-g="${g.id}" style="cursor:pointer">
      <div class="row">${avatar(g.name)}<div><div class="b">${esc(g.name)}</div><div class="sm mut">${friend ? "amigo" : esc(g.currency||"BRL")}</div></div></div>
      <span class="pill ${cls}">${txt}</span></div>`;
  };
  const gNets = nets.filter(x => x.g.kind !== "friend" && x.g.kind !== "couple"), fNets = nets.filter(x => x.g.kind === "friend");
  const gList = gNets.length ? gNets.map(x => row(x, false)).join("") : `<div class="empty">Nenhum grupo ainda.</div>`;
  const fCard = fNets.length ? `<div class="card"><h3 style="margin:0 0 .4em">Amigos</h3>${fNets.map(x => row(x, true)).join("")}</div>` : "";
  app.innerHTML = `
    ${summary}
    <div class="card"><h3 style="margin:0 0 .4em">Seus grupos</h3>${gList}</div>
    ${fCard}
    <div class="card"><h3>Novo grupo</h3>
      <div class="row"><input id="ngName" placeholder="ex.: República, Viagem, Happy hour"><button class="btn" id="ngBtn">Criar</button></div>
    </div>
    <div class="card"><h3>Novo amigo (1 a 1)</h3>
      <p class="sm mut" style="margin:.2em 0">Pra dividir com uma pessoa sem criar grupo. Depois dá pra convidar ela pelo link.</p>
      <div class="row"><input id="nfName" placeholder="nome do amigo"><button class="btn" id="nfBtn">Add</button></div>
    </div>`;
  app.querySelectorAll("[data-g]").forEach(r => r.onclick = () => go(`g/${r.dataset.g}`));
  $("#ngBtn").onclick = async () => {
    const name = $("#ngName").value.trim(); if(!name){ toast("Dê um nome ao grupo"); return; }
    $("#ngBtn").disabled = true;
    try{ const g = await db.createGroup(name); go(`g/${g.id}`); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui criar"); $("#ngBtn").disabled = false; }
  };
  $("#nfBtn").onclick = async () => {
    const name = $("#nfName").value.trim(); if(!name){ toast("Diga o nome do amigo"); return; }
    $("#nfBtn").disabled = true;
    try{ const g = await db.createFriend(name); go(`g/${g.id}`); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui criar"); $("#nfBtn").disabled = false; }
  };
}

let liveTimer = null;
async function renderGroup(groupId, silent){
  if(!silent) loading("Abrindo o grupo…");            // silent = conferência de fundo: troca o conteúdo sem piscar
  let group, members, bal, expenses, activity = [];
  try{
    [members, bal, expenses, activity] = await Promise.all([
      db.groupMembers(groupId), db.balances(groupId), db.listExpenses(groupId), db.groupActivity(groupId).catch(() => []),
    ]);
    group = { id: groupId, name: (await db.groupNameOf(groupId)) || "Grupo" };
  }catch(e){ console.error(e); return renderNeedConfig(e?.message); }

  const myId = members.find(m => m.user_id === ME?.id)?.id;
  const balRows = bal.slice().sort((a,b) => b.net - a.net).map(m => {
    const n = Number(m.net), cls = Math.abs(n) < 0.005 ? "zero" : n > 0 ? "pos" : "neg";
    const txt = Math.abs(n) < 0.005 ? "quite" : (n > 0 ? "recebe " : "deve ") + brl(Math.abs(n));
    const nudge = (n < -0.005 && m.id !== myId) ? `<a class="link sm" data-nudge="${m.id}">cobrar</a>` : "";
    return `<div class="listrow"><div class="row">${avatar(m.display_name)}<span class="b">${esc(m.display_name)}</span>${m.user_id?"":'<span class="pill zero">fantasma</span>'}</div><div class="row" style="gap:8px"><span class="pill ${cls}">${txt}</span>${nudge}</div></div>`;
  }).join("");
  const expList = expenses.length ? expenses.map(e => `
    <div class="listrow" data-exp="${e.id}" style="cursor:pointer">
      <div><div class="b">${esc(e.description || "Despesa")}</div><div class="sm mut">${fmtDate(e.spent_at)}${e.place?" · "+esc(e.place):""}</div></div>
      <div class="b">${brl(e.total)}</div></div>`).join("") : `<div class="empty">Sem despesas. Adicione a primeira.</div>`;
  const actIcon = { expense: "🧾", settle: "💸", join: "👋" };
  const actText = ev => ev.kind === "expense" ? `<b>${esc(ev.who)}</b> adicionou “${esc(ev.desc || "despesa")}” · ${brl(ev.total)}`
    : ev.kind === "settle" ? `<b>${esc(ev.from)}</b> pagou ${brl(ev.amount)} a <b>${esc(ev.to)}</b>`
    : `<b>${esc(ev.who)}</b> entrou no grupo`;
  const actList = activity.length ? activity.slice(0, 12).map(ev =>
    `<div class="listrow"><div class="row"><span style="font-size:17px">${actIcon[ev.kind] || "•"}</span><div><div class="sm">${actText(ev)}</div><div class="sm mut">${timeAgo(ev.at)}</div></div></div></div>`).join("") : `<div class="empty">Sem atividade ainda.</div>`;

  app.innerHTML = `
    <div class="card">
      <div class="between"><a class="link" href="#grupos">← grupos</a><a class="link" id="gMembers">membros (${members.length})</a></div>
      <h2 style="margin:.3em 0 0">${esc(group.name)}</h2>
    </div>
    <div class="card">
      <div class="between"><h3 style="margin:0">Saldo</h3><a class="link" id="gSettle">acertar →</a></div>
      ${balRows || `<div class="empty">Adicione membros e uma despesa.</div>`}
    </div>
    <div class="card"><div class="between"><h3 style="margin:0">Despesas</h3>${expenses.length?`<a class="link" id="gExport">exportar CSV</a>`:""}</div>${expList}</div>
    <div class="card"><h3>Atividade</h3>${actList}</div>
    <button class="btn block fab" id="gNew">+ Nova despesa</button>`;
  if($("#gExport")) $("#gExport").onclick = () => exportGroupCSV(groupId, group.name, members);
  $("#gNew").onclick = () => go(`g/${groupId}/new`);
  $("#gSettle").onclick = () => go(`g/${groupId}/settle`);
  $("#gMembers").onclick = () => membersDialog(groupId, members);
  app.querySelectorAll("[data-exp]").forEach(r => r.onclick = () => expenseDialog(r.dataset.exp, groupId));
  app.querySelectorAll("[data-nudge]").forEach(a => a.onclick = () => {
    const m = bal.find(x => x.id === a.dataset.nudge); if(!m) return;
    let msg = `Oi! Passando pra lembrar do nosso *${group.name}*: você está com *${brl(Math.abs(Number(m.net)))}* a acertar. 🙂`;
    if(PROFILE?.pix_key) msg += `\nSe for comigo, meu Pix: ${PROFILE.pix_key}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  });
  // atualização ao vivo: quando alguém mexe no grupo, recarrega (debounced) se ainda estou nele
  const here = () => location.hash.replace(/^#\/?/, "") === `g/${groupId}`;
  if(!here()) return;                                  // saiu da tela enquanto carregava
  REFRESH = async () => { if(here()) await renderGroup(groupId, true); };
  if(!LIVE) LIVE = db.subscribeGroup(groupId, () => { clearTimeout(liveTimer); liveTimer = setTimeout(softRefresh, 400); });
}
function timeAgo(at){
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if(s < 60) return "agora";
  if(s < 3600) return `há ${Math.floor(s/60)} min`;
  if(s < 86400) return `há ${Math.floor(s/3600)} h`;
  if(s < 604800) return `há ${Math.floor(s/86400)} d`;
  return fmtDate(at);
}
async function exportGroupCSV(groupId, groupName, members){
  let rows;
  try{ rows = await db.groupExport(groupId); }catch(e){ console.error(e); toast("Não consegui exportar"); return; }
  if(!rows.length){ toast("Sem despesas pra exportar"); return; }
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const nameOf = id => members.find(m => m.id === id)?.display_name || "?";
  const head = ["Data", "Descrição", "Categoria", "Local", "Total", "Pago por", ...members.map(m => m.display_name)];
  const lines = [head.map(q).join(",")];
  rows.forEach(r => {
    const paid = (r.payers || []).map(p => `${nameOf(p.member_id)}: ${Number(p.amount).toFixed(2)}`).join("; ");
    const by = {}; (r.shares || []).forEach(s => { by[s.member_id] = Number(s.amount).toFixed(2); });
    const line = [r.spent_at, r.description || "", r.category || "", r.place || "", Number(r.total).toFixed(2), paid, ...members.map(m => by[m.id] || "")];
    lines.push(line.map(q).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });   // BOM + CRLF: Excel abre com acento
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `racha-${(groupName || "grupo").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("CSV baixado ✓");
}

function inviteLink(groupId){
  const cfg = db.getSbConfig();
  const base = location.origin + location.pathname;
  const q = cfg ? `?s=${encodeURIComponent(cfg.url)}&k=${encodeURIComponent(cfg.anon)}` : "";
  return base + q + "#join/" + groupId;   // o link já leva a conexão: o convidado só faz login
}
async function membersDialog(groupId, members){
  const dlg = document.createElement("dialog");
  const link = inviteLink(groupId);
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>Membros</h2>
    <div>${members.map(m => `<div class="listrow"><div class="row">${avatar(m.display_name)}<span>${esc(m.display_name)}</span>${m.user_id?"":'<span class="pill zero">fantasma</span>'}</div>${m.user_id===ME?.id?"":`<a class="link" data-del="${m.id}">remover</a>`}</div>`).join("")}</div>
    <h3 style="margin-top:14px">Adicionar pessoa (sem conta)</h3>
    <div class="row"><input id="mName" placeholder="nome"><button class="btn sm" id="mAdd">Add</button></div>
    <h3 style="margin-top:14px">Convidar por link</h3>
    <p class="sm mut" style="margin:.2em 0">Quem abrir entra no grupo e pode marcar "esse sou eu".</p>
    <div class="pix-box">${esc(link)}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm grow" id="mCopy">Copiar link</button>
      <a class="btn sm sec grow" style="text-align:center;text-decoration:none" target="_blank" href="https://wa.me/?text=${encodeURIComponent("Entra no nosso racha: " + link)}">WhatsApp</a></div>
    <button class="btn sec block" style="margin-top:14px" id="mClose">Fechar</button>
  </div>`;
  document.body.appendChild(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#mClose").onclick = close;
  dlg.querySelector("#mCopy").onclick = () => copy(link);
  dlg.querySelector("#mAdd").onclick = async () => { const n = dlg.querySelector("#mName").value.trim(); if(!n) return; await guard(() => db.addGhost(groupId, n), "Não consegui adicionar"); close(); renderGroup(groupId); };
  dlg.querySelectorAll("[data-del]").forEach(a => a.onclick = async () => { if(!confirm("Remover do grupo?")) return; await guard(() => db.removeMember(a.dataset.del), "Não consegui remover"); close(); renderGroup(groupId); });
}

async function expenseDialog(expId, groupId){
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd"><div class="spin"></div></div>`; dlg.showModal();
  let e, members, comments = [];
  try{ [e, members, comments] = await Promise.all([ db.getExpense(expId), db.groupMembers(groupId), db.expenseComments(expId).catch(() => []) ]); }
  catch(err){ dlg.close(); dlg.remove(); toast("Não consegui abrir a despesa"); return; }
  const nameOf = id => members.find(m => m.id === id)?.display_name || "?";
  const nameOfUser = uid => members.find(m => m.user_id === uid)?.display_name || "Alguém";
  const commentHtml = list => list.length
    ? list.map(c => `<div class="listrow" style="align-items:flex-start"><div><div class="sm"><b>${esc(nameOfUser(c.user_id))}</b> <span class="mut">${timeAgo(c.created_at)}</span></div><div class="sm">${esc(c.body)}</div></div>${c.user_id===ME?.id?`<a class="link sm" data-delc="${c.id}">apagar</a>`:""}</div>`).join("")
    : `<p class="sm mut">Sem comentários.</p>`;
  const items = (e.items||[]).map(it => `<div class="listrow"><div><div>${esc(it.name||"item")}</div><div class="sm mut">${Number(it.qty)}× ${brl(it.unit_price)} · ${(it.shares||[]).map(s=>esc(nameOf(s.member_id))).join(", ")||"todos"}</div></div><div>${brl(Number(it.qty)*Number(it.unit_price))}</div></div>`).join("");
  const payers = (e.payers||[]).map(p => `${esc(nameOf(p.member_id))} ${brl(p.amount)}`).join(", ");
  const shares = (e.shares||[]).map(s => `<div class="listrow"><span>${esc(nameOf(s.member_id))}</span><span class="b">${brl(s.amount)}</span></div>`).join("");
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>${esc(e.description||"Despesa")}</h2>
    <p class="sm mut" style="margin-top:0">${fmtDate(e.spent_at)}${e.category?" · "+esc(e.category):""}${e.place?" · "+esc(e.place):""} · pago por ${payers||"—"}</p>
    ${e.note ? `<p class="sm" style="margin-top:-4px">“${esc(e.note)}”</p>` : ""}
    <h3>Itens</h3>${items||'<p class="sm mut">sem itens</p>'}
    <h3 style="margin-top:12px">Quanto cada um deve</h3>${shares}
    <div class="between" style="margin-top:8px"><span class="mut">Total</span><span class="b">${brl(e.total)}</span></div>
    ${e.receipt ? `<h3 style="margin-top:12px">Recibo</h3><img src="${e.receipt}" alt="recibo" style="max-width:100%;border-radius:10px">` : ""}
    <h3 style="margin-top:14px">Comentários</h3>
    <div id="eComments">${commentHtml(comments)}</div>
    <div class="row" style="margin-top:8px"><input id="eCmt" placeholder="escrever um comentário…" class="grow"><button class="btn sm" id="eCmtBtn">Enviar</button></div>
    <button class="btn sec block" id="eRepeat" style="margin-top:14px">↻ Repetir esta despesa (hoje)</button>
    <div class="row" style="margin-top:10px"><button class="btn sec grow" id="eClose">Fechar</button><button class="btn grow" id="eEdit">Editar</button><button class="btn" id="eDel" style="background:var(--danger)">Excluir</button></div>
  </div>`;
  const close = () => { dlg.close(); dlg.remove(); };
  const repeat = async () => {
    const payload = {
      group_id: groupId, description: e.description || "Despesa", place: e.place || null, spent_at: todayISO(),
      category: e.category || null, note: e.note || null, receipt: null,
      subtotal: Number(e.subtotal)||0, service_rate: Number(e.service_rate)||0, service_amount: Number(e.service_amount)||0,
      couvert: Number(e.couvert)||0, discount: Number(e.discount)||0, total: Number(e.total)||0,
      items: (e.items||[]).map((it, i) => ({ name: it.name || "item", qty: Number(it.qty)||1, unit_price: Number(it.unit_price)||0, position: i, shares: (it.shares||[]).map(s => ({ member_id: s.member_id, weight: Number(s.weight)||1 })) })),
      payers: (e.payers||[]).map(p => ({ member_id: p.member_id, amount: Number(p.amount)||0 })),
      shares: (e.shares||[]).map(s => ({ member_id: s.member_id, amount: Number(s.amount)||0 })),
    };
    await guard(() => db.saveExpense(payload), "Não consegui repetir");
    close(); toast("Despesa repetida (hoje) ✓"); renderGroup(groupId);
  };
  const wireDelC = () => dlg.querySelectorAll("[data-delc]").forEach(a => a.onclick = async () => { await guard(() => db.deleteComment(a.dataset.delc), "Não consegui apagar"); refreshComments(); });
  const refreshComments = async () => { const list = await db.expenseComments(expId).catch(() => []); dlg.querySelector("#eComments").innerHTML = commentHtml(list); wireDelC(); };
  const sendComment = async () => {
    const inp = dlg.querySelector("#eCmt"), body = inp.value.trim(); if(!body) return;
    dlg.querySelector("#eCmtBtn").disabled = true;
    try{ await db.addComment(expId, body); inp.value = ""; await refreshComments(); }
    catch(err){ toast(err?.message || "Não consegui comentar (rodou o 0003?)", 4500); }
    finally{ dlg.querySelector("#eCmtBtn").disabled = false; }
  };
  dlg.querySelector("#eClose").onclick = close;
  dlg.querySelector("#eEdit").onclick = () => { close(); go(`g/${groupId}/e/${expId}`); };
  dlg.querySelector("#eDel").onclick = async () => { if(!confirm("Excluir esta despesa?")) return; await guard(() => db.deleteExpense(expId), "Não consegui excluir"); close(); renderGroup(groupId); };
  dlg.querySelector("#eRepeat").onclick = repeat;
  dlg.querySelector("#eCmtBtn").onclick = sendComment;
  dlg.querySelector("#eCmt").addEventListener("keydown", ev => { if(ev.key === "Enter") sendComment(); });
  wireDelC();
}

let DRAFT = null, MEMBERS = [];
const CATEGORIES = ["🍽️ Comida", "🍺 Bar/Boteco", "🛒 Mercado", "🏠 Casa", "🚗 Transporte", "✈️ Viagem", "🎉 Lazer", "💊 Saúde", "🧾 Contas", "🎁 Outros"];
async function renderNewExpense(groupId){
  loading("Preparando…");
  try{ MEMBERS = await db.groupMembers(groupId); }catch(e){ return renderNeedConfig(e?.message); }
  if(MEMBERS.length === 0){ toast("Adicione membros ao grupo primeiro"); return renderGroup(groupId); }
  const allIds = MEMBERS.map(m => m.id);
  const meMember = MEMBERS.find(m => m.user_id === ME?.id);
  DRAFT = { groupId, editId: null, description: "", place: "", spent_at: todayISO(), payer: (meMember || MEMBERS[0]).id,
            multiPayer: false, payAmt: {}, mode: "equal", total: 0, among: [...allIds], exact: {}, pct: {}, parts: {},
            items: [], serviceOn: false, serviceRate: 0.10, couvert: 0, discount: 0, billTotal: null,
            category: "", note: "", receipt: null, allIds };
  paintNewExpense();
}
async function renderEditExpense(groupId, expId){
  loading("Abrindo pra editar…");
  let e, members;
  try{ [e, members] = await Promise.all([ db.getExpense(expId), db.groupMembers(groupId) ]); }
  catch(err){ console.error(err); toast("Não consegui abrir a despesa"); return go(`g/${groupId}`); }
  MEMBERS = members;
  const allIds = members.map(m => m.id);
  const hasItems = (e.items || []).length > 0;
  const meMember = members.find(m => m.user_id === ME?.id);
  const payerRows = e.payers || [];
  DRAFT = {
    groupId, editId: e.id, description: e.description || "", place: e.place || "", spent_at: e.spent_at || todayISO(),
    payer: payerRows[0]?.member_id || (meMember || members[0]).id,
    multiPayer: payerRows.length > 1, payAmt: Object.fromEntries(payerRows.map(p => [p.member_id, Number(p.amount) || 0])),
    mode: hasItems ? "items" : "exact",
    total: Number(e.total) || 0, among: [...allIds], exact: {}, pct: {}, parts: {},
    items: (e.items || []).slice().sort((a, b) => a.position - b.position)
             .map(it => ({ name: it.name || "", qty: Number(it.qty) || 1, unitPrice: Number(it.unit_price) || 0, consumers: (it.shares || []).map(s => s.member_id) })),
    serviceOn: Number(e.service_rate) > 0, serviceRate: Number(e.service_rate) || 0.10,
    couvert: Number(e.couvert) || 0, discount: Number(e.discount) || 0, billTotal: null,
    category: e.category || "", note: e.note || "", receipt: e.receipt || null, allIds,
  };
  (e.shares || []).forEach(s => { DRAFT.exact[s.member_id] = Number(s.amount) || 0; });   // modo Valores reproduz o rateio salvo
  paintNewExpense();
}
function paintNewExpense(){
  const d = DRAFT;
  ITEM_SINK = applyToDraft;
  const memChips = ids => MEMBERS.map(m => `<span class="chip ${ids.includes(m.id)?"on":""}" data-mid="${m.id}">${esc(m.display_name)}</span>`).join("");
  const modeTab = (key, label) => `<span class="chip ${d.mode===key?"on":""}" data-mode="${key}">${label}</span>`;

  let panel = "";
  const totalField = `<label class="fld"><span>Valor total (R$)</span><input id="neTotal" type="number" inputmode="decimal" value="${d.total||""}" step="0.01" placeholder="0,00"></label>`;
  if(d.mode === "equal"){
    panel = `${totalField}
      <div class="sm mut" style="margin:8px 0 4px">Dividir igual entre — toque pra incluir/tirar:</div>
      <div class="row wrap" style="gap:6px">${MEMBERS.map(m => `<span class="chip ${d.among.includes(m.id)?"on":""}" data-among="${m.id}">${esc(m.display_name)}</span>`).join("")}</div>`;
  } else if(d.mode === "pct"){
    panel = `${totalField}
      <div class="sm mut" style="margin:8px 0 4px">Porcentagem de cada um (deve somar 100%):</div>
      ${MEMBERS.map(m => `<label class="fld"><span>${esc(m.display_name)}</span><div class="row"><input data-pct="${m.id}" type="number" inputmode="decimal" value="${d.pct[m.id] ?? ""}" step="1" style="width:96px" placeholder="0"><span class="mut">%</span></div></label>`).join("")}`;
  } else if(d.mode === "parts"){
    panel = `${totalField}
      <div class="sm mut" style="margin:8px 0 4px">Partes de cada um (ex.: 2 e 1 → o primeiro paga o dobro):</div>
      ${MEMBERS.map(m => `<label class="fld"><span>${esc(m.display_name)}</span><input data-parts="${m.id}" type="number" inputmode="decimal" value="${d.parts[m.id] ?? ""}" step="1" min="0" style="width:96px" placeholder="0"></label>`).join("")}`;
  } else if(d.mode === "exact"){
    panel = `<div class="sm mut" style="margin-bottom:8px">Quanto cada um deve (deixe em branco quem não entra):</div>
      ${MEMBERS.map(m => `<label class="fld"><span>${esc(m.display_name)}</span><input data-exact="${m.id}" type="number" inputmode="decimal" value="${d.exact[m.id] ?? ""}" step="0.01" placeholder="0,00"></label>`).join("")}`;
  } else {
    const itemsHtml = d.items.map((it, i) => `
      <div class="item" data-i="${i}">
        <div class="row" style="gap:8px">
          <input data-f="name" value="${esc(it.name)}" placeholder="item" class="grow">
          <input data-f="qty" type="number" inputmode="decimal" value="${it.qty}" min="0" step="1" style="width:58px">
          <input data-f="unitPrice" type="number" inputmode="decimal" value="${it.unitPrice}" min="0" step="0.01" style="width:82px">
          <button class="btn ghost" data-rm="${i}" aria-label="remover">${icon("close", 18, 2)}</button>
        </div>
        <div class="row wrap" style="margin-top:8px;gap:6px">${memChips(it.consumers)}</div>
      </div>`).join("");
    panel = `
      <div class="seg c4" style="margin-bottom:10px">${srcTiles("ne")}</div>
      <div id="neItems">${itemsHtml || '<p class="sm mut">Adicione itens por foto, texto ou manual; marque quem dividiu cada um.</p>'}</div>
      <div class="grid2" style="margin-top:12px">
        <label class="fld"><span>Serviço</span><div class="row"><input id="neSvc" type="number" inputmode="decimal" value="${Math.round(d.serviceRate*100)}" step="1" style="width:70px" ${d.serviceOn?"":"disabled"}><span class="mut">%</span><span class="chip ${d.serviceOn?"on":""}" id="neSvcOn">${d.serviceOn?"incluso":"sem"}</span></div></label>
        <label class="fld"><span>Couvert (total)</span><input id="neCouvert" type="number" inputmode="decimal" value="${d.couvert}" step="0.01"></label>
      </div>
      <label class="fld"><span>Desconto (total)</span><input id="neDisc" type="number" inputmode="decimal" value="${d.discount}" step="0.01"></label>`;
  }

  app.innerHTML = `
    <div class="card">
      <div class="between"><a class="link" id="neBack">← grupo</a><span class="mut sm">${d.editId ? "editar despesa" : "nova despesa"}</span></div>
      <label class="fld" style="margin-top:8px"><span>Descrição</span><input id="neDesc" value="${esc(d.description)}" placeholder="ex.: Jantar no boteco"></label>
      <div class="grid2">
        <label class="fld"><span>Categoria</span><select id="neCat"><option value="">— sem categoria —</option>${CATEGORIES.map(c => `<option value="${esc(c)}" ${d.category===c?"selected":""}>${esc(catLabel(c))}</option>`).join("")}</select></label>
        <label class="fld"><span>Data</span><input id="neDate" type="date" value="${d.spent_at}"></label>
      </div>
      <div class="grid2">
        <label class="fld"><span>Lugar (opcional)</span><input id="nePlace" value="${esc(d.place)}"></label>
        <label class="fld"><span>Nota (opcional)</span><input id="neNote" value="${esc(d.note)}" placeholder="observação"></label>
      </div>
    </div>
    ${d.multiPayer ? `
    <div class="card">
      <div class="between"><h3 style="margin:0">Quem pagou</h3><a class="link" id="nePayToggle">um só pagou</a></div>
      <div class="sm mut" style="margin:6px 0 4px">Quanto cada um pagou:</div>
      ${MEMBERS.map(m => `<label class="fld"><span>${esc(m.display_name)}</span><input data-pay="${m.id}" type="number" inputmode="decimal" value="${d.payAmt[m.id] ?? ""}" step="0.01" placeholder="0,00"></label>`).join("")}
      <div class="sm" id="nePaySum"></div>
    </div>` : `
    <div class="card">
      <div class="between"><h3 style="margin:0">Quem pagou</h3><a class="link" id="nePayToggle">mais de um pagou?</a></div>
      <select id="nePayer" style="margin-top:8px">${MEMBERS.map(m => `<option value="${m.id}" ${m.id===d.payer?"selected":""}>${esc(m.display_name)}</option>`).join("")}</select>
    </div>`}
    <div class="card">
      <h3>Como dividir</h3>
      <div class="row wrap" style="gap:6px;margin-bottom:12px">${modeTab("equal","Igual")}${modeTab("pct","%")}${modeTab("parts","Partes")}${modeTab("exact","Valores")}${modeTab("items","Por item")}</div>
      ${panel}
    </div>
    <div class="card">
      <div class="between"><h3 style="margin:0">Recibo (foto)</h3>${d.receipt ? `<a class="link" id="neRcptRm">remover</a>` : ""}</div>
      ${d.receipt ? `<img src="${d.receipt}" alt="recibo" style="max-width:100%;border-radius:10px;margin-top:8px">` : `<button class="btn sec block" id="neRcpt" style="margin-top:8px">📎 Anexar foto do recibo</button>`}
    </div>
    <div class="card" id="nePreview"></div>
    <button class="btn block fab" id="neSave">${d.editId ? "Salvar alterações" : "Salvar despesa"}</button>`;

  $("#neDesc").oninput = e => d.description = e.target.value;
  $("#nePlace").oninput = e => d.place = e.target.value;
  $("#neDate").oninput = e => d.spent_at = e.target.value;
  $("#neCat").onchange = e => d.category = e.target.value;
  $("#neNote").oninput = e => d.note = e.target.value;
  if($("#nePayer")) $("#nePayer").onchange = e => d.payer = e.target.value;
  if($("#nePayToggle")) $("#nePayToggle").onclick = () => {
    d.multiPayer = !d.multiPayer;
    if(d.multiPayer && !Object.keys(d.payAmt).length) d.payAmt = { [d.payer]: round2(draftSplit().total) };   // semente: quem era o pagador único
    paintNewExpense();
  };
  app.querySelectorAll("[data-pay]").forEach(inp => inp.oninput = e => { d.payAmt[inp.dataset.pay] = parseMoney(e.target.value); refreshPreview(); });
  if($("#neRcpt")) $("#neRcpt").onclick = attachReceipt;
  if($("#neRcptRm")) $("#neRcptRm").onclick = () => { d.receipt = null; paintNewExpense(); };
  $("#neBack").onclick = () => go(`g/${d.groupId}`);
  $("#neSave").onclick = saveExpense;
  app.querySelectorAll("[data-mode]").forEach(el => el.onclick = () => { d.mode = el.dataset.mode; paintNewExpense(); });

  if(d.mode === "equal"){
    $("#neTotal").oninput = e => { d.total = parseMoney(e.target.value); refreshPreview(); };
    app.querySelectorAll("[data-among]").forEach(ch => ch.onclick = () => { const id = ch.dataset.among, a = d.among, k = a.indexOf(id); if(k>=0) a.splice(k,1); else a.push(id); ch.classList.toggle("on"); refreshPreview(); });
  } else if(d.mode === "pct"){
    $("#neTotal").oninput = e => { d.total = parseMoney(e.target.value); refreshPreview(); };
    app.querySelectorAll("[data-pct]").forEach(inp => inp.oninput = e => { d.pct[inp.dataset.pct] = parseFloat(e.target.value) || 0; refreshPreview(); });
  } else if(d.mode === "parts"){
    $("#neTotal").oninput = e => { d.total = parseMoney(e.target.value); refreshPreview(); };
    app.querySelectorAll("[data-parts]").forEach(inp => inp.oninput = e => { d.parts[inp.dataset.parts] = parseFloat(e.target.value) || 0; refreshPreview(); });
  } else if(d.mode === "exact"){
    app.querySelectorAll("[data-exact]").forEach(inp => inp.oninput = e => { d.exact[inp.dataset.exact] = parseMoney(e.target.value); refreshPreview(); });
  } else {
    $("#neCouvert").oninput = e => { d.couvert = parseMoney(e.target.value); refreshPreview(); };
    $("#neDisc").oninput = e => { d.discount = parseMoney(e.target.value); refreshPreview(); };
    $("#neSvc").oninput = e => { d.serviceRate = (parseFloat(e.target.value)||0)/100; refreshPreview(); };
    $("#neSvcOn").onclick = () => { d.serviceOn = !d.serviceOn; paintNewExpense(); };
    $("#neManual").onclick = () => { d.items.push({ name:"", qty:1, unitPrice:0, consumers:[...d.allIds] }); paintNewExpense(); };
    $("#neText").onclick = textDialog;
    $("#neGal").onclick = () => wantPhoto("gal");
    $("#neCam").onclick = () => wantPhoto("cam");
    $("#neItems").querySelectorAll(".item").forEach(node => {
      const i = +node.dataset.i;
      node.querySelectorAll("[data-f]").forEach(inp => inp.oninput = e => { const f = inp.dataset.f; d.items[i][f] = f === "name" ? e.target.value : parseMoney(e.target.value); refreshPreview(); });
      node.querySelector("[data-rm]").onclick = () => { d.items.splice(i, 1); paintNewExpense(); };
      node.querySelectorAll("[data-mid]").forEach(ch => ch.onclick = () => { const id = ch.dataset.mid, a = d.items[i].consumers, k = a.indexOf(id); if(k>=0) a.splice(k,1); else a.push(id); ch.classList.toggle("on"); refreshPreview(); });
    });
  }
  refreshPreview();
}
function draftSplit(){
  const d = DRAFT;
  if(d.mode === "equal" || d.mode === "pct" || d.mode === "parts"){
    const T = Number(d.total) || 0;
    let weights = {};
    if(d.mode === "equal") d.among.forEach(id => { if(d.allIds.includes(id)) weights[id] = 1; });
    else if(d.mode === "pct") d.allIds.forEach(id => { const v = Number(d.pct[id]) || 0; if(v > 0) weights[id] = v; });
    else d.allIds.forEach(id => { const v = Number(d.parts[id]) || 0; if(v > 0) weights[id] = v; });
    const shares = allocateByWeights(T, weights);
    d.allIds.forEach(id => { if(!(id in shares)) shares[id] = 0; });
    return { shares, subtotal: T > 0 ? round2(T) : 0, total: T > 0 ? round2(T) : 0, serviceAmount: 0 };
  }
  if(d.mode === "exact"){
    const shares = {}; let total = 0;
    d.allIds.forEach(id => { const v = Number(d.exact[id]) || 0; shares[id] = v; total += v; });
    return { shares, subtotal: round2(total), total: round2(total), serviceAmount: 0 };
  }
  const items = d.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.unitPrice)||0) > 0).map(it => ({ qty: it.qty, unitPrice: it.unitPrice, consumers: it.consumers }));
  return computeShares(d.allIds, items, { serviceRate: d.serviceOn ? d.serviceRate : 0, couvert: d.couvert, discount: d.discount });
}
function refreshPreview(){
  const d = DRAFT, r = draftSplit();
  const nameOf = id => MEMBERS.find(m => m.id === id)?.display_name || "?";
  const owing = d.allIds.filter(id => Math.abs(r.shares[id]||0) > 0.0001);
  const rows = (owing.length ? owing : d.allIds).map(id => `<div class="listrow"><span>${esc(nameOf(id))}</span><span class="b">${brl(r.shares[id]||0)}</span></div>`).join("");
  let check = "";
  if(d.mode === "items" && d.billTotal != null && Math.abs(d.billTotal - r.total) > 0.05) check = `<div class="banner warn">Os itens somam ${brl(r.total)}, mas a conta diz ${brl(d.billTotal)} — confira se faltou ou repetiu item.</div>`;
  else if(d.mode === "items" && d.billTotal != null) check = `<div class="banner ok">✓ Bate com o total da conta (${brl(d.billTotal)}).</div>`;
  const sub = d.mode === "items"
    ? `<div class="sm mut">Subtotal ${brl(r.subtotal)}${d.serviceOn?` · serviço ${brl(r.serviceAmount)}`:""}${d.couvert?` · couvert ${brl(d.couvert)}`:""}${d.discount?` · -${brl(d.discount)}`:""}</div>`
    : "";
  const paidBy = d.multiPayer
    ? "Pago por " + (d.allIds.filter(id => (Number(d.payAmt[id])||0) > 0).map(id => `${esc(nameOf(id))} ${brl(Number(d.payAmt[id])||0)}`).join(", ") || "—")
    : `Pago por <b>${esc(nameOf(d.payer))}</b>`;
  $("#nePreview").innerHTML = `<h3>Prévia da divisão</h3>${check}${sub}
    ${rows || '<p class="sm mut">Informe um valor pra ver a divisão.</p>'}
    <div class="between" style="margin-top:8px"><span class="b">Total</span><span class="b">${brl(r.total)}</span></div>
    <div class="sm mut" style="margin-top:4px">${paidBy}</div>`;
  if(d.multiPayer && $("#nePaySum")){
    const paid = d.allIds.reduce((s, id) => s + (Number(d.payAmt[id])||0), 0);
    const off = Math.abs(round2(paid) - round2(r.total)) > 0.01;
    $("#nePaySum").innerHTML = `<span class="${off?"":"mut"}" style="${off?"color:var(--warn)":""}">pago ${brl(paid)} de ${brl(r.total)}${off?" — precisa bater o total":" ✓"}</span>`;
  }
}
async function saveExpense(){
  const d = DRAFT, r = draftSplit();
  if(!(r.total > 0)){ toast(d.mode === "exact" ? "Preencha os valores" : "Informe um valor pra dividir"); return; }
  if(d.mode === "equal" && !d.among.length){ toast("Escolha entre quem dividir"); return; }
  const items = d.mode === "items"
    ? d.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.unitPrice)||0) > 0).map((it, i) => ({
        name: it.name || "item", qty: Number(it.qty)||1, unit_price: Number(it.unitPrice)||0, position: i,
        shares: (it.consumers.length ? it.consumers : d.allIds).map(mid => ({ member_id: mid, weight: 1 })),
      }))
    : [];
  let payers;
  if(d.multiPayer){
    const paid = d.allIds.reduce((s, mid) => s + (Number(d.payAmt[mid])||0), 0);
    if(Math.abs(round2(paid) - round2(r.total)) > 0.05){ toast(`Os pagadores somam ${brl(paid)}, mas o total é ${brl(r.total)}.`, 4500); return; }
    payers = d.allIds.filter(mid => (Number(d.payAmt[mid])||0) > 0).map(mid => ({ member_id: mid, amount: round2(Number(d.payAmt[mid])||0) }));
    if(!payers.length){ toast("Diga quanto cada um pagou"); return; }
    const diff = Math.round(round2(r.total)*100) - payers.reduce((s, p) => s + Math.round(p.amount*100), 0);   // joga o resíduo no maior pagador
    if(diff !== 0){ let bi = 0; payers.forEach((p, i) => { if(p.amount > payers[bi].amount) bi = i; }); payers[bi].amount = round2(payers[bi].amount + diff/100); }
  } else {
    payers = [{ member_id: d.payer, amount: round2(r.total) }];
  }
  const isItems = d.mode === "items";
  const payload = {
    ...(d.editId ? { id: d.editId } : {}),
    group_id: d.groupId, description: d.description || "Despesa", place: d.place || null, spent_at: d.spent_at,
    category: d.category || null, note: d.note || null, receipt: d.receipt || null,
    subtotal: round2(r.subtotal), service_rate: (isItems && d.serviceOn) ? d.serviceRate : 0, service_amount: round2(r.serviceAmount || 0),
    couvert: isItems ? round2(d.couvert) : 0, discount: isItems ? round2(d.discount) : 0, total: round2(r.total),
    items, payers,
    shares: d.allIds.map(mid => ({ member_id: mid, amount: round2(r.shares[mid]||0) })).filter(s => s.amount !== 0),
  };
  fixPennies(payload.shares, payload.total);
  $("#neSave").disabled = true;
  try{
    if(d.editId) await db.updateExpense(payload); else await db.saveExpense(payload);
    toast(d.editId ? "Despesa atualizada ✓" : "Despesa salva ✓"); go(`g/${d.groupId}`);
  }catch(e){ console.error(e); toast(e?.message || "Não consegui salvar", 4500); $("#neSave").disabled = false; }
}
function applyToDraft(parsed){
  if(!parsed.items?.length){ toast("Não achei itens. Tente manual."); return; }
  DRAFT.mode = "items";   // foto/texto trazem itens → entra no modo "Por item"
  parsed.items.forEach(p => DRAFT.items.push({ name: p.name, qty: p.qty, unitPrice: parseMoney(p.unitPrice ?? p.price ?? 0), consumers: [...DRAFT.allIds] }));
  if(parsed.total > 0) DRAFT.billTotal = parsed.total;
  if(parsed.service){ DRAFT.serviceOn = true; if(parsed.service.rate > 0) DRAFT.serviceRate = parsed.service.rate/100; }
  paintNewExpense();
  toast(`${parsed.items.length} ${parsed.items.length>1?"itens":"item"} lido(s) ✓`);
}
function fixPennies(shares, total){
  const sum = shares.reduce((s, x) => s + Math.round(x.amount*100), 0);
  let diff = Math.round(total*100) - sum;
  for(let i = 0; diff !== 0 && i < shares.length; i++){ const step = diff > 0 ? 1 : -1; shares[i].amount = round2(shares[i].amount + step/100); diff -= step; }
}

async function renderSettle(groupId){
  loading("Calculando o acerto…");
  let bal, members;
  try{ [bal, members] = await Promise.all([ db.balances(groupId), db.groupMembers(groupId) ]); }
  catch(e){ return renderNeedConfig(e?.message); }
  const mById = Object.fromEntries(members.map(m => [m.id, m]));
  const tx = simplifyDebts(netFromRows(bal));
  const list = tx.length ? tx.map((t, i) => `
    <div class="listrow">
      <div class="row">${avatar(mById[t.from]?.display_name)}<span class="mut">→</span>${avatar(mById[t.to]?.display_name)}
        <div class="sm"><b>${esc(mById[t.from]?.display_name||"?")}</b> paga <b>${esc(mById[t.to]?.display_name||"?")}</b></div></div>
      <div class="row"><span class="b">${brl(t.amount)}</span><button class="btn sm" data-tx="${i}">Pix</button></div>
    </div>`).join("") : `<div class="banner ok">✓ Tá tudo quite. Ninguém deve nada.</div>`;
  app.innerHTML = `
    <div class="card"><div class="between"><a class="link" href="#g/${groupId}">← grupo</a><span class="mut sm">acerto sugerido</span></div>
      <h2 style="margin:.3em 0 0">Quem paga quem</h2><p class="sm mut">Transferências mínimas pra zerar todo mundo.</p></div>
    <div class="card">${list}</div>`;
  app.querySelectorAll("[data-tx]").forEach(b => b.onclick = () => settleDialog(groupId, tx[+b.dataset.tx], mById));
}
async function settleDialog(groupId, t, mById){
  const from = mById[t.from], to = mById[t.to];
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd"><div class="spin"></div></div>`; dlg.showModal();
  let pix = null;
  try{ pix = to.user_id ? await db.memberPix(to.user_id) : null; }catch(_){}
  const close = () => { dlg.close(); dlg.remove(); };
  let payload = "";
  let pixBlock;
  if(pix?.pix_key){
    try{ payload = buildPixPayload({ key: pix.pix_key, name: pix.pix_name || pix.name || to.display_name, city: "BRASIL", amount: t.amount, description: "Racha" }); }catch(_){ payload = ""; }
    pixBlock = payload ? `<p class="sm mut" style="margin-bottom:6px">Pix de <b>${esc(pix.pix_name||to.display_name)}</b> — ${brl(t.amount)}</p>
      <div class="qr" id="sdQr"></div><div class="pix-box" id="sdCopia">${esc(payload)}</div>
      <button class="btn sm block" id="sdCopy" style="margin-top:8px">Copiar código Pix</button>` : `<div class="banner warn">Não consegui montar o Pix.</div>`;
  } else {
    pixBlock = `<div class="banner warn">${esc(to.display_name)} ainda não cadastrou a chave Pix. Peça pra entrar e salvar em ⚙, ou acerte por fora.</div>`;
  }
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>${esc(from.display_name)} → ${esc(to.display_name)}</h2><h3 style="margin-top:0">${brl(t.amount)}</h3>
    ${pixBlock}
    <div class="row" style="margin-top:16px"><button class="btn grow" id="sdDone">Marcar como pago</button><button class="btn sec" id="sdClose">Fechar</button></div>
  </div>`;
  if(payload){
    try{ const qr = qrcode(0, "M"); qr.addData(payload); qr.make(); dlg.querySelector("#sdQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 }); }catch(_){ dlg.querySelector("#sdQr")?.remove(); }
    dlg.querySelector("#sdCopy").onclick = () => copy(payload);
  }
  dlg.querySelector("#sdClose").onclick = close;
  dlg.querySelector("#sdDone").onclick = async () => { await guard(() => db.addSettlement({ groupId, from: t.from, to: t.to, amount: t.amount }), "Não consegui registrar"); toast("Acerto registrado ✓"); close(); renderSettle(groupId); };
}

async function renderJoin(groupId){
  if(!db.hasConfig()){ return renderNeedConfig(); }
  if(!ME){ localStorage.setItem("racha.join", groupId); return renderLogin(); }
  loading("Abrindo convite…");
  let name = "Grupo", ghosts = [];
  try{ [name, ghosts] = await Promise.all([ db.groupNameOf(groupId), db.ghostsOf(groupId) ]); }
  catch(e){ console.error(e); toast("Convite inválido"); return go("grupos"); }
  // Quem foi convidado quase sempre JÁ está na conta com o nome que o outro digitou. Assumir esse nome é o caminho
  // principal; entrar como pessoa nova duplica a pessoa (o que um lança não chega no saldo do outro).
  const ghostBtns = ghosts.length ? `<h3>${ghosts.length === 1 ? "Este é você?" : "Qual destes é você?"}</h3>
    <p class="sm mut" style="margin-top:0">Seu nome já está na conta. Toque nele pra ver e lançar no mesmo lugar.</p>
    ${ghosts.map(g => `<button class="btn block" style="margin-bottom:8px" data-claim="${g.id}">Sou ${esc(g.display_name)}</button>`).join("")}` : "";
  app.innerHTML = `<div class="card">
    <h2>Entrar em “${esc(name||"Grupo")}”</h2>${ghostBtns}
    ${ghosts.length
      ? `<p class="sm mut" style="text-align:center;margin-top:14px"><a class="link" id="joinNew">Não sou ${ghosts.length === 1 ? "essa pessoa" : "nenhuma dessas"} — entrar como pessoa nova</a></p>`
      : `<button class="btn block" id="joinNew" style="margin-top:8px">Entrar como ${esc(PROFILE?.name || "novo membro")}</button>`}
    <p class="sm mut" style="text-align:center;margin-top:10px"><a class="link" href="#grupos">cancelar</a></p></div>`;
  const join = async (claim) => { await guard(() => db.joinGroup(groupId, claim), "Não consegui entrar"); localStorage.removeItem("racha.join");
    const kind = (await db.myGroups().catch(() => [])).find(g => g.id === groupId)?.kind;
    COUPLE = null; toast(kind === "couple" ? "Você entrou no casal ✓" : "Você entrou no grupo ✓"); go(kind === "couple" ? "casal" : `g/${groupId}`); };
  $("#joinNew").onclick = () => join(null);
  app.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => join(b.dataset.claim));
}

/* ====================================================================== */
/* ===================== compartilhado: foto, texto, config ============= */
/* ====================================================================== */
function textDialog(){
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd"><h2>Colar texto da conta</h2>
    <textarea id="tdTxt" rows="8" placeholder="Cole aqui, um item por linha…"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn grow" id="tdOk">Ler</button><button class="btn sec" id="tdCancel">Cancelar</button></div></div>`;
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#tdCancel").onclick = close;
  dlg.querySelector("#tdOk").onclick = () => { const r = parseBill(dlg.querySelector("#tdTxt").value); close(); if(ITEM_SINK) ITEM_SINK(normalizeParsed(r)); };
}
function normalizeParsed(json){
  return {
    items: (json.items||[]).map(it => ({ name: it.name||"item", qty: Number(it.qty)||1, unitPrice: parseMoney(it.unitPrice ?? it.price ?? 0) })),
    subtotal: json.subtotal, total: json.total, service: json.service,
  };
}
function wantPhoto(kind){
  if(!ocrConfigured()){ toast("Configure o OCR (chave da API) em ⚙"); openCfg(); return; }
  if(kind === "cam") openCamera(); else pickPhoto("#galInput");
}
function pickPhoto(sel){ const inp = $(sel); inp.value = ""; inp.onchange = async () => { if(inp.files?.[0]) await processImage(await fileToImageSafe(inp.files[0])); }; inp.click(); }
async function fileToImageSafe(file){ try{ return await fileToImage(file); }catch(e){ toast("Imagem inválida"); throw e; } }
// recibo: miniatura leve (≤1000px, jpeg 0.6) como data URL, pra guardar junto da despesa
function fileToReceipt(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img; const max = 1000;
      if(Math.max(w, h) > max){ const s = max / Math.max(w, h); w = Math.round(w*s); h = Math.round(h*s); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("img")); };
    img.src = URL.createObjectURL(file);
  });
}
function attachReceipt(){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = async () => { const f = inp.files?.[0]; if(!f) return; try{ DRAFT.receipt = await fileToReceipt(f); paintNewExpense(); }catch(_){ toast("Imagem inválida"); } };
  inp.click();
}
async function processImage(img){
  if(!img) return;
  const dlg = document.createElement("dialog"); dlg.innerHTML = `<div class="dlg-bd" style="text-align:center"><div class="spin"></div><p class="mut sm">Lendo a foto…</p></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  try{ const json = await ocrImage(img.data, img.media); if(ITEM_SINK) ITEM_SINK(normalizeParsed(json)); }
  catch(e){ toast(ocrError(e), 6000); }
  finally{ dlg.close(); dlg.remove(); }
}

let camStream = null, camFacing = "environment";
function wireCamera(){
  $("#camCancel").onclick = closeCamera;
  $("#camFlip").onclick = flipCamera;
  $("#camShot").onclick = shootCamera;
  $("#camInput").onchange = async () => { const f = $("#camInput").files?.[0]; if(f) await processImage(await fileToImageSafe(f)); };
}
async function openCamera(){
  if(!navigator.mediaDevices?.getUserMedia){ $("#camInput").click(); return; }
  try{ camStream = await grabCam(camFacing); }
  catch(e){ console.warn(e); toast(/denied|permission/i.test(String(e))?"Permita a câmera no navegador.":"Câmera indisponível — abrindo arquivos."); $("#camInput").click(); return; }
  const v = $("#camVideo"); v.srcObject = camStream; v.muted = true; v.playsInline = true;
  try{ await v.play(); }catch(_){}
  $("#camOverlay").classList.remove("hide"); document.body.style.overflow = "hidden";
}
async function grabCam(facing){
  try{ return await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal: facing } }, audio:false }); }
  catch(_){ return await navigator.mediaDevices.getUserMedia({ video:true, audio:false }); }
}
function closeCamera(){
  if(camStream){ camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  $("#camOverlay").classList.add("hide"); $("#camVideo").srcObject = null; document.body.style.overflow = "";
}
async function flipCamera(){
  camFacing = camFacing === "environment" ? "user" : "environment";
  if(camStream) camStream.getTracks().forEach(t => t.stop());
  try{ camStream = await grabCam(camFacing); $("#camVideo").srcObject = camStream; await $("#camVideo").play(); }catch(e){ toast("Não consegui trocar de câmera."); }
}
async function shootCamera(){
  const v = $("#camVideo"); const w = v.videoWidth, h = v.videoHeight;
  if(!w || !h){ toast("Câmera ainda carregando…"); return; }
  const max = 1600; let cw = w, ch = h;
  if(Math.max(w,h) > max){ const s = max/Math.max(w,h); cw = Math.round(w*s); ch = Math.round(h*s); }
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  cv.getContext("2d").drawImage(v, 0, 0, cw, ch);
  const data = cv.toDataURL("image/jpeg", 0.82).split(",")[1];
  closeCamera();
  await processImage({ data, media: "image/jpeg" });
}

function openCfg(){
  const c = db.getSbConfig() || {};
  $("#cfgUrl").value = c.url || ""; $("#cfgAnon").value = c.anon || "";
  $("#cfgPix").value = PROFILE?.pix_key || ""; $("#cfgPixName").value = PROFILE?.pix_name || PROFILE?.name || "";
  $("#cfgKey").value = localStorage.getItem("racha.apiKey") || "";
  $("#cfgModel").value = localStorage.getItem("racha.ocrModel") || "claude-haiku-4-5-20251001";
  $("#cfgOcrUrl").value = localStorage.getItem("racha.ocrUrl") || "";
  $("#cfgDlg").showModal();
}
function wireConfig(){
  $("#cfgClose").onclick = () => $("#cfgDlg").close();
  $("#cfgSave").onclick = async (ev) => {
    ev.preventDefault();
    const url = $("#cfgUrl").value.trim(), anon = $("#cfgAnon").value.trim();
    const key = $("#cfgKey").value.trim(), ocrUrl = $("#cfgOcrUrl").value.trim();
    if(key) localStorage.setItem("racha.apiKey", key); else localStorage.removeItem("racha.apiKey");
    localStorage.setItem("racha.ocrModel", $("#cfgModel").value);
    if(ocrUrl) localStorage.setItem("racha.ocrUrl", ocrUrl); else localStorage.removeItem("racha.ocrUrl");

    const prev = db.getSbConfig();
    if(url && anon) db.setSbConfig(url, anon);
    const now = db.getSbConfig();
    const sbChanged = !!(url && anon && now && (!prev || prev.url !== now.url || prev.anon !== now.anon));
    const pixKey = $("#cfgPix").value.trim(), pixName = $("#cfgPixName").value.trim();
    if(ME && (pixKey || pixName)){ try{ PROFILE = await db.saveProfile({ pix_key: pixKey || null, pix_name: pixName || null }); }catch(e){ console.error(e); } }

    $("#cfgDlg").close(); toast("Salvo ✓");
    if(sbChanged){ location.reload(); return; }   // (re)conecta com a URL/chave nova
    if(ME){ PROFILE = await db.getMyProfile(); paintAcct(); }
    route();
  };
}

async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast("Copiado ✓"); }
  catch(_){ const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast("Copiado ✓"); }catch(__){ toast("Copie manualmente"); } ta.remove(); }
}

boot();
