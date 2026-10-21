---
name: playtest
description: >-
  Executa no Foundry real, sem intervenção humana, o plano de teste manual de
  uma issue do t20-community-patches: entra no mundo como GM com Playwright e
  Chrome headless, roda cada passo de .work/manual-tests.md pelo console (dados
  forçados, rolagens pelo atalho e pelo diálogo, patch ligado e desligado),
  limpa o mundo e grava as evidências em .work/playtest.md para a skill land.
  Use quando o usuário pedir playtest, testar no Foundry, validar os testes
  manuais ou rodar o teste manual automaticamente.
---

# playtest

Leia `AGENTS.md` antes de começar. Entrada: o número da issue (`#n`). Saída: `<wt>/.work/playtest.md` com uma linha por verificação (PASS, FAIL ou SKIP) e o resultado final. A skill **não** altera código do módulo, não faz commits e não escreve no GitHub.

Os caminhos:
- `<wt>`: worktree da issue (`<projeto>/<n>-<slug>`), com `.work/manual-tests.md` (gerado pela skill `implement`);
- `<skill>`: `<wt>/.github/skills/playtest` (este diretório). Use o da `main` se a worktree for anterior à skill.

## 1. Pré-condições

Rode tudo de uma vez e trate cada divergência antes de seguir:

```bash
cd <wt>
test -f .work/manual-tests.md && echo "plano: ok"
curl -s -m 5 "${FOUNDRY_URL:-http://localhost:30000}/api/status"; echo
make active-status
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

| Divergência | Ação |
|---|---|
| Sem `.work/manual-tests.md` | Pare; rode antes a skill `implement`. |
| `curl` falha | O Foundry não está rodando. Pergunte ao usuário com `ask_user`. |
| `"active":false` | O Foundry está no setup, protegido pela senha de administrador (`Config/admin.txt`), que você não tem. Peça com `ask_user` para o usuário iniciar o mundo (ou informar a senha), depois espere com um laço em `/api/status` até `"active":true`. |
| `system` ≠ `tormenta20` ou versão fora de `system.affected` | Peça para o usuário iniciar um mundo Tormenta20 na versão certa. Os mundos estão em `$FOUNDRY_DATA/worlds/*/world.json` (campo `system`). Prefira um mundo de teste, como `teste-t20`. |
| `make active-status` não aponta para `<wt>` | Rode `make active` em `<wt>`. Se o `module.json` mudou, o Foundry precisa reiniciar; senão basta o script entrar (ele carrega a página de novo). |
| Chrome ausente ou < 146 | O Foundry 14 recusa Chromium < 146, e o Chromium do Playwright costuma ser mais antigo. Peça ao usuário para instalar ou atualizar o Google Chrome. |

Credenciais: usuário GM `Gamemaster`, sem senha, salvo `FOUNDRY_GM_USER` e `FOUNDRY_GM_PASSWORD`. Se o login falhar, pergunte com `ask_user`. Avise o usuário de que o script entra como esse GM e pode tomar a sessão dele no navegador.

## 2. Preparar

```bash
cd <wt> && mkdir -p .work/playtest && cd .work/playtest
[ -f package.json ] || npm init -y >/dev/null
npm i -s playwright >/dev/null
```

O `.work/` é ignorado pelo git; nada daqui entra em commit. O Playwright só fornece o driver; o navegador é o Chrome instalado (`channel: "chrome"`), então **não** rode `npx playwright install`.

## 3. Escrever o script

Crie `<wt>/.work/playtest/playtest-<n>.mjs`. Ele importa o Playwright local e o helper da skill pelo caminho relativo `../../.github/skills/playtest/foundry.mjs`, ou pelo caminho absoluto do helper na `main` se a worktree for anterior à skill.

Funções do helper (`foundry.mjs`):

| Função | O que faz |
|---|---|
| `openFoundry(chromium, {url, user, password})` | Abre o Chrome headless com WebGL por software, entra no mundo e espera `game.ready`. Devolve `{browser, page, errors}` e fecha o navegador se falhar. |
| `reload(page)` | Recarrega e espera `game.ready`. Obrigatório depois de mudar o modo de um patch. |
| `patchStatus(page, id)` | `{id, group, mode, state, diagnosis, reason}` do patch nesta carga (`game.modules.get(MODULE_ID).api.status`). |
| `getPatchMode(page, id)` / `setPatchMode(page, id, mode)` | Lê ou grava `"auto"`, `"off"`, `"force"` ou `null` (remove a chave, ou seja, volta ao padrão) na configuração `patches`. `setPatchMode` devolve o valor anterior. |
| `PLAYTEST_FLAGS` | Flags que marcam **todo** ator ou item criado pelo teste: `Actor.create({ ..., flags: PLAYTEST_FLAGS })`. |
| `cleanup(page, {patchId, prevMode})` | Restaura os dados e o modo do patch e apaga as mensagens dos atores marcados, os atores e os itens marcados. Cada etapa roda isolada (os atores só saem se as mensagens saírem); devolve a lista de erros. |
| `leftovers(page, patchId)` | Conta o que sobrou (`actors`, `items`, `messages`) e devolve o modo atual. |
| `provenance(wt)` | Commit, `dirty` e sha256 de `.work/manual-tests.md` da worktree, que o `land` confere. |
| `uniformFor(face, faces = 20)` | O valor de `CONFIG.Dice.randomUniform` que faz o dado mostrar `face`. |
| `environment(page)` | Versões do Foundry e do sistema, mundo e usuário, para o relatório. |
| `createReport(title)` | `check(passo, nome, ok, detalhe)`, `skip(passo, nome, motivo)`, `error(err)`, `summary()` e `write(caminho, meta)`. Sem nenhuma verificação, o relatório sai FALHOU. |

Estrutura obrigatória do script (troque `<n>` e `<patch-id>`):

```js
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { openFoundry, reload, patchStatus, getPatchMode, setPatchMode, PLAYTEST_FLAGS, cleanup, leftovers,
  provenance, uniformFor, environment, createReport } from "../../.github/skills/playtest/foundry.mjs";

const ID = "<patch-id>";
const WT = fileURLToPath(new URL("../../", import.meta.url));
const report = createReport(`#<n> ${ID}`);
let browser, page, env, prevMode;
try {
  ({ browser, page } = await openFoundry(chromium));
  env = await environment(page);
  prevMode = await getPatchMode(page, ID);
  await cleanup(page, { patchId: ID, prevMode });       // restos marcados de uma execução anterior interrompida
  if (prevMode !== null) { await setPatchMode(page, ID, null); await reload(page); }   // patch no modo padrão
  let status = await patchStatus(page, ID);
  if (status?.state === "unverified") { await setPatchMode(page, ID, "force"); await reload(page); status = await patchStatus(page, ID); }
  report.check(0, "patch aplicado", ["applied", "applied-unverified", "applied-guarded", "suspected-fixed", "forced"].includes(status?.state), JSON.stringify({ mode: status?.mode, state: status?.state }));
  // passos do plano, na ordem de .work/manual-tests.md, cada um com report.check ou report.skip
  // último passo: setPatchMode(page, ID, "off") → reload(page) → state "disabled" → comportamento oficial
} catch (err) {
  report.error(err);
} finally {
  if (page) {
    for (const e of await cleanup(page, { patchId: ID, prevMode }).catch((e) => [String(e)])) report.check("limpeza", "restaurar o mundo", false, e);
    const left = await leftovers(page, ID).catch(() => null);
    report.check("limpeza", "nada sobrou e modo restaurado", left && !left.actors && !left.items && !left.messages && left.mode === prevMode, JSON.stringify(left));
  }
  await browser?.close().catch(() => {});
  report.write(new URL("../playtest.md", import.meta.url).pathname, { ...env, ...provenance(WT), script: ".work/playtest/playtest-<n>.mjs" });
  process.exitCode = report.failed ? 1 : 0;
}
```

O estado `unverified` (versão fora de `system.affected` e patch não `guarded`) é tratado antes do passo 0: o esqueleto força o patch. Anote isso em `Notas`.

Regras do script:
- **Um passo do plano → uma ou mais verificações**, com o número do passo. Cada verificação compara um valor observável (d20, fórmula do dano, valor na ficha, mudança salva) com o esperado do plano, e o detalhe registra o valor observado.
- Todo ator ou item de mundo criado leva `flags: PLAYTEST_FLAGS` (os itens embutidos somem com o ator). Dê nomes reconhecíveis (`CP<n> Guerreiro`), mas **nunca** apague por nome: a limpeza usa só a flag.
- O que não dá para automatizar (aparência visual, arrastar e soltar, dois usuários sem segundo login disponível) vira `report.skip` com o motivo. Nunca marque PASS sem observar.
- `page.evaluate` só devolve dados serializáveis. Monte objetos simples: as changes dos efeitos têm referência circular (`change.effect`), e os documentos não serializam.
- Restaure `CONFIG.Dice.randomUniform` num `finally` dentro do próprio `evaluate` da rolagem.
- Rode o script com tudo commitado na worktree (`git status --short` vazio); senão o relatório marca o commit como "com alterações não commitadas", e o `land` não o aceita.

## 4. Receitas (Tormenta20 1.6.5 · Foundry 14)

Dentro de `page.evaluate` não há acesso ao helper: passe `PLAYTEST_FLAGS`, `u` etc. como argumento.

**Documentos do compêndio.** `game.packs.get("tormenta20.equipamentos")` (Item), `tormenta20.efeitos` (ActiveEffect), `tormenta20.poderes`, `tormenta20.magias`. Para pôr num ator:

```js
const actor = await Actor.create({ name: "CP<n> Guerreiro", type: "character", flags });   // flags = PLAYTEST_FLAGS
const doc = await game.packs.get("tormenta20.equipamentos").getDocument("<id>");
const [item] = await actor.createEmbeddedDocuments("Item", [game.items.fromCompendium(doc)]);
await item.update({ "system.equipado": 1 });           // 0 = não equipado
```

Tipos de ator: `character`, `npc`, `simple`, `hazard`. Os ids do compêndio estão no corpo da issue; se não estiverem, procure com `pack.index.find((e) => e.name === "<nome>")`.

**Aprimoramentos de arma ou armadura** (melhorias, materiais, encantos). O sistema cria o efeito de forma assíncrona no `_onUpdate`:

```js
await item.update({ "system.upgrades.enchantment": ["Compendium.tormenta20.efeitos.ActiveEffect.<id>"] });
await new Promise((r) => setTimeout(r, 1500));         // ou espere item.effects ter o efeito
```

Categorias: `improvement`, `material`, `enchantment`, `curse`, `innovation`. A lista substitui a anterior; `[]` remove.

**Forçar dados.** O core mapeia `u` para `Math.ceil((1 - u) * faces)`. O mesmo `u` vale para **todos** os dados da rolagem (o dano também).

```js
window.__r0 ??= CONFIG.Dice.randomUniform;             // cleanup() restaura a partir de window.__r0
CONFIG.Dice.randomUniform = () => u;                   // u = uniformFor(17) no Node, passado como argumento
```

**Rolar um item sem diálogo e com diálogo.** `ItemT20#roll({ event })` abre o diálogo de uso quando há efeitos de uso ou rolagens e `usageConfig ? !shiftKey : shiftKey`, com `usageConfig = game.settings.get("tormenta20", "UsageConfig") === "default"`. Calcule o `shiftKey` a partir da configuração atual:

```js
const usage = game.settings.get("tormenta20", "UsageConfig") === "default";
// sem diálogo
const msg = await item.roll({ event: { shiftKey: usage } });
// com diálogo: não espere dentro do evaluate
window.__p = item.roll({ event: { shiftKey: !usage } });
```

No Node, para o diálogo:

```js
const use = page.locator('button[data-button="use"]').last();
await use.waitFor({ state: "visible", timeout: 15000 });
await page.locator(`input[name="aprs.${effectId}.aplica"]`).last().uncheck();   // desmarcar um efeito de uso
await use.click();
const result = await page.evaluate(async () => { const m = await window.__p; /* ler m */ });
```

Os campos do diálogo: `aprs.<effectId>.aplica` (checkbox ou número), `aprs.<effectId>.custo` (oculto), `bonus` e `bonusdano` (texto).

**Ler o resultado de uma rolagem.** Use a `ChatMessage` que `item.roll` devolve. Se não vier uma `ChatMessage`, registre FAIL ou corrija o script; **não** use a última mensagem do chat, que pode ser de outro usuário.

```js
if (!(m instanceof ChatMessage)) throw new Error("roll não devolveu ChatMessage");
const atk = m.rolls.find((r) => r.options.type === "attack");
const dmg = m.rolls.find((r) => r.options.type === "damage");
const d20 = atk.terms[0].total;
const die = dmg.terms.find((t) => t instanceof foundry.dice.terms.Die);   // die.number, die.faces
```

Crítico: o sistema multiplica os dados do dano por `criticoX` (espada ×2: 1d8 → 2d8; machado de batalha ×3: 1d8 → 3d8). Compare `die.number` com os dados base × `item.system.criticoX`, nunca com um ×2 fixo.

**Valores da ficha.** Leia os dados preparados (`actor.system…`, `item.system…`) depois de `await` nas atualizações. Para conferir a interface, `actor.sheet.render(true)` e consulte o DOM com o `page.locator`.

**Efeitos guardados.** Confira que o dado salvo não mudou: `item.effects.getName("<nome>").system.changes.map(({ key, type, value }) => ({ key, type, value }))`.

**Patch desligado.** `setPatchMode(page, ID, "off")`, `reload(page)`, `patchStatus(page, ID).state === "disabled"`, e então repita a verificação principal esperando o comportamento oficial (com o bug). O `finally` restaura o modo anterior.

## 5. Executar e analisar

```bash
cd <wt>/.work/playtest && node playtest-<n>.mjs
```

Para cada FAIL, decida **antes** de reportar:
- **Erro do script** (seletor, premissa errada, como um multiplicador de crítico fixo): corrija o script e rode de novo. Registre a correção em uma linha em `Notas` do relatório.
- **Erro do patch** (o observado contradiz o plano e a regra da issue): **não** corrija o patch aqui. Reporte ao usuário com o passo, o esperado e o observado, e oriente voltar para a skill `implement`.
- **Plano errado** (o plano contradiz a issue ou o livro): pergunte com `ask_user`.
- **Limpeza** (linhas `limpeza` em FAIL): mostre ao usuário o que sobrou; não apague nada sem a flag do teste.

Se o código ou o plano mudarem depois, rode o playtest de novo: o relatório vale só para o commit e o plano registrados nele.

## 6. Relatório

`<wt>/.work/playtest.md` registra o commit, o hash do plano e termina com uma destas linhas, que a skill `land` lê:
- `Resultado: PASSOU (…)`: todas as verificações PASS;
- `Resultado: PARCIAL (…)`: nenhuma FAIL, com algum SKIP;
- `Resultado: FALHOU (…)`: alguma FAIL (inclusive na limpeza).

Ao usuário, seja conciso: o resultado, a tabela de passos (PASS, FAIL ou SKIP, com o valor observado), os FAIL analisados, os SKIP com motivo e a confirmação da limpeza. Se passou, sugira `land #<n>`.
