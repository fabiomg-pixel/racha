// Racha Grupos — controlador da UI (PWA estático, sem build).
import * as db from "./db.js";
import { ocrImage, ocrConfigured, ocrError, fileToImage } from "./ocr.js";
import { computeShares } from "./split.js";
import { simplifyDebts, netFromRows } from "./ledger.js";
import { buildPixPayload } from "./pix.js";
import { parseBill } from "./parse.js";
import { parseMoney, brl } from "./money.js";

const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = iso => { try{ return new Date(iso + "T12:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" }); }catch(_){ return iso; } };

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

let ME = null;        // user
let PROFILE = null;   // profile row

/* ============================ boot ============================ */
async function boot(){
  wireHeader(); wireConfig(); wireCamera();
  if(!db.hasConfig()){ renderNeedConfig(); return; }
  try{
    ME = await db.currentUser();
    PROFILE = ME ? await db.getMyProfile() : null;
    db.onAuthChange(async (u) => {
      ME = u; PROFILE = u ? await db.getMyProfile() : null; paintAcct();
      const pending = sessionStorage.getItem("racha.join");
      if(ME && pending && location.hash.indexOf("join") < 0){ sessionStorage.removeItem("racha.join"); return go("/join/" + pending); }
      route();
    });
  }catch(e){ console.error(e); renderNeedConfig(e?.message); return; }
  paintAcct(); route();
}
window.addEventListener("hashchange", route);

function paintAcct(){
  const b = $("#hAcct");
  if(ME){ b.textContent = initials(PROFILE?.name || ME.email || "?"); b.title = "sair"; }
  else { b.textContent = "entrar"; b.title = "entrar"; }
}

/* ============================ router ============================ */
function parseHash(){
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { parts };
}
async function route(){
  if(!db.hasConfig()) return renderNeedConfig();
  const { parts } = parseHash();
  if(parts[0] === "join" && parts[1]) return renderJoin(parts[1]);
  if(!ME) return renderLogin();
  if(parts[0] === "g" && parts[1]){
    if(parts[2] === "new") return renderNewExpense(parts[1]);
    if(parts[2] === "settle") return renderSettle(parts[1]);
    return renderGroup(parts[1]);
  }
  return renderGroups();
}
const go = hash => { location.hash = hash; };

/* ============================ config / login ============================ */
function renderNeedConfig(err){
  app.innerHTML = `<div class="card">
    <h2>Conectar ao Supabase</h2>
    <p class="mut">Pra dividir contas com o grupo e guardar o histórico, o Racha precisa de um back-end. É grátis e leva uns minutos:</p>
    <ol class="sm mut" style="padding-left:18px">
      <li>Crie um projeto em <b>supabase.com</b>.</li>
      <li>No SQL Editor, rode o conteúdo de <code>supabase/migrations/0001_init.sql</code>.</li>
      <li>Em Project Settings → API, copie a <b>URL</b> e a chave <b>anon</b>.</li>
      <li>Toque em <b>⚙</b> aqui em cima e cole as duas.</li>
    </ol>
    ${err ? `<div class="banner warn">${esc(err)}</div>` : ""}
    <button class="btn block" id="ncOpen">Abrir configurações</button>
    <p class="sm mut" style="text-align:center;margin-top:12px"><a class="link" href="../">← usar a calculadora simples (1 aparelho)</a></p>
  </div>`;
  $("#ncOpen").onclick = openCfg;
}

function renderLogin(){
  app.innerHTML = `<div class="card">
    <h2>Entrar</h2>
    <p class="mut">Mandamos um link mágico pro seu e-mail. Sem senha.</p>
    <label class="fld"><span>Seu e-mail</span><input id="loginEmail" type="email" inputmode="email" placeholder="voce@email.com" autocomplete="email"></label>
    <button class="btn block" id="loginBtn">Enviar link de acesso</button>
    <p class="sm mut" id="loginMsg" style="margin-top:10px"></p>
    <p class="sm mut" style="text-align:center;margin-top:8px"><a class="link" href="../">← calculadora simples (sem conta)</a></p>
  </div>`;
  const send = async () => {
    const email = $("#loginEmail").value.trim();
    if(!/.+@.+\..+/.test(email)){ toast("E-mail inválido"); return; }
    $("#loginBtn").disabled = true; $("#loginMsg").textContent = "Enviando…";
    try{ await db.sendMagicLink(email); $("#loginMsg").innerHTML = `Pronto! Abra o link que enviamos pra <b>${esc(email)}</b> neste aparelho.`; }
    catch(e){ console.error(e); $("#loginMsg").textContent = e?.message || "Não consegui enviar."; $("#loginBtn").disabled = false; }
  };
  $("#loginBtn").onclick = send;
  $("#loginEmail").addEventListener("keydown", e => { if(e.key === "Enter") send(); });
}

/* ============================ grupos (lista) ============================ */
async function renderGroups(){
  loading("Buscando seus grupos…");
  let groups;
  try{ groups = await db.myGroups(); }catch(e){ return renderNeedConfig(e?.message); }
  const list = groups.length ? groups.map(g => `
    <div class="listrow" data-g="${g.id}" style="cursor:pointer">
      <div class="row">${avatar(g.name)}<div><div class="b">${esc(g.name)}</div><div class="sm mut">${esc(g.currency||"BRL")}</div></div></div>
      <div class="mut">›</div>
    </div>`).join("") : `<div class="empty">Nenhum grupo ainda.<br>Crie o primeiro pra começar a rachar.</div>`;
  app.innerHTML = `
    <div class="card">
      <div class="between"><h2 style="margin:0">Seus grupos</h2></div>
      ${list}
    </div>
    <div class="card">
      <h3>Novo grupo</h3>
      <div class="row"><input id="ngName" placeholder="ex.: República, Viagem, Happy hour"><button class="btn" id="ngBtn">Criar</button></div>
    </div>`;
  app.querySelectorAll("[data-g]").forEach(r => r.onclick = () => go(`/g/${r.dataset.g}`));
  $("#ngBtn").onclick = async () => {
    const name = $("#ngName").value.trim(); if(!name){ toast("Dê um nome ao grupo"); return; }
    $("#ngBtn").disabled = true;
    try{ const g = await db.createGroup(name); go(`/g/${g.id}`); }
    catch(e){ console.error(e); toast(e?.message || "Não consegui criar"); $("#ngBtn").disabled = false; }
  };
}

/* ============================ grupo (detalhe) ============================ */
async function renderGroup(groupId){
  loading("Abrindo o grupo…");
  let group, members, bal, expenses;
  try{
    [members, bal, expenses] = await Promise.all([ db.groupMembers(groupId), db.balances(groupId), db.listExpenses(groupId) ]);
    group = { id: groupId, name: (await db.groupNameOf(groupId)) || "Grupo" };
  }catch(e){ console.error(e); return renderNeedConfig(e?.message); }

  const balRows = bal.slice().sort((a,b) => b.net - a.net).map(m => {
    const n = Number(m.net);
    const cls = Math.abs(n) < 0.005 ? "zero" : n > 0 ? "pos" : "neg";
    const txt = Math.abs(n) < 0.005 ? "quite" : (n > 0 ? "recebe " : "deve ") + brl(Math.abs(n));
    return `<div class="listrow"><div class="row">${avatar(m.display_name)}<span class="b">${esc(m.display_name)}</span>${m.user_id?"":'<span class="pill zero">fantasma</span>'}</div><span class="pill ${cls}">${txt}</span></div>`;
  }).join("");

  const expList = expenses.length ? expenses.map(e => `
    <div class="listrow" data-exp="${e.id}">
      <div><div class="b">${esc(e.description || "Despesa")}</div><div class="sm mut">${fmtDate(e.spent_at)}${e.place?" · "+esc(e.place):""}</div></div>
      <div class="b">${brl(e.total)}</div>
    </div>`).join("") : `<div class="empty">Sem despesas. Adicione a primeira conta.</div>`;

  app.innerHTML = `
    <div class="card">
      <div class="between"><a class="link" href="#/">← grupos</a><a class="link" id="gMembers">membros (${members.length})</a></div>
      <h2 style="margin:.3em 0 0">${esc(group.name)}</h2>
    </div>
    <div class="card">
      <div class="between"><h3 style="margin:0">Saldo</h3><a class="link" id="gSettle">acertar →</a></div>
      ${balRows || `<div class="empty">Adicione membros e uma despesa.</div>`}
    </div>
    <div class="card">
      <h3>Despesas</h3>
      ${expList}
    </div>
    <button class="btn block fab" id="gNew">+ Nova despesa</button>`;

  $("#gNew").onclick = () => go(`/g/${groupId}/new`);
  $("#gSettle").onclick = () => go(`/g/${groupId}/settle`);
  $("#gMembers").onclick = () => membersDialog(groupId, members);
  app.querySelectorAll("[data-exp]").forEach(r => r.onclick = () => expenseDialog(r.dataset.exp, groupId));
}

async function membersDialog(groupId, members){
  const dlg = document.createElement("dialog");
  const link = location.origin + location.pathname + "#/join/" + groupId;
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>Membros</h2>
    <div id="mList">${members.map(m => `<div class="listrow"><div class="row">${avatar(m.display_name)}<span>${esc(m.display_name)}</span>${m.user_id?"":'<span class="pill zero">fantasma</span>'}</div>${m.user_id===ME?.id?"":`<a class="link" data-del="${m.id}">remover</a>`}</div>`).join("")}</div>
    <h3 style="margin-top:14px">Adicionar pessoa (sem conta)</h3>
    <div class="row"><input id="mName" placeholder="nome"><button class="btn sm" id="mAdd">Add</button></div>
    <h3 style="margin-top:14px">Convidar por link</h3>
    <p class="sm mut" style="margin:.2em 0">Quem abrir o link entra no grupo e pode marcar "esse sou eu".</p>
    <div class="pix-box" id="mLink">${esc(link)}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm grow" id="mCopy">Copiar link</button>
      <a class="btn sm sec grow" style="text-align:center;text-decoration:none" target="_blank" href="https://wa.me/?text=${encodeURIComponent("Entra no nosso racha: " + link)}">WhatsApp</a>
    </div>
    <button class="btn sec block" style="margin-top:14px" id="mClose">Fechar</button>
  </div>`;
  document.body.appendChild(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#mClose").onclick = close;
  dlg.querySelector("#mCopy").onclick = () => copy(link);
  dlg.querySelector("#mAdd").onclick = async () => {
    const name = dlg.querySelector("#mName").value.trim(); if(!name) return;
    await guard(() => db.addGhost(groupId, name), "Não consegui adicionar"); close(); renderGroup(groupId);
  };
  dlg.querySelectorAll("[data-del]").forEach(a => a.onclick = async () => {
    if(!confirm("Remover do grupo?")) return;
    await guard(() => db.removeMember(a.dataset.del), "Não consegui remover"); close(); renderGroup(groupId);
  });
}

async function expenseDialog(expId, groupId){
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd"><div class="spin"></div></div>`; dlg.showModal();
  let e, members;
  try{ [e, members] = await Promise.all([ db.getExpense(expId), db.groupMembers(groupId) ]); }
  catch(err){ dlg.close(); dlg.remove(); toast("Não consegui abrir a despesa"); return; }
  const nameOf = id => members.find(m => m.id === id)?.display_name || "?";
  const items = (e.items||[]).map(it => `<div class="listrow"><div><div>${esc(it.name||"item")}</div><div class="sm mut">${Number(it.qty)}× ${brl(it.unit_price)} · ${(it.shares||[]).map(s=>esc(nameOf(s.member_id))).join(", ")||"todos"}</div></div><div>${brl(Number(it.qty)*Number(it.unit_price))}</div></div>`).join("");
  const payers = (e.payers||[]).map(p => `${esc(nameOf(p.member_id))} ${brl(p.amount)}`).join(", ");
  const shares = (e.shares||[]).map(s => `<div class="listrow"><span>${esc(nameOf(s.member_id))}</span><span class="b">${brl(s.amount)}</span></div>`).join("");
  dlg.innerHTML = `<div class="dlg-bd">
    <h2>${esc(e.description||"Despesa")}</h2>
    <p class="sm mut" style="margin-top:0">${fmtDate(e.spent_at)}${e.place?" · "+esc(e.place):""} · pago por ${payers||"—"}</p>
    <h3>Itens</h3>${items||'<p class="sm mut">sem itens</p>'}
    <h3 style="margin-top:12px">Quanto cada um deve</h3>${shares}
    <div class="between" style="margin-top:8px"><span class="mut">Total</span><span class="b">${brl(e.total)}</span></div>
    <div class="row" style="margin-top:16px">
      <button class="btn sec grow" id="eClose">Fechar</button>
      <button class="btn grow" id="eDel" style="background:var(--danger)">Excluir</button>
    </div>
  </div>`;
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#eClose").onclick = close;
  dlg.querySelector("#eDel").onclick = async () => {
    if(!confirm("Excluir esta despesa?")) return;
    await guard(() => db.deleteExpense(expId), "Não consegui excluir"); close(); renderGroup(groupId);
  };
}

/* ============================ nova despesa ============================ */
let DRAFT = null, MEMBERS = [];
async function renderNewExpense(groupId){
  loading("Preparando…");
  try{ MEMBERS = await db.groupMembers(groupId); }catch(e){ return renderNeedConfig(e?.message); }
  if(MEMBERS.length === 0){ toast("Adicione membros ao grupo primeiro"); return renderGroup(groupId); }
  const allIds = MEMBERS.map(m => m.id);
  const meMember = MEMBERS.find(m => m.user_id === ME?.id);
  DRAFT = {
    groupId, description: "", place: "", spent_at: todayISO(),
    items: [], payer: (meMember || MEMBERS[0]).id,
    serviceOn: false, serviceRate: 0.10, couvert: 0, discount: 0, billTotal: null, allIds,
  };
  paintNewExpense();
}

function paintNewExpense(){
  const d = DRAFT;
  const memChips = ids => MEMBERS.map(m => `<span class="chip ${ids.includes(m.id)?"on":""}" data-mid="${m.id}">${esc(m.display_name)}</span>`).join("");
  const itemsHtml = d.items.map((it, i) => `
    <div class="item" data-i="${i}">
      <div class="row" style="gap:8px">
        <input data-f="name" value="${esc(it.name)}" placeholder="item" class="grow">
        <input data-f="qty" type="number" inputmode="decimal" value="${it.qty}" min="0" step="1" style="width:62px">
        <input data-f="unitPrice" type="number" inputmode="decimal" value="${it.unitPrice}" min="0" step="0.01" style="width:84px">
        <button class="btn ghost" data-rm="${i}" aria-label="remover">✕</button>
      </div>
      <div class="row wrap" style="margin-top:8px;gap:6px">${memChips(it.consumers)}</div>
    </div>`).join("");

  app.innerHTML = `
    <div class="card">
      <div class="between"><a class="link" id="neBack">← cancelar</a><span class="mut sm">nova despesa</span></div>
      <label class="fld" style="margin-top:8px"><span>Descrição</span><input id="neDesc" value="${esc(d.description)}" placeholder="ex.: Jantar no boteco"></label>
      <div class="grid2">
        <label class="fld"><span>Lugar (opcional)</span><input id="nePlace" value="${esc(d.place)}"></label>
        <label class="fld"><span>Data</span><input id="neDate" type="date" value="${d.spent_at}"></label>
      </div>
    </div>

    <div class="card">
      <div class="between"><h3 style="margin:0">Itens</h3></div>
      <div class="grid4" style="margin-bottom:10px">
        <button class="btn sec sm" id="neCam">📷 Foto</button>
        <button class="btn sec sm" id="neGal">🖼️ Galeria</button>
        <button class="btn sec sm" id="neText">📝 Texto</button>
        <button class="btn sec sm" id="neManual">＋ Manual</button>
      </div>
      <div id="neItems">${itemsHtml || '<p class="sm mut">Adicione itens por foto, texto ou manual.</p>'}</div>
    </div>

    <div class="card">
      <h3>Quem pagou</h3>
      <select id="nePayer">${MEMBERS.map(m => `<option value="${m.id}" ${m.id===d.payer?"selected":""}>${esc(m.display_name)}</option>`).join("")}</select>
      <div class="grid2" style="margin-top:12px">
        <label class="fld"><span>Serviço</span>
          <div class="row"><input id="neSvc" type="number" inputmode="decimal" value="${Math.round(d.serviceRate*100)}" step="1" style="width:70px" ${d.serviceOn?"":"disabled"}><span class="mut">%</span>
          <span class="chip ${d.serviceOn?"on":""}" id="neSvcOn">${d.serviceOn?"incluso":"sem"}</span></div></label>
        <label class="fld"><span>Couvert (total)</span><input id="neCouvert" type="number" inputmode="decimal" value="${d.couvert}" step="0.01"></label>
      </div>
      <label class="fld"><span>Desconto (total)</span><input id="neDisc" type="number" inputmode="decimal" value="${d.discount}" step="0.01"></label>
    </div>

    <div class="card" id="nePreview"></div>
    <button class="btn block fab" id="neSave">Salvar despesa</button>`;

  // top fields (lidos no save; sem re-render pra não perder foco)
  $("#neDesc").oninput = e => d.description = e.target.value;
  $("#nePlace").oninput = e => d.place = e.target.value;
  $("#neDate").oninput = e => d.spent_at = e.target.value;
  $("#nePayer").onchange = e => d.payer = e.target.value;
  $("#neCouvert").oninput = e => { d.couvert = parseMoney(e.target.value); refreshPreview(); };
  $("#neDisc").oninput = e => { d.discount = parseMoney(e.target.value); refreshPreview(); };
  $("#neSvc").oninput = e => { d.serviceRate = (parseFloat(e.target.value)||0)/100; refreshPreview(); };
  $("#neSvcOn").onclick = () => { d.serviceOn = !d.serviceOn; paintNewExpense(); };

  $("#neBack").onclick = () => go(`/g/${d.groupId}`);
  $("#neManual").onclick = () => { d.items.push({ name:"", qty:1, unitPrice:0, consumers:[...d.allIds] }); paintNewExpense(); };
  $("#neText").onclick = textDialog;
  $("#neGal").onclick = () => pickPhoto("#galInput");
  $("#neCam").onclick = openCamera;

  $("#neItems").querySelectorAll(".item").forEach(node => {
    const i = +node.dataset.i;
    node.querySelectorAll("[data-f]").forEach(inp => inp.oninput = e => {
      const f = inp.dataset.f; d.items[i][f] = f === "name" ? e.target.value : parseMoney(e.target.value); refreshPreview();
    });
    node.querySelector(`[data-rm]`).onclick = () => { d.items.splice(i, 1); paintNewExpense(); };
    node.querySelectorAll("[data-mid]").forEach(ch => ch.onclick = () => {
      const id = ch.dataset.mid, arr = d.items[i].consumers, k = arr.indexOf(id);
      if(k >= 0) arr.splice(k, 1); else arr.push(id);
      ch.classList.toggle("on"); refreshPreview();
    });
  });
  $("#neSave").onclick = saveExpense;
  refreshPreview();
}

function currentSplit(){
  const d = DRAFT;
  const items = d.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.unitPrice)||0) > 0)
    .map(it => ({ qty: it.qty, unitPrice: it.unitPrice, consumers: it.consumers }));
  return computeShares(d.allIds, items, { serviceRate: d.serviceOn ? d.serviceRate : 0, couvert: d.couvert, discount: d.discount });
}
function refreshPreview(){
  const d = DRAFT, r = currentSplit();
  const nameOf = id => MEMBERS.find(m => m.id === id)?.display_name || "?";
  const rows = d.allIds.map(id => `<div class="listrow"><span>${esc(nameOf(id))}</span><span class="b">${brl(r.shares[id]||0)}</span></div>`).join("");
  let check = "";
  if(d.billTotal != null && Math.abs(d.billTotal - r.total) > 0.05){
    check = `<div class="banner warn">Os itens somam ${brl(r.total)}, mas a conta diz ${brl(d.billTotal)} — confira se faltou ou repetiu item.</div>`;
  } else if(d.billTotal != null){
    check = `<div class="banner ok">✓ Bate com o total da conta (${brl(d.billTotal)}).</div>`;
  }
  $("#nePreview").innerHTML = `<h3>Prévia da divisão</h3>${check}
    <div class="sm mut between"><span>Subtotal ${brl(r.subtotal)}${d.serviceOn?` · serviço ${brl(r.serviceAmount)}`:""}${d.couvert?` · couvert ${brl(d.couvert)}`:""}${d.discount?` · -${brl(d.discount)}`:""}</span></div>
    ${rows}
    <div class="between" style="margin-top:8px"><span class="b">Total</span><span class="b">${brl(r.total)}</span></div>
    <div class="sm mut" style="margin-top:4px">Pago por <b>${esc(nameOf(d.payer))}</b></div>`;
}

async function saveExpense(){
  const d = DRAFT, r = currentSplit();
  if(r.total <= 0){ toast("Adicione ao menos um item com valor"); return; }
  const items = d.items.filter(it => (Number(it.qty)||0) > 0 && (Number(it.unitPrice)||0) > 0).map((it, i) => ({
    name: it.name || "item", qty: Number(it.qty)||1, unit_price: Number(it.unitPrice)||0, position: i,
    shares: (it.consumers.length ? it.consumers : d.allIds).map(mid => ({ member_id: mid, weight: 1 })),
  }));
  const payload = {
    group_id: d.groupId, description: d.description || "Despesa", place: d.place || null, spent_at: d.spent_at,
    subtotal: round2(r.subtotal), service_rate: d.serviceOn ? d.serviceRate : 0,
    service_amount: round2(r.serviceAmount), couvert: round2(d.couvert), discount: round2(d.discount), total: round2(r.total),
    items, payers: [{ member_id: d.payer, amount: round2(r.total) }],
    shares: d.allIds.map(mid => ({ member_id: mid, amount: round2(r.shares[mid]||0) })).filter(s => s.amount !== 0),
  };
  // garante que os centavos do rateio batem com o total mesmo após arredondar
  fixPennies(payload.shares, payload.total);
  $("#neSave").disabled = true;
  try{ await db.saveExpense(payload); toast("Despesa salva ✓"); go(`/g/${d.groupId}`); }
  catch(e){ console.error(e); toast(e?.message || "Não consegui salvar", 4500); $("#neSave").disabled = false; }
}
const round2 = n => Math.round((Number(n)||0) * 100) / 100;
function fixPennies(shares, total){
  const sum = shares.reduce((s, x) => s + Math.round(x.amount*100), 0);
  let diff = Math.round(total*100) - sum;
  for(let i = 0; diff !== 0 && i < shares.length; i++){ const step = diff > 0 ? 1 : -1; shares[i].amount = round2(shares[i].amount + step/100); diff -= step; }
}

function textDialog(){
  const dlg = document.createElement("dialog"); document.body.appendChild(dlg);
  dlg.innerHTML = `<div class="dlg-bd"><h2>Colar texto da conta</h2>
    <textarea id="tdTxt" rows="8" placeholder="Cole aqui, um item por linha…"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn grow" id="tdOk">Ler</button><button class="btn sec" id="tdCancel">Cancelar</button></div></div>`;
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector("#tdCancel").onclick = close;
  dlg.querySelector("#tdOk").onclick = () => { const r = parseBill(dlg.querySelector("#tdTxt").value); close(); applyParsed(r); };
}

function applyParsed(parsed){
  if(!parsed.items?.length){ toast("Não achei itens. Tente manual."); return; }
  parsed.items.forEach(p => DRAFT.items.push({ name: p.name, qty: p.qty, unitPrice: parseMoney(p.unitPrice ?? p.price ?? 0), consumers: [...DRAFT.allIds] }));
  if(parsed.subtotal > 0) DRAFT.billTotal = null;
  if(parsed.total > 0) DRAFT.billTotal = parsed.total;
  if(parsed.service){ DRAFT.serviceOn = true; if(parsed.service.rate > 0) DRAFT.serviceRate = parsed.service.rate / 100; }
  paintNewExpense();
  toast(`${parsed.items.length} ${parsed.items.length>1?"itens":"item"} lido(s) ✓`);
}

/* ---------- foto: galeria + câmera ---------- */
function pickPhoto(sel){
  if(!ocrConfigured()){ toast("Configure o OCR (chave da API) em ⚙"); openCfg(); return; }
  const inp = $(sel); inp.value = ""; inp.onchange = async () => { if(inp.files?.[0]) await runOCR(inp.files[0]); }; inp.click();
}
async function runOCR(file){
  let img;
  try{ img = await fileToImage(file); }catch(e){ toast("Imagem inválida"); return; }
  const dlg = document.createElement("dialog"); dlg.innerHTML = `<div class="dlg-bd" style="text-align:center"><div class="spin"></div><p class="mut sm">Lendo a foto…</p></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  try{ const json = await ocrImage(img.data, img.media); applyParsed(normalizeOCR(json)); }
  catch(e){ toast(ocrError(e), 6000); }
  finally{ dlg.close(); dlg.remove(); }
}
function normalizeOCR(json){
  return {
    items: (json.items||[]).map(it => ({ name: it.name||"item", qty: Number(it.qty)||1, unitPrice: parseMoney(it.unitPrice ?? it.price ?? 0) })),
    subtotal: json.subtotal, total: json.total, service: json.service,
  };
}

/* câmera in-app via getUserMedia (não depende do capture) */
let camStream = null, camFacing = "environment";
function wireCamera(){
  $("#camCancel").onclick = closeCamera;
  $("#camFlip").onclick = flipCamera;
  $("#camShot").onclick = shootCamera;
  $("#camInput").onchange = async () => { const f = $("#camInput").files?.[0]; if(f) await runOCR(f); };
}
async function openCamera(){
  if(!ocrConfigured()){ toast("Configure o OCR (chave da API) em ⚙"); openCfg(); return; }
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
  const dlg = document.createElement("dialog"); dlg.innerHTML = `<div class="dlg-bd" style="text-align:center"><div class="spin"></div><p class="mut sm">Lendo a foto…</p></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  try{ const json = await ocrImage(data, "image/jpeg"); applyParsed(normalizeOCR(json)); }
  catch(e){ toast(ocrError(e), 6000); }
  finally{ dlg.close(); dlg.remove(); }
}

/* ============================ acerto (settle) ============================ */
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
        <div><div class="sm"><b>${esc(mById[t.from]?.display_name||"?")}</b> paga <b>${esc(mById[t.to]?.display_name||"?")}</b></div></div></div>
      <div class="row"><span class="b">${brl(t.amount)}</span><button class="btn sm" data-tx="${i}">Pix</button></div>
    </div>`).join("") : `<div class="banner ok">✓ Tá tudo quite. Ninguém deve nada.</div>`;
  app.innerHTML = `
    <div class="card"><div class="between"><a class="link" href="#/g/${groupId}">← grupo</a><span class="mut sm">acerto sugerido</span></div>
      <h2 style="margin:.3em 0 0">Quem paga quem</h2>
      <p class="sm mut">Transferências mínimas pra zerar todo mundo.</p>
    </div>
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

  let pixBlock;
  if(pix?.pix_key){
    let payload = "";
    try{ payload = buildPixPayload({ key: pix.pix_key, name: pix.pix_name || pix.name || to.display_name, city: "BRASIL", amount: t.amount, description: "Racha" }); }catch(_){ payload = ""; }
    pixBlock = payload ? `
      <p class="sm mut" style="margin-bottom:6px">Pix de <b>${esc(to.pix_name||to.display_name)}</b> — ${brl(t.amount)}</p>
      <div class="qr" id="sdQr"></div>
      <div class="pix-box" id="sdCopia">${esc(payload)}</div>
      <button class="btn sm block" id="sdCopy" style="margin-top:8px">Copiar código Pix</button>` : `<div class="banner warn">Não consegui montar o Pix.</div>`;
    setTimeout(() => { try{ const qr = qrcode(0, "M"); qr.addData(payload); qr.make(); $("#sdQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 }); }catch(_){ $("#sdQr").remove(); } }, 0);
  } else {
    pixBlock = `<div class="banner warn">${esc(to.display_name)} ainda não cadastrou a chave Pix. Peça pra entrar e salvar em ⚙, ou acerte por fora.</div>`;
  }

  dlg.innerHTML = `<div class="dlg-bd">
    <h2>${esc(from.display_name)} → ${esc(to.display_name)}</h2>
    <h3 style="margin-top:0">${brl(t.amount)}</h3>
    ${pixBlock}
    <div class="row" style="margin-top:16px">
      <button class="btn grow" id="sdDone">Marcar como pago</button>
      <button class="btn sec" id="sdClose">Fechar</button>
    </div>
  </div>`;
  if(pix?.pix_key){
    try{ const qr = qrcode(0, "M"); const payload = dlg.querySelector("#sdCopia").textContent; qr.addData(payload); qr.make(); dlg.querySelector("#sdQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 }); }catch(_){ dlg.querySelector("#sdQr")?.remove(); }
    dlg.querySelector("#sdCopy").onclick = () => copy(dlg.querySelector("#sdCopia").textContent);
  }
  dlg.querySelector("#sdClose").onclick = close;
  dlg.querySelector("#sdDone").onclick = async () => {
    await guard(() => db.addSettlement({ groupId, from: t.from, to: t.to, amount: t.amount }), "Não consegui registrar");
    toast("Acerto registrado ✓"); close(); renderSettle(groupId);
  };
}

/* ============================ join (convite) ============================ */
async function renderJoin(groupId){
  if(!ME){ sessionStorage.setItem("racha.join", groupId); return renderLogin(); }
  loading("Abrindo convite…");
  let name = "Grupo", ghosts = [];
  try{ [name, ghosts] = await Promise.all([ db.groupNameOf(groupId), db.ghostsOf(groupId) ]); }
  catch(e){ console.error(e); toast("Convite inválido"); return go("/"); }
  const ghostBtns = ghosts.length ? `<h3>Algum desses é você?</h3>
    <p class="sm mut" style="margin-top:0">Se você já aparece na conta, escolha seu nome pra juntar tudo.</p>
    ${ghosts.map(g => `<button class="btn sec block" style="margin-bottom:8px" data-claim="${g.id}">Sou ${esc(g.display_name)}</button>`).join("")}` : "";
  app.innerHTML = `<div class="card">
    <h2>Entrar em “${esc(name||"Grupo")}”</h2>
    ${ghostBtns}
    <button class="btn block" id="joinNew" style="margin-top:8px">Entrar como ${esc(PROFILE?.name || "novo membro")}</button>
    <p class="sm mut" style="text-align:center;margin-top:10px"><a class="link" href="#/">cancelar</a></p>
  </div>`;
  const join = async (claim) => { const mid = await guard(() => db.joinGroup(groupId, claim), "Não consegui entrar"); sessionStorage.removeItem("racha.join"); toast("Você entrou no grupo ✓"); go(`/g/${groupId}`); };
  $("#joinNew").onclick = () => join(null);
  app.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => join(b.dataset.claim));
}

/* ============================ header + config ============================ */
function wireHeader(){
  $("#hCfg").onclick = openCfg;
  $("#hAcct").onclick = async () => {
    if(ME){ if(confirm("Sair desta conta?")){ await db.signOut(); ME = null; PROFILE = null; paintAcct(); go("/"); route(); } }
    else go("/");
  };
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
    // OCR (chaves locais, compartilhadas com o app simples)
    const key = $("#cfgKey").value.trim(); const ocrUrl = $("#cfgOcrUrl").value.trim();
    if(key) localStorage.setItem("racha.apiKey", key); else localStorage.removeItem("racha.apiKey");
    localStorage.setItem("racha.ocrModel", $("#cfgModel").value);
    if(ocrUrl) localStorage.setItem("racha.ocrUrl", ocrUrl); else localStorage.removeItem("racha.ocrUrl");

    const hadConfig = db.hasConfig();
    if(url && anon) db.setSbConfig(url, anon);

    // salva o Pix no perfil (se logado)
    const pixKey = $("#cfgPix").value.trim(), pixName = $("#cfgPixName").value.trim();
    if(ME && (pixKey || pixName)){ try{ PROFILE = await db.saveProfile({ pix_key: pixKey || null, pix_name: pixName || null }); }catch(e){ console.error(e); } }

    $("#cfgDlg").close(); toast("Salvo ✓");
    if(!hadConfig && url && anon){ location.reload(); return; }   // primeira config: recarrega pra subir o cliente
    if(ME){ PROFILE = await db.getMyProfile(); paintAcct(); }
    route();
  };
}

/* ============================ util ============================ */
async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast("Copiado ✓"); }
  catch(_){ const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast("Copiado ✓"); }catch(__){ toast("Copie manualmente"); } ta.remove(); }
}

boot();
