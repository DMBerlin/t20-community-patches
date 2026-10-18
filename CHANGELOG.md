# Changelog

## Unreleased

- Gerenciador de correções (#20): janela "Gerenciar correções", com as correções agrupadas por área, selo de status e link da issue. As configurações soltas foram substituídas pela configuração única `patches`. Cada correção testa em tempo de execução se o bug ainda existe (`isNeeded`): ela é desativada automaticamente quando o sistema já corrige o bug e continua ativa em versões novas, ainda não verificadas, se o bug persistir. O GM é avisado quando o status de uma correção muda. / Patch manager (#20): "Manage patches" window with patches grouped by area, status badges and issue links; runtime bug checks; GM notifications on status changes.

## 0.1.0

- Patch `armor-penalty-reduction`: Ajustada, Sob Medida e Mitral passam a reduzir a penalidade de armadura do item (até 0) em vez de aumentá-la. Afeta Tormenta20 1.6.5. / Adjusted, Under Measure and Mithril now reduce the item's armor penalty (down to 0) instead of increasing it.
