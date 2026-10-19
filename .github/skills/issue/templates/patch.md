## Resumo

<O que está errado, onde aparece e o que este patch (`<patch-id>`) faz. 2–4 frases, com exemplos concretos de itens/efeitos.>

## Ambiente afetado

- Tormenta20 **<versão>**
- Foundry VTT **<versão>**
- Upstream: <link da issue/branch no GitLab ou "não reportado">.

## Como reproduzir

1. <passo com dados concretos (pack/item/classe)>
2. <passo>

**Esperado:** <...>
**Observado:** <...>

## Causa raiz

`systems/tormenta20/tormenta20.mjs` (`T20:<linha>`).

```js
// T20:<início>-<fim> – <Classe.método> (<papel no fluxo>)
<trecho relevante>
```

<Mecanismo em prosa: por que o trecho produz o sintoma. Todos os caminhos de entrada afetados.>

## Impacto no jogo

<Quem é afetado, com que frequência, e consequência para a mesa.>

## Implementação proposta

### Arquivos

- Novo: `scripts/patches/<patch-id>.mjs`, no modelo dos patches existentes.
- `scripts/patches/index.mjs`: importar e adicionar a `PATCHES`.
- `group`: `<conditions|sheet-effects|usage-effects|items|settings>`; `issue`: <n>.
- Faixa: `system: { id: "tormenta20", affected: { minimum: "<v>", maximum: "<v>" } }`.

### Pontos de interceptação e por que são seguros

1. **`<Classe.prototype.método>`**: <o que o wrapper faz, quando roda, por que preserva o comportamento oficial>.

### Teste em tempo de execução (`isNeeded`)

<Teste síncrono, seguro no `init`, que devolve `{ bug: "present"|"fixed"|"unknown", confidence: "high"|"low", evidence }`. Diga o que ele cobre e o que não cobre, e por que a confiança é essa (só ler código-fonte → no máximo `fixed`/low). Ou: "não há teste confiável porque …", e se o patch é `guarded` ou tem `lateProbe()`.>

### Código completo

```js
// scripts/patches/<patch-id>.mjs
<código completo>
```

### Funções puras exportadas para teste

`<função(args)>`

### i18n

`lang/pt-BR.json` e `lang/en.json`, em `T20CP.Patches`:
```json
"<patch-id>": { "Name": "Correção: …", "Hint": "…" }
```
```json
"<patch-id>": { "Name": "Fix: …", "Hint": "…" }
```

### README

`| \`<patch-id>\` ([#<n>](https://github.com/DMBerlin/t20-community-patches/issues/<n>)) | <Grupo> | <versões> | <o que faz> |`

### CHANGELOG

Seção: `Fixed`
```
`<patch-id>` (#<n>): <o que muda para o usuário>. Afeta Tormenta20 <versão>.
```

## Decisões de produto

- <decisão confirmada com o usuário>

## Riscos e casos-limite

- **<caso>:** <comportamento e por quê>.
- **Interação com #<n>:** <...>.

## Critérios de aceite

- [ ] <comportamento corrigido, verificável>
- [ ] Com o patch desligado no gerenciador, o comportamento oficial volta.
- [ ] README, `lang/*.json` e testes foram atualizados, e `make check` passa.

## Testes

### Unitários: `tests/<patch-id>.test.mjs`

- <caso → resultado esperado>

### Plano de teste manual no Foundry

1. <passo com dados concretos → resultado esperado>
2. Desligue o patch em **Gerenciar correções**, recarregue e repita o passo 1: o comportamento oficial volta.

## Fora de escopo

- <o que não será feito, e onde está (#n)>

## Referências

- `tormenta20.mjs`: <linhas (símbolos)>
- Core: `<arquivo:linha>` (<símbolo>)
- Issues relacionadas: #<n>
