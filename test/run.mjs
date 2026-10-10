// Testes dos módulos puros — `node test/run.mjs`. Sem dependências.
import assert from "node:assert/strict";
import { computeShares, allocateByWeights } from "../js/split.js";
import { simplifyDebts, directDebts } from "../js/ledger.js";
import { buildPixPayload, validatePix, crc16 } from "../js/pix.js";
import { parseBill } from "../js/parse.js";
import { parseMoney } from "../js/money.js";
import { normalizeSupabaseUrl } from "../js/db.js";
import { createCouple, buildExpense, entryNet, ledgerBalances, coupleSummary, createStore, toRpcPayload, ledgerFromCloud } from "../js/model.js";

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok —", name); };
const sumCents = obj => Object.values(obj).reduce((s, v) => s + Math.round(v * 100), 0);
const toMapAmt = arr => Object.fromEntries(arr.map(x => [x.id, x.amount]));      // [{id,amount}] -> {id:amount}
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

console.log("split.js");
ok("rateio soma exatamente o total (serviço + couvert + desconto)", () => {
  const members = ["a", "b", "c"];
  const items = [
    { qty: 1, unitPrice: 30.00, consumers: ["a"] },
    { qty: 1, unitPrice: 30.00, consumers: ["b"] },
    { qty: 3, unitPrice: 10.00, consumers: ["a", "b", "c"] },   // 30 dividido em 3
  ];
  const r = computeShares(members, items, { serviceRate: 0.10, couvert: 10, discount: 5 });
  assert.equal(r.subtotal, 90);
  // total = 90 + 9 (serviço) + 10 (couvert) - 5 (desconto) = 104
  assert.equal(r.total, 104);
  assert.equal(sumCents(r.shares), Math.round(r.total * 100));   // bate ao centavo
});

ok("item sem ninguém marcado divide entre todos (nada vaza)", () => {
  const r = computeShares(["a", "b"], [{ qty: 1, unitPrice: 10, consumers: [] }], {});
  assert.equal(r.total, 10);
  assert.equal(sumCents(r.shares), 1000);
  assert.equal(r.shares.a, 5); assert.equal(r.shares.b, 5);
});

ok("centavos quebrados reconciliados (10 / 3)", () => {
  const r = computeShares(["a", "b", "c"], [{ qty: 1, unitPrice: 10, consumers: ["a", "b", "c"] }], {});
  assert.equal(sumCents(r.shares), 1000);          // 3.34 + 3.33 + 3.33
  const vals = Object.values(r.shares).map(v => Math.round(v * 100)).sort();
  assert.deepEqual(vals, [333, 333, 334]);
});

console.log("split.js — modo 'Igual' da despesa (reusa computeShares)");
ok("igual entre um subconjunto: 100 entre 2 de 3 (terceiro fica em 0)", () => {
  const r = computeShares(["a", "b", "c"], [{ qty: 1, unitPrice: 100, consumers: ["a", "b"] }], {});
  assert.equal(r.total, 100);
  assert.equal(sumCents(r.shares), 10000);
  assert.equal(r.shares.a, 50); assert.equal(r.shares.b, 50); assert.equal(r.shares.c, 0);
});
ok("igual com centavo quebrado: 100 entre 3 soma exato", () => {
  const r = computeShares(["a", "b", "c"], [{ qty: 1, unitPrice: 100, consumers: ["a", "b", "c"] }], {});
  assert.equal(sumCents(r.shares), 10000);
  assert.deepEqual(Object.values(r.shares).map(v => Math.round(v * 100)).sort((x, y) => x - y), [3333, 3333, 3334]);
});

console.log("split.js — allocateByWeights (% e partes)");
ok("porcentagem 60/40 de 100", () => {
  const s = allocateByWeights(100, { a: 60, b: 40 });
  assert.equal(sumCents(s), 10000);
  assert.equal(s.a, 60); assert.equal(s.b, 40);
});
ok("partes 2:1 de 90", () => {
  const s = allocateByWeights(90, { a: 2, b: 1 });
  assert.equal(s.a, 60); assert.equal(s.b, 30);
});
ok("pesos iguais com centavo quebrado somam exato (100 em 3)", () => {
  const s = allocateByWeights(100, { a: 1, b: 1, c: 1 });
  assert.equal(sumCents(s), 10000);
  assert.deepEqual(Object.values(s).map(v => Math.round(v * 100)).sort((x, y) => x - y), [3333, 3333, 3334]);
});

console.log("ledger.js");
ok("simplifyDebts zera todos os saldos", () => {
  const net = { a: -20, b: -10, c: 25, d: 5 };
  const tx = simplifyDebts(net);
  const after = { ...net };
  for(const t of tx){ after[t.from] += t.amount; after[t.to] -= t.amount; }
  for(const k of Object.keys(after)) assert.ok(Math.abs(after[k]) < 0.005, `saldo de ${k} = ${after[k]}`);
});

ok("simplifyDebts usa nº mínimo de transferências (≤ n-1)", () => {
  const net = { a: -30, b: -30, c: 20, d: 20, e: 20 };
  const tx = simplifyDebts(net);
  assert.ok(tx.length <= 4, `transferências = ${tx.length}`);
  assert.ok(tx.every(t => t.amount > 0));
});

ok("directDebts também quita (sem simplificar entre pares)", () => {
  const net = { a: -15, b: 15 };
  const tx = directDebts(net);
  const after = { ...net };
  for(const t of tx){ after[t.from] += t.amount; after[t.to] -= t.amount; }
  assert.ok(Math.abs(after.a) < 0.005 && Math.abs(after.b) < 0.005);
});

console.log("pix.js");
ok("CRC16/CCITT-FALSE de '123456789' = 29B1", () => {
  assert.equal(crc16("123456789"), "29B1");        // vetor de teste padrão
});
ok("payload válido e com CRC correto", () => {
  const p = buildPixPayload({ key: "fulano@email.com", name: "Fábio Gomes", city: "Rio de Janeiro", amount: 42.5 });
  assert.ok(validatePix(p), "CRC bate");
  assert.ok(p.startsWith("000201"), "começa com format indicator");
  assert.ok(p.includes("br.gov.bcb.pix"));
  assert.ok(p.includes("5405" + "42.50"), "valor formatado com 2 casas");
});
ok("acento e tamanho do nome são normalizados", () => {
  const p = buildPixPayload({ key: "11999990000", name: "José da Conceição Anতোnio Muito Longo", city: "São Paulo", amount: 1 });
  assert.ok(validatePix(p));
  assert.ok(!/[^\x00-\x7F]/.test(p), "sem caractere não-ascii no payload");
});

console.log("parse.js");
ok("parseMoney pt-BR", () => {
  assert.equal(parseMoney("1.234,56"), 1234.56);
  assert.equal(parseMoney("R$ 12,90"), 12.90);
  assert.equal(parseMoney("8.00"), 8.00);
});
ok("parseBill lê itens, subtotal, serviço e total", () => {
  const txt = [
    "2 Chopp           30,00",
    "Picanha           89,90",
    "Subtotal         119,90",
    "Serviço 10%       11,99",
    "Total            131,89",
  ].join("\n");
  const r = parseBill(txt);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].qty, 2);
  assert.equal(r.subtotal, 119.90);
  assert.equal(r.service.rate, 10);
  assert.equal(r.total, 131.89);
  assert.equal(r.items[0].unitPrice, 15);                            // valor no fim = total da linha
  assert.equal(Math.round(r.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * 100), 11990);   // itens somam o subtotal impresso
});
ok("parseBill: linha com quantidade usa o valor final como total da linha", () => {
  const r = parseBill(["Picanha           98,00", "Bolinho de feijoada 62,00", "2 Caipirinha      56,00",
    "Subtotal         216,00", "Serviço 10%       21,60", "Total            237,60"].join("\n"));
  assert.equal(r.items.length, 3);
  assert.equal(r.items[2].name, "Caipirinha");
  assert.equal(r.items[2].qty, 2);
  assert.equal(r.items[2].unitPrice, 28);
  assert.equal(Math.round(r.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * 100), 21600);
  assert.equal(r.subtotal, 216);
  assert.equal(r.total, 237.60);
});
ok("parseBill: unitário e total impressos na mesma linha — tira o unitário do nome", () => {
  const r = parseBill("2 x 28,00 Caipirinha 56,00");
  assert.deepEqual(r.items, [{ name: "Caipirinha", qty: 2, unitPrice: 28 }]);
});
ok("parseBill: 3 itens por 10,00 (unitário não inteiro) fecha ao centavo no rateio", () => {
  const r = parseBill("3 Pastel 10,00");
  assert.equal(r.items[0].qty, 3);
  const s = computeShares(["a", "b", "c"], r.items.map(i => ({ ...i, consumers: ["a", "b", "c"] })));
  assert.equal(Math.round(s.total * 100), 1000);
  assert.equal(sumCents(s.shares), 1000);
});

console.log("db.js");
ok("normalizeSupabaseUrl conserta os erros comuns", () => {
  const good = "https://abcdefghijklmnop.supabase.co";
  assert.equal(normalizeSupabaseUrl(good), good);
  assert.equal(normalizeSupabaseUrl(good + "/"), good);                                  // barra no fim
  assert.equal(normalizeSupabaseUrl("abcdefghijklmnop.supabase.co"), good);             // sem https
  assert.equal(normalizeSupabaseUrl("abcdefghijklmnop"), good);                          // só o ref
  assert.equal(normalizeSupabaseUrl("https://supabase.com/dashboard/project/abcdefghijklmnop"), good); // URL do painel
  assert.equal(normalizeSupabaseUrl("https://supabase.com/dashboard/project/abcdefghijklmnop/auth/users"), good);
  assert.equal(normalizeSupabaseUrl(good + "/rest/v1/"), good);                           // colou o endpoint REST
  assert.equal(normalizeSupabaseUrl(good + "/auth/v1"), good);
});

console.log("model.js — átomo rápido (sem conta) + histórico do casal");
ok("átomo rápido: eu pago 100, igual entre 2 → cada um 50; net soma zero", () => {
  const e = buildExpense({ description: "Mercado", amount: 100, method: "equal", participants: ["me", "ana"], payers: "me" });
  assert.equal(e.total, 100);
  assert.equal(sumCents(toMapAmt(e.shares)), 10000);
  const sh = toMapAmt(e.shares);
  assert.equal(sh.me, 50); assert.equal(sh.ana, 50);
  const n = entryNet(e);
  assert.equal(n.me, 50); assert.equal(n.ana, -50);                 // eu paguei, ela me deve
  assert.equal(Object.values(n).reduce((s, v) => s + Math.round(v * 100), 0), 0);
});

ok("átomo % 70/30 de 200, quem paga não é quem escreve", () => {
  const e = buildExpense({ amount: 200, method: "pct", participants: ["a", "b"], weights: { a: 70, b: 30 }, payers: "b" });
  assert.equal(toMapAmt(e.shares).a, 140);
  assert.equal(toMapAmt(e.shares).b, 60);
  const n = entryNet(e);
  assert.equal(n.b, 140);                                            // b pagou 200, devia 60 → +140
  assert.equal(n.a, -140);
});

ok("histórico do casal acumula saldo e o acerto zera", () => {
  const store = createStore(mem());
  const c = createCouple("Fábio", "Ana", { myPix: { key: "x", name: "F" } });
  store.save(c);
  const me = c.people[0].id, ana = c.people[1].id;
  store.addExpense(c.id, { description: "Mercado", amount: 100, method: "equal", payers: me });  // Ana deve 50
  store.addExpense(c.id, { description: "Jantar",  amount: 60,  method: "equal", payers: ana }); // eu devo 30
  let bal = ledgerBalances(store.get(c.id));
  assert.equal(bal[me], 20); assert.equal(bal[ana], -20);           // líquido: Ana me deve 20
  const sum = coupleSummary(store.get(c.id));
  assert.equal(sum.from, ana); assert.equal(sum.to, me); assert.equal(sum.amount, 20);
  store.addSettlement(c.id, ana, me, 20);                           // Ana me paga 20
  bal = ledgerBalances(store.get(c.id));
  assert.ok(Math.abs(bal[me]) < 0.005 && Math.abs(bal[ana]) < 0.005);
  assert.equal(coupleSummary(store.get(c.id)), null);              // quite
});

ok("divisão por item alimenta o casal (quem comeu o quê)", () => {
  const store = createStore(mem());
  const c = createCouple("Fábio", "Ana"); store.save(c);
  const me = c.people[0].id, ana = c.people[1].id;
  store.addExpense(c.id, { description: "Restaurante", method: "item", payers: me,
    items: [{ name: "Picanha", qty: 1, unitPrice: 60, consumers: [me] }, { name: "Suco", qty: 1, unitPrice: 30, consumers: [me, ana] }] });
  const bal = ledgerBalances(store.get(c.id));                      // eu devo 60+15=75, ela 15; paguei 90
  assert.equal(bal[me], 15); assert.equal(bal[ana], -15);
});

ok("histórico persiste: relê do mesmo backend sem perder saldo", () => {
  const backend = mem();
  const store = createStore(backend);
  const c = createCouple("A", "B"); store.save(c);
  const a = c.people[0].id;
  store.addExpense(c.id, { amount: 40, method: "equal", payers: a });
  const before = ledgerBalances(store.get(c.id));
  const store2 = createStore(backend);                             // simula recarregar o app
  assert.deepEqual(ledgerBalances(store2.get(c.id)), before);
});

ok("toRpcPayload mapeia o átomo pro Supabase (member_id, soma bate)", () => {
  const e = buildExpense({ description: "X", amount: 100, method: "equal", participants: ["me", "ana"], payers: "me", category: "Mercado" });
  const p = toRpcPayload("grp1", e, { me: "m1", ana: "m2" });
  assert.equal(p.group_id, "grp1");
  assert.equal(p.category, "Mercado");
  assert.equal(p.payers[0].member_id, "m1");
  assert.equal(sumCents(Object.fromEntries(p.shares.map(s => [s.member_id, s.amount]))), 10000);
});

console.log("model.js — ida e volta da nuvem (casal no Supabase)");
// simula o servidor: guarda o payload do RPC e devolve linhas no formato das tabelas
const asRow = (id, p, at) => ({ id, description: p.description, category: p.category, note: p.note, spent_at: p.spent_at, created_at: at,
  subtotal: p.subtotal, service_rate: p.service_rate, service_amount: p.service_amount, couvert: p.couvert, discount: p.discount, total: p.total,
  items: p.items.map(it => ({ name: it.name, qty: it.qty, unit_price: it.unit_price, position: it.position, shares: it.shares })), payers: p.payers, shares: p.shares });
const GROUP = { id: "g1", kind: "couple", name: "Fábio & Ana" };
const MEMBERS = [{ id: "mA", user_id: null, display_name: "Ana" }, { id: "mF", user_id: "uF", display_name: "Fábio" }];

ok("o que sobe volta igual: mesmo saldo no aparelho e na nuvem", () => {
  const local = [
    buildExpense({ description: "Mercado", category: "🛒 Mercado", amount: 247.80, method: "equal", participants: ["mF", "mA"], payers: "mF" }),
    buildExpense({ description: "Uber", amount: 30, method: "equal", participants: ["mF"], payers: "mA" }),
    buildExpense({ description: "Jantar", method: "item", participants: ["mF", "mA"], payers: "mA", opts: { serviceRate: 0.10 },
      items: [{ name: "Picanha", qty: 1, unitPrice: 98, consumers: ["mF"] }, { name: "Caipirinha", qty: 2, unitPrice: 28, consumers: [] }] }),
  ];
  const rows = local.map((e, i) => asRow("e" + i, toRpcPayload("g1", e), "2026-10-0" + (i + 1)));
  rows.forEach(r => {                                    // o servidor recusa se pagadores/rateio não somam o total
    assert.equal(sumCents(Object.fromEntries(r.payers.map(x => [x.member_id, x.amount]))), Math.round(r.total * 100));
    assert.equal(sumCents(Object.fromEntries(r.shares.map(x => [x.member_id, x.amount]))), Math.round(r.total * 100));
  });
  const cloud = ledgerFromCloud({ group: GROUP, members: MEMBERS, expenses: rows, settlements: [], myUserId: "uF" });
  const want = ledgerBalances({ people: [{ id: "mF" }, { id: "mA" }], entries: local });
  assert.deepEqual(ledgerBalances(cloud), want);
  assert.equal(cloud.people[0].id, "mF"); assert.ok(cloud.people[0].isMe);     // eu venho primeiro
  assert.equal(cloud.people[1].userId, null);                                  // Ana ainda é fantasma
  assert.equal(cloud.entries[1].participants.length, 1);                       // "só eu" continua só eu
  assert.equal(cloud.entries[2].method, "item");
  assert.equal(cloud.entries[2].opts.serviceRate, 0.10);
  assert.equal(rows[2].items[1].shares.length, 2);                             // item sem ninguém marcado = os dois
  assert.equal(rows[2].subtotal, 154); assert.equal(rows[2].service_amount, 15.4);
});

ok("acerto da nuvem zera o saldo e a chave Pix vem do perfil de quem tem conta", () => {
  const e = buildExpense({ amount: 100, method: "equal", participants: ["mF", "mA"], payers: "mF" });
  const cloud = ledgerFromCloud({ group: GROUP, members: MEMBERS, myUserId: "uF",
    expenses: [asRow("e0", toRpcPayload("g1", e), "2026-10-01T10:00:00Z")],
    settlements: [{ id: "s1", from_member: "mA", to_member: "mF", amount: 50, settled_at: "2026-10-02T12:00:00Z" }],
    pixByUser: { uF: { pix_key: "fabio@pix.com", pix_name: "Fábio Gomes" } } });
  assert.equal(coupleSummary(cloud), null);
  assert.equal(cloud.entries[1].type, "settlement"); assert.equal(cloud.entries[1].spentAt, "2026-10-02");
  assert.deepEqual(cloud.people[0].pix, { key: "fabio@pix.com", name: "Fábio Gomes" });
  assert.equal(cloud.people[1].pix, null);
});

console.log(`\n${pass} testes passaram ✓`);
