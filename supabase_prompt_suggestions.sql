-- Ejecutar en el SQL Editor de Supabase
create table prompt_suggestions (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default current_date,
  analisis    text not null,       -- análisis completo del agente revisor
  sugerencias jsonb not null,      -- array de sugerencias específicas
  convs_analizadas integer default 0,
  created_at  timestamptz default now()
);
