---
name: onboarding
description: >-
  Inicializa uma sessão nova no t20-community-patches: verifica o ambiente,
  o estado do repositório, das worktrees, do Foundry e do backlog, monta o mapa
  mínimo da arquitetura e entrega um briefing curto. O restante do contexto é
  carregado sob demanda (progressive disclosure). Use no início de uma sessão
  ou quando o usuário pedir onboarding, contexto, "se situe", "o que está
  acontecendo no projeto" ou "por onde começo".
---

# onboarding

Objetivo: deixar a sessão pronta para operar com precisão, **gastando pouco contexto**. Carregue só o que vale para qualquer tarefa. Todo o resto entra depois, quando a tarefa pedir (seção 5).

O `AGENTS.md` já é carregado automaticamente pelo agente. **Não** o releia inteiro; consulte trechos quando precisar. Esta skill é **somente leitura**: não cria commits, labels, comentários nem worktrees, e não muda qual worktree o Foundry carrega.

## 1. Ambiente

Rode em um único comando e anote **só as divergências**:

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin 2>/dev/null)}"
echo "gh: $(gh api user -q .login 2>&1)"
echo "FOUNDRY_DATA=${FOUNDRY_DATA:-<padrão>}  FOUNDRY_CORE=${FOUNDRY_CORE:-<não definido>}"
data="${FOUNDRY_DATA:-$HOME/Library/Application Support/FoundryVTT/Data}"
node -p "'Tormenta20 instalado: ' + require('$data/systems/tormenta20/system.json').version" 2>&1
node -p "'Módulo: ' + require('./module.json').version + ' · verificado T20 ' + require('./module.json').relationships.systems[0].compatibility.verified"
test -d "${FOUNDRY_CORE:-/nonexistent}/client" && echo "core: ok" || echo "core: ausente"
git config --get commit.gpgsign; node --version
```

| Divergência | Consequência |
|---|---|
| `gh` não é `DMBerlin` | Nenhuma operação no GitHub até corrigir (`.envrc`/direnv ou `GH_TOKEN`). |
| `FOUNDRY_CORE` ausente | Não dá para verificar APIs do core; investigações e o review ficam limitados. |
| Tormenta20 instalado > `verified` | Os patches podem estar obsoletos: rode a skill `triage` antes de implementar. |
| `commit.gpgsign` ≠ `true` | Não faça commits até corrigir. |

## 2. Estado do repositório

```bash
git worktree list
git status --short --branch
git fetch -q origin && git rev-list --left-right --count origin/main...main   # "atrás à frente"
git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "sem tags"
git log --oneline -8 origin/main
make active-status
node -e 'import("./tools/changelog.mjs").then(m=>console.log(JSON.stringify(m.unreleasedEntries(require("fs").readFileSync("CHANGELOG.md","utf8")))))'
```

Para cada worktree de issue (`<n>-<slug>`), verifique o estágio pelo `.work/`, sem abrir os arquivos inteiros:

```bash
for wt in "$(git rev-parse --git-common-dir)"/../[0-9]*-*/; do
  [ -d "$wt" ] || continue
  echo "$(basename "$wt"): $(tail -1 "$wt/.work/review.md" 2>/dev/null || echo 'sem review') · commits: $(git -C "$wt" rev-list --count origin/main..HEAD)"
done
```

Os estágios são:
- **em implementação:** sem review;
- **em review:** review sem resultado final;
- **pronta para land:** `Resultado final: CLEAN`.

Se a sessão foi aberta fora de uma worktree do projeto, avise e use a `main`.

## 3. Mapa mínimo da arquitetura

Leia **apenas** estes trechos. São os pontos que qualquer tarefa toca:

1. `scripts/patches/index.mjs`, inteiro e curto: `GROUPS`, o typedef `Patch` e a lista `PATCHES`.
2. `scripts/main.mjs`: só o fluxo dos hooks `init` e `ready`, ou seja, onde o estado é resolvido e o `apply()` é chamado.
3. `scripts/registry.mjs`: só as assinaturas e os comentários de `resolvePatchState` e `shouldNotify`, mais os estados possíveis.
4. A lista de arquivos: `ls scripts scripts/patches scripts/apps tests tools .github/skills`.

Guarde, em uma linha cada:
- o ciclo de vida de um patch: setting → `resolvePatchState` (versão + `isNeeded`) → `apply()` no `init` → aviso no `ready`;
- os patches existentes e os grupos deles.

## 4. Backlog

```bash
gh issue list -R DMBerlin/t20-community-patches --state open --limit 100 \
  --json number,title,labels -q '.[] | "#\(.number) [\([.labels[].name] | join(","))] \(.title)"'
```

Leia **só os títulos e os labels**. Os corpos das issues são longos: carregue um corpo apenas quando a tarefa envolver aquela issue.

## 5. O que NÃO carregar agora (progressive disclosure)

Carregue sob demanda, quando a tarefa pedir:

| Quando a tarefa for… | Carregar |
|---|---|
| fazer qualquer commit | a skill `commit` |
| priorizar ou escolher o que fazer | a skill `triage` |
| registrar um bug ou uma melhoria | a skill `issue` (e os modelos dela) |
| implementar a issue #n | a skill `implement`, o corpo e os comentários da #n, e o patch existente mais parecido como modelo |
| testar a #n no Foundry sem intervenção humana | a skill `playtest` |
| integrar ou fechar a #n | a skill `land` |
| publicar uma versão | a skill `release` |
| entender um bug do sistema | trechos do bundle `tormenta20.mjs`, localizados por busca (`grep -n`), **nunca** o arquivo inteiro (mais de 20 mil linhas) |
| confirmar uma API do Foundry | o arquivo do core encontrado por busca em `$FOUNDRY_CORE/client` ou `$FOUNDRY_CORE/common` |
| mexer na interface do gerenciador | `scripts/apps/patch-manager.mjs`, `templates/patch-manager.hbs`, `styles/` |
| mexer em configurações ou migração | `scripts/settings.mjs` |
| histórico de decisões de um patch | a issue dele (comentários) e o `git log --follow` do arquivo |

Também não leia: testes existentes (só quando for mexer no código que eles cobrem), README inteiro, CHANGELOG inteiro, `lang/*.json` inteiros nem `.work-archive/`.

## 6. Briefing ao usuário

Responda em português, em até ~15 linhas, neste formato:

```
**Ambiente:** gh DMBerlin ✅ · Tormenta20 <v> (verificado <v>) · core ✅/⚠️ · Foundry carregando <worktree>
**Repo:** main <em dia | N atrás/à frente> · última tag <vX | nenhuma> · Unreleased: <k entradas (seções)>
**Em andamento:** #n <slug> — <estágio> | nenhuma
**Patches:** <id> (grupo, #n) …
**Backlog:** <x> abertas implementáveis (<críticas/altas>) · <y> upstream-only
**Alertas:** <só divergências reais, ou "nenhum">
**Sugestão:** <uma ação concreta: retomar #n / land #n / triage / release>
```

Depois, aguarde a instrução do usuário. Não inicie nenhuma tarefa por conta própria.
