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

# Visual novo (direção C) — v26
- [ ] Abas **no rodapé** (Racha · Casal · Grupos); cabeçalho verde só em Racha e Grupos; botão "entrar" só aparece em Grupos.
- [ ] Em qualquer formulário (nova despesa, editar, acerto dos Grupos) as abas somem e o botão de salvar fica no rodapé.
- [ ] Casal: saldo em número grande no bloco verde; o **+** fica dentro da barra de abas, à direita, e **nunca cobre um valor** da lista.
- [ ] Nenhum ícone é emoji (categorias, foto/galeria/texto/manual, remover item).
- [ ] Modo escuro do celular: tudo legível, botões verdes com texto branco nítido.
- [ ] Sem internet a fonte cai pra fonte do sistema e o app continua funcionando.

# Casal na nuvem — v29 (substitui "local, sem conta")
- [ ] Aba **Casal** sem login pede o e-mail ("Entrar no Casal"); o link do e-mail volta direto pro Casal.
- [ ] Primeira vez: "Vocês dois" → seu nome, Pix, nome do(a) parceiro(a) → **Começar**. Se havia lançamentos antigos no aparelho, eles sobem com o mesmo saldo.
- [ ] Aparece o cartão **"Ana ainda não entrou"** com o convite (WhatsApp / copiar link).
- [ ] **Outro aparelho**: abrir o app, entrar com o MESMO e-mail → mesmo saldo e mesmo histórico.
- [ ] **A outra pessoa**: abre o convite, entra com o e-mail dela, toca em **"Sou Ana"** → cai no Casal vendo tudo. O cartão de convite some pra você.
- [ ] Ela lança uma despesa → aparece no seu aparelho sozinha em ~1s, e o saldo muda.
- [ ] Editar, excluir e acertar por qualquer um dos dois reflete no outro.
- [ ] A chave Pix dela aparece no acerto depois que ela cadastrar a própria (⚙ ou "editar o casal").
- [ ] Sem internet: o Casal avisa que não carregou e oferece tentar de novo (a aba Racha continua funcionando).
- [ ] Na aba **Grupos**, cada grupo aparece **uma vez só** e o casal não aparece na lista (tem a aba dele).

# Atualização entre aparelhos + detalhamento — v30
- [ ] Com o app aberto nos dois celulares, um lança → o outro mostra em até ~10 s, sem tocar em nada.
- [ ] Bloquear a tela (ou trocar de app) num deles, lançar no outro, voltar → atualiza ao voltar.
- [ ] Editar o rateio de uma despesa num aparelho → o valor muda no outro.
- [ ] Quando a outra pessoa entra pelo convite, o cartão "ainda não entrou" some sozinho.
- [ ] Histórico separado por **mês**, com o total gasto no mês.
- [ ] Com 2+ categorias aparecem as fichas (Tudo · Mercado · Comida…); tocar filtra a lista.
- [ ] O quadro de resumo mostra total, a parte de cada um e quanto cada um pagou; muda com o filtro.
- [ ] Tocar numa linha abre o detalhe (itens, quanto é de cada um, efeito no saldo).
- [ ] (opcional) rodar `supabase/migrations/0005_realtime.sql` pra o aviso em tempo real ficar mais confiável.

# Parcelado e recorrente (Casal) — v32
- [ ] Nova despesa → **Repetir**: Uma vez · Parcelado · Recorrente.
- [ ] **Parcelado**: 1000 em 3 vezes, "o valor é o total" → 333,34 + 333,33 + 333,33, uma por mês, "Geladeira (1/3)"…
- [ ] "O valor é de cada parcela" → 3 lançamentos de 1000.
- [ ] **Recorrente**: todo mês / toda semana / todo ano. Com "Vezes" e/ou "Até" respeita o menor dos dois; sem nenhum, programa 12.
- [ ] O **saldo só conta o que já venceu**; o resto aparece em **Programado** (toque em "ver").
- [ ] No dia do vencimento a parcela passa do Programado pro histórico e entra no saldo.
- [ ] Detalhe de uma parcela mostra "Parcela 2 de 3"; **Excluir** oferece "só esta" ou "esta e as seguintes".
- [ ] Recorrente sem limite: quando faltar ~45 dias pro último, aparece o cartão **Programar mais 12 / Encerrar**.
- [ ] Despesa lançada à noite sai com a data de **hoje** (antes saía com a de amanhã depois das 21h).

# (histórico) Aba Casal local — v25

## 15. Configurar o casal
- [ ] Aba **Casal** abre direto em "Vocês dois" (sem login, sem "Ative os Grupos").
- [ ] Preencher seu nome + Pix (opcional) e o nome do(a) parceiro(a) + Pix (opcional) → **Começar** → "Vocês estão quites ✓".
- [ ] **editar** muda nomes/Pix sem perder o histórico. "Apagar o casal" pede confirmação e zera.

## 16. Lançar despesa (os 5 jeitos)
- [ ] **Meio a meio**: eu paguei 100 → prévia "Ana passa a te dever R$ 50,00" → salva → home "Ana te deve R$ 50,00".
- [ ] **Só eu** com Ana pagando: 30 → "você passa a dever R$ 30,00" → home cai pra R$ 20,00.
- [ ] **Só Ana**, **Valores** (quanto é de cada um).
- [ ] **Por item**: 📷 foto (precisa da chave em ⚙) / 📝 texto / ＋ manual → marcar quem consumiu cada item → serviço/couvert/desconto → banner "✓ Bate com o total da conta".
- [ ] A **prévia** mostra o **saldo que fica** depois da despesa, com a variação entre parênteses. Ex.: saldo 110,60 + mercado de 247,80 meio a meio, eu pagando → "Ana passa a te dever R$ 234,50 (+123,90)".
- [ ] Trocar o jeito de dividir não perde o valor digitado (Meio a meio → Valores já vem 123,90 / 123,90).
- [ ] Trocar **Quem pagou** (Eu / Ana) inverte o efeito.

## 17. Histórico, detalhe, editar, excluir
- [ ] Histórico do mais recente pro mais antigo; cada linha mostra `+R$` (me devem) ou `-R$` (eu devo).
- [ ] Tocar na linha abre o detalhe (itens, quanto é de cada um, efeito). **Editar** abre o form preenchido; salvar não duplica (mesma contagem, saldo certo). **Excluir** some e o saldo volta.

## 18. Acertar + cobrar
- [ ] **Acertar** mostra quem paga quem e o valor. Se quem recebe tem Pix: **QR + copia-e-cola + Copiar**. Se não: aviso.
- [ ] Quando ela me deve: **Cobrar** (home) e **Cobrar no WhatsApp** (dialog) abrem o WhatsApp com valor + meu Pix.
- [ ] **Marcar como pago** registra o acerto (💸 no histórico) e volta pra "quites".

## 19. Ponte: mesa → casal
- [ ] Na aba **Racha**, rachar uma conta com 3+ pessoas (incluindo vocês dois) → **Guardar no casal**.
- [ ] O dialog já adivinha quem é você e quem é ela pelo nome; escolher quem pagou → **Guardar** → cai no Casal com a despesa "Conta na mesa" e **só a parte de vocês dois** (nota diz "Mesa com N pessoas · conta R$X").
- [ ] Sem casal configurado, o botão manda pra aba Casal.

## 20. Persistência
- [ ] Fechar e reabrir o app (ou recarregar): casal e histórico continuam (localStorage — só neste aparelho).

---
**Anotar bugs:** o que fez, o que esperava, o que aconteceu, e (se der) o print + a mensagem embaixo do botão / no console.
