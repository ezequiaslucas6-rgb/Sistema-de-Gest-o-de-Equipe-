# Escala Técnica — Sistema de Gestão de Equipe

Programa para Windows que organiza as duplas de **Suporte Técnico** e **Infraestrutura Backbone** de um provedor de
internet: escala 6x1 e transição para 5x2, plantão de fim de semana com compensação, feriados, ausências, banco de horas
e painel de cobertura.

Os dados ficam na **nuvem (Supabase)**: qualquer computador com o programa e um login liberado vê os mesmos dados,
e o que um grava aparece nos outros na hora. Precisa de internet.

## Instalar

1. Abra a página de [Releases](../../releases) e baixe o arquivo **`Escala-Tecnica-Instalador-…exe`** da versão mais recente.
2. Execute e siga os passos. O instalador cria o atalho **"Escala Técnica"** na área de trabalho e no Menu Iniciar.
   - O Windows pode mostrar "O Windows protegeu o computador" (o programa não tem assinatura digital paga).
     Clique em **Mais informações → Executar assim mesmo**.
3. Quer usar sem instalar? Baixe **`Escala-Tecnica-Portatil-…exe`** e execute direto.

## Acesso pelo navegador

O mesmo sistema também abre no navegador, sem instalar:
**https://ezequiaslucas6-rgb.github.io/Sistema-de-Gest-o-de-Equipe-/** (publicado a cada push na `main`).

## Login e acesso

- Entre com o mesmo **e-mail e senha do sistema da frota** (Supabase Auth do mesmo projeto).
- Só e-mails cadastrados na tabela **`escala_usuarios`** veem os dados da escala (regras RLS em todas as tabelas `escala_*`).
  Para liberar alguém: `insert into escala_usuarios (email) values ('pessoa@exemplo.com');`

## Dados

- Tabelas `escala_*` no projeto Supabase (duplas, técnicos, ausências, regras, escalas, plantões, feriados, armários,
  viagens, regras das diárias e configuração do motor).
- Ícone de **nuvem** (canto inferior esquerdo): usuário logado, **Baixar backup (.json)**, **Enviar dados do banco
  antigo (arquivo)…** (escolha o `escala-tecnica.sqlite`; funciona no site e no programa) e **Sair**.
- **Versões anteriores guardavam tudo num arquivo local** (`Documentos\Escala Técnica\escala-tecnica.sqlite`). No primeiro
  login num computador que tem esse arquivo com dados próprios, o programa oferece **enviar esses dados para a nuvem**
  (substitui o que está lá). O arquivo local não é apagado.

## Telas

| Tela | O que faz |
|---|---|
| Painel | Centro de operações: navegação por dia (← → / H), filtro de setor, indicadores, gráfico de cobertura clicável, detalhes da dupla, status "agora" ao vivo, próximos eventos, alertas e sugestões |
| Modo TV | Tela cheia escura para o monitor do NOC: cobertura por setor, duplas, próximos 7 dias e faixa de alertas; atualiza sozinho (Esc sai, F tela cheia) |
| Escala | Grade mensal por dupla, **editável direto na tabela**: clique no dia → Em campo / Folga / Plantão (só aquele dia), técnico ausente (férias, atestado…) por um período, ou folga fixa no ciclo; o ponto laranja marca os ajustes manuais |
| Escala de plantão | **Escala salva (editar):** quem está de plantão em cada fim de semana, folga e feriado — clique para trocar, grava na hora. **Gerar rodízio automático:** monta meses de plantão (6x1 e 5x2) com feriados, folgas e trocas por ausência/viagem |
| Regras e banco de horas | Horário do plantão por setor e banco de horas de cada dupla |
| Viagens e diárias | Viagens da equipe (dupla fica "V" na escala), cálculo de diárias cheias/meias, adiantamento, status até o pagamento, relatório por técnico e CSV |
| Feriados | Importação dos feriados nacionais, plantão no feriado e folga no dia útil seguinte |
| Planejamento 6x1 → 5x2 | Gerador de escala e comparativo entre as duas |
| Equipes e duplas | Cadastro de técnicos e duplas |
| Ausências | Férias, atestados, folgas extras |
| Armários | Mapa dos 24 armários (6 por fileira, a 13 aparece como "12+1"): ocupante, setor, desde quando e observação; busca e filtro de ocupados/livres; resumo no Painel |

## Regras implementadas

- **Escala-base:** 6x1 = segunda a sábado (sábado até 12h), folga no domingo. 5x2 = segunda a sexta, folga sábado e domingo.
- **Plantão de fim de semana:** 1 dupla por setor; sábado 14h–18h, domingo 08h–12h e 14h–18h (12h). Rodízio justo.
- **Compensação do plantão:** 6x1 → sexta + sábado seguintes; 5x2 → quinta + sexta seguintes; folga em feriado passa
  para o próximo dia útil.
- **Feriados:** folga geral coberta pela dupla de plantão; quem trabalha folga no próximo dia útil.
- **Plantão é só sábado e domingo**; domingo é DSR (descanso semanal remunerado) e não conta como folga de compensação.
- **Feriado em dia útil (motor):** a dupla do plantão do fim de semana daquela semana faz o feriado e folga no próximo
  dia útil (feriado na **sexta** fica com outra dupla, fora do plantão e da semana de folga, para o plantão não começar na sexta); feriado na segunda usa o fim de semana anterior (emenda) ou o seguinte, conforme a opção escolhida.
- **Diárias só para os destinos da lista** (padrão: Rondolândia, Fazenda Castanhal, Fazenda Peralta); cada viagem pode
  ser marcada como "gera diária: sim/não". **Viagem sobre um plantão** troca a dupla automaticamente com a próxima livre.
- **Diárias:** cheia por pernoite, meia no dia do retorno e em viagem no mesmo dia acima do mínimo de horas (valores
  configuráveis em "Regras das diárias").
- **Banco de horas:** crédito = horas de plantão; débito = horas dos dias de folga que seriam trabalhados.
- **Armários:** o ocupante pode ser um técnico cadastrado (nome e setor preenchidos automaticamente) ou outra pessoa.
  Se o técnico for excluído, o nome continua no armário.

## Estrutura do código

```
electron/
  main.cjs      janela do programa
  preload.cjs   ponte com o banco local antigo (só para enviar os dados para a nuvem)
  db.cjs        banco SQLite local das versões anteriores (leitura para a migração)
  seed.json     dados iniciais do banco local
src/
  helpers/scheduleEngine.tsx   motor de regras (escala, plantão, feriados, banco de horas)
  helpers/api.tsx              validação das entradas
  helpers/cloud.tsx            leitura/gravação no Supabase, envio do banco local, tempo real
  helpers/supabase.tsx         cliente Supabase (URL e chave publicável)
  components/AuthGate.tsx      login e verificação de acesso
  pages/                       telas
  components/                  menu lateral, células da escala, kit de interface
build/icon.png                 ícone do programa e do atalho
```

## Desenvolvimento

```bash
npm install
npm start        # gera a interface e abre o programa
npm run dist     # gera o instalador do Windows em release/ (rodar no Windows)
```

A cada push na `main`, o GitHub Actions gera o instalador e publica uma nova Release automaticamente.
