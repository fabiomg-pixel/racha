// Racha — OCR de conta via Claude vision (Supabase Edge Function / Deno)
// Recebe { image: base64, mediaType } e devolve { items:[{name,qty,unitPrice}], serviceIncluded }
// A chave fica no servidor:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("RACHA_MODEL") ?? "claude-haiku-4-5-20251001"; // troque p/ sonnet em cupom difícil

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `Você recebe a FOTO de uma conta/cupom de restaurante ou bar no Brasil.
Extraia os itens de consumo e responda APENAS com JSON válido, sem texto extra, neste formato:
{"items":[{"name":"nome do item","qty":1,"unitPrice":0.00}],"serviceIncluded":false}
Regras:
- unitPrice é o preço UNITÁRIO em reais (número, ponto decimal). Se a linha mostra só o total da linha, divida pelo qty.
- qty é a quantidade (inteiro). Quando não houver, use 1.
- NÃO inclua linhas de total, subtotal, troco, taxa de serviço, couvert, CNPJ ou impostos como itens.
- Se houver taxa de serviço (10%) na conta, marque "serviceIncluded": true.
- Não invente itens que não estão legíveis.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  if (!KEY) return json({ error: "ANTHROPIC_API_KEY ausente" }, 500);

  try {
    const { image, mediaType } = await req.json();
    if (!image) return json({ error: "sem imagem" }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });

    if (!r.ok) return json({ error: "anthropic " + r.status, detail: await r.text() }, 502);
    const data = await r.json();
    const text = (data.content?.[0]?.text ?? "").trim();
    const m = text.match(/\{[\s\S]*\}/);            // tira cercas de código se vierem
    const parsed = m ? JSON.parse(m[0]) : { items: [] };
    return json({ items: parsed.items ?? [], serviceIncluded: !!parsed.serviceIncluded });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
