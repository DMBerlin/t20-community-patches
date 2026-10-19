---
name: issue
description: >-
  Investiga um bug ou uma melhoria do Tormenta20 no Foundry e abre uma issue
  completa no t20-community-patches, com causa raiz comprovada no código,
  reprodução, decisões de produto, implementação proposta, testes e critérios de
  aceite, para que qualquer agente implemente sem contexto adicional. Use quando
  o usuário pedir para abrir, registrar, mapear ou documentar um bug, problema
  ou melhoria.
---

# issue

Leia `AGENTS.md` antes de começar. O resultado é **uma issue no GitHub** (ou várias, se o usuário relatar problemas independentes). Nenhum código é alterado.

Padrão de qualidade: um agente sem acesso a esta conversa precisa conseguir implementar a correção de ponta a ponta apenas com o corpo da issue. Toda afirmação técnica precisa de evidência (`T20:<linha>`, `core:<arquivo>:<linha>` ou trecho de código).

## 1. Entender o pedido

- Reescreva o problema em uma frase: o que o usuário vê, o que esperava e onde acontece (ficha, rolagem, chat, configuração).
- Se faltar o mínimo para investigar (qual item, classe, efeito ou tela), pergunte com `ask_user` **antes** de investigar.

## 2. Procurar duplicatas

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin)}"
gh issue list -R DMBerlin/t20-community-patches --state all --search "<termos>" --json number,title,state
```

- Procure também no upstream (https://gitlab.com/vizael/Tormenta20): issues abertas e fechadas, e branches recentes que mencionem o problema.
- Se houver uma duplicata aqui, **não** crie outra issue. Mostre a existente ao usuário e proponha um comentário com o que for novo.
- Se o bug já foi reportado no upstream, use o label `upstream-reported` e coloque o link nas Referências.

## 3. Investigar a fundo

Fontes, somente leitura:
- sistema: `$FOUNDRY_DATA/systems/tormenta20/tormenta20.mjs`, `system.json`, `templates/`, `lang/` e `packs/`;
- core: `$FOUNDRY_CORE/client`, `$FOUNDRY_CORE/common`;
- módulo: `scripts/`, especialmente patches que mexem na mesma área.

Entregáveis da investigação:
1. **Causa raiz**, com as linhas exatas e o trecho de código. Explique o mecanismo, não só o sintoma.
2. **Caminhos afetados:** todos os pontos de entrada que levam ao bug (diálogo, Shift-clique, ficha, macro, chat). Uma correção parcial vira bug novo.
3. **Viabilidade como patch:**
   - quais métodos podem ser embrulhados e em que momento (`init`, `setup`, `ready`);
   - funções locais do bundle **não** podem ser embrulhadas, então diga qual é a alternativa;
   - o efeito para outros usuários e para dados persistidos.
4. **Teste em tempo de execução (`isNeeded`):** um teste síncrono, seguro no `init`, que diga se o bug ainda existe, como um diagnóstico (`present`/`fixed`/`unknown`). Diga o **nível de confiança** (`high` só quando a evidência cobre tudo o que o patch corrige; um teste que só lê código-fonte nunca dá `fixed`/high) e **o que o teste cobre e o que não cobre** (por exemplo, a criação, mas não a exclusão). Se não houver teste possível, diga isso e avalie `guarded` (o `apply()` só age quando o bug aparece) ou um `lateProbe()` depois do `ready`.
5. **Interações:** com patches existentes e com outras issues abertas (`#n`).
6. **Classificação:**
   - `patch`: corrigível no módulo sem mudar o comportamento oficial;
   - `upstream-only`: só o sistema pode corrigir, ou o patch seria arriscado demais;
   - `enhancement`: melhoria do próprio módulo;
   - mais, quando couber: `ui-hide`, `data` e `needs-repro` (se você não conseguiu comprovar pelo código).
7. **Prioridade:**
   - `critical`: quebra uma mecânica central;
   - `high`: mecânica incorreta ou invisível;
   - `medium`: inconsistência com contorno possível;
   - `low`: ruído ou cosmético.

Se houver mais de um caminho razoável, ou uma decisão de comportamento, **pare e pergunte** com `ask_user`. Exemplos: o que filtrar, o que manter, se o usuário pode desfazer. Cada pergunta deve ter opções concretas e a sua recomendação como padrão. Registre as respostas em "Decisões de produto".

## 4. Escrever o corpo

Use o modelo do tipo, em `templates/`:
- `templates/patch.md`: correção no módulo;
- `templates/upstream-only.md`: documentação para reporte upstream;
- `templates/enhancement.md`: melhoria do módulo.

Regras:
- Português claro e direto, com frases curtas.
- Nomes da interface como o usuário os vê (por exemplo, "Aplicar Sempre") e o nome técnico entre crases.
- Em issues de **patch**, inclua o código completo proposto: o arquivo do patch no contrato do `AGENTS.md`, as funções puras exportadas, i18n (`lang/pt-BR.json` e `lang/en.json`), a linha do README e a entrada de CHANGELOG em **uma linha** em português, que vai para a seção sugerida (`Fixed` em geral).
- Critérios de aceite em checkbox, verificáveis um a um, incluindo "com o patch desligado, o comportamento oficial volta".
- O plano de teste manual no Foundry deve ter passos numerados, dados concretos (qual item, de qual compêndio) e o resultado esperado.
- Não deixe placeholders `<…>` no texto final.

Salve o corpo em `.work/issue-draft-<slug>.md` na worktree atual.

## 5. Revisar e criar

1. Mostre ao usuário: o título, os labels e um resumo de 3 linhas (causa, correção, decisões). O corpo completo fica no arquivo. Peça confirmação com `ask_user` (criar / ajustar / cancelar).
2. Crie:

```bash
gh issue create -R DMBerlin/t20-community-patches \
  --title "<Descrição em português> (<patch-id>)" \
  --label "patch,priority: high" \
  --body-file .work/issue-draft-<slug>.md
```

3. Se a nova issue afeta outra (dependência ou interação), comente na outra issue com o link.
4. Responda com o link da issue e sugira o próximo passo: a skill `triage` para reordenar, ou `implement #<n>`.
