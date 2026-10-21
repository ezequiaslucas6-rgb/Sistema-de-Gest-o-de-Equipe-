Escala Técnica — arquitetura

Dados (Postgres): teams (setor suporte|infraestrutura), technicians (team_id, máx 2 por equipe — validado no endpoint), absences (datas texto YYYY-MM-DD), sector_settings (min_coverage jsonb[7] seg..dom, max_consecutive, horas/dia 6x1 e 5x2, turno), schedule_patterns (sector, scale_type, start_date segunda-feira, cycle_weeks, days_off jsonb {teamId: [{day, kind: regular|compensatoria}]}).

Regra de vigência: em cada data vale a escala do setor com maior start_date <= data (scheduleEngine.patternForDate). Transição 6x1→5x2 = cadastrar padrão 5x2 com início futuro.

helpers/scheduleEngine: generatePattern (rodízio domingo/fim de semana, busca exaustiva semanal por cobertura mínima, duas passadas p/ virada do ciclo, reparo com folgas compensatórias), computeMetrics, resolveTeamDay (folga > ausente > desfalcada > trabalho).
helpers/buildScheduleSnapshot: visão diária por setor + alertas agrupados + sugestões (dupla temporária, trocar folga).
endpoints: data_GET devolve tudo; save/delete POST para team, technician, absence, pattern; settings/save.
Plantão de fim de semana: on_call_shifts (team_id, weekend_start = sábado, comp_dates jsonb — padrão sexta+sábado seguintes). sector_settings.on_call_teams/on_call_saturday/on_call_sunday (faixas "08:00-12:00,14:00-18:00"). resolveTeamDay: plantão (sáb/dom) > folga_plantao (comp_dates) > escala base. Escala base no modo "plantao" do gerador: 6x1 folga fixa domingo, 5x2 folga sáb+dom. Banco de horas: crédito = horas do plantão, débito = horas/dia dos dias de compensação que seriam trabalhados na escala base (sábado no 5x2 não abate).
Compensação do plantão de fim de semana: 6x1 sex+sáb, 5x2 qui+sex (defaultCompDates; folga em feriado empurrada ao próximo dia útil).
Feriados: holidays (date único, kind, day_off, on_call_team_ids jsonb, on_call_hours, comp_date = próximo dia útil após o feriado — regra do supervisor). Importação dos nacionais por ano (brazilNationalHolidays, Páscoa calculada). day_off=false = ponto facultativo trabalhado.
Páginas: / painel, /feriados, /plantao plantões + rodízio + banco de horas, /escala grade mensal (clique altera padrão ou registra ausência), /planejamento gerador + comparativo, /equipes, /ausencias.
