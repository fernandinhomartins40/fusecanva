# ADR-015 — Plugins em iframe sandbox com RPC tipado por `postMessage` e manifest de permissões

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-003, ADR-012, ADR-020

## Contexto

O catálogo de apps atual (`apps-catalog.mjs`, `app-adapters.mjs`) roda no mesmo contexto da aplicação. Código de terceiros com acesso ao DOM, aos tokens de sessão e ao documento inteiro é inaceitável num ecossistema aberto.

## Decisão

- Cada plugin roda num **`<iframe sandbox>`** de origem isolada (sem `allow-same-origin` com a origem do app), com CSP restritiva.
- A comunicação é feita por **RPC tipado sobre `postMessage`**, definido em `@fuse/sdk` (licença MIT, ADR-020): requisições com ID, respostas, eventos e cancelamento; todas as mensagens são validadas por schema dos dois lados.
- Um **manifest** declara identidade, versão, pontos de extensão (painel, ação, tipo de nó `PluginNode`, importador/exportador) e **permissões** (`document:read`, `document:write`, `selection`, `assets:upload`, `network:<domínio>` etc.).
- O usuário (ou o admin da org) aprova as permissões na instalação; o host nega no RPC qualquer chamada fora do manifest.
- Escritas no documento passam pelos mesmos comandos do editor (ADR-014) e são desfazíveis.
- O sandbox passa por pentest na Onda 6.

## Consequências

- **Positivas:** terceiros não acessam DOM, cookies nem tokens; permissões auditáveis; plugins portáveis entre instâncias.
- **Negativas:** latência de RPC; o plugin não desenha direto no canvas (renderiza `PluginNode` por dados ou por imagem fornecida); manter a compatibilidade do SDK exige versionamento semântico.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Plugins in-process (estado atual) | Acesso total ao app e aos segredos |
| Realms/ShadowRealm ou SES em JS | Suporte de plataforma incompleto; superfície de ataque maior |
| Plugins só no servidor (webhooks) | Não cobre UI dentro do editor |

## Versões

Sem dependência externa obrigatória: o RPC é código próprio em `@fuse/sdk`. Referências da plataforma: https://developer.mozilla.org/docs/Web/HTML/Element/iframe#sandbox e https://developer.mozilla.org/docs/Web/API/Window/postMessage
