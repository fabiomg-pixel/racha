// Testes dos módulos puros — `node test/run.mjs`. Sem dependências.
import assert from "node:assert/strict";
import { computeShares } from "../js/split.js";
import { simplifyDebts, directDebts } from "../js/ledger.js";
import { buildPixPayload, validatePix, crc16 } from "../js/pix.js";
import { parseBill } from "../js/parse.js";
import { parseMoney } from "../js/money.js";
import { normalizeSupabaseUrl } from "../js/db.js";

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok —", name); };
const sumCents = obj => Object.values(obj).reduce((s, v) => s + Math.round(v * 100), 0);

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
});

console.log(`\n${pass} testes passaram ✓`);
