# Governança do Fuse Studio

Este documento descreve como as decisões são tomadas no Fuse Studio. Ele vale para a fase **pré-alpha** e será revisto antes da versão 1.0.

## Princípios

As decisões seguem os princípios do [plano v2](docs/v2/02-PLANO-V2.md#11-princípios-decidem-qualquer-dúvida). Os mais importantes para a governança são:

1. **Produto próprio, não réplica.** Identidade, nomes e textos são originais.
2. **Aberto por padrão.** Formato, API, SDK e auto-hospedagem são públicos e documentados.
3. **Decisões registradas.** Toda decisão de arquitetura vira um ADR em [docs/adr/](docs/adr/README.md).
4. **Pronto quer dizer valor medido.** Uma entrega só conta quando cumpre a Definição de Pronto (§6 do plano).

## Papéis

| Papel | Quem | Pode |
| --- | --- | --- |
| **Contribuidor(a)** | Qualquer pessoa que envia issue, PR, revisão ou tradução | Propor mudanças; participar das discussões |
| **Revisor(a) de pacote** | Contribuidor(a) recorrente indicado(a) para um ou mais pacotes no `.github/CODEOWNERS` | Aprovar PRs nos pacotes sob sua responsabilidade |
| **Mantenedor(a)** | Lista abaixo | Fazer merge em `main`; aceitar ADRs; publicar versões; moderar a comunidade; aplicar o Código de Conduta |
| **Mantenedor(a) líder** | Quem criou o projeto, durante a pré-alpha | Dar a palavra final quando não houver consenso; decidir licença e marca |

### Mantenedores atuais

| Nome | GitHub | Áreas |
| --- | --- | --- |
| *a definir pelo mantenedor líder* | — | todas |

> Pendência: preencher esta tabela e o `.github/CODEOWNERS` quando a organização no GitHub existir.

### Como se tornar revisor(a) ou mantenedor(a)

- **Revisor(a) de pacote:** depois de alguns PRs aceitos no pacote e de revisões úteis em PRs de outras pessoas, qualquer mantenedor(a) pode indicar. A indicação é aprovada por consenso preguiçoso (veja abaixo).
- **Mantenedor(a):** indicação de um(a) mantenedor(a), com aprovação explícita da maioria dos(as) mantenedores(as) atuais e sem veto do(a) mantenedor(a) líder.
- Quem fica inativo(a) por 6 meses passa a ter o status de *emérito(a)* e pode voltar quando quiser.

## Como as decisões são tomadas

1. **Mudanças do dia a dia** (bugs, features dentro de um pacote, documentação): PR com CI verde e aprovação de 1 revisor(a) ou mantenedor(a) do pacote.
2. **Mudanças de contrato** (tipos públicos de pacote, formato `.fuse`, API REST, SDK de plugins): issue antes do PR e aprovação de 2 mantenedores(as). Mudanças incompatíveis no `.fuse` sempre trazem migração.
3. **Decisões de arquitetura:** PR com um ADR em `docs/adr/`, no formato MADR. O ADR fica aberto a comentários por pelo menos **7 dias** e é aceito por **consenso preguiçoso**: se nenhum(a) mantenedor(a) fizer objeção fundamentada, o ADR é aceito.
4. **Sem consenso:** os(as) mantenedores(as) votam por maioria simples. Em caso de empate, decide o(a) mantenedor(a) líder.
5. **Licença, marca e governança:** decisão do(a) mantenedor(a) líder, registrada em ADR ou neste arquivo.

## Licenças e marca

- As licenças de código estão descritas no [README](README.md#licenças) e no [ADR-020](docs/adr/020-licenca-agpl-mit.md): **AGPL-3.0-only** para o aplicativo e o servidor, **MIT** para `packages/format`, `packages/sdk` e `apps/cli`.
- Contribuições entram sob **DCO** (`Signed-off-by`). Mudar para CLA ou relicenciar exige um ADR aceito pelo(a) mantenedor(a) líder.
- O nome **"Fuse Studio"** e o logotipo **não** são cobertos pelas licenças de código. Forks devem usar outro nome. A política de marca está pendente (ADR-020, item d).

## Roadmap e execução

O roadmap é o §8 do [plano v2](docs/v2/02-PLANO-V2.md#8-roadmap-em-ondas), organizado em ondas de 0 a 6. Cada onda termina com um **gate** (CI verde, revisão do integrador e demonstração do fluxo), e a próxima só começa quando o gate passa. A divisão do trabalho por onda está em [docs/v2/03-AGENTES-OPUS.md](docs/v2/03-AGENTES-OPUS.md).

## Contato de conduta

Para relatar violações do [Código de Conduta](CODE_OF_CONDUCT.md), envie mensagem privada a qualquer mantenedor(a) da tabela acima. Se o relato envolver um(a) mantenedor(a), escreva para outra pessoa da lista. Essa pessoa se afasta das decisões sobre o caso.

> Pendência: criar um endereço de e-mail dedicado (por exemplo, `conduta@` num domínio do projeto) e registrá-lo aqui.

Vulnerabilidades de segurança seguem o [SECURITY.md](SECURITY.md).

## Mudanças nesta governança

Mudanças neste arquivo são feitas por PR, ficam abertas por pelo menos 14 dias e precisam da aprovação do(a) mantenedor(a) líder.
