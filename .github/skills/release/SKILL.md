---
name: release
description: >-
  Publica uma nova versão do t20-community-patches de ponta a ponta: anuncia a
  intenção, resolve os pontos abertos com o usuário (versão SemVer própria e
  compatibilidade declarada), move Unreleased do CHANGELOG para a versão com a
  linha de compatibilidade, cria o commit e a tag assinada vX.Y.Z, faz o push
  que dispara o workflow Release e acompanha o pipeline até o manifesto do
  Foundry servir a nova versão. Use quando o usuário pedir release, nova
  versão, tag ou publicação.
---

# release

Leia a skill `commit` antes de começar. Trabalhe **somente** na worktree `main`.

## Política de versões

- O módulo tem **histórico de versão próprio**, em SemVer (`X.Y.Z`), independente da versão do Tormenta20.
- A compatibilidade é **documentada**, não codificada no número:
  - no `module.json`: `compatibility` (Foundry) e `relationships.systems[tormenta20].compatibility` (Tormenta20);
  - no `CHANGELOG.md`: cada versão começa com a linha `**Compatibilidade:** …`, gravada pelo `changelog.mjs release`;
  - na GitHub Release: título `vX.Y.Z · Tormenta20 <verified>` e a mesma linha nas notas.
- Tags publicadas são imutáveis: nunca mova nem reutilize uma tag que já foi enviada.

## 1. Anunciar a intenção

Antes de qualquer comando que altere algo, diga ao usuário, em poucas linhas, o que vai acontecer: as fases desta skill e que, ao final, a release ficará pública e o manifesto passará a servi-la a todos os mundos que instalaram o módulo.

## 2. Levantar o estado (somente leitura)

```bash
export GH_TOKEN="${GH_TOKEN:-$(gh auth token --user DMBerlin)}"
cd <main>
git status --short                                         # precisa estar vazio
git fetch -q origin --tags
git rev-list --left-right --count origin/main...main       # precisa ser "0 0"
git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "sem tags"
node tools/changelog.mjs next                              # versão sugerida
node tools/changelog.mjs compat                            # compatibilidade declarada
data="${FOUNDRY_DATA:-$HOME/Library/Application Support/FoundryVTT/Data}"
node -p "require('$data/systems/tormenta20/system.json').version"   # Tormenta20 instalado
gh run list -R DMBerlin/t20-community-patches --workflow release.yml --limit 3
make check
```

Bloqueios (pare e explique; não siga para a fase 3):
- árvore suja ou `main` diferente de `origin/main` (lands sem push ou main desatualizada);
- `Unreleased` vazio;
- `make check` falhando;
- um workflow `Release` ainda em execução.

A regra do `next`:
- sem nenhuma tag: usa a versão atual do `module.json` (primeira release);
- `Removed` ou `BREAKING`: minor em 0.x, major a partir de 1.0;
- `Added` ou `Changed`: minor;
- só `Fixed` ou `Security`: patch.

## 3. Pontos abertos e versão

Mostre ao usuário, de forma compacta:
- as entradas de `Unreleased`, agrupadas por seção (só a contagem e os ids/issues, não o texto inteiro);
- a versão sugerida e o motivo;
- a compatibilidade declarada, comparada com o Tormenta20 instalado.

Depois faça **um único** `ask_user` com:
- **versão**: a sugestão como padrão, mais as alternativas patch, minor e major (texto livre permitido);
- **compatibilidade**, só se houver divergência (por exemplo, Tormenta20 instalado mais novo que o `verified`): atualizar o `verified` para a versão instalada, se os patches foram testados nela, ou manter;
- **publicar agora**: sim (padrão) ou só preparar localmente, sem push.

Não invente pontos abertos: se não houver divergência de compatibilidade, o formulário tem só versão e publicação.

Se o usuário pedir para atualizar a compatibilidade, edite o `module.json` e faça um commit próprio antes da release: `chore: bump verified compatibility`.

## 4. Cortar a versão

```bash
node tools/changelog.mjs release <x.y.z>     # CHANGELOG: Unreleased → "## v<x.y.z> - <data>" + linha de compatibilidade; module.json: version + download
node tools/changelog.mjs notes <x.y.z>       # conferir as notas
make package && rm -rf dist                  # valida download e manifest
make check
git add CHANGELOG.md module.json
git commit -m "chore(release): v<x.y.z>"
git tag -s v<x.y.z> -m "v<x.y.z>"
git log -1 --format='%G? %s' && git tag -v v<x.y.z> >/dev/null && echo "tag assinada OK"
```

A tag precisa ser **anotada e assinada** (`-s`).

Se o usuário escolheu só preparar, pare aqui: entregue a versão, as notas, o comando `git push --atomic origin main v<x.y.z>` e como desfazer antes do push (`git tag -d v<x.y.z> && git reset --hard HEAD~1`).

## 5. Disparar e acompanhar o pipeline

```bash
git push --atomic origin main v<x.y.z>
```

O `--atomic` envia a `main` e a tag juntas, ou nenhuma. A tag dispara o workflow **Release** (`.github/workflows/release.yml`), que:
1. valida que a tag bate com o `module.json`, está na `main` e tem seção no CHANGELOG;
2. roda os testes;
3. empacota `module.zip` e `module.json` (`tools/package.sh`);
4. publica a GitHub Release como `latest`, com título `v<x.y.z> · Tormenta20 <verified>` e as notas do CHANGELOG;
5. confere que `releases/latest/download/module.json` serve a nova versão e que o `download` responde.

Acompanhe até o fim:

```bash
sleep 5
run=$(gh run list -R DMBerlin/t20-community-patches --workflow release.yml --branch v<x.y.z> --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$run" -R DMBerlin/t20-community-patches --exit-status --interval 10 > /dev/null
gh release view v<x.y.z> -R DMBerlin/t20-community-patches --json name,isLatest,assets -q '"\(.name) · latest=\(.isLatest) · \([.assets[].name] | join(", "))"'
curl -sL https://github.com/DMBerlin/t20-community-patches/releases/latest/download/module.json | node -p 'JSON.parse(require("fs").readFileSync(0)).version'
```

Se o `run` vier vazio, espere mais alguns segundos e repita o `gh run list`.

### Se o pipeline falhar

Leia o log (`gh run view "$run" --log-failed -R DMBerlin/t20-community-patches`) e classifique:
- **falha transitória** (rede, runner): `gh run rerun "$run" --failed` e acompanhe de novo;
- **falha real** antes de publicar (validação, testes, empacotamento): a tag já é pública e não deve ser movida. Explique a causa ao usuário, corrija na `main` com um commit próprio e publique uma nova versão patch (`<x.y.z+1>`) rodando esta skill de novo. Se a GitHub Release chegou a ser criada incompleta, peça confirmação antes de apagá-la (`gh release delete v<x.y.z> --yes`), mantendo a tag.

## 6. Entregar

Responda de forma concisa:
- versão, commit e tag;
- link da release e status do workflow;
- versão servida pelo manifesto;
- as notas da versão (`node tools/changelog.mjs notes <x.y.z>`), resumidas se forem longas.
