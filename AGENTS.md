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
| `make lint` | ESLint: fronteiras entre camadas, tamanho e estilo (precisa de `npm ci` na worktree) |
| `make check` | `node --check` em todos os scripts, lint e testes; o CI roda o mesmo em push e PR |
| `make active` | Faz o Foundry carregar **esta** worktree (link simbólico em `Data/modules`) |
| `make active-status` | Mostra qual worktree o Foundry está carregando |
| `make worktree ISSUE=n` | Cria ou reutiliza a worktree da issue |
| `make audit [BUNDLE=…]` | Auditoria estática dos patches contra o bundle do Tormenta20 instalado, sem abrir o Foundry (ver "Auditoria estática") |
| `make package` | Gera `dist/module.zip` e `dist/module.json` |
| `node tools/changelog.mjs …` | `add`, `next`, `release`, `notes` (ver o cabeçalho do arquivo) |

## Camadas e fronteiras

O `eslint.config.mjs` garante as fronteiras da arquitetura em camadas (épico #82). Rode `npm ci` uma vez em cada worktree; depois, `make lint` ou `make check`.

- Camadas: `scripts/kernel`, `scripts/platform`, `scripts/services`, `scripts/lib` e `scripts/features/<feature>`.
- **Globais do Foundry só em `scripts/platform/`.** `game`, `CONFIG`, `ui`, `foundry`, `canvas`, `Hooks`, `CONST`, `Roll`, `ChatMessage`, `Actor`, `Item` e `Handlebars` são proibidos em `kernel`, `services`, `lib`, em todas as features (domínio, integração e UI), no `main.mjs` e nos arquivos legados já migrados (lista `NO_GLOBALS` do `eslint.config.mjs`). Isso vale também para `globalThis.<global>`, `window.<global>` e `self.<global>`, para cadeias como `globalThis.window.game` e para desestruturação (`const { game } = window`), via a regra local `t20/no-foundry-globals`.
- A regra local `t20/layer-boundaries` (`tools/eslint/layer-boundaries.mjs`) resolve cada importação relativa a partir do arquivo, em qualquer profundidade de pasta. Importações dentro da mesma feature são livres, salvo as do domínio abaixo. Ela também verifica `export … from` e `import()`; nas features e em `scripts/lib`, `import()` só aceita caminho literal. Nas camadas, só caminhos relativos (`./`, `../`): caminho absoluto, URL ou pacote é erro.
- Plataforma (`scripts/platform/foundry.mjs`): `createPlatform()` devolve um objeto congelado com as portas `system`, `classes` (classes de documento do sistema), `t20()`, `t20Config()`, `statusEffects()`, `settings` (chaves deste módulo), `i18n`, `notify`, `hooks`, `user`, `documents`, `utils`, `dice`, `forms`, `log`, `sourceOf(fn)` (código-fonte da função original, sob os wrappers do módulo), `sourceOfMethod(rótulo)` (o mesmo, a partir de um rótulo como `ItemT20#rollDamage`; ver "Auditoria estática") e `module`. Tudo é lido sob demanda, porque `CONFIG`, `game.user` e as traduções mudam entre o `init` e o `ready`. Uma porta nova entra aqui, nunca como global lido numa feature.
- Contexto (`scripts/kernel/context.mjs`): cada feature recebe um `ctx` congelado em `isNeeded(ctx)`, `install(ctx)` e `lateProbe(ctx)`, com `id`, `platform`, `log` (prefixado com o id), `hooks`, `wrap(alvo, método, wrapper)` (o dono é o id da feature) `setting(chave)`, que só lê chaves declaradas em `settings` da própria feature e lança nas outras, `services` e `features` (abaixo).
- Bibliotecas (`scripts/lib/`): helpers puros e sem estado compartilhados entre features (constantes, cálculos, leitura de dados). Recebem por parâmetro o que precisariam ler de globais (por exemplo `getProperty`, `fromUuidSync`, um leitor de configuração).
- Serviços (`scripts/services/`, registrados em `SERVICES`, de `scripts/services/index.mjs`): contratos **com estado** compartilhados entre features (`stacking-exclusions`, `use-dialog-guard`, `mana-queue`, `use-targets`, `attack-outcome`, `applied-changes`). Cada serviço exporta `{ id, install(ctx) }`; o `install` devolve a API, guarda o estado no próprio fechamento e é chamado **uma vez**, pelo kernel (`scripts/kernel/services.mjs`), logo antes da primeira feature que declara o serviço em `services`. O `ctx` do serviço tem `id`, `platform`, `log`, `hooks` e `wrap` (o dono dos wrappers é o id do serviço). Uma feature lê a API em `ctx.services[id]`; um id não declarado lança. Se o serviço falha ao instalar, as features que o declaram viram `error`.
- Dependências entre features (`scripts/kernel/features.mjs`): uma feature que precisa saber o estado ou a configuração de outra declara o id em `interactsWith` e lê por `ctx.features.isActive(id)` (patch aplicado ou regra instalada; leia só em tempo de uso, nunca durante o `install`) ou `ctx.features.setting(id, chave)` (só chaves declaradas em `settings` da outra; lança se a configuração não estiver registrada). Nunca leia `api.status` nem a configuração de outra feature por `game.settings`. `api.graph()` mostra as dependências declaradas.
- O `main.mjs` só cria a plataforma e liga o `init` (`registerPatchSettings`, menu da Central, `bootFeatures`, `api`) e o `ready` (`runReady`, em `scripts/kernel/ready.mjs`: avisos do carregamento e diagnósticos tardios).
- Nos testes, use `createFakePlatform(overrides)` e `createFakeContext(feature, platform)`, de `tests/support/fake-platform.mjs`, sem tocar em `globalThis`. A plataforma falsa guarda os avisos em `platform.notes` e o log em `platform.logs`. Para features com `services` ou `interactsWith`, use `createTestKernel({ platform, features, status })`: `install(feature)` instala os serviços declarados e a feature, e `service(id)` devolve a API de um serviço. Os testes de regras legadas que leem globais usam `tests/support/legacy-services.mjs` (um conjunto de serviços por `CONFIG.Item.documentClass`).
- **Uma feature não importa outra feature** (nem em `scripts/patches` e `scripts/rules`), nem `scripts/platform`; ela recebe a plataforma por `ctx`. Código comum puro vai para `scripts/lib`; código comum com estado vira um serviço em `scripts/services`; o estado ou a configuração de outra feature é lido por `ctx.features`, com `interactsWith`.
- O domínio de uma feature (`domain.mjs` ou `domain/`) e `scripts/lib` não importam `integration`, `ui`, `scripts/platform` nem `scripts/services`; `scripts/lib` também não importa features. Os dois também não importam o código legado de `scripts/` (raiz, `patches`, `rules`, `apps`): mova o código puro para `scripts/lib`.
- No máximo 300 linhas por arquivo nas camadas. Um domínio maior vira uma pasta `domain/`.
- Estilo: retorno antecipado (`no-else-return`), profundidade de blocos até 3, `===` (exceto com `null`), `const` e nenhum `var`. Complexidade acima de 12 e mais de 4 parâmetros geram aviso.
- Pastas legadas (`scripts/patches`, `scripts/rules`, `scripts/apps` e a raiz de `scripts/`) e os testes só geram avisos até as fases de migração (#88, #89). Não rode `eslint --fix` nelas fora dessas fases.

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

## Contrato de uma feature

Patches (correções) e regras opcionais seguem um contrato único, `Feature` (`scripts/kernel/feature.mjs`), com `kind: "patch" | "rule"`. A lista `FEATURES`, em `scripts/features/index.mjs`, define a ordem de instalação: primeiro os patches (`PATCHES`, de `scripts/patches/index.mjs`), depois as regras. Quem vem antes fica mais perto do original em cada cadeia de wrappers. O ciclo de vida (`bootFeatures`, em `scripts/kernel/lifecycle.mjs`) é o único ponto que instala features e isola erros: uma feature que lança vira `error` e não impede as outras. O `main.mjs` não conhece nenhuma feature específica.

Cada correção fica em `scripts/patches/<id>.mjs` e é registrada em `PATCHES`, em `scripts/patches/index.mjs`. Patches novos usam `install(ctx)`; o `apply()` sem contexto é legado, lê globais e continua aceito até a migração (#88):

```js
export default {
  id: "<id>",                       // também é a chave de i18n: T20CP.Patches.<id>.Name/Hint
  group: "<um de GROUPS>",          // conditions | sheet-effects | usage-effects | items | settings | actor | combat
  issue: <n>,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  guarded: false,                   // opcional: true se o install() só age quando o bug aparece
  settings: [/* opcional: SettingSpec, registradas só quando o patch é aplicado */],
  interactsWith: ["<id>"],          // opcional: features lidas por ctx.features (estado ou configuração)
  services: ["<id>"],               // opcional: serviços lidos em ctx.services, instalados antes do install()
  sources: ["ItemT20#rollDamage"],  // rótulos das funções do sistema de que o patch depende (make audit)
  probeKind: "behavior",            // opcional: o isNeeded executa código ou lê CONFIG, dados ou configurações
  isNeeded(ctx) { /* síncrono, seguro no init, roda antes do install(): devolve um Diagnosis */ },
  async lateProbe(ctx) { /* opcional: diagnóstico depois do ready; só atualiza selo e aviso */ },
  install(ctx) { /* instala os wrappers com ctx.wrap; chamado uma vez no init */ }
};
```

Cada regra opcional fica em `scripts/rules/<arquivo>.mjs`, exporta uma feature como `default` e é adicionada a `FEATURES`, na posição certa:

```js
export default {
  id: "<id>",                       // id da entrada na Central (T20CP.Manager.Rules.<id> quando há várias chaves)
  kind: "rule",
  group: "<um de GROUPS>",
  system: { id: "tormenta20" },     // outro sistema → estado "incompatible", sem install
  settings: [{ key: "<chave>", scope: "world", type: String, choices: {…}, default: "off", name, hint, onChange }],
  after: ["<id>"],                  // opcional: ids que precisam vir ANTES em FEATURES; "*" = a última
  interactsWith: ["<id>"],          // opcional: features lidas por ctx.features (estado ou configuração)
  services: ["<id>"],               // opcional: serviços lidos em ctx.services, instalados antes do install()
  install(ctx) { /* lê a própria configuração a cada uso, com ctx.setting("<chave>") */ }
};
```

- `SettingSpec`: o objeto passado a `game.settings.register`, mais `key`. O registro força `config: false`. A Central mostra a configuração na aba "Regras opcionais" (`centerSettings(FEATURES)`, em `scripts/kernel/settings.mjs`), agrupada por `centerId ?? id`; `center: false` a esconde. **Nunca** renomeie uma chave existente.
- As configurações das regras são registradas antes de qualquer `install`, em qualquer sistema.
- `after` não reordena nada: é uma restrição verificada por `validateFeatures` (no `init` e em `tests/kernel-feature.test.mjs`). Ao incluir uma regra, escolha a posição em `FEATURES` e declare em `after` as dependências de ordem, com um comentário que explique o motivo.
- `api.status` lista patches e regras (`kind`); as regras têm estado `installed`, `incompatible` ou `error`. Avisos e a aba de correções da Central só usam os patches.

Diagnóstico (`Diagnosis`, em `scripts/registry.mjs`): `{ bug: "present" | "fixed" | "unknown", confidence: "high" | "low", evidence?: string }`.
- `confidence: "high"` só quando a evidência cobre **tudo** o que o patch corrige. Em Automático, só `fixed`/high deixa de aplicar a correção; `fixed`/low vira `suspected-fixed` e a correção continua aplicada.
- Um teste que **só lê código-fonte** nunca devolve `fixed`/high: ignore comentários (`stripComments`), leia a função original por rótulo (`ctx.platform.sourceOfMethod("Classe#método")`, que segue o `unwrap`) e responda `unknown` para código não reconhecido (por exemplo, o wrapper de outro módulo). Uma correção parcial do sistema não é `fixed`.
- Booleanos legados continuam aceitos: `true` → present/high, `false` → fixed/low, `undefined` → unknown.
- `guarded: true` permite aplicar a correção numa versão não verificada sem confirmar o bug (`applied-guarded`).
- `lateProbe()` só roda quando o patch foi aplicado, não pode medir o efeito do próprio patch e devolve `undefined` quando não aprendeu nada.

### Auditoria estática (`make audit`)

`tools/audit.mjs` (#90) confere os patches contra um bundle do Tormenta20 sem abrir o Foundry: o bundle é só lido e analisado com acorn, nunca importado nem executado.
- Rótulos (`scripts/lib/method-label.mjs`): `Classe#membro` (método ou getter do protótipo), `Classe.membro` (estático), `#helper:nome` (helper do Handlebars) e `#local:nome` (função de topo do bundle, que só existe na auditoria; no Foundry é `null`).
- Um `isNeeded` de código-fonte lê o sistema **só** por `ctx.platform.sourceOfMethod(rótulo)`, e todo rótulo lido está em `sources`. A auditoria roda esse `isNeeded` contra o bundle; qualquer outra porta lança `RequiresFoundry` e vira erro. Um teste que executa código ou lê `CONFIG`, dados ou configurações declara `probeKind: "behavior"` e não roda na auditoria. Em todo patch, `sources` inclui também as funções do sistema que o cabeçalho aponta como causa do bug, mesmo que o teste não as leia: são elas que a auditoria vigia (`CHANGED`). Patches só de dados de compêndio podem ficar sem `sources`.
- As impressões digitais (`sourceFingerprint`) de todos os rótulos ficam em `tests/fixtures/audit-baseline.json`, por versão. A comparação usa a versão `verified` do `module.json` (ou a mais nova registrada). Depois de verificar uma versão nova do sistema, grave a dela com `node tools/audit.mjs --write-baseline`.
- As referências `T20:<linha>` dos arquivos de patch são conferidas pelo nome de código mais próximo: `ok`, `shifted` (o código andou), `missing`, `pinned` (a linha cita outra versão, como `1.6.5`) e `no-anchor`.
- Código de saída 1 quando uma impressão digital muda (`CHANGED`), um teste lança, um rótulo lido falta em `sources` ou uma referência some (`missing`).

Regras (patches e regras opcionais):
- Lógica de decisão em **funções puras exportadas**, testadas em `tests/<id>.test.mjs`. A integração com o Foundry fica fina.
- Wrappers preservam `this`, argumentos e o valor de retorno, e falham de forma segura (sem quebrar o sistema).
- Todo wrapper de método passa por `ctx.wrap(alvo, "método", function (original, ...args) { … })` (ou, no código legado e nos serviços, `wraps.wrap(alvo, "método", "<dono>", …)`, de `scripts/kernel/wrap.mjs`); nunca atribua direto ao protótipo. O dono é o id do patch ou da regra (ou o nome do serviço compartilhado). Quem registra primeiro fica mais perto do original, e a ordem aparece em `api.wraps()` e no snapshot `tests/fixtures/wrap-order.json` (regerar com `UPDATE_WRAP_ORDER=1 node --test tests/wrap-order.test.mjs` quando a ordem mudar de propósito). Para uma fábrica pura `(original) => substituta`, use `fromFactory`. `scripts/kernel/` não lê globais do Foundry.
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
