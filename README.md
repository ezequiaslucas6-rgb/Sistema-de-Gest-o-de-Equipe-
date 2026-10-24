# Escala Técnica — Sistema de Gestão de Equipe

Programa para Windows que organiza as duplas de **Suporte Técnico** e **Infraestrutura Backbone** de um provedor de
internet: escala 6x1 e transição para 5x2, plantão de fim de semana com compensação, feriados, ausências, banco de horas
e painel de cobertura.

Funciona **sem internet e sem login**. Os dados ficam num banco **SQLite** no próprio computador.

## Instalar

1. Abra a página de [Releases](../../releases) e baixe o arquivo **`Escala-Tecnica-Instalador-…exe`** da versão mais recente.
2. Execute e siga os passos. O instalador cria o atalho **"Escala Técnica"** na área de trabalho e no Menu Iniciar.
   - O Windows pode mostrar "O Windows protegeu o computador" (o programa não tem assinatura digital paga).
     Clique em **Mais informações → Executar assim mesmo**.
3. Quer usar sem instalar? Baixe **`Escala-Tecnica-Portatil-…exe`** e execute direto.

## Onde ficam os dados

```
Documentos\Escala Técnica\escala-tecnica.sqlite
```

No programa, o ícone de **banco de dados** (canto inferior esquerdo) mostra o caminho e permite:

- **Fazer backup…** — salva uma cópia do banco (sugere a área de trabalho);
- **Restaurar backup…** — volta uma cópia (o banco atual é guardado antes, com o final `.antes-da-restauracao`);
- **Abrir pasta do banco**.

Na primeira vez que abre, o programa cria o banco com as 7 duplas, as escalas 6x1/5x2, o rodízio de plantões e os
feriados de 2026–2027. Os técnicos vêm como "Técnico 01…14" — troque pelos nomes reais em **Equipes e duplas**.

## Telas

| Tela | O que faz |
|---|---|
| Painel | Centro de operações: navegação por dia (← → / H), filtro de setor, indicadores, gráfico de cobertura clicável, detalhes da dupla, status "agora" ao vivo, próximos eventos, alertas e sugestões |
| Modo TV | Tela cheia escura para o monitor do NOC: cobertura por setor, duplas, próximos 7 dias e faixa de alertas; atualiza sozinho (Esc sai, F tela cheia) |
| Escala | Grade mensal por dupla; clique para registrar ausência ou mover folga |
| Plantões | Regras do plantão, lançamentos manuais, compensação e banco de horas |
| Motor de plantão | Gera o rodízio dos dois setores até o fim do 6x1, plantões de feriado, folgas de compensação, trocas automáticas por ausência e banco de horas projetado |
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
- **Feriado em dia útil (motor):** a dupla do plantão do fim de semana daquela semana faz o feriado e folga no próximo
  dia útil; feriado na segunda usa o fim de semana anterior (emenda) ou o seguinte, conforme a opção escolhida.
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
  main.cjs      janela do programa, backup/restauração
  preload.cjs   ponte segura entre a janela e o banco
  db.cjs        banco SQLite (sql.js) — tabelas e operações de gravação
  seed.json     dados iniciais da primeira execução
src/
  helpers/scheduleEngine.tsx   motor de regras (escala, plantão, feriados, banco de horas)
  helpers/api.tsx              validação e chamadas ao banco
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
