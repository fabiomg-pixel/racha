// Parser do TEXTO da conta colado (sem foto). Mesma heurística do app original.
// Retorna { items:[{name, qty, unitPrice}], subtotal, service:{rate,amount}|null, total }
import { parseMoney } from "./money.js";

export function parseBill(text){
  const items = [];
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
    if(!rest) rest = "item";
    items.push({ name: rest, qty, unitPrice: val });
  });

  return { items, subtotal, service, total };
}
