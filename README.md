# Racha 💸

Divida a conta do rolê entre o grupo — por **foto**, **colando o texto** da conta ou **na mão**.
PWA num arquivo só, sem build. Feito pra Brasil: R$, taxa de serviço de 10%, couvert.

> Versão atual: **um celular só** (MVP). Uma pessoa escaneia, atribui os itens de todos e mostra/compartilha o resultado. Sem login, sem servidor de dados.

## Como funciona

1. **Adicione as pessoas** do grupo.
2. **Entre os itens** de um destes jeitos:
   - 📷 **Foto** — manda a foto da conta pra uma função de OCR (Claude vision) que devolve os itens. *(precisa configurar, veja abaixo)*
   - 📝 **Colar texto** — cola o texto da conta, um item por linha; o app extrai nome/qtd/preço.
   - ✏️ **Manual** — digita cada item.
3. **Marque quem dividiu** cada item (toque nas pessoas; “todos” divide igual).
4. **Ajuste** taxa de serviço (10%), couvert e desconto.
5. **Compartilhe** o resultado (WhatsApp / copiar).

A taxa de serviço e o desconto são **rateados pelo consumo**; o couvert é dividido **igual** entre todos. O arredondamento é reconciliado em centavos pra soma das partes bater **exatamente** com o total.

## Rodar local

Qualquer servidor estático na pasta:

```bash
cd ~/Documents/Claude/racha
python3 -m http.server 8000
# abra http://localhost:8000
```

## Deploy (GitHub Pages, igual ao Vereda)

**Já está no ar:** https://fabiomg-pixel.github.io/racha/ · repo: https://github.com/fabiomg-pixel/racha

Pra publicar uma atualização, basta empurrar pra `main`:

```bash
cd ~/Documents/Claude/racha
git add -A && git commit -m "ajuste"
git push        # GitHub Pages republica sozinho em ~1 min
```

> Ao mexer no app, **suba o número do cache** em `sw.js` (`racha-v2` → `racha-v3`...) pra forçar a atualização nos aparelhos já instalados.

## OCR por foto — duas formas

### A) Chave direta (simples, recomendado pra uso pessoal)

O app chama o Claude vision **direto do navegador** usando o header oficial `anthropic-dangerous-direct-browser-access`.

1. Pegue uma **API key da Anthropic** em console.anthropic.com → API Keys. É cobrança separada do Claude Code; cada foto custa centavos.
2. No app, toque em **⚙**, cole a chave (`sk-ant-...`), escolha o modelo (Haiku é barato; Sonnet lê cupom difícil) e **Salvar**.
3. Toque em 📷 e mande a foto da conta. Pronto.

> A chave fica **só no aparelho** (localStorage), **nunca no código** — então publicar no GitHub Pages continua seguro. Indicado quando só você (ou poucas pessoas de confiança) usa o app no próprio celular.

### B) Proxy no Supabase (pra compartilhar sem expor a chave)

O código da função já está em `supabase/functions/ocr/`.

```bash
npm i -g supabase
supabase login
supabase init                       # dentro de ~/Documents/Claude/racha
supabase link --project-ref SEU_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ocr --no-verify-jwt    # --no-verify-jwt: app chama sem login
# cupom difícil: supabase secrets set RACHA_MODEL=claude-sonnet-4-6
```

Depois, em **⚙ → Avançado**, cole a URL `https://SEU_REF.supabase.co/functions/v1/ocr`. Se a URL estiver preenchida, ela tem prioridade sobre a chave local.

> O ambiente do Fabio bloqueia `api.github.com` no navegador, mas **não** bloqueia `api.anthropic.com` nem o Supabase — então os dois caminhos funcionam.

## Arquivos

| Arquivo | O quê |
|---|---|
| `index.html` | O app inteiro (UI + lógica de divisão + parser de texto + chamada de foto) |
| `sw.js` | Service worker (cache `racha-vN`, offline) |
| `manifest.json` · `icon.svg` | PWA instalável |
| `supabase/functions/ocr/index.ts` | Proxy de OCR (Claude vision) — só pra foto |

## Roadmap

- [ ] PIX por pessoa (copia-e-cola + QR com o valor da parte de cada um)
- [ ] Mesa compartilhada por link (cada um marca os próprios itens em tempo real)
- [ ] Histórico de rachas
