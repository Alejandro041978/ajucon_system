-- Ejecutar en el SQL Editor de Supabase
create table inscripciones_cursos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  curso_nombre    text not null,
  moodle_curso_id integer not null default 8,
  moodle_user_id  integer,           -- ID del usuario en Moodle (para sync de notas)
  nota            numeric(5,2),      -- nota sincronizada desde Moodle (0-100)
  estado          text not null default 'inscrito'
                  check (estado in ('inscrito', 'aprobado', 'rechazado')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table inscripciones_cursos enable row level security;
