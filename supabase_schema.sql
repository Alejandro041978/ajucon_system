-- ============================================================
-- AJUCON — Schema completo
-- Ejecutar en el SQL Editor de Supabase (en orden)
-- ============================================================

-- ------------------------------------------------------------
-- 1. USUARIOS
-- ------------------------------------------------------------
create table users (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  email        text unique not null,
  grado        text not null,
  created_at   timestamptz default now()
);

-- ------------------------------------------------------------
-- 2. AUTENTICACIÓN — códigos de verificación por email
-- ------------------------------------------------------------
create table verification_codes (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  code         text not null,
  expires_at   timestamptz not null,
  used         boolean default false,
  created_at   timestamptz default now()
);

create index on verification_codes(email, used, expires_at);

-- ------------------------------------------------------------
-- 3. CONVERSACIONES DE CHAT (Psicóloga y Profesor)
-- ------------------------------------------------------------
create table conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  agente       text not null check (agente in ('psicologa', 'profesor')),
  created_at   timestamptz default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz default now()
);

create index on messages(conversation_id, created_at);

-- ------------------------------------------------------------
-- 4. TEST VOCACIONAL
-- ------------------------------------------------------------
create table test_results (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  respuestas   jsonb not null,   -- {pregunta_id: valor, ...}
  resultado    text not null,    -- perfil vocacional resultante
  carreras     jsonb not null,   -- ["Ingeniería", "Diseño", ...]
  created_at   timestamptz default now()
);

-- ------------------------------------------------------------
-- 5. POSTULACIONES A BECAS — Estudios Profesionales
-- ------------------------------------------------------------
create table becas_profesionales (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  rut               text not null,
  fecha_nacimiento  date not null,
  direccion         text not null,
  telefono          text not null,
  carrera_interes   text not null,
  institucion       text not null,
  situacion_economica text not null,
  promedio_notas    numeric(4,2) not null,
  motivacion        text not null,
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'en_revision', 'aprobada', 'rechazada')),
  created_at        timestamptz default now()
);

-- ------------------------------------------------------------
-- 6. POSTULACIONES A BECAS — Cursos Online
-- ------------------------------------------------------------
create table becas_cursos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  plataforma      text not null,   -- Coursera, Udemy, etc.
  curso_nombre    text not null,
  curso_url       text,
  justificacion   text not null,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'en_revision', 'aprobada', 'rechazada')),
  created_at      timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — cada usuario solo ve sus propios datos
-- ============================================================
alter table users               enable row level security;
alter table verification_codes  enable row level security;
alter table conversations       enable row level security;
alter table messages            enable row level security;
alter table test_results        enable row level security;
alter table becas_profesionales enable row level security;
alter table becas_cursos        enable row level security;

-- Las API Functions usan la service key (bypassa RLS),
-- así que las policies son solo por si se usa el cliente anon.

create policy "usuarios: solo su fila"
  on users for all using (email = current_setting('request.jwt.claims', true)::json->>'email');

create policy "conversaciones: solo las propias"
  on conversations for all using (
    user_id = (select id from users where email = current_setting('request.jwt.claims', true)::json->>'email')
  );

create policy "mensajes: solo los propios"
  on messages for all using (
    conversation_id in (
      select id from conversations where user_id = (
        select id from users where email = current_setting('request.jwt.claims', true)::json->>'email'
      )
    )
  );

create policy "test_results: solo los propios"
  on test_results for all using (
    user_id = (select id from users where email = current_setting('request.jwt.claims', true)::json->>'email')
  );

create policy "becas_profesionales: solo las propias"
  on becas_profesionales for all using (
    user_id = (select id from users where email = current_setting('request.jwt.claims', true)::json->>'email')
  );

create policy "becas_cursos: solo las propias"
  on becas_cursos for all using (
    user_id = (select id from users where email = current_setting('request.jwt.claims', true)::json->>'email')
  );
