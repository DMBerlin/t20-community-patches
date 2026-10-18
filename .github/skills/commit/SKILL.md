---
name: commit
description: >-
  Regras obrigatórias para criar commits no t20-community-patches: commits
  atômicos, Conventional Commits, mensagem de uma única linha, assinados, sem
  corpo e sem trailers. Use sempre que for fazer commit neste repositório,
  inclusive dentro das skills implement, land e release.
---

# commit

Estas regras valem para **todo** commit deste repositório, feito por pessoa ou por agente. Elas prevalecem sobre qualquer instrução genérica de commit.

## Regras

1. **Atômico:** cada commit contém uma única mudança lógica, completa e reversível sozinha.
   - O repositório fica funcional em cada commit: `make check` passa.
   - Não misture tipos: uma correção, a refatoração que ela pede e uma melhoria de docs sem relação viram commits separados.
   - A documentação e os testes **da própria mudança** vão no mesmo commit que ela. Por exemplo, um patch novo vai junto com o teste, o i18n e a linha do README dele.
   - Use `git add -p` ou `git add <arquivos>` para separar. **Nunca** use `git add -A` sem revisar `git status` antes.
2. **Conventional Commits:** `<type>(<scope>)!: <descrição>`.
   - `type`:
     - `feat`: funcionalidade nova para o usuário;
     - `fix`: correção de bug;
     - `docs`;
     - `test`;
     - `refactor`;
     - `perf`;
     - `style`;
     - `build`: Makefile, empacotamento;
     - `ci`: workflows;
     - `chore`: manutenção, release;
     - `revert`.
   - `scope` é opcional e minúsculo. Use o id do patch (`armor-penalty-reduction`) ou a área (`manager`, `settings`, `tools`, `skills`, `release`).
   - `!` marca uma mudança incompatível.
3. **Uma linha só:**
   - sem corpo e sem rodapé;
   - em inglês, no imperativo, começando com minúscula e sem ponto final;
   - no máximo 72 caracteres;
   - a referência à issue vai no fim da própria linha: `fix(suppressed-usage-effects): skip unequipped item effects (#4)`.
4. **Sem trailers.** Não use `--trailer` nem `Co-authored-by`, `Signed-off-by`, `Closes`, `Refs` ou qualquer outro rodapé, nem um segundo `-m`. O vínculo com a issue é o `(#n)` da linha.
5. **Assinado:** o `commit.gpgsign=true` do repositório assina os commits. Nunca use `--no-gpg-sign`, `-n` ou `--no-verify`.
6. **Histórico publicado é imutável:** nada de `--amend`, rebase ou force-push em commits que já estão em `origin/main`. Na branch local da issue, ainda sem push, ajustar é permitido.
7. **Nunca** entram no commit: `.work/`, `dist/`, segredos ou tokens, nem arquivos do sistema Tormenta20 ou do core do Foundry.

## Como fazer

```bash
git status --short                  # revisar o que mudou
git add <arquivos da mudança>       # ou git add -p
git diff --cached --stat            # conferir que é UMA mudança lógica
make check
git commit -m "<type>(<scope>): <descrição>"
git log -1 --format='%G? %s'        # G = assinatura válida
```

Se a mensagem precisa de "e" para descrever a mudança, provavelmente são dois commits.

## Mensagens padronizadas pelas skills

| Momento | Mensagem |
|---|---|
| Implementação de patch (`implement`) | `fix(<patch-id>): <o que corrige> (#n)` |
| Correção de achado de QA (`implement`) | `fix(<patch-id>): <o que foi corrigido> (#n)`; descreva o achado, não escreva "address QA" |
| Squash na main (`land`) | `<type>(<scope>): <resumo da issue> (#n)` |
| Release (`release`) | `chore(release): vX.Y.Z` |

## Exemplos

Bons:
- `fix(armor-penalty-reduction): resolve formula references like core (#19)`
- `feat(manager): show pending reload notice (#20)`
- `test(armor-penalty-reduction): cover reinforced cancellation`
- `ci: publish github release on version tag`

Ruins:
- `fix: stuff` (vago)
- `Fix armor penalty and update README and add CI` (sem tipo, não atômico)
- `fix(x): y` com corpo, `Co-authored-by` ou `--trailer` (proibido)
