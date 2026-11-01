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
Extraia os dados exatamente como impressos.
Regras:
- items: cada item de consumo. qty é inteiro (1 se não houver). lineTotal é o valor da linha em reais, como impresso; unitPrice é o preço unitário SÓ se estiver impresso, senão null (o app calcula lineTotal ÷ qty). NÃO inclua linhas de total, subtotal, serviço, couvert, CNPJ ou impostos como itens. Não invente itens ilegíveis. Cuidado para NÃO repetir o mesmo item duas vezes.
- subtotal: a soma do consumo ANTES da taxa de serviço, exatamente como impressa; se não houver, use null.
- service: a taxa de serviço/gorjeta SE existir na conta — "rate" é o percentual (ex.: 10) e "amount" o valor em reais; se a conta não cobra serviço, use null.
- total: o total final impresso na conta; se não houver, use null.
- Use null quando o campo não estiver visível. Não calcule nada que não esteja impresso.`;

// Mesmo schema/normalização de js/ocr.js (manter os dois em sincronia).
const money = { anyOf: [{ type: "number" }, { type: "null" }] };
const OCR_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["items", "subtotal", "service", "total"],
  properties: {
    items: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["name", "qty", "lineTotal", "unitPrice"],
      properties: { name: { type: "string" }, qty: { type: "integer" }, lineTotal: money, unitPrice: money } } },
    subtotal: money,
    service: { anyOf: [ { type: "null" }, { type: "object", additionalProperties: false,
      required: ["rate", "amount"], properties: { rate: money, amount: money } } ] },
    total: money,
  },
};

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
        output_config: { format: { type: "json_schema", schema: OCR_SCHEMA } },
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
    if (data.stop_reason !== "end_turn") return json({ error: "resposta incompleta: " + data.stop_reason }, 502);
    const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
    if (!text) return json({ error: "vazio" }, 502);
    const parsed = JSON.parse(text);
    // preço unitário: o impresso, senão total da linha ÷ qty (aritmética no código, não no modelo)
    const items = (parsed.items ?? []).map((it: { name: string; qty: number; lineTotal: number | null; unitPrice: number | null }) => {
      const qty = it.qty > 0 ? it.qty : 1;
      const unitPrice = it.unitPrice ?? (it.lineTotal != null ? Math.round(it.lineTotal / qty * 100) / 100 : 0);
      return { name: it.name, qty, unitPrice };
    });
    return json({
      items,
      subtotal: parsed.subtotal ?? null,
      service: parsed.service ?? null,
      total: parsed.total ?? null,
    });
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
