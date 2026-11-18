# ADR-011 — Autenticação com Better Auth, OIDC/SAML para SSO e sessões em cookie httpOnly

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-007, ADR-008, ADR-012

## Contexto

A autenticação atual é artesanal. Instalações corporativas auto-hospedadas exigem SSO (OIDC e SAML), verificação de domínio e políticas de sessão. A segurança de auth é gate ASVS L2 (plano v2 §5).

## Decisão

- **Better Auth** como biblioteca de autenticação no módulo `auth` de `apps/server`, com adapter para o Drizzle/Postgres (ADR-008).
- Métodos na Onda 1: e-mail + senha (hash forte) e link de acesso de uso único por e-mail. Na Onda 4: **OIDC** e **SAML** por organização, com verificação de domínio.
- Sessões em **cookie httpOnly**, `Secure`, `SameSite=Lax`, com rotação e revogação no servidor; proteção CSRF nas rotas que mudam estado.
- Se algum recurso de SSO não estiver coberto pela biblioteca, ele é implementado com bibliotecas padrão (`openid-client` para OIDC, `@node-saml/node-saml` para SAML) atrás da mesma interface do módulo `auth`.
- O plano cita "Lucia-like" como alternativa; a Lucia foi descontinuada como biblioteca e hoje serve de material de referência, por isso não é adotada como dependência.

## Consequências

- **Positivas:** fluxos testados pela comunidade; SSO disponível para self-host corporativo; sem tokens em `localStorage`.
- **Negativas:** dependência de uma biblioteca relativamente jovem; precisa de testes de integração próprios e revisão de segurança a cada atualização.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Auth artesanal (estado atual) | Risco de segurança e custo de manutenção |
| Lucia | Descontinuada como biblioteca |
| Auth.js | Mais voltada a frameworks full-stack do que a um servidor Fastify |
| IdP externo obrigatório (Keycloak etc.) | Pesado para o self-host pequeno; continua suportado via OIDC |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `better-auth` | 1.7.25 | https://www.better-auth.com |
| `openid-client` (fallback OIDC) | 6.9.0 | https://github.com/panva/openid-client |
| `@node-saml/node-saml` (fallback SAML) | 5.2.0 | https://github.com/node-saml/node-saml |
| `@fastify/cookie` | 11.1.5 | https://github.com/fastify/fastify-cookie |
