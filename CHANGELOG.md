# Changelog

Mudanças relevantes do módulo. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [SemVer](https://semver.org/lang/pt-BR/). Cada entrada ocupa uma linha, em português, e cita a issue `(#n)`. Cada versão começa com a compatibilidade declarada no `module.json` (Foundry VTT e Tormenta20) no momento da release.

<!--
Não edite as seções de versão à mão.
- Novas entradas: `node tools/changelog.mjs add <Added|Changed|Fixed|Security|Removed> "<entrada>"` (feito pela skill land).
- Nova versão: `node tools/changelog.mjs release <x.y.z>` (feito pela skill release).
-->

## Unreleased

### Added

- Gerenciador de correções (#20): janela "Gerenciar correções" com as correções agrupadas por área, selo de status, link da issue e aviso de recarregamento pendente. Cada correção testa, ao carregar, se o bug ainda existe: é desligada quando o sistema já corrigiu e continua ativa em versões não verificadas se o bug persistir. Cada GM é avisado uma vez quando uma correção pede atenção.

### Fixed

- `armor-penalty-reduction` (#19): Ajustada, Sob Medida e Mitral reduzem a penalidade de armadura do item até 0, em vez de aumentá-la; o excedente anula a Reforçada do próprio item. Afeta Tormenta20 1.6.5.
- `item-effects-on-actor-sheet` (#2): a ficha do ator volta a listar os efeitos transferidos pelos itens (passivos, de uso e suprimidos), com o item como fonte, e permite alternar, editar, excluir (com confirmação) e arrastar esses efeitos. Afeta Tormenta20 1.6.5.
- `status-effects-compendium` (#1): o compêndio Condições (`world.statuses`) vazio é preenchido com as 38 condições do sistema, o que restaura o HUD de condições, Morto, Cego/Invisível, Sobrecarregado e Sustentando; jogadores conectados recebem as condições sem recarregar. Afeta Tormenta20 1.6.5.
- `encumbered-status-sync` (#21): Sobrecarregado é aplicado ou removido ao adicionar ou excluir itens da ficha, sem cópias duplicadas. Afeta Tormenta20 1.6.5.
- `usage-effect-toggle` (#5): o botão de alternar dos efeitos de uso nas fichas passa a ligar e desligar "Aplicar Sempre", e o ícone mostra esse estado; efeitos de uso temporários de itens continuam alternando entre aplicado por padrão e opcional. Afeta Tormenta20 1.6.5.
- `suppressed-usage-effects` (#4): efeitos de uso de armas e equipamentos não equipados deixam de ser oferecidos no diálogo e aplicados automaticamente em rolagens de item, perícia e atributo; os efeitos do próprio item rolado não mudam. Afeta Tormenta20 1.6.5.
- `ability-dialog-cost` (#7): o "Custo de Mana Total" do diálogo de uso passa a ser o custo base mais os aprimoramentos marcados (incluindo os de "Aplicar Sempre"), sem contagem dupla, e deixa de mostrar 0 em perícias e atributos com efeitos pagos; os PM gastos não mudam. Afeta Tormenta20 1.6.5.
- `temporary-usage-effect-expiry` (#6): efeitos de uso temporários nos atores (como Profanar e Consagrar aplicados pelo card do chat) passam a expirar no fim da cena, por rodadas/turnos ou pelo avanço do tempo; o primeiro "Encerrar Cena" após ativar remove os buffs acumulados, e efeitos desativados manualmente não expiram. Afeta Tormenta20 1.6.5.
- `hide-legacy-upgrades` (#8): a aba Aprimoramentos das fichas de item deixa de mostrar o bloco "Deprecated" do sistema de aprimoramentos antigo, cujos campos não funcionavam, incluindo o campo Tamanho das armas; nenhum dado é alterado. Afeta Tormenta20 1.6.5.
- `segmented-scene-setting` (#9): abrir Configurar Ajustes deixa de gerar erro no console, e a regra de Cena Segmentada passa a ser configurável (segmentos por cena e segmento atual) por um botão na aba Tormenta20, com limite de segmentos ajustável nas configurações do módulo (padrão 10). Afeta Tormenta20 1.6.5.
