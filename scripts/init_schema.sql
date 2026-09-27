CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  world_id TEXT NOT NULL,
  synopsis TEXT,
  project_type TEXT NOT NULL DEFAULT 'film',
  style TEXT NOT NULL DEFAULT 'drama',
  status TEXT NOT NULL DEFAULT 'development',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shots (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id INTEGER,
  scene_number INTEGER NOT NULL,
  shot_order INTEGER,
  description TEXT NOT NULL,
  camera_movement TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 5,
  dialogue TEXT,
  audio_note TEXT,
  audio_url TEXT,
  video_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_clips (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_seconds INTEGER,
  notes TEXT,
  clip_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subtitles (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'ar',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS timeline_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
  clip_id INTEGER REFERENCES edit_clips(id) ON DELETE SET NULL,
  asset_id TEXT,
  asset_url TEXT,
  track TEXT NOT NULL,
  start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  metadata TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  output_video_url TEXT,
  total_duration DOUBLE PRECISION DEFAULT 0,
  render_settings TEXT,
  logs TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- إدخال مشروع تجريبي ولقطات بحوارات حقيقية
INSERT INTO projects (id, title, world_id, project_type, style, synopsis, status)
VALUES (1, 'رحلة البداية', 'noir', 'film', 'drama', 'مشروع سينمائي تجريبي', 'in_production')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shots (project_id, scene_number, description, camera_movement, duration_seconds, dialogue, audio_note)
VALUES 
(1, 1, 'لقطة واسعة لغروب الشمس في الصحراء', 'Slow Pan Right', 5, 'الرحلة تبدأ من هنا، ولا مجال للتردد.', 'صوت رياح خفيفة'),
(1, 2, 'لقطة مقربة للبطل وهو ينظر للأفق', 'Close-up Static', 6, 'كل سر يدفن في الرمال سيكشفه الزمن.', 'موسيقى غموض متصاعدة')
ON CONFLICT DO NOTHING;
