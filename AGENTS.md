# AGENTS.md: convenções do projeto

Este arquivo é lido automaticamente pelos agentes (Copilot CLI e outros). As skills em `.github/skills/` dependem dele.

## O que é o projeto

Módulo do Foundry VTT (`t20-community-patches`) com correções ativáveis para bugs confirmados do sistema **Tormenta20**.

Princípios inegociáveis:
- **Nunca** editar arquivos do sistema Tormenta20 nem do core do Foundry. Toda correção é feita por wrapper ou interceptação em tempo de execução, dentro do módulo.
- Corrigir só o que está comprovadamente quebrado, seguindo a intenção do sistema. Não mudar comportamento oficial que funciona.
- Toda correção tem três modos (Automático, Desligado, Forçar), é limitada por versão (`system.affected`) e, sempre que possível, tem um teste em tempo de execução (`isNeeded()`) que devolve um diagnóstico com nível de confiança.

## Layout de worktrees (`.bare`)

```
t20-community-patches/
├── .bare/                 repositório bare (git common dir)
├── .git                   "gitdir: ./.bare"
├── .envrc                 local (direnv): GH_TOKEN, FOUNDRY_DATA, FOUNDRY_CORE, T20_BOOKS
├── LOCAL.md               local (opcional): referências desta máquina (core do Foundry, livros)
├── main/                  worktree da branch main (principal)
└── <n>-<slug>/            worktree da issue #n, branch issue/<n>-<slug>
```

- Criar ou reutilizar a worktree de uma issue: `make worktree ISSUE=<n> [SLUG=<slug>]`. A worktree nasce de `origin/main`, sem upstream.
- O slug padrão é o id do patch que aparece entre parênteses no título da issue.
- Artefatos locais de trabalho ficam em `<worktree>/.work/`, ignorado pelo git: corpo da issue, rodadas de review, plano de teste manual, entrada do CHANGELOG.

## Idioma

- Documentação do projeto (`README.md`, `CHANGELOG.md`, `AGENTS.md`, skills, issues e comentários): **somente pt-BR**.
- Exceções: as mensagens de commit são em inglês (skill `commit`), e a interface do módulo continua traduzida em `lang/pt-BR.json` e `lang/en.json`.

## Caminhos externos

| Variável | Uso | Padrão |
|---|---|---|
| `FOUNDRY_DATA` | Pasta Data do Foundry | `~/Library/Application Support/FoundryVTT/Data` |
| `FOUNDRY_CORE` | Código-fonte do core do Foundry (`client/`, `common/`) | sem padrão; definir no `.envrc` |
| `T20_BOOKS` | PDFs dos livros do Tormenta20 (base bibliográfica das regras) | sem padrão; definir no `.envrc` |

- Se `../LOCAL.md` existir (na raiz do projeto, fora do git), leia-o para saber o que há em `FOUNDRY_CORE` e em `T20_BOOKS` e quando consultar cada um. O arquivo é opcional e nunca é versionado.
- Bundle do sistema (somente leitura): `$FOUNDRY_DATA/systems/tormenta20/tormenta20.mjs`. Nas issues, as referências ao código usam o formato `T20:<linha>`, e as linhas podem mudar entre versões. Confirme sempre pelo conteúdo, não só pelo número.
- Versão instalada do sistema: `node -p "require('$FOUNDRY_DATA/systems/tormenta20/system.json').version"`.

## Comandos

| Comando | O que faz |
|---|---|
| `make test` | Testes unitários (`node --test "tests/*.test.mjs"`) |
| `make check` | `node --check` em todos os scripts + testes |
| `make active` | Faz o Foundry carregar **esta** worktree (link simbólico em `Data/modules`) |
| `make active-status` | Mostra qual worktree o Foundry está carregando |
| `make worktree ISSUE=n` | Cria ou reutiliza a worktree da issue |
| `make package` | Gera `dist/module.zip` e `dist/module.json` |
| `node tools/changelog.mjs …` | `add`, `next`, `release`, `notes` (ver o cabeçalho do arquivo) |

## GitHub e git

- Repositório: `DMBerlin/t20-community-patches`, público, branch padrão `main`.
- `gh` precisa usar a conta **DMBerlin**: `export GH_TOKEN="$(gh auth token --user DMBerlin)"`. O `.envrc` já faz isso quando o direnv está ativo.
- `git push` funciona sem nada extra: o `.bare/config` tem um credential helper da conta DMBerlin.
- Commits: siga **sempre** a skill `commit` (`.github/skills/commit/SKILL.md`). Os commits são atômicos, seguem Conventional Commits e têm **mensagem de uma linha**, sem corpo e **sem trailers** (nada de `--trailer` ou `Co-authored-by`). São assinados por `commit.gpgsign`.
- Labels:
  - tipo: `patch` (corrigível no módulo), `upstream-only` (documentado para reporte, não corrigido aqui), `enhancement`, `ui-hide`, `data`;
  - prioridade: `priority: critical|high|medium|low`;
  - estado: `needs-repro`, `upstream-reported`.
- Título de issue: descrição em português; issues de patch terminam com o id do patch entre parênteses, por exemplo `Efeitos de uso … (suppressed-usage-effects)`.
- Upstream: https://gitlab.com/vizael/Tormenta20 (issues e branches).

## Contrato de um patch

Cada correção fica em `scripts/patches/<id>.mjs` e é registrada em `PATCHES`, em `scripts/patches/index.mjs`:

```js
export default {
  id: "<id>",                       // também é a chave de i18n: T20CP.Patches.<id>.Name/Hint
  group: "<um de GROUPS>",          // conditions | sheet-effects | usage-effects | items | settings
  issue: <n>,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  guarded: false,                   // opcional: true se o apply() só age quando o bug aparece
  isNeeded() { /* síncrono, seguro no init, roda antes do apply(): devolve um Diagnosis */ },
  async lateProbe() { /* opcional: diagnóstico depois do ready; só atualiza selo e aviso */ },
  apply() { /* instala os wrappers; chamado uma vez no init */ }
};
```

Diagnóstico (`Diagnosis`, em `scripts/registry.mjs`): `{ bug: "present" | "fixed" | "unknown", confidence: "high" | "low", evidence?: string }`.
- `confidence: "high"` só quando a evidência cobre **tudo** o que o patch corrige. Em Automático, só `fixed`/high deixa de aplicar a correção; `fixed`/low vira `suspected-fixed` e a correção continua aplicada.
- Um teste que **só lê código-fonte** nunca devolve `fixed`/high: ignore comentários (`stripComments`), leia a função original (`unwrap`, antes do `apply()`) e responda `unknown` para código não reconhecido (por exemplo, o wrapper de outro módulo). Uma correção parcial do sistema não é `fixed`.
- Booleanos legados continuam aceitos: `true` → present/high, `false` → fixed/low, `undefined` → unknown.
- `guarded: true` permite aplicar a correção numa versão não verificada sem confirmar o bug (`applied-guarded`).
- `lateProbe()` só roda quando o patch foi aplicado, não pode medir o efeito do próprio patch e devolve `undefined` quando não aprendeu nada.

Regras:
- Lógica de decisão em **funções puras exportadas**, testadas em `tests/<id>.test.mjs`. A integração com o Foundry fica fina.
- Wrappers preservam `this`, argumentos e o valor de retorno, e falham de forma segura (sem quebrar o sistema).
- Nunca avaliar texto de usuário como JavaScript (`eval`, `Function`, `Roll.safeEval`). Fórmulas passam por `foundry.dice.Roll`, como no core.
- Para cada patch, atualizar:
  - `lang/pt-BR.json` e `lang/en.json` (paridade de chaves; é a tradução da interface do módulo);
  - a tabela "Correções" do `README.md`.
- **Não** editar o `CHANGELOG.md` na worktree. A entrada é escrita em `.work/changelog.md` e inserida na main durante o land (ver abaixo).

## CHANGELOG e versões

- Formato Keep a Changelog. A seção `## Unreleased` acumula tudo o que já entrou na main e ainda não tem tag.
- Seções: `Added`, `Changed`, `Fixed`, `Security`, `Removed`. Cada entrada é **uma linha** em português que cita a issue (`(#n)`).
- Entradas entram **somente no land**: `node tools/changelog.mjs add <Seção> "<linha>"`.
- Versões: SemVer próprio do módulo, independente do Tormenta20. A compatibilidade é documentada no `module.json`, na linha `**Compatibilidade:**` de cada versão do CHANGELOG (`node tools/changelog.mjs compat`) e no título da GitHub Release (`vX.Y.Z · Tormenta20 <verified>`).
- Release: skill `release`. Ela confirma a versão com o usuário, roda `node tools/changelog.mjs release <x.y.z>`, cria o commit e a tag assinada `vX.Y.Z`, faz `git push --atomic origin main vX.Y.Z` e acompanha o workflow até o manifesto servir a nova versão. Tags publicadas nunca são movidas.
- O workflow `.github/workflows/release.yml` publica a GitHub Release, com `module.json` e `module.zip`, quando recebe a tag, e confere a URL do manifesto depois de publicar. O manifesto instalado no Foundry aponta para `releases/latest/download/module.json`, ou seja, para a última release publicada, e não para uma branch.

## Ciclo de vida (skills)

- `onboarding`: início de sessão; faz um briefing do ambiente, do repositório e do backlog e carrega o resto sob demanda.
0. `commit`: regras de commit, usadas por todas as outras skills.
1. `triage`: lista as issues abertas por prioridade (valor × complexidade). Não altera nada.
2. `issue`: investiga e abre uma issue completa, pronta para outro agente implementar.
3. `implement`: worktree, implementação, testes, commit e ciclo de review de QA (gpt-6.1-sol, no máximo 5 rodadas) até sair CLEAN; depois `make active` e o plano de teste manual.
   - `playtest`: opcional, entre `implement` e `land`; executa o plano de teste manual no Foundry real com Playwright e grava as evidências em `.work/playtest.md`.
4. `land`: squash na main, entrada no CHANGELOG, push, comentário com as evidências, fechamento da issue e remoção da worktree.
5. `release`: anuncia, confirma a versão e os pontos abertos, gera o commit e a tag assinados, faz o push e acompanha o pipeline até a publicação.
