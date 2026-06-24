// Livro-razão: do saldo líquido de cada um para a lista mínima de transferências.

// net: { memberId: saldoLiquido }  (>0 tem a receber, <0 deve)
// Simplificação de dívidas (min cash flow guloso) — mesmo espírito do "simplify debts" do Splitwise.
// Reduz o nº de pix: em vez de A→C e B→C separados, junta no menor conjunto de transferências.
export function simplifyDebts(net){
  const bal = Object.keys(net)
    .map(id => ({ id, c: Math.round((Number(net[id]) || 0) * 100) }))
    .filter(x => x.c !== 0);

  const debtors   = bal.filter(x => x.c < 0).sort((a, b) => a.c - b.c); // mais negativo primeiro
  const creditors = bal.filter(x => x.c > 0).sort((a, b) => b.c - a.c); // mais positivo primeiro

  const tx = [];
  let i = 0, j = 0;
  let guard = 0;
  while(i < debtors.length && j < creditors.length && guard++ < 10000){
    const d = debtors[i], c = creditors[j];
    const amt = Math.min(-d.c, c.c);
    if(amt > 0){
      tx.push({ from: d.id, to: c.id, amount: amt / 100 });
      d.c += amt; c.c -= amt;
    }
    if(d.c === 0) i++;
    if(c.c === 0) j++;
  }
  return tx;
}

// transferências SEM simplificar entre pares: cada um paga proporcionalmente a cada credor.
// (útil como alternativa quando a pessoa não quer pagar "estranho" — fase 3, toggle)
export function directDebts(net){
  const creditors = Object.keys(net).filter(id => net[id] > 0).map(id => ({ id, c: Math.round(net[id]*100) }));
  const debtors   = Object.keys(net).filter(id => net[id] < 0).map(id => ({ id, c: Math.round(-net[id]*100) }));
  const totalCred = creditors.reduce((s, x) => s + x.c, 0) || 1;
  const tx = [];
  for(const d of debtors){
    for(const c of creditors){
      const amt = Math.round(d.c * c.c / totalCred);
      if(amt > 0) tx.push({ from: d.id, to: c.id, amount: amt / 100 });
    }
  }
  return tx;
}

// converte as linhas do RPC group_balances num mapa { memberId: net }
export function netFromRows(rows){
  const net = {};
  for(const r of rows) net[r.member_id] = Number(r.net) || 0;
  return net;
}
