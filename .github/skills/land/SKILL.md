---
name: land
description: >-
  Integra na main a worktree de uma issue já implementada e revisada no
  t20-community-patches: confirma o review CLEAN e o teste manual, faz o squash
  em um commit assinado de uma linha, registra a entrada em Unreleased no
  CHANGELOG, faz push da main, comenta na issue as evidências de sucesso, fecha
  a issue e remove a worktree e a branch. Use quando o usuário pedir land,
  integrar, finalizar, mergear ou fechar a issue #n.
---

# land

Leia `AGENTS.md` e a skill `commit` antes de começar. Entrada: o número da issue (`#n`). Os caminhos:
- `<wt>`: worktree da issue (`<projeto>/<n>-<slug>`);
- `<main>`: worktree `main`;
- `<projeto>`: a pasta que contém o `.bare`.

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin)}"
git worktree list                                      # localizar <wt> (branch issue/<n>-*)
```

## 1. Pré-condições (pare na primeira que falhar)

1. A issue `#n` está `OPEN`, e a branch `issue/<n>-<slug>` e a `<wt>` existem.
2. `git -C <wt> status --short` está vazio: tudo commitado.
3. `<wt>/.work/review.md` termina com `Resultado final: CLEAN …` ou `Resultado final: risco aceito pelo usuário …`. Se não terminar, oriente a rodar a skill `implement`.
4. `<wt>/.work/changelog.md` existe, com `Section: <Added|Changed|Fixed|Security|Removed>` e **uma** linha de entrada em português que cita `(#n)`.
5. `git -C <main> status --short` está vazio.
6. **Teste manual:** se `<wt>/.work/playtest.md` existir (skill `playtest`), confira antes que ele vale para o que vai ser integrado: a linha `Commit:` é igual a `git -C <wt> rev-parse HEAD`, sem "com alterações não commitadas", e a linha `Plano (sha256 …)` é igual a `shasum -a 256 <wt>/.work/manual-tests.md`. Faça essa conferência **antes** de gravar qualquer coisa no `manual-tests.md`. Se não bater, o relatório está velho: rode a skill `playtest` de novo ou trate como se ele não existisse. Valendo, leia a linha `Resultado:`:
   - `PASSOU`: vale como validação. Registre no fim de `.work/manual-tests.md`: "Validado pela skill playtest: <resumo>" e siga;
   - `PARCIAL`: mostre os passos com SKIP e pergunte ao usuário, como abaixo, só sobre eles;
   - `FALHOU`: pare e oriente voltar para `implement`.

   Sem `playtest.md`, mostre os passos de `<wt>/.work/manual-tests.md` e pergunte com `ask_user`:
   - "Todos passaram";
   - "Algum falhou" (pare, peça os detalhes e volte para `implement`);
   - "Integrar sem teste manual" (registre como **não validado manualmente**).

   Grave a resposta e as observações no fim de `.work/manual-tests.md`.

## 2. Atualizar a branch com a main

```bash
git -C <main> pull --ff-only origin main
git -C <wt> rebase main
```

- Se o rebase der conflito trivial (por exemplo, duas linhas novas na mesma tabela ou lista), resolva mantendo as duas mudanças.
- Se não for trivial, rode `git rebase --abort` e pergunte com `ask_user`.

Depois, rode `make -C <wt> check`. Ele precisa passar.

Se a validação veio do `playtest`, o relatório vale para o commit testado. Anote esse commit antes do rebase (`git -C <wt> rev-parse HEAD`) e, depois dele, confira `git -C <wt> diff --name-only <commit testado> HEAD -- scripts lang templates styles module.json`. Se sair algum arquivo, mesmo que a branch não o tenha alterado, rode a skill `playtest` de novo antes do squash.

## 3. Squash na main

```bash
git -C <main> merge --squash issue/<n>-<slug>
cd <main> && node tools/changelog.mjs add <Section> "<linha de .work/changelog.md>"
make -C <main> check
git -C <main> add CHANGELOG.md
git -C <main> commit -m "<type>(<scope>): <resumo da issue> (#<n>)"
```

- O commit tem uma linha, é assinado e não tem trailer (skill `commit`).
- O `type` é `fix` para patches e `feat` para melhorias. O `scope` é o id do patch ou a área.
- O squash é a única exceção à atomicidade por mudança: ele resulta em **um commit por issue** na `main`.
- Se algo falhar antes do commit, rode `git -C <main> reset --hard origin/main` e reporte.

## 4. Push

```bash
git -C <main> push origin main
```

Se o push for rejeitado porque a `main` remota avançou:
1. `git -C <main> pull --rebase origin main`;
   - se a validação veio do `playtest` e o pull trouxe mudanças em `scripts lang templates styles module.json` (`git -C <main> diff --name-only <sha do squash> HEAD -- …`), pare antes do push e pergunte com `ask_user` se é preciso rodar o playtest de novo com a `main` ativa;
2. `make check` de novo;
3. push de novo.

Nunca use force.

## 5. Comentário de fechamento

Monte o comentário a partir dos artefatos de `.work/` e do commit. Escreva-o em `.work/closing-comment.md` e poste:

```bash
gh issue comment <n> -R DMBerlin/t20-community-patches --body-file <wt>/.work/closing-comment.md
```

Modelo (em português, objetivo, sem placeholders):

```markdown
## ✅ Implementado em <sha curto>

<1–2 frases: o que o usuário passa a ver.>

**Mudanças**
- <arquivo ou área>: <o que mudou>
- …

**Evidências**
- Testes unitários: <x> passando (`make check`); novos: `tests/<id>.test.mjs` (<y> casos).
- Review de QA (gpt-6.1-sol): <k> rodada(s), resultado <CLEAN | risco aceito>.
  - Rodada 1: <n achados → resumo do que foi corrigido>
  - …
- Teste manual no Foundry <versão> / Tormenta20 <versão>: <passou | passou no playtest automatizado (<x>/<y> verificações) | não validado manualmente>.
  1. <passo> → ✅
  2. Patch desligado → comportamento oficial ✅

**Decisões**
- <de .work/decisions.md e das respostas do usuário, se houver>

**CHANGELOG** (Unreleased · <Section>): <linha>

Disponível na próxima release do módulo.
```

## 6. Fechar a issue

```bash
gh issue close <n> -R DMBerlin/t20-community-patches --reason completed
```

## 7. Teardown

1. Se o Foundry estiver carregando a `<wt>` (`make -C <main> active-status`), aponte de volta para a `main` com `make -C <main> active`.
2. Arquive os artefatos, porque o `git worktree remove` apaga arquivos ignorados sem avisar:

   ```bash
   mkdir -p <projeto>/.work-archive && cp -R <wt>/.work <projeto>/.work-archive/<n>-<slug>
   ```

3. Remova a worktree e a branch. Antes, confirme que o squash contém tudo o que estava na branch:

   ```bash
   git -C <main> diff --quiet issue/<n>-<slug> main -- . ':(exclude)CHANGELOG.md' && echo OK
   git -C <main> worktree remove <wt>
   git -C <main> branch -D issue/<n>-<slug>
   git -C <main> push origin --delete issue/<n>-<slug> 2>/dev/null || true   # se a branch tiver sido publicada
   ```

   Se o `diff` não estiver vazio, **não** apague a branch. Reporte a diferença.

## 8. Relatório ao usuário

Seja extremamente conciso:
- o commit `<sha>` na `main`, já enviado;
- a issue `#n` fechada, com o link do comentário;
- a entrada adicionada em Unreleased;
- worktree e branch removidas; o Foundry voltou para a `main` (se aplicável).

Sugira os próximos passos: `triage` para escolher a próxima issue, ou `release` quando quiser publicar.
