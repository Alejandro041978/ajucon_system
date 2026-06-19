-- Ejecutar en el SQL Editor de Supabase
create table cursos (
  id              serial primary key,
  nombre          text not null,
  moodle_curso_id integer,
  activo          boolean default true,
  orden           integer default 0,
  created_at      timestamptz default now()
);

alter table cursos enable row level security;

-- Cargar el catálogo inicial de 20 cursos
insert into cursos (nombre, orden) values
  ('Liderazgo', 1),
  ('Desarrollo Emocional', 2),
  ('Valores, ética y bienestar', 3),
  ('Desarrollo Humano a lo Largo de la Vida', 4),
  ('Finanzas Personales', 5),
  ('Redes Sociales', 6),
  ('Pensamiento Creativo', 7),
  ('Introducción a la Inteligencia Artificial', 8),
  ('Lógica de la Argumentación y Pensamiento Crítico', 9),
  ('Creatividad Digital', 10),
  ('Inteligencia Emocional', 11),
  ('Habilidades de Comunicación', 12),
  ('Gestión de Emociones', 13),
  ('Gestión del Tiempo y Productividad', 14),
  ('Cómo Hacer Amigos y tener Relaciones Exitosas', 15),
  ('Herramientas para la Autogestión de Emociones', 16),
  ('Liderazgo en tiempos Digitales', 17),
  ('Cómo entender lo que leo', 18),
  ('Cómo Ser más Empático', 19),
  ('Comunicación Asertiva', 20);
