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
- Regra opcional "Valor efetivo dos itens" (#65): mostra na ficha do item, no inventário e no card do chat a Defesa, a penalidade, o ataque, o dano e o crítico finais depois de melhorias, materiais e encantos, com o detalhamento de cada fonte; modos Só nas pontas, Mostrar no item (padrão) e Item efetivo.
- Regra opcional "Restrições ao lançar magias": uma magia sustentada por vez, ou duas com Fluxo de Mana (aviso ao lançar e ao aplicar), condições que impedem magias (avisar ou bloquear) e aviso de concentração em condição ruim, citando o livro (#37).
- Regra opcional "Penalidades por não proficiência": −5 no ataque com arma sem proficiência e penalidade de armadura sem proficiência em todas as perícias de Força e Destreza, com proficiências derivadas da classe inicial, de poderes e da aba Traços, só para personagens (#39).
- `attribute-breakdown` (#72): ao passar o mouse sobre um atributo, a ficha mostra base, racial, bônus temporário e cada item, magia, poder ou efeito que compõe o valor. Afeta Tormenta20 1.6.5.
- Regra opcional "Teste de resistência pelo card": botões para os alvos rolarem Fortitude, Reflexos ou Vontade contra a CD, com passou/falhou, o efeito do livro e o dano pela metade por alvo (#58).
- Regra opcional "Ataque contra Defesa": o card do ataque mostra se acertou ou errou cada alvo marcado, o crítico só vale num acerto e Caído dá +5 na Defesa contra ataques à distância (#42).
- Regra opcional "Perícias somente treinadas": avisa ou impede o teste de perícia somente treinada sem treino nos personagens, respeitando Eclético e Cultura Exótica (#62).
- Regra opcional "Modificadores situacionais": o diálogo de ataque soma flanquear, investida, posição elevada, atirar em corpo a corpo e alcance dobrado, marca cobertura leve e atacante invisível por alvo na Defesa e aplica após a investida o efeito de −2 na Defesa, removido à mão (#59).
- Regra opcional "Dano não letal": botão no card de dano, PV não letais na ficha e cura que os recupera primeiro, conforme o livro (#55).
- Regra opcional "Magia arcana de armadura": ao lançar magia arcana vestindo armadura, rola Misticismo (CD 20 + PM) com penalidade de armadura, e a magia falha sem devolver os PM (#46).
- Dano não letal: escolha "Letal/Não letal" no diálogo de uso das armas, com −5 no ataque quando contraria o tipo natural da arma (salvo Ataque Piedoso, Estilo Desarmado e Pão e Circo) e o botão do card já na posição escolhida (#74).
- Regra opcional "Chance de falha por camuflagem": rola 1d10 junto com o ataque contra alvos com camuflagem (20% leve, 50% total; Cego e Invisível automáticos), mostra o resultado no card e cancela o crítico quando o ataque erra todos os alvos (#49).
- Regra opcional "Manobras de combate": no diálogo de uso de um ataque corpo a corpo (ou pelo botão no card de ataque), resolve agarrar, derrubar, desarmar, empurrar, quebrar e atropelar como teste oposto, sem rolar dano (o alvo rola com a própria arma e efeitos), com tamanho e desempate do livro, indicando a condição a aplicar (#48).
- Regra opcional "Traços de tipo de criatura": mortos-vivos e construtos ficam imunes a condições de cansaço, metabolismo e veneno, mortos-vivos se curam com trevas e sofrem dano de luz da cura, e construtos não recuperam PV por cura (#50).

### Changed

- A "Central do T20CP" substitui o gerenciador: uma linha por correção com interruptor e detalhes ao expandir, as regras opcionais numa aba própria e um único aviso por carregamento, com link para reportar problemas (#73).

### Fixed

- `appended-usage-changes` (#23): a Inspiração Marcial soma o dano uma única vez e não vaza mais o bônus para os usos seguintes da Inspiração. Afeta Tormenta20 1.6.5.
- `linked-usage-effects` (#24): Arte Mágica e Esgrima Mágica entregam seus efeitos ao usar a Inspiração, e o efeito principal não recebe mais a change "efeito". Afeta Tormenta20 1.6.5.
- `death-threshold` (#29): o PV mínimo segue a regra do livro (−10 ou −metade dos PV máximos, o que for mais baixo) para Personagens de Jogador, Ameaças e Personagens do Mestre. Afeta Tormenta20 1.6.5.
- `threatening-crit-range` (#30): armas com o encanto Ameaçadora voltam a critar, com a margem de ameaça duplicada (espada longa 19 → 17) antes dos outros aumentos. Afeta Tormenta20 1.6.5.
- `rest-recovery` (#31): Cuidados Prolongados no descanso soma +1 PV por nível, em vez de dobrar toda a recuperação de PV. Afeta Tormenta20 1.6.5.
- `spell-dc-bonus` (#35): a CD das magias soma os efeitos de "CD de Magias", os bônus de CD dos NPCs e o Fortalecimento Arcano como bônus passivo. Afeta Tormenta20 1.6.5.
- `spell-cost-zero` (#34): redutores de −1 PM em "Aplicar Sempre" e aprimoramentos de custo 0 não transformam mais a magia em Truque gratuito, e o Truque não combina com outros aprimoramentos. Afeta Tormenta20 1.6.5.
- `conditional-powers` (#33): Estilo de Duas Mãos, Estilo de Uma Arma, Estilo de Arma e Escudo, Encouraçado e Inexpugnável só dão o bônus com o equipamento exigido, e Fanático ignora o −3 m da armadura pesada. Afeta Tormenta20 1.6.5.
- `menace-xp-fraction` (#36): ameaças de ND 1/4 e 1/2 mostram 250 e 500 XP, em vez de 1.000. Afeta Tormenta20 1.6.5.
- `spell-compendium-data` (#32): aprimoramentos de Curar Ferimentos, Sono, Raio do Enfraquecimento, Arma Mágica e a marca de múltiplas aplicações de 12 aprimoramentos seguem o livro. Afeta Tormenta20 1.6.5.
- `condition-skill-lists` (#38): Cego, Fraco e Debilitado penalizam Ladinagem, e Frustrado e Esmorecido penalizam os Ofícios, inclusive os personalizados. Afeta Tormenta20 1.6.5.
- Fortitude, Reflexos e Vontade passam a receber os bônus de "Testes de Perícias, exceto de Ataque" também quando há bônus de "Testes de Perícias de Resistências" (`save-skill-bonus`, #39).
- O detalhamento dos valores da ficha volta a mostrar efeitos de valor 3 ou 4, usa os dados do próprio token não vinculado e lista a penalidade de condição da Defesa (`modified-fields-filter`, `field-bonuses-tooltip`, #39).
- `sheet-initiative-token` (#67): a Iniciativa rolada pela ficha vai para o combatente daquele token, e não para o primeiro token do mesmo ator, e passa a funcionar com o rótulo da perícia renomeado ou traduzido. Afeta Tormenta20 1.6.5.
- `skill-modifier-attributes` (#68): modificadores de perícia com atributo na fórmula, como a Aura Sagrada, passam a contar os bônus temporários de atributo na ficha e na rolagem. Afeta Tormenta20 1.6.5.
- `prone-defense` (#40): a condição Caído soma −5 à Defesa em vez de trocar o bônus manual "Outros" da ficha por −5, que fazia a Defesa cair mais de 5 ou não cair. Afeta Tormenta20 1.6.5.
- `ongoing-damage-conditions` (#45): Em Chamas rola 1d6 de fogo e Sangrando rola o teste de Constituição (CD 15) e a perda de 1d6 PV no início do turno. Afeta Tormenta20 1.6.5.
- `alchemical-damage-bonus` (#69): o bônus de dano alquímico entra no dano de itens alquímicos mesmo sem bônus de dano de magias. Afeta Tormenta20 1.6.5.
- `field-bonuses-breakdown` (#70): o detalhamento de PV, PM, perícias e Defesa passa a bater com a ficha (bônus manuais por nível e total, fórmulas, Substituir/Multiplicar, efeitos com *, atributo limitado pela armadura pesada) e a Defesa lista Outros e condições pelo nome. Afeta Tormenta20 1.6.5.
- `enchantment-data` (#43): Guardião, Protetor, Relampejante, Sombrio, Mitral, Incandescente, Gelo Eterno, Adamante, Invulnerável, Delicada, Discreto e Manto da Resistência passam a seguir o livro, inclusive a Destreza em armadura pesada de Mitral e os espaços. Afeta Tormenta20 1.6.5.
- Modelos de buff desativados de habilidades e itens (Arma Mágica, Duelo, Botas Aladas, Animar Objetos e outros) passam a ser oferecidos no card do chat, com um botão por modelo; buffs de arma pedem a arma e só valem para ela, e o placeholder +0 homônimo é ocultado (`usage-buff-templates`, #66). Afeta Tormenta20 1.6.5.
- `finesse-agile-weapons` (#44): Acuidade com Arma passa a usar Destreza no ataque e no dano "Padrão" de armas ágeis, como Florete e Cimitarra. Afeta Tormenta20 1.6.5.
- `engenhoqueiro-armor-penalty` (#41): Ofício (Engenhoqueiro) deixa de sofrer penalidade de armadura, inclusive em personagens já criados. Afeta Tormenta20 1.6.5.
- `race-data` (#57): Minotauro, Pequeno e Rechonchudo (Hynne), Conhecimento das Rochas (Anão) e Sentidos Élficos (Elfo) passam a ser criados com os dados do livro básico, e a ficha marca as cópias antigas para serem adicionadas de novo. Afeta Tormenta20 1.6.5.
- `partner-combatant` (#56): o parceiro Combatente passa a dar +2/+3/+4 no ataque, como no livro básico, e as cópias antigas são marcadas na ficha. Afeta Tormenta20 1.6.5.
- `bestiary-creature-type` (#47): 7 mortos-vivos e 4 monstros do compêndio Ameaças passam a ser criados com o tipo do livro básico, e o importador de bloco de estatísticas reconhece "Morto-vivo" e as demais palavras do livro sem diferenciar maiúsculas. Afeta Tormenta20 1.6.5.

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
