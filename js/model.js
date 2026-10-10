// Modelo de domínio do Racha — átomo de despesa (rápido, sem conta) + histórico (livro-razão local).
// Local-first: tudo funciona sem login e serializa em JSON; o MESMO átomo alimenta o Supabase (toRpcPayload).
// Reusa a matemática pura: split.js (rateio de UMA despesa) e ledger.js (saldos → transferências mínimas).
import { computeShares, allocateByWeights, reconcile } from "./split.js";
import { simplifyDebts } from "./ledger.js";
import { cents } from "./money.js";

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function uid(){
  try{ return crypto.randomUUID(); }catch(_){}
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayISO(d){
  const t = d ? new Date(d) : new Date();
  return t.toISOString().slice(0, 10);
}

// [{id,amount}] <-> {id:amount}
const toMap   = arr => { const m = {}; (arr || []).forEach(x => { m[x.id] = (m[x.id] || 0) + Number(x.amount || 0); }); return m; };
const fromMap = map => Object.keys(map || {}).map(id => ({ id, amount: round2(map[id]) }));
// reconcilia uma lista pro total exato (maior resto), reusando reconcile() de split.js
const fixTo   = (arr, total) => { const r = reconcile(arr.map(x => ({ m: x.id, amount: x.amount })), total); return Object.keys(r).map(id => ({ id, amount: r[id] })); };

// ── Pessoas ────────────────────────────────────────────────────────────────
// Fantasma-primeiro: existe como nome; userId só entra quando a pessoa loga e "reivindica".
export function makePerson(name, opts = {}){
  return {
    id: opts.id || uid(),
    name: String(name || "").trim() || "?",
    pix: opts.pix || null,
    isMe: !!opts.isMe,
    userId: opts.userId || null,
  };
}

// ── Átomo de despesa (o "modelo rápido") ─────────────────────────────────────
// draft: {
//   description?, category?, note?, spentAt?, receipt?,
//   participants:[id],
//   method: 'equal'|'pct'|'parts'|'exact'|'item',
//   amount?,                       // equal/pct/parts (total da conta)
//   weights?:{id:peso},            // pct (%) e parts (nº de partes)
//   exact?:{id:valor},             // valores exatos por pessoa
//   items?, opts?,                 // por item (reusa computeShares)
//   payers?: id | [{id,amount}] | {id:amount},   // quem pagou (default: 1º participante)
// }
// retorna um registro validado: soma(shares) == soma(payers) == total, no centavo.
export function buildExpense(draft = {}){
  const participants = (draft.participants || []).slice();
  if(!participants.length) throw new Error("despesa sem participantes");
  const method = draft.method || "equal";

  // 1) quanto cada um DEVE (shares) + total
  let sharesMap = {}, total = 0, items = null, opts = null;

  if(method === "item"){
    items = (draft.items || []).map(it => ({
      name: it.name || "",
      qty: Number(it.qty) || 0,
      unitPrice: Number(it.unitPrice ?? it.unit_price) || 0,
      consumers: (it.consumers || []).slice(),
    }));
    opts = {
      serviceRate: Number(draft.opts?.serviceRate) || 0,
      couvert:     Number(draft.opts?.couvert) || 0,
      discount:    Number(draft.opts?.discount) || 0,
    };
    const r = computeShares(participants, items.map(it => ({ qty: it.qty, unitPrice: it.unitPrice, consumers: it.consumers })), opts);
    sharesMap = r.shares;
    total = round2(r.total);
  } else if(method === "exact"){
    const ex = draft.exact || {};
    const raw = Object.keys(ex).map(id => ({ id, amount: Number(ex[id]) || 0 })).filter(x => x.amount > 0);
    total = round2(raw.reduce((s, x) => s + x.amount, 0));
    fixTo(raw, total).forEach(x => { sharesMap[x.id] = x.amount; });
  } else {                                   // equal | pct | parts
    total = round2(draft.amount);
    const weights = {};
    if(method === "equal"){
      participants.forEach(id => { weights[id] = 1; });
    } else {
      participants.forEach(id => { const w = Number((draft.weights || {})[id]) || 0; if(w > 0) weights[id] = w; });
    }
    sharesMap = allocateByWeights(total, weights);
  }
  participants.forEach(id => { if(!(id in sharesMap)) sharesMap[id] = 0; });

  // 2) quem PAGOU (payers) — resíduo cai no maior pagador pra somar o total exato
  const payersMap = normalizePayers(draft.payers, participants, total);

  return {
    id: draft.id || uid(),
    type: "expense",
    description: draft.description || "Despesa",
    category: draft.category || null,
    note: draft.note || null,
    spentAt: draft.spentAt || todayISO(),
    method,
    total,
    participants,
    shares: fromMap(sharesMap).filter(s => s.amount !== 0),
    payers: fromMap(payersMap).filter(p => p.amount !== 0),
    ...(items ? { items, opts } : {}),
    ...(draft.receipt ? { receipt: draft.receipt } : {}),
  };
}

function normalizePayers(payers, participants, total){
  const map = {};
  if(!payers)                         map[participants[0]] = total;                 // default: 1º participante pagou tudo
  else if(typeof payers === "string") map[payers] = total;
  else if(Array.isArray(payers))      payers.forEach(p => { map[p.id] = (map[p.id] || 0) + Number(p.amount || 0); });
  else                                Object.keys(payers).forEach(id => { const v = Number(payers[id]) || 0; if(v) map[id] = v; });

  const arr = Object.keys(map).map(id => ({ id, amount: round2(map[id]) })).filter(p => p.amount !== 0);
  if(!arr.length) return { [participants[0]]: total };

  const diff = cents(total) - arr.reduce((s, p) => s + cents(p.amount), 0);
  if(diff !== 0){                                                                   // encosta o resíduo no maior pagador
    let bi = 0; arr.forEach((p, i) => { if(p.amount > arr[bi].amount) bi = i; });
    arr[bi].amount = round2(arr[bi].amount + diff / 100);
  }
  const out = {}; arr.forEach(p => { out[p.id] = p.amount; }); return out;
}

// Acerto: A paga X pra B (dinheiro/Pix). Zera dívida sem ser "despesa".
export function buildSettlement(fromId, toId, amount, meta = {}){
  const a = round2(amount);
  if(!fromId || !toId || fromId === toId || a <= 0) throw new Error("acerto inválido");
  return { id: meta.id || uid(), type: "settlement", from: fromId, to: toId, amount: a, spentAt: meta.spentAt || todayISO(), note: meta.note || null };
}

// ── Efeito de UMA entrada no saldo: { id: pago − devido }. Soma sempre zero. ──
export function entryNet(entry){
  const net = {};
  const add = (id, v) => { net[id] = round2((net[id] || 0) + v); };
  if(entry.type === "settlement"){ add(entry.from, entry.amount); add(entry.to, -entry.amount); return net; }
  (entry.payers || []).forEach(p => add(p.id, Number(p.amount) || 0));    // pagou (+)
  (entry.shares || []).forEach(s => add(s.id, -(Number(s.amount) || 0))); // deve (−)
  return net;
}

// ── Livro-razão (o "histórico") ──────────────────────────────────────────────
export function createLedger({ name, kind = "group", people = [] } = {}){
  return { id: uid(), kind, name: name || "Sem nome", people: people.slice(), entries: [], createdAt: todayISO() };
}

// Casal = o caso mais simples do livro-razão (n=2). "partir daí" pra grupos/viagens é o mesmo modelo.
export function createCouple(meName, otherName, opts = {}){
  const me    = makePerson(meName,    { isMe: true, pix: opts.myPix || null });
  const other = makePerson(otherName, { pix: opts.otherPix || null });
  return createLedger({ name: opts.name || `${me.name} & ${other.name}`, kind: "couple", people: [me, other] });
}

// saldo acumulado: >0 tem a receber, <0 deve.
export function ledgerBalances(ledger){
  const bal = {};
  (ledger.people || []).forEach(p => { bal[p.id] = 0; });
  (ledger.entries || []).forEach(e => { const n = entryNet(e); for(const id in n) bal[id] = round2((bal[id] || 0) + n[id]); });
  return bal;
}

export function ledgerTransfers(ledger){ return simplifyDebts(ledgerBalances(ledger)); }

// atalho pro casal: {from,to,amount} de quem deve pra quem — ou null se quite.
export function coupleSummary(ledger){
  const tx = ledgerTransfers(ledger);
  return tx.length ? tx[0] : null;
}

// helpers imutáveis (retornam novo ledger)
export function addEntry(ledger, entry){ return { ...ledger, entries: [...(ledger.entries || []), entry] }; }
export function removeEntry(ledger, entryId){ return { ...ledger, entries: (ledger.entries || []).filter(e => e.id !== entryId) }; }
export function replaceEntry(ledger, entry){ return { ...ledger, entries: (ledger.entries || []).map(e => e.id === entry.id ? entry : e) }; }

// ── Persistência local (sem conta) ───────────────────────────────────────────
// backend pluggável: localStorage no browser; qualquer {getItem,setItem} nos testes.
const STORE_KEY = "racha.model.v1";
export function createStore(backend){
  const io = backend || (typeof localStorage !== "undefined" ? localStorage : memoryBackend());
  const read  = () => { try{ return JSON.parse(io.getItem(STORE_KEY)) || { ledgers: {}, order: [] }; }catch(_){ return { ledgers: {}, order: [] }; } };
  const write = s  => io.setItem(STORE_KEY, JSON.stringify(s));
  const api = {
    list(){ const s = read(); return s.order.map(id => s.ledgers[id]).filter(Boolean); },
    get(id){ return read().ledgers[id] || null; },
    save(ledger){ const s = read(); if(!s.ledgers[ledger.id]) s.order.push(ledger.id); s.ledgers[ledger.id] = ledger; write(s); return ledger; },
    remove(id){ const s = read(); delete s.ledgers[id]; s.order = s.order.filter(x => x !== id); write(s); },
    addExpense(id, draft){
      const l = api.get(id); if(!l) throw new Error("ledger não encontrado");
      const entry = buildExpense({ ...draft, participants: draft.participants || l.people.map(p => p.id) });
      const next = addEntry(l, entry); api.save(next); return { ledger: next, entry };
    },
    addSettlement(id, from, to, amount, meta){
      const l = api.get(id); if(!l) throw new Error("ledger não encontrado");
      const entry = buildSettlement(from, to, amount, meta);
      const next = addEntry(l, entry); api.save(next); return { ledger: next, entry };
    },
    removeEntry(id, entryId){ const l = api.get(id); if(!l) return null; const next = removeEntry(l, entryId); api.save(next); return next; },
  };
  return api;
}
function memoryBackend(){ const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }

// ── Ponte pro sistema: átomo local → payload do RPC create_expense/update_expense (Supabase) ─
// memberMap: { idLocal: server_member_id } (default: identidade). Um átomo, dois destinos.
export function toRpcPayload(groupId, entry, memberMap = {}){
  const mid = id => (memberMap[id] || id);
  if(entry.type === "settlement"){
    return { kind: "settlement", group_id: groupId, from_member: mid(entry.from), to_member: mid(entry.to), amount: entry.amount, spent_at: entry.spentAt };
  }
  const items = entry.items || [];
  const subtotal = items.length ? round2(items.reduce((t, it) => t + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)) : entry.total;
  const rate = items.length ? (Number(entry.opts?.serviceRate) || 0) : 0;
  const everyone = entry.participants || [];
  return {
    group_id: groupId,
    description: entry.description,
    category: entry.category,
    note: entry.note,
    place: null,
    spent_at: entry.spentAt,
    subtotal, service_rate: rate, service_amount: round2(subtotal * rate),
    couvert: items.length ? round2(entry.opts?.couvert) : 0,
    discount: items.length ? round2(entry.opts?.discount) : 0,
    total: entry.total,
    items: items.map((it, i) => {
      const who = (it.consumers || []).filter(id => everyone.includes(id));
      return { name: it.name, qty: it.qty, unit_price: it.unitPrice, position: i, shares: (who.length ? who : everyone).map(id => ({ member_id: mid(id), weight: 1 })) };
    }),
    payers: entry.payers.map(p => ({ member_id: mid(p.id), amount: p.amount })),
    shares: entry.shares.map(s => ({ member_id: mid(s.id), amount: s.amount })),
    ...(entry.receipt ? { receipt: entry.receipt } : {}),
  };
}

// ── Volta do sistema: linhas do Supabase → o MESMO livro-razão que as telas já usam ─────────
// Pessoa = membro do grupo (id do membro). Assim a tela do casal não sabe se o dado veio do aparelho ou da nuvem.
export function ledgerFromCloud({ group, members = [], expenses = [], settlements = [], myUserId = null, pixByUser = {} }){
  const people = members.map(m => {
    const px = m.user_id ? pixByUser[m.user_id] : null;
    return { id: m.id, name: m.display_name, isMe: !!myUserId && m.user_id === myUserId, userId: m.user_id || null,
             pix: px && px.pix_key ? { key: px.pix_key, name: px.pix_name || px.name || m.display_name } : null };
  }).sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
  const rows = arr => (arr || []).map(x => ({ id: x.member_id, amount: round2(x.amount) })).filter(x => x.amount !== 0);
  const exp = expenses.map(e => {
    const shares = rows(e.shares), payers = rows(e.payers);
    const items = (e.items || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(it => ({ name: it.name || "", qty: Number(it.qty) || 0, unitPrice: Number(it.unit_price) || 0, consumers: (it.shares || []).map(x => x.member_id) }));
    const even = shares.length > 0 && shares.every(x => Math.abs(x.amount - shares[0].amount) <= 0.011);
    return {
      id: e.id, type: "expense", description: e.description || "Despesa", category: e.category || null, note: e.note || null,
      spentAt: e.spent_at, createdAt: e.created_at, method: items.length ? "item" : even ? "equal" : "exact",
      total: round2(e.total), participants: shares.map(x => x.id), shares, payers,
      ...(items.length ? { items, opts: { serviceRate: Number(e.service_rate) || 0, couvert: Number(e.couvert) || 0, discount: Number(e.discount) || 0 } } : {}),
    };
  });
  const set = settlements.map(x => ({ id: x.id, type: "settlement", from: x.from_member, to: x.to_member, amount: round2(x.amount),
    spentAt: String(x.settled_at || "").slice(0, 10), createdAt: x.settled_at, note: x.note || null }));
  const entries = [...exp, ...set].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return { id: group.id, kind: group.kind || "group", name: group.name, people, entries, createdAt: group.created_at, cloud: true };
}
