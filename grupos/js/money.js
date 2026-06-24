// dinheiro: parsing pt-BR e formatação
export function parseMoney(raw){
  if(typeof raw === "number") return isFinite(raw) ? raw : 0;
  if(!raw) return 0;
  let s = String(raw).replace(/[R$\s]/gi, "");
  if(s.includes(",")){ s = s.replace(/\./g, "").replace(",", "."); }   // 1.234,56 -> 1234.56
  const v = parseFloat(s);
  return isFinite(v) ? v : 0;
}

export function brl(n){
  return (Number(n)||0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

// arredonda pra centavo de forma estável
export const cents = n => Math.round((Number(n)||0) * 100);
export const fromCents = c => c / 100;
