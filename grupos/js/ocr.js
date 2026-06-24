// OCR da foto da conta via Claude vision. Reusa as MESMAS chaves do app original
// (localStorage racha.ocrUrl = proxy Supabase, ou racha.apiKey = chave direta).
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const OCR_PROMPT = `Você recebe a FOTO de uma conta/cupom de restaurante ou bar no Brasil.
Extraia os dados e responda APENAS com JSON válido, sem texto extra, neste formato:
{"items":[{"name":"nome do item","qty":1,"unitPrice":0.00}],"subtotal":0.00,"service":{"rate":10,"amount":0.00},"total":0.00}
Regras:
- items: cada item de consumo. unitPrice é o preço UNITÁRIO em reais (número, ponto decimal); se a linha mostra só o total da linha, divida pelo qty. qty é inteiro (1 se não houver). NÃO inclua linhas de total, subtotal, serviço, couvert, CNPJ ou impostos como itens. Não invente itens ilegíveis. Cuidado para NÃO repetir o mesmo item duas vezes.
- subtotal: a soma do consumo ANTES da taxa de serviço, exatamente como impressa; se não houver, use null.
- service: a taxa de serviço/gorjeta SE existir na conta — "rate" é o percentual (ex.: 10) e "amount" o valor em reais; se a conta não cobra serviço, use null.
- total: o total final impresso na conta; se não houver, use null.
- Use null quando o campo não estiver visível. Não calcule nada que não esteja impresso.`;

export function ocrConfigured(){
  return !!(localStorage.getItem("racha.ocrUrl") || localStorage.getItem("racha.apiKey"));
}

// File -> { data: base64, media } com compressão (lado maior ≤1600px, jpeg 0.82)
export function fileToImage(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600; let { width: w, height: h } = img;
      if(Math.max(w, h) > max){ const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve({ data: cv.toDataURL("image/jpeg", 0.82).split(",")[1], media: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}

// base64 -> { items, subtotal, service, total }
export async function ocrImage(data, media){
  const url = localStorage.getItem("racha.ocrUrl");
  const key = localStorage.getItem("racha.apiKey");
  if(url) return await proxyOCR(url, data, media);
  if(key) return await directOCR(data, media, key);
  throw new Error("Sem OCR configurado. Informe a chave da API ou a URL do proxy em ⚙.");
}

async function proxyOCR(url, data, media){
  let res;
  try{ res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: data, mediaType: media }) }); }
  catch(err){ throw new Error("rede: " + (err?.message || err)); }
  if(!res.ok){ let d = ""; try{ d = (await res.json())?.error || ""; }catch(_){}
    throw new Error("HTTP " + res.status + (d ? ": " + d : "")); }
  return await res.json();
}

async function directOCR(image, media, key){
  const model = localStorage.getItem("racha.ocrModel") || DEFAULT_MODEL;
  let res;
  try{
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data: image } },
        { type: "text", text: OCR_PROMPT },
      ] }] }),
    });
  }catch(err){ throw new Error("rede: " + (err?.message || err)); }
  if(!res.ok){ let d = ""; try{ d = (await res.json())?.error?.message || ""; }catch(_){}
    throw new Error("HTTP " + res.status + (d ? ": " + d : "")); }
  const j = await res.json();
  const text = (j.content?.[0]?.text || "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error("vazio");
  return JSON.parse(m[0]);
}

export function ocrError(e){
  const s = String(e?.message || e);
  console.error("[Racha OCR]", e);
  if(/401|403|authentication|invalid x-api-key|permission/i.test(s)) return "Chave inválida ou sem permissão. Confira em ⚙.";
  if(/credit|billing|balance|payment|quota|insufficient/i.test(s)) return "Sem créditos na API Anthropic. Adicione créditos no console — é cobrança separada do Claude Code.";
  if(/429|rate.?limit|overloaded|529/i.test(s)) return "API ocupada ou limite atingido. Tente de novo em instantes.";
  if(/404|not.?found|model/i.test(s)) return "Modelo indisponível pra essa conta. Tente o outro modelo em ⚙.";
  if(/rede|network|cors|failed to fetch/i.test(s)) return "Sem conexão com o serviço de OCR. Tente de novo.";
  return "Não consegui ler a foto. Tente de novo ou use texto/manual.";
}
