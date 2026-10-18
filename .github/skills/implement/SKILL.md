---
name: implement
description: >-
  Implementa uma issue do t20-community-patches de ponta a ponta numa worktree
  própria (layout .bare): lê a issue, confirma a causa raiz no código atual,
  implementa o patch com testes, faz commits assinados e roda o ciclo de review
  de QA com subagente gpt-6.1-sol até sair CLEAN (no máximo 5 rodadas). No fim,
  ativa a worktree no Foundry e entrega o plano de teste manual. Use quando o
  usuário pedir para implementar, desenvolver, corrigir ou atacar a issue #n.
---

# implement

Leia `AGENTS.md` antes de começar. Entrada: o número da issue (`#n`). Saída:
- a branch `issue/<n>-<slug>` com commits assinados;
- `.work/review.md` terminando em `CLEAN`;
- `.work/changelog.md` e `.work/manual-tests.md`;
- o Foundry carregando a worktree.

**Nada vai para a `main` nem para o remoto aqui.** Quem faz isso é a skill `land`.

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin)}"
```

## 1. Pré-condições

```bash
gh issue view <n> -R DMBerlin/t20-community-patches --json number,title,state,labels,body,comments
```

- A issue precisa estar `OPEN`.
- Se ela for `upstream-only` ou `needs-repro`, ou depender de uma issue ainda aberta, avise e pergunte com `ask_user` se deve continuar.
- Confira se a versão instalada do sistema (`$FOUNDRY_DATA/systems/tormenta20/system.json`) está dentro da faixa da issue. Se for maior, o bug pode ter sido corrigido. Verifique antes de implementar (passo 3).

## 2. Worktree

A partir da worktree `main`:

```bash
make worktree ISSUE=<n>          # imprime o caminho da worktree na última linha
```

Cada comando seguinte roda **dentro** da worktree, com caminho absoluto, porque o shell não guarda o `cd`. Grave o contexto da issue:

```bash
mkdir -p .work && gh issue view <n> -R DMBerlin/t20-community-patches --comments > .work/issue.md
```

Os comentários podem mudar o contrato. Por exemplo, o comentário sobre `group`, `issue` e `isNeeded()` vale mais que o corpo original.

## 3. Confirmar a causa raiz no código atual

As linhas `T20:<n>` da issue podem ter mudado. Localize cada trecho citado **pelo conteúdo** no bundle do sistema e no core (`$FOUNDRY_CORE`).

- Se o código mudou de forma que invalida a proposta, ou se o bug não existe mais, **pare**. Explique ao usuário e pergunte com `ask_user`.
- Se a proposta da issue tiver uma falha (um caminho não coberto, uma API inexistente), corrija na implementação e registre o motivo em `.work/decisions.md`. Esse registro vai para o comentário de fechamento.

## 4. Anunciar a intenção

Antes de escrever código, anuncie ao usuário o que vai fazer. O anúncio é informativo: **não** espere confirmação, a menos que o passo 3 tenha levantado uma dúvida, e nesse caso use `ask_user`.

Estilo telegráfico: frases curtas, sem artigos nem conectivos dispensáveis, setas no lugar de explicações. Sacrifique a gramática, nunca a precisão. O anúncio tem no máximo ~8 linhas:

```
**#<n> — <título curto>**
**Problema:** <sintoma visto pelo usuário> → <causa raiz em 1 linha, com símbolo/T20:linha>.
**Solução:** <o que o patch faz, ponto de interceptação> → <efeito para o usuário>.
**Escopo:** <arquivos/áreas>. Fora: <o que não muda>.
**Desvios da issue:** <o que mudou em relação à proposta e por quê | nenhum>.
**Próximo:** implementar → testes → review QA (gpt-6.1-sol).
```

Exemplo:

```
**#4 — efeitos de uso de itens não equipados**
**Problema:** Varinha Arcana na mochila ainda dá −1 PM ao lançar magia → listas de efeitos de uso (`_allApplicableOnUseEffects`, `rollPericia`/`rollAtributo`) ignoram supressão.
**Solução:** filtrar efeitos de item suprimido nas 3 listas; efeitos do próprio item rolado mantidos → item guardado = sem bônus/custo.
**Escopo:** novo `suppressed-usage-effects.mjs`, index, lang, README, testes. Fora: toggle Aplicar Sempre (#5), custo (#7).
**Desvios da issue:** nenhum.
**Próximo:** implementar → testes → review QA.
```

Se a solução mudar durante a implementação ou o review, por exemplo por um achado de QA que altere o comportamento, anuncie de novo **só a mudança**, no mesmo estilo e em 1–2 linhas.

## 5. Implementar

Siga o contrato e as regras de patch do `AGENTS.md`:
- `scripts/patches/<id>.mjs`, com a lógica pura exportada;
- registro em `scripts/patches/index.mjs` (`group`, `issue`, `system.affected`, `isNeeded`, `apply`);
- `lang/pt-BR.json` e `lang/en.json`, com as mesmas chaves;
- a linha da tabela de correções no `README.md`;
- `tests/<id>.test.mjs`: casos que **falhariam sem a correção**, mais os casos-limite da issue. Não teste constantes nem frameworks.
- **Não** edite o `CHANGELOG.md`. Escreva a entrada em `.work/changelog.md`:

```
Section: Fixed
`<id>` (#<n>): <o que muda para o usuário>. Afeta Tormenta20 <versão>.
```

O texto deve ter uma linha só. A seção é uma de `Added|Changed|Fixed|Security|Removed`.

Valide:

```bash
make check
```

Quando a integração for difícil de testar só com funções puras, faça um smoke test com mocks do Foundry em `.work/smoke/`, que é ignorado pelo git. O formato é:
- `globalThis.Hooks`, `game`, `CONFIG` e `foundry` falsos;
- importar `scripts/main.mjs`;
- chamar os hooks `init` e `ready`;
- exercitar os wrappers.

Faça os commits na branch seguindo a skill `commit`: atômicos, com uma linha e sem trailers. Exemplo:

```bash
git add scripts/patches/<id>.mjs scripts/patches/index.mjs tests/<id>.test.mjs lang README.md
git commit -m "fix(<id>): <o que corrige> (#<n>)"
```

Não faça push da branch; o land faz squash localmente.

## 6. Ciclo de review de QA

Repita até o revisor responder `CLEAN`, com **no máximo 5 rodadas**:

1. Monte o prompt a partir de `review-prompt.md` (nesta pasta), preenchendo os campos. A partir da rodada 2, inclua os achados anteriores e as correções feitas.
2. Chame o subagente:
   - ferramenta `task`;
   - `agent_type: "code-review"`;
   - `model: "gpt-6.1-sol"`;
   - `name: "qa-review-<n>-r<k>"`;
   - modo síncrono.
3. Registre a rodada em `.work/review.md`:

```
## Rodada <k> — <data>
Resultado: CLEAN | <x> achados
1. [<severidade>] <arquivo:linha> — <achado> → <ação: corrigido em <sha> | rejeitado porque … | decisão do usuário: …>
```

4. Para cada achado:
   - **bug técnico:** corrija, adicione um teste que falhe sem a correção, rode `make check` e faça um commit atômico que descreva o achado (skill `commit`), por exemplo `fix(<id>): handle reentrant rolls (#<n>)`;
   - **questão de produto ou trade-off:** junte todas as questões da rodada num único `ask_user`, com opções concretas e a sua recomendação como padrão;
   - **falso positivo:** rejeite com evidência (arquivo:linha) e registre a rejeição.
5. Ao atingir 5 rodadas sem `CLEAN`, pare. Mostre ao usuário os achados restantes com `ask_user`, com as opções:
   - continuar mais rodadas;
   - aceitar o risco e documentar na issue;
   - abandonar.

A última linha de `.work/review.md` deve ser `Resultado final: CLEAN (rodada <k>)` ou `Resultado final: risco aceito pelo usuário — <resumo>`.

## 7. Preview e teste manual

```bash
make active        # o Foundry passa a carregar esta worktree; recarregue o mundo (F5)
```

Se o `module.json` mudou, reinicie o Foundry.

Escreva `.work/manual-tests.md` a partir do plano de teste manual da issue, ajustado ao que foi implementado. Use passos numerados, dados concretos e o resultado esperado. O último passo é sempre: "desligar o patch em Gerenciar correções → o comportamento oficial volta".

## 8. Relatório ao usuário

Seja extremamente conciso, em português:
- worktree e branch;
- o que mudou, em até 5 bullets;
- testes: quantos passaram;
- QA: quantas rodadas e o resultado final, mais as decisões tomadas;
- os passos de teste manual (copiados de `.work/manual-tests.md`).

Termine com: "Após validar, use a skill `land` para a issue #<n>."
