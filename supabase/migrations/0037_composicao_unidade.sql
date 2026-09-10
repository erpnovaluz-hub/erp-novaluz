-- Unidade de medida por item da composição de custo (un, kg, m, h…)
alter table composicao_custo add column if not exists unidade text;
