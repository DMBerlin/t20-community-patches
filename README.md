# Tormenta20 Community Patches

[Português](#português) · [English](#english)

## Português

Módulo para Foundry VTT com correções comunitárias para bugs confirmados no sistema [Tormenta20](https://gitlab.com/vizael/Tormenta20), enquanto a correção oficial não é lançada.

**Princípios**

- Corrige apenas bugs comprovados, seguindo a intenção dos mantenedores do sistema. O comportamento padrão do Foundry e do Tormenta20 não é alterado.
- As correções ficam em **Configurações → Configurar Definições → Tormenta20 Community Patches → Gerenciar correções**, agrupadas por área. Cada uma tem seu próprio liga/desliga, um selo de status e o link da issue. Ao alterar uma opção, o mundo é recarregado.
- Cada correção verifica, ao carregar o mundo, se o bug ainda existe no sistema. Nas versões verificadas, ela é aplicada, a menos que esse teste mostre que o bug já foi corrigido. Em versões mais novas, ainda não verificadas, ela só é aplicada se o teste confirmar o bug. Esse teste verifica o sintoma principal do bug, não todo o comportamento. Por isso ele reduz bastante o risco de aplicar uma correção em dobro, mas não o elimina. Se notar algo estranho depois de atualizar o Tormenta20, desligue a correção e abra uma issue. Cada GM é avisado, uma vez, quando uma correção passa a precisar de atenção: corrigida no sistema, versão não verificada, aplicada em versão não verificada ou incompatível. Erros geram aviso a cada carregamento.
- Alterações salvas valem depois de recarregar o mundo. Se o GM recusar o recarregamento, a janela mostra que há alterações pendentes.
- Selos: Aplicada · Aplicada (versão não verificada) · Desligada · Corrigida no sistema · Versão não verificada · Incompatível · Erro.

### Instalação

No Foundry, vá em **Add-on Modules → Install Module** e cole a URL do manifesto:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

### Correções

| Correção | Grupo | Versões verificadas | O que faz |
|---|---|---|---|
| `armor-penalty-reduction` ([#19](https://github.com/DMBerlin/t20-community-patches/issues/19)) | Itens e equipamento | 1.6.5 | Faz Ajustada (−1), Sob Medida (−2) e Mitral (−2) reduzirem a penalidade de armadura do item até 0, em vez de aumentá-la. Antes, uma Armadura Completa (−5) com Ajustada mostrava −6; agora mostra −4. A correção afeta perícias e rolagens, mas a ficha do item continua mostrando a penalidade-base. Reforçada e Sobrecarregado continuam aumentando a penalidade. A penalidade do item inclui a Reforçada dele, então uma redução maior que a penalidade-base também anula a Reforçada (base −1, Reforçada −1 e Sob Medida resultam em 0). |

### Desenvolvimento

- Cada correção fica em um arquivo próprio em `scripts/patches/` e precisa ser registrada em `scripts/patches/index.mjs`, com `group` (um dos `GROUPS`), `issue`, `system.affected` (versões verificadas), `apply()` e, sempre que possível, `isNeeded()`: um teste síncrono, seguro no `init`, que retorna `true` se o bug existe, `false` se já foi corrigido e `undefined` se não dá para saber. Também é preciso adicionar o nome e a descrição dela em `lang/*.json`.
- Testes: `node --test "tests/*.test.mjs"`
- Para usar nesta máquina, crie um link simbólico de `Data/modules/t20-community-patches` para a worktree desejada.
- Release manual:
  1. Atualize `version` e `download` no `module.json`.
  2. Atualize o `CHANGELOG.md`.
  3. Execute `tools/package.sh`.
  4. Execute `gh release create vX.Y.Z dist/module.zip dist/module.json`.

## English

Foundry VTT module with community fixes for confirmed bugs in the [Tormenta20](https://gitlab.com/vizael/Tormenta20) system, while an official fix has not been released.

**Principles**

- It fixes only confirmed bugs, following the system maintainers' intent. Default Foundry and Tormenta20 behavior is not changed.
- Patches live in **Settings → Configure Settings → Tormenta20 Community Patches → Manage patches**, grouped by area. Each one has its own toggle, a status badge and a link to its issue. Changing an option reloads the world.
- When the world loads, each patch checks whether the bug still exists in the system. On verified versions it is applied unless that check shows the bug is already fixed. On newer, unverified versions it is applied only when the check confirms the bug. The check tests the bug's main symptom, not its full behavior, so it greatly reduces the risk of applying a fix twice but does not rule it out. If something looks wrong after a Tormenta20 update, turn the patch off and open an issue. Each GM is notified once when a patch starts needing attention: fixed in the system, unverified version, applied on an unverified version, or incompatible. Errors are reported on every load.
- Saved changes take effect after reloading the world. If the GM declines the reload, the window shows that changes are pending.
- Badges: Applied · Applied (unverified version) · Off · Fixed in the system · Unverified version · Incompatible · Error.

### Installation

In Foundry, go to **Add-on Modules → Install Module** and paste the manifest URL:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

### Patches

| Patch | Group | Verified versions | What it does |
|---|---|---|---|
| `armor-penalty-reduction` ([#19](https://github.com/DMBerlin/t20-community-patches/issues/19)) | Items and equipment | 1.6.5 | Makes Adjusted (−1), Under Measure (−2) and Mithril (−2) reduce the item's armor penalty down to 0 instead of increasing it. Previously, Full Plate (−5) with Adjusted showed −6; it now shows −4. The fix affects skills and rolls, but the item sheet still shows the base penalty. Reinforced and Overloaded still increase the penalty. The item's penalty includes its own Reinforced, so a reduction larger than the base penalty also cancels it (base −1, Reinforced −1 and Under Measure result in 0). |

### Development

- Each patch lives in its own file in `scripts/patches/` and must be registered in `scripts/patches/index.mjs` with `group` (one of `GROUPS`), `issue`, `system.affected` (verified versions), `apply()` and, whenever possible, `isNeeded()`: a synchronous check, safe during `init`, that returns `true` if the bug exists, `false` if it is already fixed and `undefined` if it can't tell. Its name and description must also be added to `lang/*.json`.
- Tests: `node --test "tests/*.test.mjs"`
- To use it on this machine, create a symlink from `Data/modules/t20-community-patches` to the desired worktree.
- Manual release:
  1. Update `version` and `download` in `module.json`.
  2. Update `CHANGELOG.md`.
  3. Run `tools/package.sh`.
  4. Run `gh release create vX.Y.Z dist/module.zip dist/module.json`.

## License

MIT
