# Changelog

Mudanças relevantes do módulo. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [SemVer](https://semver.org/lang/pt-BR/). Cada entrada ocupa uma linha, em português, e cita a issue `(#n)`.

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
