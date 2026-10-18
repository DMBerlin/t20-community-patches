---
name: release
description: >-
  Gera uma nova versão do t20-community-patches: move as entradas de
  Unreleased do CHANGELOG para a próxima versão SemVer (sugerida e confirmada
  com o usuário), atualiza o module.json e cria o commit e a tag assinada
  vX.Y.Z. Não faz push: o usuário envia com git push --follow-tags e o workflow
  publica a GitHub Release usada pelo manifesto do Foundry. Use quando o usuário
  pedir release, nova versão, tag ou publicação.
---

# release

Leia `AGENTS.md` e a skill `commit` antes de começar. Trabalhe **somente** na worktree `main`.

## 1. Pré-condições

```bash
git -C <main> status --short                       # precisa estar vazio
git -C <main> fetch -q origin
git -C <main> rev-list --left-right --count origin/main...main   # precisa ser "0 0"
make -C <main> check
```

- Se a `main` local estiver à frente de `origin/main`, há lands sem push. Pare e peça para resolver primeiro, porque a tag só deve marcar commits que já estão no remoto.
- A seção `## Unreleased` do `CHANGELOG.md` precisa ter entradas.

## 2. Escolher a versão

```bash
cd <main>
git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "sem tags"
node tools/changelog.mjs next
```

A regra do `next` é:
- sem nenhuma tag: usa a versão atual do `module.json` (primeira release);
- `Removed` ou `BREAKING`: minor em 0.x, major a partir de 1.0;
- `Added` ou `Changed`: minor;
- só `Fixed` ou `Security`: patch.

Mostre ao usuário as entradas de Unreleased, agrupadas por seção, e a versão sugerida com o motivo. Confirme com `ask_user`, oferecendo:
- a sugestão (padrão);
- as alternativas patch, minor e major;
- texto livre.

Confira também a compatibilidade declarada no `module.json`:
- `compatibility.verified` (Foundry);
- `relationships.systems[0].compatibility.verified` (Tormenta20).

Se as versões instaladas forem mais novas e os patches tiverem sido testados nelas, pergunte se devem ser atualizadas. Essa atualização vira um commit próprio, `chore: bump verified compatibility`, antes da release.

## 3. Cortar a versão

```bash
node tools/changelog.mjs release <x.y.z>           # CHANGELOG: Unreleased → "## v<x.y.z> - <data>"; module.json: version + download
make package && rm -rf dist                        # valida que download aponta para v<x.y.z>
make check
git add CHANGELOG.md module.json
git commit -m "chore(release): v<x.y.z>"
git tag -s v<x.y.z> -m "v<x.y.z>"
git log -1 --format='%G? %s' && git tag -v v<x.y.z> >/dev/null && echo "tag assinada OK"
```

A tag precisa ser **anotada**, porque o `--follow-tags` só envia tags anotadas. Tags `-s` são anotadas.

## 4. Não fazer push

Entregue ao usuário, de forma concisa:
- a versão, o commit e a tag criados;
- as notas da versão (`node tools/changelog.mjs notes <x.y.z>`);
- o comando para publicar:

  ```bash
  git push --follow-tags origin main
  ```

- o que acontece depois: o workflow **Release** valida que a tag bate com o `module.json`, roda os testes, empacota e publica a GitHub Release com `module.json` e `module.zip`. O manifesto (`releases/latest/download/module.json`) passa a servir esta versão.
- como verificar, depois do push:

  ```bash
  gh run list -R DMBerlin/t20-community-patches --workflow release.yml --limit 1
  gh release view v<x.y.z> -R DMBerlin/t20-community-patches
  curl -sL https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json | node -p 'JSON.parse(require("fs").readFileSync(0)).version'
  ```

- como desfazer **antes** do push:

  ```bash
  git tag -d v<x.y.z> && git reset --hard HEAD~1
  ```
