# D02 — Modelo de documento e formato aberto

Formato `.fuse` versionado, validação, migração, persistência local e funcionamento offline.

Histórias: 8. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-019 — Exportar e importar o arquivo .fuse

Como criadora, quero salvar qualquer documento como um arquivo .fuse e abri-lo de volta, para ter meus dados fora de qualquer servidor.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Exportar e importar o arquivo .fuse

  Cenário: Ida e volta sem perda
    Dado um documento com páginas, textos, imagens e grupos
    Quando exporto para .fuse e importo o arquivo
    Então o documento resultante é estruturalmente igual ao original
    E os assets ficam embutidos no pacote zip
```

## US-020 — Schema público e validável

Como desenvolvedora de integrações, quero um JSON Schema publicado para o formato, para gerar e validar arquivos fora do app.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Schema público e validável

  Cenário: Validação externa
    Dado o JSON Schema da versão atual
    Quando valido um manifesto gerado pelo app com um validador padrão
    Então ele é aceito
    E um manifesto com campo obrigatório ausente é rejeitado com mensagem que aponta o caminho do erro
```

## US-021 — Migração automática entre versões do formato

Como criadora, quero abrir arquivos de versões antigas do formato, para não perder trabalho com atualizações.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Migração automática entre versões do formato

  Cenário: Arquivo antigo abre
    Dado um arquivo com versão de schema anterior
    Quando o abro
    Então ele é migrado em memória para a versão atual sem perda
    E o original não é sobrescrito até eu salvar
```

## US-022 — Migrar dados do armazenamento legado

Como operadora de self-host, quero migrar documentos do formato atual do protótipo para o .fuse, para atualizar a instância sem perder conteúdo.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Migrar dados do armazenamento legado

  Cenário: Roundtrip das fixtures
    Dado o conjunto de fixtures de teste do formato legado
    Quando rodo o migrador
    Então todas convertem para .fuse válido e reabrem com o mesmo conteúdo
```

## US-023 — Edição offline completa

Como criadora, quero continuar editando sem internet, para trabalhar em qualquer lugar.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Edição offline completa

  Cenário: Sincronizar ao reconectar
    Dado que perdi a conexão por 10 minutos enquanto editava
    Quando a conexão volta
    Então minhas alterações são sincronizadas automaticamente
    E nenhum diálogo de conflito é mostrado
```

## US-024 — Indicador de estado de salvamento

Como criadora, quero saber se minhas alterações estão salvas localmente e sincronizadas, para fechar a aba com tranquilidade.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Indicador de estado de salvamento

  Cenário: Estados distintos
    Dado que fiz uma alteração
    Então o indicador mostra "salvando", depois "salvo neste dispositivo" e, se conectado, "sincronizado"
```

## US-025 — Envelope comum para todos os tipos

Como desenvolvedora de plugins, quero que design, doc, apresentação, quadro, planilha, vídeo e site compartilhem um envelope comum, para escrever ferramentas que funcionem com qualquer tipo.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Envelope comum para todos os tipos

  Cenário: Metadados comuns
    Dado um arquivo de qualquer tipo
    Então ele expõe id, tipo, título, versão de schema, páginas e assets no mesmo formato
```

## US-026 — Versionar arquivos em Git

Como desenvolvedora de integrações, quero uma forma textual estável do documento, para versionar designs em repositórios e ver diffs legíveis.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Versionar arquivos em Git

  Cenário: Serialização determinística
    Dado o mesmo documento salvo duas vezes sem alterações
    Então a forma textual é idêntica byte a byte
```
