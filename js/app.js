// Racha — controlador único (PWA estático, sem build). Duas abas:
//  • Racha  = calculadora de UMA conta (local, funciona sem login)
//  • Grupos = livro-razão (Supabase): saldo acumulado, acerto por Pix
// Ponte: o resultado do Racha pode ser "lançado" como despesa de um grupo.
import * as db from "./db.js";
import { ocrImage, ocrConfigured, ocrError, fileToImage } from "./ocr.js";
import { computeShares, allocateByWeights } from "./split.js";
import { simplifyDebts, netFromRows } from "./ledger.js";
import { buildPixPayload } from "./pix.js";
import { parseBill } from "./parse.js";
import { parseMoney, brl } from "./money.js";

const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = iso => { try{ return new Date(iso + "T12:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" }); }catch(_){ return iso; } };
const round2 = n => Math.round((Number(n)||0) * 100) / 100;
const norm = s => String(s||"").trim().toLowerCase();

function initials(name){ const p = String(name||"?").trim().split(/\s+/); return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase() || "?"; }
function colorFor(seed){ let h = 0; for(const c of String(seed||"")) h = (h*31 + c.charCodeAt(0)) % 360; return `hsl(${h} 52% 42%)`; }
const avatar = name => `<span class="av" style="background:${colorFor(name)}">${esc(initials(name))}</span>`;

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

/* ============================ boot ============================ */
// Convite "pronto pra usar": o link carrega a conexão (URL + chave anon pública).
// Quem abre adota a config automaticamente e só precisa fazer login — nada de ⚙.
function adoptConfigFromLink(){
  const q = new URLSearchParams(location.search);
  const s = q.get("s"), k = q.get("k"), join = q.get("join");
  let changed = false;
  if(s && k){ try{ db.setSbConfig(s, k); }catch(_){} q.delete("s"); q.delete("k"); changed = true; }
  if(join){ try{ localStorage.setItem("racha.join", join); }catch(_){} q.delete("join"); changed = true; }   // alvo do convite sobrevive ao login
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
        const pending = localStorage.getItem("racha.join");
        if(ME && pending && location.hash.indexOf("join") < 0){ localStorage.removeItem("racha.join"); return go("join/" + pending); }
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
function activeTab(){ const h = location.hash.replace(/^#\/?/, ""); return (h.startsWith("grupos") || h.startsWith("g/") || h.startsWith("join")) ? "grupos" : "racha"; }
const go = hash => { location.hash = hash; };

function route(){
  const tab = activeTab();
  $("#tabRacha").classList.toggle("on", tab === "racha");
  $("#tabGrupos").classList.toggle("on", tab === "grupos");
  ITEM_SINK = null;
  if(LIVE){ db.unsubscribe(LIVE); LIVE = null; }   // encerra o realtime da tela anterior
  if(tab === "racha") return renderRacha();
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
        <button class="btn ghost" data-rm="${i}" aria-label="remover">✕</button>
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
      <div class="grid4" style="margin:10px 0">
        <button class="btn sec sm" id="rcCam">📷 Foto</button>
        <button class="btn sec sm" id="rcGal">🖼️ Galeria</button>
        <button class="btn sec sm" id="rcText">📝 Texto</button>
        <button class="btn sec sm" id="rcManual">＋ Manual</button>
      </div>
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
      <button class="btn grow" id="rcPush">Lançar no grupo →</button>
    </div>
    <button class="btn ghost block" id="rcReset" style="margin-top:8px">Recomeçar</button>`;

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
function renderLogin(){
  app.innerHTML = `<div class="card">
    <h2>Entrar nos Grupos</h2>
    <p class="mut">Coloque seu e-mail; mandamos um link de acesso. Sem senha.</p>
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
    if(!(await ensureInit())){ $("#loginMsg").textContent = INIT_ERR || "Não consegui conectar ao Supabase."; $("#loginBtn").disabled = false; return; }
    try{
      await db.sendMagicLink(email); sentEmail = email;
      $("#loginMsg").innerHTML = `Enviado pra <b>${esc(email)}</b>. Abra o <b>link</b> do e-mail <b>neste mesmo navegador</b>. (Se o e-mail trouxer um código de 6 dígitos, dá pra digitar abaixo.)`;
      $("#codeBox").style.display = "block";
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
  const list = groups.length ? nets.map(({ g, net }) => {
    const cls = Math.abs(net) < 0.005 ? "zero" : net > 0 ? "pos" : "neg";
    const txt = Math.abs(net) < 0.005 ? "quite" : (net > 0 ? "recebe " : "deve ") + brl(Math.abs(net));
    return `<div class="listrow" data-g="${g.id}" style="cursor:pointer">
      <div class="row">${avatar(g.name)}<div><div class="b">${esc(g.name)}</div><div class="sm mut">${esc(g.currency||"BRL")}</div></div></div>
      <span class="pill ${cls}">${txt}</span></div>`;
  }).join("") : `<div class="empty">Nenhum grupo ainda.<br>Crie o primeiro — ou lance um racha da aba ao lado.</div>`;
  app.innerHTML = `
    ${summary}
    <div class="card"><h3 style="margin:0 0 .4em">Seus grupos</h3>${list}</div>
    <div class="card"><h3>Novo grupo</h3>
      <div class="row"><input id="ngName" placeholder="ex.: República, Viagem, Happy hour"><button class="btn" id="ngBtn">Criar</button></div>
    </div>`;
  app.querySelectorAll("[data-g]").forEach(r => r.onclick = () => go(`g/${r.dataset.g}`));
  $("#ngBtn").onclick = async () => {
    const name = $("#ngName").value.trim(); if(!name){ toast("Dê um nome ao grupo"); return; }
    $("#ngBtn").disabled = true;
    try{ const g = await db.createGroup(name); go(`g/${g.id}`); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui criar"); $("#ngBtn").disabled = false; }
  };
}

let liveTimer = null;
async function renderGroup(groupId){
  if(LIVE){ db.unsubscribe(LIVE); LIVE = null; }   // evita canal duplicado em re-render ao vivo
  loading("Abrindo o grupo…");
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
    <div class="card"><h3>Despesas</h3>${expList}</div>
    <div class="card"><h3>Atividade</h3>${actList}</div>
    <button class="btn block fab" id="gNew">+ Nova despesa</button>`;
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
  LIVE = db.subscribeGroup(groupId, () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if(location.hash.replace(/^#\/?/, "").startsWith(`g/${groupId}`)) renderGroup(groupId); }, 500);
  });
}
function timeAgo(at){
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if(s < 60) return "agora";
  if(s < 3600) return `há ${Math.floor(s/60)} min`;
  if(s < 86400) return `há ${Math.floor(s/3600)} h`;
  if(s < 604800) return `há ${Math.floor(s/86400)} d`;
  return fmtDate(at);
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
    <div class="row" style="margin-top:16px"><button class="btn sec grow" id="eClose">Fechar</button><button class="btn grow" id="eEdit">Editar</button><button class="btn" id="eDel" style="background:var(--danger)">Excluir</button></div>
  </div>`;
  const close = () => { dlg.close(); dlg.remove(); };
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
          <button class="btn ghost" data-rm="${i}" aria-label="remover">✕</button>
        </div>
        <div class="row wrap" style="margin-top:8px;gap:6px">${memChips(it.consumers)}</div>
      </div>`).join("");
    panel = `
      <div class="grid4" style="margin-bottom:10px">
        <button class="btn sec sm" id="neCam">📷 Foto</button><button class="btn sec sm" id="neGal">🖼️ Galeria</button>
        <button class="btn sec sm" id="neText">📝 Texto</button><button class="btn sec sm" id="neManual">＋ Manual</button>
      </div>
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
        <label class="fld"><span>Categoria</span><select id="neCat"><option value="">— sem categoria —</option>${CATEGORIES.map(c => `<option value="${esc(c)}" ${d.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
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
  const ghostBtns = ghosts.length ? `<h3>Algum desses é você?</h3>
    <p class="sm mut" style="margin-top:0">Se você já aparece na conta, escolha seu nome pra juntar tudo.</p>
    ${ghosts.map(g => `<button class="btn sec block" style="margin-bottom:8px" data-claim="${g.id}">Sou ${esc(g.display_name)}</button>`).join("")}` : "";
  app.innerHTML = `<div class="card">
    <h2>Entrar em “${esc(name||"Grupo")}”</h2>${ghostBtns}
    <button class="btn block" id="joinNew" style="margin-top:8px">Entrar como ${esc(PROFILE?.name || "novo membro")}</button>
    <p class="sm mut" style="text-align:center;margin-top:10px"><a class="link" href="#grupos">cancelar</a></p></div>`;
  const join = async (claim) => { await guard(() => db.joinGroup(groupId, claim), "Não consegui entrar"); localStorage.removeItem("racha.join"); toast("Você entrou no grupo ✓"); go(`g/${groupId}`); };
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
