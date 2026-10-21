# Changelog

Mudanças relevantes do módulo. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [SemVer](https://semver.org/lang/pt-BR/). Cada entrada ocupa uma linha, em português, e cita a issue `(#n)`. Cada versão começa com a compatibilidade declarada no `module.json` (Foundry VTT e Tormenta20) no momento da release.

<!--
Não edite as seções de versão à mão.
- Novas entradas: `node tools/changelog.mjs add <Added|Changed|Fixed|Security|Removed> "<entrada>"` (feito pela skill land).
- Nova versão: `node tools/changelog.mjs release <x.y.z>` (feito pela skill release).
-->

## Unreleased

### Added

- Regra opcional "Limite de PM por uso" (#25): avisa ou bloqueia usos que gastam mais PM do que o nível na classe que fornece a habilidade (ou o nível de personagem), respeitando o custo mínimo; o limite pode ser definido por item.
- Regra opcional "Máximo de aplicações de efeitos de uso" (#26): limita, por fórmula, quantas vezes um efeito de uso pode ser aplicado, com modos Avisar, Bloquear e Desligado e padrão embarcado para a Inspiração do Bardo.
- Regra opcional "Efeitos da mesma habilidade" (#27): efeitos de uma mesma habilidade, como duas Inspirações, deixam de acumular no alvo, substituindo o anterior ou mantendo o maior.
- Regra opcional "Bônus de itens e magias" (#28): bônus de itens não acumulam com outros itens, nem magias com outras magias; vale o maior, e entre os itens além da armadura e do escudo só conta o de maior Defesa, com aviso e marca na ficha citando o livro.

### Fixed

- `appended-usage-changes` (#23): a Inspiração Marcial soma o dano uma única vez e não vaza mais o bônus para os usos seguintes da Inspiração. Afeta Tormenta20 1.6.5.
- `linked-usage-effects` (#24): Arte Mágica e Esgrima Mágica entregam seus efeitos ao usar a Inspiração, e o efeito principal não recebe mais a change "efeito". Afeta Tormenta20 1.6.5.
- `death-threshold` (#29): o PV mínimo segue a regra do livro (−10 ou −metade dos PV máximos, o que for mais baixo) para Personagens de Jogador, Ameaças e Personagens do Mestre. Afeta Tormenta20 1.6.5.
- `threatening-crit-range` (#30): armas com o encanto Ameaçadora voltam a critar, com a margem de ameaça duplicada (espada longa 19 → 17) antes dos outros aumentos. Afeta Tormenta20 1.6.5.
- `rest-recovery` (#31): Cuidados Prolongados no descanso soma +1 PV por nível, em vez de dobrar toda a recuperação de PV. Afeta Tormenta20 1.6.5.

## v1.0.0 - 2026-10-19

**Compatibilidade:** Foundry VTT (mínimo 14, verificado 14.369) · Tormenta20 (mínimo 1.6.5, verificado 1.6.5)

### Added

- Gerenciador de correções (#20): janela "Gerenciar correções" com as correções agrupadas por área, selo de status, link da issue e aviso de recarregamento pendente. Cada correção testa, ao carregar, se o bug ainda existe: é desligada quando o sistema já corrigiu e continua ativa em versões não verificadas se o bug persistir. Cada GM é avisado uma vez quando uma correção pede atenção.

### Changed

- Detecção de correções do sistema (#22): cada correção agora informa o nível de confiança do diagnóstico, só é pulada sozinha quando a evidência é forte, mostra quando pode ser desmarcada (inclusive se estiver desligada) e ganha o modo "Forçar".

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
