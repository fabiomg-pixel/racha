// Parser do TEXTO da conta colado (sem foto). Mesma heurística do app original.
// Retorna { items:[{name, qty, unitPrice}], subtotal, service:{rate,amount}|null, total }
import { parseMoney } from "./money.js";

export function parseBill(text){
  const items = [], meta = [];
  let total = null, subtotal = null, service = null;

  String(text || "").split(/\r?\n/).forEach(line => {
    const raw = line.trim();
    if(!raw) return;
    const m = raw.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})\s*$/);
    const val = m ? parseMoney(m[1]) : null;
    const low = raw.toLowerCase();

    if(/servi[çc]o|gorjeta/.test(low) && !/\d+\s*x/i.test(raw)){
      const pct = raw.match(/(\d{1,2})\s*%/);
      service = { rate: pct ? parseInt(pct[1], 10) : null, amount: (val && val > 0) ? val : null };
      return;
    }
    if(/sub[\s-]?total/.test(low)){ if(val > 0) subtotal = val; return; }
    if(/^total|valor a pagar|total a pagar|total geral/.test(low)){ if(val > 0) total = val; return; }
    if(/troco|cnpj|cpf|mesa|gar[çc]om|atend|acr[ée]scimo|desconto|couvert/.test(low)) return;
    if(!(val > 0)) return;

    let rest = raw.slice(0, m.index).trim().replace(/[\.\-–—:\s]+$/, "");
    let qty = 1;
    const q = rest.match(/^(\d{1,3})\s*(x|un|und|unid|pç|pc|\b)\s+/i);
    if(q && parseInt(q[1], 10) > 0){ qty = parseInt(q[1], 10); rest = rest.slice(q[0].length).trim(); }
    rest = rest.replace(/^[xX]\s*/, "").replace(/\s{2,}/g, " ").trim();

    // O valor no fim da linha é o TOTAL da linha (como na conta impressa); unitPrice = total / qty.
    // Se a linha imprime unitário E total ("2 x 28,00 Caipirinha 56,00"), usa o unitário e tira-o do nome.
    let unitPrice = val, ambiguous = false;
    if(qty > 1){
      const u = rest.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/);
      const uv = u ? parseMoney(u[1]) : 0;
      if(uv > 0 && Math.abs(uv * qty - val) <= 0.01){
        unitPrice = uv;
        rest = (rest.slice(0, u.index) + " " + rest.slice(u.index + u[0].length)).replace(/\s{2,}/g, " ").trim();
      } else {
        unitPrice = Math.round(val / qty * 1e6) / 1e6;   // sem arredondar a 2 casas: qty×unit continua = total da linha ao centavo
        ambiguous = true;
      }
    }
    if(!rest) rest = "item";
    items.push({ name: rest, qty, unitPrice });
    meta.push({ val, ambiguous });
  });

  // Se o subtotal impresso só fecha lendo o valor como unitário, usa essa leitura.
  if(subtotal > 0 && meta.some(m => m.ambiguous)){
    const sum = f => items.reduce((s, it, i) => s + f(it, i), 0);
    const asTotal = sum(it => it.qty * it.unitPrice), asUnit = sum((it, i) => it.qty * (meta[i].ambiguous ? meta[i].val : it.unitPrice));
    if(Math.abs(asTotal - subtotal) > 0.01 && Math.abs(asUnit - subtotal) <= 0.01)
      items.forEach((it, i) => { if(meta[i].ambiguous) it.unitPrice = meta[i].val; });
  }

  return { items, subtotal, service, total };
}
