# Tormenta20 Community Patches

[Português](#português) · [English](#english)

## Português

Módulo para Foundry VTT com correções comunitárias para bugs confirmados no sistema [Tormenta20](https://gitlab.com/vizael/Tormenta20), enquanto a correção oficial não é lançada.

**Princípios**

- Corrige apenas bugs comprovados, seguindo a intenção dos mantenedores do sistema. O comportamento padrão do Foundry e do Tormenta20 não é alterado.
- Cada correção pode ser ativada ou desativada em **Configurações → Configurar Definições → Tormenta20 Community Patches**. Ao alterar uma opção, o mundo é recarregado.
- Cada correção é aplicada somente nas versões do sistema verificadas com o bug. Em outras versões, ela não é aplicada e o GM recebe um aviso, para que uma correção oficial nunca seja aplicada em dobro.

### Instalação

No Foundry, vá em **Add-on Modules → Install Module** e cole a URL do manifesto:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

### Correções

| Correção | Versões afetadas | O que faz |
|---|---|---|
| `armor-penalty-reduction` | 1.6.5 | Faz Ajustada (−1), Sob Medida (−2) e Mitral (−2) reduzirem a penalidade de armadura do item até 0, em vez de aumentá-la. Antes, uma Armadura Completa (−5) com Ajustada mostrava −6; agora mostra −4. A correção afeta perícias e rolagens, mas a ficha do item continua mostrando a penalidade-base. Reforçada e Sobrecarregado continuam aumentando a penalidade. |

### Desenvolvimento

- Cada correção fica em um arquivo próprio em `scripts/patches/` e precisa ser registrada em `scripts/patches/index.mjs`. Também é preciso adicionar o nome e a descrição dela em `lang/*.json`.
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
- Each fix can be turned on or off in **Settings → Configure Settings → Tormenta20 Community Patches**. Changing an option reloads the world.
- Each fix is applied only to system versions verified to have the bug. On other versions, it is not applied and the GM gets a warning, so an official fix is never applied twice.

### Installation

In Foundry, go to **Add-on Modules → Install Module** and paste the manifest URL:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

### Patches

| Patch | Affected versions | What it does |
|---|---|---|
| `armor-penalty-reduction` | 1.6.5 | Makes Adjusted (−1), Under Measure (−2) and Mithril (−2) reduce the item's armor penalty down to 0 instead of increasing it. Previously, Full Plate (−5) with Adjusted showed −6; it now shows −4. The fix affects skills and rolls, but the item sheet still shows the base penalty. Reinforced and Overloaded still increase the penalty. |

### Development

- Each patch lives in its own file in `scripts/patches/` and must be registered in `scripts/patches/index.mjs`. Its name and description must also be added to `lang/*.json`.
- Tests: `node --test "tests/*.test.mjs"`
- To use it on this machine, create a symlink from `Data/modules/t20-community-patches` to the desired worktree.
- Manual release:
  1. Update `version` and `download` in `module.json`.
  2. Update `CHANGELOG.md`.
  3. Run `tools/package.sh`.
  4. Run `gh release create vX.Y.Z dist/module.zip dist/module.json`.

## License

MIT
