# Prompt do revisor de QA

Preencha os campos `{…}` e envie como `prompt` para o subagente `code-review` com o modelo `gpt-6.1-sol`.

---

Você é o QA, rodada {k}, de um módulo do Foundry VTT v14 (`t20-community-patches`) que corrige bugs do sistema Tormenta20 por meio de wrappers em tempo de execução. Reporte **todos** os bugs, vulnerabilidades, lacunas e pontos em aberto não resolvidos. Foque em correção e risco real, e ignore questões de estilo. **Não modifique nenhum arquivo.**

**Worktree:** `{caminho absoluto da worktree}` (branch `{branch}`)
**Issue:** #{n}. O conteúdo completo, com comentários, está em `.work/issue.md`. Decisões tomadas durante a implementação: `.work/decisions.md`, se existir.
**Convenções e contrato do patch:** `AGENTS.md`.

**O que revisar:**
- `git diff origin/main...HEAD` e `git log origin/main..HEAD`;
- os arquivos completos tocados pelo diff;
- testes: `node --test "tests/*.test.mjs"`.

**Código de referência (somente leitura):**
- sistema: `{FOUNDRY_DATA}/systems/tormenta20/tormenta20.mjs`; pontos relevantes: {lista T20:<linha> e símbolos da issue};
- core: `{FOUNDRY_CORE}` (`client/`, `common/`).

**Checklist obrigatório:**
1. A correção cobre **todos** os caminhos que levam ao bug (diálogo, atalho/Shift, ficha, macro, chat, outros usuários), e não só o caminho da reprodução.
2. Com o patch desligado ou fora da faixa de versão, o comportamento oficial fica **intacto**: nada é instalado e nenhum efeito colateral ocorre no `init`.
3. `isNeeded()` é síncrono, seguro no `init`, não tem efeitos colaterais e retorna `true`/`false`/`undefined` corretamente.
4. Wrappers preservam `this`, os argumentos, o valor de retorno (inclusive `Promise` e geradores) e as exceções. Analise reentrância, chamadas aninhadas e o estado do módulo em erro (`try/finally`).
5. Segurança: nenhuma avaliação de texto como JavaScript; nenhum HTML de usuário sem escape; nenhuma escrita em documentos por um usuário sem permissão.
6. Multiusuário: o comportamento do GM e do jogador, e dados persistidos ou sincronizados.
7. Os testes falhariam sem a correção e cobrem os casos-limite da issue.
8. Há paridade de chaves entre `lang/pt-BR.json` e `lang/en.json`, e o README (só pt-BR) está preciso.
9. O `CHANGELOG.md` **não** foi editado na worktree. A entrada proposta está em `.work/changelog.md`, em uma linha, em português.
10. Os critérios de aceite da issue foram atendidos ou estão justificados em `.work/decisions.md`.

{Somente a partir da rodada 2:}
**Achados das rodadas anteriores e o que foi feito** (verifique que as correções estão certas e completas; não repita achados rejeitados com evidência, a menos que a evidência esteja errada):
{conteúdo de .work/review.md}

**Formato da resposta:**
- Uma lista numerada de achados. Para cada um: severidade (`critical`/`high`/`medium`/`low`), `arquivo:linha`, evidência (trecho ou reprodução) e a correção concreta.
- Depois, as **questões de produto em aberto**, se houver.
- Se não houver nenhum achado `medium` ou mais grave, nem questão de produto em aberto, a primeira linha da resposta deve ser exatamente `CLEAN`, seguida das notas `low`, se houver.
