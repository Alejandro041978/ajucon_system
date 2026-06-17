-- Ejecutar en el SQL Editor de Supabase
-- Tabla para perfiles vocacionales RIASEC (persistente entre sesiones)

create table riasec_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique not null references users(id) on delete cascade,
  R           integer default 0,  -- Realista
  I           integer default 0,  -- Investigador
  A           integer default 0,  -- Artístico
  S           integer default 0,  -- Social
  E           integer default 0,  -- Emprendedor
  C           integer default 0,  -- Convencional
  completitud integer default 0,  -- 0 a 100
  updated_at  timestamptz default now()
);

alter table riasec_profiles enable row level security;
