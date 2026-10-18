# Changelog

## Unreleased

- Gerenciador de correções (#20): janela "Gerenciar correções", com as correções agrupadas por área, selo de status e link da issue. As configurações soltas foram substituídas pela configuração única `patches`. Cada correção testa em tempo de execução se o bug ainda existe (`isNeeded`): ela é desativada automaticamente quando o sistema já corrige o bug e continua ativa em versões novas, ainda não verificadas, se o bug persistir. O GM é avisado quando o status de uma correção muda. / Patch manager (#20): "Manage patches" window with patches grouped by area, status badges and issue links; runtime bug checks; GM notifications on status changes.
- A configuração `patch.<id>` da 0.1.0 é migrada para a nova configuração `patches`. / The 0.1.0 `patch.<id>` setting is migrated.
- Cada GM recebe o aviso de mudança de status uma vez (controle por usuário). A janela mostra quando há alterações salvas aguardando recarregamento e grava só os campos alterados pelo usuário, sem desfazer a alteração de outro GM. / Per-user status notifications; pending-reload notice; the manager only writes the toggles the user changed.
- `armor-penalty-reduction`:
  - **Segurança:** valores de efeito não numéricos passam a ser avaliados pelo parser de rolagens do Foundry, como no core, e não mais como JavaScript. / **Security:** non-numeric effect values are evaluated with Foundry's roll parser, as core does, instead of as JavaScript.
  - Uma redução maior que a penalidade-base também anula os aumentos do próprio item (Reforçada). Reduções em fases diferentes de `initial` mantêm o comportamento do sistema e geram um aviso no console. / Reductions beyond the base penalty also cancel the item's own increases (Reinforced); non-initial phases keep system behavior, with a console warning.

## 0.1.0

- Patch `armor-penalty-reduction`: Ajustada, Sob Medida e Mitral passam a reduzir a penalidade de armadura do item (até 0) em vez de aumentá-la. Afeta Tormenta20 1.6.5. / Adjusted, Under Measure and Mithril now reduce the item's armor penalty (down to 0) instead of increasing it.
