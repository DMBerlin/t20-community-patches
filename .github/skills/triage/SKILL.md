---
name: triage
description: >-
  Faz a triagem das issues abertas do t20-community-patches e as lista em ordem
  de prioridade (valor para o usuário × complexidade), com justificativa e o
  próximo passo de cada uma. Use quando o usuário pedir triagem, backlog,
  priorização, "o que atacar agora" ou "qual a próxima issue". É somente
  leitura: não altera issues, labels nem código.
---

# triage

Leia `AGENTS.md` antes de começar. Esta skill **não escreve nada**: nenhum label, comentário, arquivo ou commit.

## 1. Coletar

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin)}"
gh issue list -R DMBerlin/t20-community-patches --state open --limit 200 \
  --json number,title,labels,body,comments,createdAt,updatedAt
```

Colete também o contexto que muda a prioridade:
- a versão instalada do sistema: `node -p "require('$FOUNDRY_DATA/systems/tormenta20/system.json').version"`;
- os patches já existentes: `scripts/patches/index.mjs` na worktree `main`;
- as worktrees em andamento: `git worktree list`; uma issue com worktree aberta está "em andamento";
- as referências cruzadas no corpo das issues ("Interação com #n", "depende de #n", "Issues relacionadas").

Se a versão instalada do sistema for **maior** que o `affected.maximum` de uma issue, ela precisa ser verificada de novo antes de ser implementada: o bug pode já ter sido corrigido.

## 2. Separar

- **Implementáveis:** issues abertas **sem** `upstream-only`.
- **Upstream-only:** listadas numa seção separada, sem pontuação de prioridade. Mostre só o resumo e se já foram reportadas (`upstream-reported`).
- **Bloqueadas:** `needs-repro` ou com dependência aberta. Elas entram no ranking, mas com o bloqueio marcado no próximo passo.

## 3. Pontuar (só as implementáveis)

**Valor (V, 1–5):** o ganho para quem joga ou mestra. Parta do label de prioridade e ajuste com a evidência do corpo da issue.

| V | Critério |
|---|---|
| 5 | Quebra uma mecânica central para todos: mesa travada, dado errado em toda rolagem, crash. Em geral `priority: critical`. |
| 4 | Mecânica errada ou invisível, com efeito frequente em combate ou na ficha (`priority: high`). |
| 3 | Comportamento inconsistente, com contorno manual (`priority: medium`). |
| 2 | Afeta uma situação rara ou poucos personagens. |
| 1 | Cosmético ou ruído (`priority: low`, `ui-hide`). |

Ajuste ±1, com justificativa, por **alcance**: quantos personagens, classes ou itens são atingidos e com que frequência na sessão.

**Complexidade (C, 1–5):** o esforço e o risco para implementar **como patch do módulo**.

| C | Critério |
|---|---|
| 1 | Troca pontual: um wrapper, ocultar UI, uma configuração. Código completo já está na issue. |
| 2 | Um ponto de interceptação, lógica pura simples, sem estado. |
| 3 | Vários pontos de interceptação, estado em memória, interação com outros patches. |
| 4 | Fluxo assíncrono, janelas síncronas frágeis, reentrância, multiusuário/socket, alteração de dados persistidos. |
| 5 | Migração de dados de mundo/compêndio, causa raiz incerta ou dependente de reprodução. |

Some +1 (máximo 5) se a issue for `needs-repro` ou se a causa raiz ou o código proposto não estiverem no corpo. Confira, por amostragem, um ou dois `T20:<linha>` citados no bundle do sistema; se o código mudou, some +1 e anote.

**Prioridade:** `P = V × (6 − C)`, de 1 a 25; maior primeiro. Desempates, nesta ordem:
1. issues que desbloqueiam outras;
2. o label de prioridade mais alto;
3. o número de issue menor.

Uma issue que depende de outra ainda aberta fica **logo depois** da dependência, mesmo que tenha P maior. Explique isso na justificativa.

## 4. Apresentar

Responda em português, curto e escaneável:

```
## Triagem — <data> · Tormenta20 instalado <versão> · <k> implementáveis, <m> upstream-only

| # | Issue | V | C | P | Por quê (1 linha) | Próximo passo |
|---|-------|---|---|---|-------------------|---------------|
| 1 | #1 Condições vazias… | 5 | 3 | 15 | trava todas as condições | implement #1 |
| 2 | #6 … | 3 | 2 | 12 | … | bloqueada por #5 → depois de #5 |

### Upstream-only (não corrigidas pelo módulo)
- #10 … (upstream-reported? sim/não)

### Alertas
- issues para verificar de novo (sistema mais novo que `affected.maximum`), referências desatualizadas, duplicatas aparentes
```

Termine sugerindo **uma** issue para começar: a primeira da tabela que não esteja bloqueada. Use o comando `implement #<n>`.
