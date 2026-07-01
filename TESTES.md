# Racha — checklist de testes (Fases 1–4)

## 0. Pré-requisitos (fazer 1 vez)
- [ ] No Supabase → **SQL Editor**, rodar em ordem: `supabase/migrations/0002_expense_edit.sql`, depois `0003_comments.sql`, depois `0004_friends.sql`.
- [ ] No app: **Cmd/Ctrl + Shift + R** (pegar a versão `v24`). Se for PWA instalado, fechar e reabrir.

## 1. Login / conta
- [ ] Aba **Grupos** abre direto no login (não mostra "Ative os Grupos").
- [ ] Login pelo **link** do e-mail loga e cai nos Grupos.
- [ ] Login pelo **código** (se o SMTP estiver ligado) também loga.
- [ ] Cadastrar **chave Pix** e nome no ⚙.

## 2. Aba Racha (calculadora avulsa)
- [ ] Somar pessoas + itens (foto/texto/manual), serviço 10%, couvert, desconto.
- [ ] Resultado bate ao **centavo**; compartilhar funciona.
- [ ] **"Lançar no grupo →"** leva o racha pra um grupo (casa nomes; cria fantasma pros que faltam).

## 3. Grupos e membros
- [ ] Criar grupo.
- [ ] Adicionar **membro sem conta** (fantasma).
- [ ] **Convidar por link**: abrir em aba anônima/outro aparelho → login → cai em "Entrar no grupo" **certo** (não cria grupo vazio) → entrar.
- [ ] Se já era fantasma, aparece **"Sou Fulano"** e funde.

## 4. Nova despesa — os 5 modos de divisão
- [ ] **Igual**: total + escolher entre quem; some/tire pessoas.
- [ ] **%**: porcentagens somando 100.
- [ ] **Partes**: pesos (ex.: 2 e 1).
- [ ] **Valores**: valor exato por pessoa.
- [ ] **Por item**: foto/texto/manual, marcar quem consumiu, serviço/couvert/desconto.
- [ ] Em todos: a **prévia** mostra a divisão e soma o total exato.

## 5. Quem pagou (multi-pagador)
- [ ] Pagador único (qualquer membro, não só você).
- [ ] **"mais de um pagou?"** → valores por pessoa; indica "pago X de Y ✓".
- [ ] Salvar com soma dos pagadores diferente do total → **avisa** (não deixa salvar torto).

## 6. Categoria, nota e recibo
- [ ] Escolher **categoria** e escrever **nota**; aparecem no detalhe.
- [ ] **📎 Anexar recibo** → miniatura aparece no formulário e no detalhe.

## 7. Home consolidada
- [ ] Card **"No total"** mostra **a receber** e **a pagar** somando grupos + amigos.
- [ ] Cada grupo/amigo mostra **seu saldo** ali (recebe/deve/quite).

## 8. Editar / apagar / repetir
- [ ] Abrir despesa → **Editar** → muda valor/categoria/pagador → salva → saldo atualiza.
- [ ] **Excluir** despesa → some e o saldo volta.
- [ ] **↻ Repetir (hoje)** → cria uma cópia com a data de hoje.

## 9. Acerto (settle) + Pix
- [ ] "**acertar →**" sugere as transferências mínimas.
- [ ] Gera **Pix copia-e-cola + QR** com o valor exato pra quem tem chave cadastrada.
- [ ] Marcar como **pago** registra o acerto e zera/ajusta o saldo.

## 10. Cobrança / lembrete
- [ ] No **Saldo**, quem deve tem link **"cobrar"** → abre WhatsApp com a mensagem + seu Pix.

## 11. Atividade / comentários / realtime
- [ ] Card **"Atividade"** lista despesas, acertos e entradas com tempo relativo.
- [ ] **Comentar** numa despesa; **apagar** o próprio comentário.
- [ ] **Ao vivo**: abrir o mesmo grupo em 2 aparelhos; lançar/editar num → o outro **atualiza sozinho**.

## 12. Amigos (1 a 1)
- [ ] **"Novo amigo"** cria um "grupo de 2"; aparece na seção **Amigos**.
- [ ] Lançar despesa com o amigo, ver saldo, acertar por Pix.
- [ ] (Opcional) convidar o amigo pelo link depois.

## 13. Export CSV
- [ ] No grupo, **"exportar CSV"** baixa o arquivo; abre no Excel/Sheets **com acento** e com uma coluna por pessoa.

## 14. Multi-dispositivo / cache
- [ ] Instalar como **PWA** (adicionar à tela inicial) e logar.
- [ ] Depois de um deploy, o app pega a versão nova **sozinho** (sem precisar limpar cache).

---
**Anotar bugs:** o que fez, o que esperava, o que aconteceu, e (se der) o print + a mensagem embaixo do botão / no console.
