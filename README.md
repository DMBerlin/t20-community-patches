# Tormenta20 Community Patches

Módulo para Foundry VTT com correções comunitárias para bugs confirmados no sistema [Tormenta20](https://gitlab.com/vizael/Tormenta20), enquanto a correção oficial não é lançada.

**Princípios**

- Corrige apenas bugs comprovados, seguindo a intenção dos mantenedores do sistema. O comportamento padrão do Foundry e do Tormenta20 não é alterado.
- As correções ficam em **Configurações → Configurar Definições → Tormenta20 Community Patches → Gerenciar correções**, agrupadas por área. Cada uma tem seu próprio liga/desliga, um selo de status e o link da issue. Ao alterar uma opção, o mundo é recarregado.
- Cada correção verifica, ao carregar o mundo, se o bug ainda existe no sistema. Nas versões verificadas, ela é aplicada, a menos que esse teste mostre que o bug já foi corrigido. Em versões mais novas, ainda não verificadas, ela só é aplicada se o teste confirmar o bug. Esse teste verifica o sintoma principal do bug, não todo o comportamento. Por isso ele reduz bastante o risco de aplicar uma correção em dobro, mas não o elimina. Se notar algo estranho depois de atualizar o Tormenta20, desligue a correção e abra uma issue. Cada GM é avisado, uma vez, quando uma correção passa a precisar de atenção: corrigida no sistema, versão não verificada, aplicada em versão não verificada ou incompatível. Erros geram aviso a cada carregamento.
- Alterações salvas valem depois de recarregar o mundo. Se o GM recusar o recarregamento, a janela mostra que há alterações pendentes.
- Selos: Aplicada · Aplicada (versão não verificada) · Desligada · Corrigida no sistema · Versão não verificada · Incompatível · Erro.

## Instalação

No Foundry, vá em **Add-on Modules → Install Module** e cole a URL do manifesto:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

## Correções

| Correção | Grupo | Versões verificadas | O que faz |
|---|---|---|---|
| `status-effects-compendium` ([#1](https://github.com/DMBerlin/t20-community-patches/issues/1)) | Condições | 1.6.5 | Preenche o compêndio Condições (`world.statuses`) com as 38 condições do pack do sistema quando ele está vazio. O problema acontecia porque o sistema procurava as condições numa pasta que não existe. Restaura o HUD de condições, Morto no combate, Cego e Invisível na visão, Sobrecarregado e Sustentando. Jogadores conectados durante o reparo recebem as condições sem recarregar. Um compêndio que já tenha conteúdo nunca é alterado, e as condições copiadas ficam na raiz do compêndio. |
| `encumbered-status-sync` ([#21](https://github.com/DMBerlin/t20-community-patches/issues/21)) | Condições | 1.6.5 | Reavalia a condição Sobrecarregado quando itens são adicionados ou excluídos da ficha do personagem; antes, ela só mudava ao editar um item. A checagem passa a aguardar a criação e a remoção, então não cria cópias duplicadas. Cópias extras, como as que surgem quando o GM e o jogador alteram o mesmo personagem ao mesmo tempo, são removidas na checagem seguinte, e todas as cópias saem quando o personagem deixa de estar sobrecarregado. Desequipar um item não muda a carga, porque o peso conta todo item carregado. |
| `item-effects-on-actor-sheet` ([#2](https://github.com/DMBerlin/t20-community-patches/issues/2)) | Efeitos na ficha | 1.6.5 | Lista na ficha do ator os efeitos transferidos pelos itens (passivos, de uso e suprimidos), com o item como fonte, como no Foundry v10. Nas linhas de efeitos de uso, que não têm coluna de fonte, o item aparece num tooltip. Alternar, Editar, Excluir (com confirmação) e Arrastar agem no efeito dentro do item. A mecânica não muda, porque esses efeitos já eram aplicados. Cópias legadas antigas no ator passam a aparecer ao lado do efeito do item; o módulo não as apaga. |
| `usage-effect-toggle` ([#5](https://github.com/DMBerlin/t20-community-patches/issues/5)) | Efeitos na ficha | 1.6.5 | O botão de alternar dos efeitos de uso nas fichas de ator e de item passa a ligar e desligar "Aplicar Sempre", como o título já dizia, e o ícone mostra esse estado. Assim, o efeito vem pré-marcado no diálogo de uso e é aplicado nas rolagens sem diálogo (Shift). Antes, o botão alternava um campo que os efeitos de uso ignoram. Efeitos de uso temporários de itens continuam alternando entre "aplicado por padrão" e "opcional" no card do chat, com o título "Alternar Efeito". Valores antigos não são migrados. |
| `suppressed-usage-effects` ([#4](https://github.com/DMBerlin/t20-community-patches/issues/4)) | Efeitos de uso | 1.6.5 | Efeitos de uso de armas e equipamentos não equipados deixam de aparecer no diálogo de uso e de ser aplicados automaticamente (Shift) em rolagens de item, perícia e atributo, seguindo a mesma regra que já suprime os efeitos passivos. Com o ajuste "Controlar Itens Equipáveis" ligado, vale o item estar num espaço de empunhar ou vestir. Ferramentas e vestuário seguem a mesma regra; consumíveis nunca são suprimidos. Rolar um item não equipado continua oferecendo os efeitos de uso dele mesmo, e os efeitos de uso do próprio personagem não mudam. |
| `armor-penalty-reduction` ([#19](https://github.com/DMBerlin/t20-community-patches/issues/19)) | Itens e equipamento | 1.6.5 | Faz Ajustada (−1), Sob Medida (−2) e Mitral (−2) reduzirem a penalidade de armadura do item até 0, em vez de aumentá-la. Antes, uma Armadura Completa (−5) com Ajustada mostrava −6; agora mostra −4. A correção afeta perícias e rolagens, mas a ficha do item continua mostrando a penalidade-base. Reforçada e Sobrecarregado continuam aumentando a penalidade. A penalidade do item inclui a Reforçada dele, então uma redução maior que a penalidade-base também anula a Reforçada (base −1, Reforçada −1 e Sob Medida resultam em 0). |

## Desenvolvimento

As convenções completas estão em [`AGENTS.md`](AGENTS.md).

- Cada correção fica em um arquivo próprio em `scripts/patches/` e precisa ser registrada em `scripts/patches/index.mjs`, com:
  - `group`: um dos `GROUPS`;
  - `issue`;
  - `system.affected`: as versões verificadas;
  - `apply()`;
  - sempre que possível, `isNeeded()`: um teste síncrono, seguro no `init`, que retorna `true` se o bug existe, `false` se já foi corrigido e `undefined` se não dá para saber.
- O nome e a descrição de cada correção vão em `lang/pt-BR.json` e `lang/en.json`.
- O repositório usa worktrees no layout `.bare`: `main/` é a principal e cada issue ganha a sua (`<n>-<slug>/`, branch `issue/<n>-<slug>`).

| Comando | O que faz |
|---|---|
| `make test` / `make check` | Testes unitários / verificação de sintaxe + testes |
| `make worktree ISSUE=<n>` | Cria ou reutiliza a worktree da issue |
| `make active` | Faz o Foundry carregar a worktree atual (`FOUNDRY_DATA` muda o caminho) |
| `make active-status` | Mostra qual worktree o Foundry está carregando |
| `make package` | Gera `dist/module.zip` e `dist/module.json` |

Fluxo de trabalho, pelas skills em `.github/skills/`:

| Skill | Etapa |
|---|---|
| `onboarding` | situar uma sessão nova |
| `triage` | priorizar |
| `issue` | registrar |
| `implement` | implementar e revisar |
| `land` | integrar na `main` e fechar a issue |
| `release` | versionar |

Todas seguem as regras de commit da skill `commit`.

### Release

1. A skill `release` move `Unreleased` para a nova versão no `CHANGELOG.md`, atualiza o `module.json` e cria o commit e a tag assinada `vX.Y.Z`.
2. Você faz o push: `git push --follow-tags origin main`.
3. O workflow `Release` testa, empacota e publica a GitHub Release com `module.json` e `module.zip`. A URL do manifesto aponta sempre para a última release publicada.

## Licença

MIT
