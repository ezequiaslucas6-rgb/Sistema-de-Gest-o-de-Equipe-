# Sistema de Gestão de Equipe — Escala Técnica

Sistema web para organizar as duplas de **Suporte Técnico** e **Infraestrutura Backbone** de um provedor de internet:
escala 6x1 e transição para 5x2, plantão de fim de semana com compensação, feriados, ausências, banco de horas
e painel de cobertura.

**Acesse:** https://ezequiaslucas6-rgb.github.io/Sistema-de-Gest-o-de-Equipe-/

Entre com o mesmo e-mail e senha do Supabase (os mesmos do sistema da frota). Só e-mails cadastrados na tabela
`escala_usuarios` conseguem ver e alterar os dados.

## Como funciona

- **Site:** React + Vite, publicado no **GitHub Pages** a cada push na `main` (workflow `.github/workflows/deploy.yml`,
  que gera o site e grava no branch `gh-pages`).
- **Banco:** **Supabase** (Postgres). Tabelas com prefixo `escala_` no mesmo projeto da frota, sem alterar as tabelas dela.
  A segurança é feita por RLS: só usuários logados cujo e-mail está em `escala_usuarios` acessam. Estrutura completa em
  [`supabase/schema.sql`](supabase/schema.sql).
- A chave do Supabase em `src/helpers/supabase.tsx` é a **chave publicável**, feita para ficar no navegador; quem protege
  os dados são as regras RLS.

## Telas

| Rota | Arquivo | O que faz |
|---|---|---|
| `#/` | `src/pages/_index.tsx` | Painel: duplas em campo hoje, cobertura dos próximos 14 dias, plantão do fim de semana, alertas e sugestões |
| `#/escala` | `src/pages/escala.tsx` | Grade mensal por dupla; clique para registrar ausência ou mover folga |
| `#/plantao` | `src/pages/plantao.tsx` | Regras do plantão, rodízio automático, compensação e banco de horas |
| `#/feriados` | `src/pages/feriados.tsx` | Feriados (importação dos nacionais), plantão no feriado e folga no dia útil seguinte |
| `#/planejamento` | `src/pages/planejamento.tsx` | Gerador de escala 6x1/5x2 e comparativo entre as duas |
| `#/equipes` | `src/pages/equipes.tsx` | Cadastro de técnicos e duplas |
| `#/ausencias` | `src/pages/ausencias.tsx` | Férias, atestados, folgas extras |

## Regras implementadas

- **Escala-base:** 6x1 = segunda a sábado (sábado até 12h), folga no domingo. 5x2 = segunda a sexta, folga sábado e domingo.
  Em cada data vale a escala do setor com a data de início mais recente.
- **Plantão de fim de semana:** 1 dupla por setor; sábado 14h–18h, domingo 08h–12h e 14h–18h (12h).
  Rodízio justo: quem fez menos plantões entra primeiro, sem fins de semana seguidos.
- **Compensação do plantão:** 6x1 → sexta + sábado seguintes; 5x2 → quinta + sexta seguintes.
  Folga que cair em feriado passa para o próximo dia útil.
- **Feriados:** folga geral, coberta pela dupla de plantão; quem trabalha folga no próximo dia útil.
- **Banco de horas:** crédito = horas de plantão; débito = horas dos dias de folga que seriam trabalhados.

O motor de regras fica em `src/helpers/scheduleEngine.tsx` (TypeScript puro) e o acesso ao banco em `src/helpers/api.tsx`.

## Liberar acesso para outra pessoa

A pessoa precisa ter usuário no Supabase (Authentication → Users). Depois, no SQL Editor do Supabase:

```sql
insert into public.escala_usuarios (email) values ('email.da.pessoa@exemplo.com');
```

## Rodar no computador

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/
```
