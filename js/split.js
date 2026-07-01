// Rateio de UMA despesa entre os membros — serviço/desconto pelo consumo, couvert igual.
// Reconciliação por maior resto garante que a soma das partes bate o total exato (em centavos).
import { cents, fromCents } from "./money.js";

// members: [memberId]
// items:   [{ qty, unitPrice, consumers:[memberId] }]  (consumers vazio = todos dividem)
// opts:    { serviceRate=0, couvert=0, discount=0 }
// retorna: { subtotal, serviceAmount, couvert, discount, total, shares:{memberId:amount} }
export function computeShares(members, items, opts = {}){
  const serviceRate = Number(opts.serviceRate) || 0;
  const couvert     = Number(opts.couvert) || 0;
  const discount    = Number(opts.discount) || 0;

  const sub = {};                       // consumo por membro
  members.forEach(m => { sub[m] = 0; });
  let subtotal = 0;

  for(const it of items){
    const line = (Number(it.qty)||0) * (Number(it.unitPrice)||0);
    if(line <= 0) continue;
    subtotal += line;
    let who = (it.consumers || []).filter(id => sub.hasOwnProperty(id));
    if(who.length === 0) who = members.slice();   // ninguém marcado => todos dividem (nada "vaza")
    if(who.length === 0) continue;
    const each = line / who.length;
    who.forEach(id => { sub[id] += each; });
  }

  const perCouvert = members.length ? couvert / members.length : 0;
  const total = subtotal + subtotal * serviceRate + couvert - discount;

  // total bruto por membro (antes de arredondar)
  const raw = members.map(m => {
    const service = sub[m] * serviceRate;
    const disc    = subtotal > 0 ? discount * (sub[m] / subtotal) : 0;
    return { m, amount: sub[m] + service + perCouvert - disc };
  });

  const shares = reconcile(raw, total);
  return {
    subtotal,
    serviceAmount: subtotal * serviceRate,
    couvert,
    discount,
    total,
    shares,
  };
}

// Rateia `total` proporcional a pesos, reconciliando centavos.
// weights: { memberId: peso }. Serve pra % (peso = porcentagem) e partes (peso = nº de partes).
export function allocateByWeights(total, weights){
  const ids = Object.keys(weights || {}).filter(id => (Number(weights[id]) || 0) > 0);
  if(!ids.length) return {};
  const wsum = ids.reduce((s, id) => s + Number(weights[id]), 0);
  const raw = ids.map(id => ({ m: id, amount: (Number(total) || 0) * Number(weights[id]) / wsum }));
  return reconcile(raw, Number(total) || 0);
}

// distribui o resíduo de arredondamento (maior resto) pra somar exatamente `total`
export function reconcile(raw, total){
  const out = {};
  if(!raw.length) return out;
  const target = cents(total);
  const floors = raw.map(r => Math.floor((Number(r.amount)||0) * 100));
  let diff = target - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: ((Number(r.amount)||0) * 100) - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for(let k = 0; diff > 0 && order.length; k++, diff--) floors[order[k % order.length].i]++;
  for(let k = 0; diff < 0 && order.length; k++, diff++) floors[order[order.length - 1 - (k % order.length)].i]--;
  raw.forEach((r, i) => { out[r.m] = fromCents(floors[i]); });
  return out;
}
