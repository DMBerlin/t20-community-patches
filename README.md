# Tormenta20 Community Patches

Módulo para Foundry VTT com correções comunitárias para bugs confirmados no sistema [Tormenta20](https://gitlab.com/vizael/Tormenta20), enquanto a correção oficial não é lançada.

**Princípios**

- Corrige apenas bugs comprovados, seguindo a intenção dos mantenedores do sistema. O comportamento padrão do Foundry e do Tormenta20 não é alterado.
- As correções ficam em **Configurações → Configurar Definições → Tormenta20 Community Patches → Gerenciar correções**, agrupadas por área. Cada uma tem um modo (Automático, Desligado ou Forçar), um selo de status com o diagnóstico na dica e o link da issue. Ao alterar um modo, o mundo é recarregado; Forçar pede confirmação.
- Cada correção faz, ao carregar o mundo, um diagnóstico do bug no sistema, com nível de confiança (alto ou baixo). O diagnóstico roda também com a correção desligada.
  - **Automático:** a correção só deixa de ser aplicada quando há evidência forte de que o Tormenta20 corrigiu o bug ("Corrigida no sistema — pode desmarcar"). Com um indício fraco, ela continua aplicada e o selo pede para verificar ("Possivelmente corrigida — verifique"). Em versões mais novas, ainda não verificadas, ela é aplicada se o bug for confirmado, ou por precaução quando a correção só age quando o bug aparece; nos demais casos, não é aplicada nesta carga. A preferência nunca muda sozinha.
  - **Desligado:** não aplica a correção; se o sistema já corrigiu o bug, o selo mostra isso.
  - **Forçar:** aplica a correção mesmo quando o diagnóstico diz que o bug foi corrigido ou não o confirma (nunca em sistema incompatível). Se o sistema também corrigiu, o comportamento pode ficar duplicado.
  - Se notar algo estranho depois de atualizar o Tormenta20, desligue a correção e abra uma issue.
- Cada GM é avisado uma vez por mudança, e de novo a cada nova versão do sistema, quando uma correção precisa de atenção. Uma correção feita pelo sistema gera um aviso informativo, com o caminho do gerenciador. Se um bug dado como corrigido voltar a ser detectado, há um aviso próprio. Erros geram aviso a cada carregamento.
- Alterações salvas valem depois de recarregar o mundo. Se o GM recusar o recarregamento, a janela mostra que há alterações pendentes.
- Selos: "Aplicada"; "Aplicada (versão não verificada)"; "Aplicada por precaução"; "Possivelmente corrigida — verifique"; "Forçada"; "Desligada"; "Desligada · corrigida no sistema"; "Corrigida no sistema — pode desmarcar"; "Versão não verificada"; "Incompatível"; "Erro".

## Instalação

No Foundry, vá em **Add-on Modules → Install Module** e cole a URL do manifesto:

```
https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json
```

## Versões e compatibilidade

O módulo tem numeração própria, em [SemVer](https://semver.org/lang/pt-BR/), independente da versão do Tormenta20. As versões do Foundry VTT e do Tormenta20 com que cada versão foi verificada aparecem no título e nas notas de cada [release](https://github.com/DMBerlin/t20-community-patches/releases) e no início de cada versão do [CHANGELOG](CHANGELOG.md).

## Correções

| Correção | Grupo | Versões verificadas | O que faz |
|---|---|---|---|
| `status-effects-compendium` ([#1](https://github.com/DMBerlin/t20-community-patches/issues/1)) | Condições | 1.6.5 | Preenche o compêndio Condições (`world.statuses`) com as 38 condições do pack do sistema quando ele está vazio. O problema acontecia porque o sistema procurava as condições numa pasta que não existe. Restaura o HUD de condições, Morto no combate, Cego e Invisível na visão, Sobrecarregado e Sustentando. Jogadores conectados durante o reparo recebem as condições sem recarregar. Um compêndio que já tenha conteúdo nunca é alterado, e as condições copiadas ficam na raiz do compêndio. |
| `encumbered-status-sync` ([#21](https://github.com/DMBerlin/t20-community-patches/issues/21)) | Condições | 1.6.5 | Reavalia a condição Sobrecarregado quando itens são adicionados ou excluídos da ficha do personagem; antes, ela só mudava ao editar um item. A checagem passa a aguardar a criação e a remoção, então não cria cópias duplicadas. Cópias extras, como as que surgem quando o GM e o jogador alteram o mesmo personagem ao mesmo tempo, são removidas na checagem seguinte, e todas as cópias saem quando o personagem deixa de estar sobrecarregado. Desequipar um item não muda a carga, porque o peso conta todo item carregado. |
| `item-effects-on-actor-sheet` ([#2](https://github.com/DMBerlin/t20-community-patches/issues/2)) | Efeitos na ficha | 1.6.5 | Lista na ficha do ator os efeitos transferidos pelos itens (passivos, de uso e suprimidos), com o item como fonte, como no Foundry v10. Nas linhas de efeitos de uso, que não têm coluna de fonte, o item aparece num tooltip. Alternar, Editar, Excluir (com confirmação) e Arrastar agem no efeito dentro do item. A mecânica não muda, porque esses efeitos já eram aplicados. Cópias legadas antigas no ator passam a aparecer ao lado do efeito do item; o módulo não as apaga. |
| `usage-effect-toggle` ([#5](https://github.com/DMBerlin/t20-community-patches/issues/5)) | Efeitos na ficha | 1.6.5 | O botão de alternar dos efeitos de uso nas fichas de ator e de item passa a ligar e desligar "Aplicar Sempre", como o título já dizia, e o ícone mostra esse estado. Assim, o efeito vem pré-marcado no diálogo de uso e é aplicado nas rolagens sem diálogo (Shift). Antes, o botão alternava um campo que os efeitos de uso ignoram. Efeitos de uso temporários de itens continuam alternando entre "aplicado por padrão" e "opcional" no card do chat, com o título "Alternar Efeito". Valores antigos não são migrados. |
| `suppressed-usage-effects` ([#4](https://github.com/DMBerlin/t20-community-patches/issues/4)) | Efeitos de uso | 1.6.5 | Efeitos de uso de armas e equipamentos não equipados deixam de aparecer no diálogo de uso e de ser aplicados automaticamente (Shift) em rolagens de item, perícia e atributo, seguindo a mesma regra que já suprime os efeitos passivos. Com o ajuste "Controlar Itens Equipáveis" ligado, vale o item estar num espaço de empunhar ou vestir. Ferramentas e vestuário seguem a mesma regra; consumíveis nunca são suprimidos. Rolar um item não equipado continua oferecendo os efeitos de uso dele mesmo, e os efeitos de uso do próprio personagem não mudam. |
| `appended-usage-changes` ([#23](https://github.com/DMBerlin/t20-community-patches/issues/23)) | Efeitos de uso | 1.6.5 | Os efeitos de uso entram no fluxo de uso como cópias, então o sistema não altera mais o efeito guardado no personagem entre um uso e outro. Efeitos que acrescentam um bônus passivo a outro efeito (chave `+system.…` sem "Aumenta"), como a Inspiração Marcial, somam o bônus uma única vez: Inspiração +3 dá dano +3, e não +6. |
| `linked-usage-effects` ([#24](https://github.com/DMBerlin/t20-community-patches/issues/24)) | Efeitos de uso | 1.6.5 | Um efeito de uso com a chave `efeito` que aponta para um efeito de **outro** item passa a funcionar: o efeito é procurado no item que fornece o efeito de uso, pelo nome ou pela descrição, e vai para o card só com as próprias changes. Isso conserta Arte Mágica (+2 na CD) e Esgrima Mágica (Atuação no ataque) na Inspiração. As changes `efeito`/`condicao` deixam de aparecer no efeito principal. Se houver mais de um candidato, nada é injetado e fica um aviso no console. |
| `temporary-usage-effect-expiry` ([#6](https://github.com/DMBerlin/t20-community-patches/issues/6)) | Efeitos de uso | 1.6.5 | Faz os efeitos de uso temporários nos atores (por exemplo, Profanar aplicado pelo card do chat) expirarem no fim da cena, por rodadas/turnos ou pelo avanço do tempo, como os demais efeitos temporários. Antes, eles nunca expiravam e continuavam sendo oferecidos (ou aplicados automaticamente) nas rolagens. Efeitos desativados manualmente e efeitos de uso dentro de itens não expiram. O primeiro "Encerrar Cena" depois de ativar a correção remove os buffs acumulados. |
| `ability-dialog-cost` ([#7](https://github.com/DMBerlin/t20-community-patches/issues/7)) | Efeitos de uso | 1.6.5 | Corrige o "Custo de Mana Total" do diálogo de uso, que passa a ser o custo base mais os aprimoramentos marcados, incluindo os que vêm marcados por "Aplicar Sempre". Antes, aprimoramentos com `disabled: false` eram somados duas vezes, os de "Aplicar Sempre" só entravam no total após o primeiro clique, e perícias ou atributos com efeitos pagos mostravam 0. Com custo, o mínimo de 1 PM continua valendo; um redutor sozinho numa rolagem sem custo base mostra 0. Só afeta a exibição: os PM gastos já estavam corretos. Editar o campo de ajuste de custo continua sem atualizar o total até o próximo clique, como no sistema. |
| `armor-penalty-reduction` ([#19](https://github.com/DMBerlin/t20-community-patches/issues/19)) | Itens e equipamento | 1.6.5 | Faz Ajustada (−1), Sob Medida (−2) e Mitral (−2) reduzirem a penalidade de armadura do item até 0, em vez de aumentá-la. Antes, uma Armadura Completa (−5) com Ajustada mostrava −6; agora mostra −4. A correção afeta perícias e rolagens, mas a ficha do item continua mostrando a penalidade-base. Reforçada e Sobrecarregado continuam aumentando a penalidade. A penalidade do item inclui a Reforçada dele, então uma redução maior que a penalidade-base também anula a Reforçada (base −1, Reforçada −1 e Sob Medida resultam em 0). |
| `hide-legacy-upgrades` ([#8](https://github.com/DMBerlin/t20-community-patches/issues/8)) | Itens e equipamento | 1.6.5 | Oculta, na aba Aprimoramentos das fichas de item (armas, armaduras, escudos, esotéricos, trajes, ferramentas e munição), o bloco "Deprecated" do sistema de aprimoramentos antigo. Os campos desse bloco não funcionam e duplicam os campos novos, que continuam visíveis. O campo Tamanho das armas, que grava mas não tem efeito em jogo, também some. Nenhum dado é alterado: valores antigos continuam no item, e efeitos antigos continuam na aba Efeitos. |
| `segmented-scene-setting` ([#9](https://github.com/DMBerlin/t20-community-patches/issues/9)) | Configurações do sistema | 1.6.5 | Esconde a linha "Cena Segmentada" de Configurar Ajustes, que não era desenhada e gerava um erro no console a cada abertura, e adiciona na aba Tormenta20 o botão "Cena Segmentada → Configurar" (só para quem pode alterar configurações do mundo). O formulário edita o número de segmentos por cena e o segmento atual: 0 ou vazio desativa a regra, e o segmento atual fica entre 0 e o número de segmentos. Como a lista de jogadores desenha um círculo por segmento em todos os clientes, o número de segmentos tem um limite, ajustável em "Limite de segmentos da Cena Segmentada", nas configurações do módulo (padrão 10). Um valor acima do limite é recusado sem salvar, e os GMs recebem um aviso se a configuração gravada passar do limite. Com a regra ativa, a lista de jogadores mostra os círculos de segmento, encerrar um combate não encerra os efeitos de cena, e "Encerrar Cena" zera o contador, como o sistema já previa. |

## Regras opcionais

Regras do livro que o sistema não aplica. Elas não aparecem em Gerenciar correções; cada uma tem um ajuste próprio nas configurações do módulo.

| Regra | Ajuste | O que faz |
|---|---|---|
| Limite de PM por uso ([#25](https://github.com/DMBerlin/t20-community-patches/issues/25)) | "Limite de PM por uso": Desligado, **Avisar** (padrão) ou Bloquear | Ao confirmar o diálogo de uso, compara o PM que o uso vai gastar (custo base, aprimoramentos marcados, `custoPM` do personagem, metade do custo e truque, como o sistema calcula; o campo de ajuste de custo, que só muda a exibição, é ignorado) com o limite do item. O limite é o nível na classe que fornece o poder (tipo Classe ou Habilidade com o subtipo igual ao nome de uma classe do personagem, `@nvl.<classe>`) ou o nível de personagem para poderes raciais, de origem, gerais e concedidos (`@nivel`). O campo "Limite de PM por uso", adicionado ao lado do custo na ficha do item, sobrepõe o limite: vazio é automático, `none` remove o limite, e uma fórmula sem dados (por exemplo, `@nvl.arcanista`) define o valor. O custo mínimo (base mais efeitos "Aplicar Sempre") sempre é permitido. Em Bloquear, o diálogo fica aberto e nada é gasto. Magias, itens e fórmulas inválidas sem limite conhecido usam o nível de personagem e só avisam. O diálogo mostra o limite e a origem dele. Usos sem diálogo (Shift) e testes de perícia e atributo não são verificados. |

## Desenvolvimento

As convenções completas estão em [`AGENTS.md`](AGENTS.md).

- Cada correção fica em um arquivo próprio em `scripts/patches/` e precisa ser registrada em `scripts/patches/index.mjs`, com:
  - `group`: um dos `GROUPS`;
  - `issue`;
  - `system.affected`: as versões verificadas;
  - `apply()`;
  - sempre que possível, `isNeeded()`: um teste síncrono, seguro no `init`, que devolve um diagnóstico `{ bug, confidence, evidence }` (ou o booleano legado). Um teste que só lê código-fonte nunca devolve "corrigido" com confiança alta;
  - opcionalmente, `guarded` (o `apply()` só age quando o bug aparece) e `lateProbe()` (diagnóstico depois do `ready`).
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

1. A skill `release` anuncia o que vai publicar, confirma a versão e os pontos abertos, move `Unreleased` para a nova versão no `CHANGELOG.md` (com a linha de compatibilidade), atualiza o `module.json`, cria o commit e a tag assinada `vX.Y.Z` e faz o push.
2. A tag dispara o workflow `Release`, que valida, testa, empacota e publica a GitHub Release com `module.json` e `module.zip`, e confere que o manifesto passou a servir a nova versão.
3. A skill acompanha o workflow até o fim e entrega o link da release.

## Licença

MIT
