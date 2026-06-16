import { query } from "./client";

export async function runMigrations(): Promise<void> {
  await query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      video_id VARCHAR(50) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TIMESTAMP,
      duration INTEGER,
      transcript_status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id SERIAL PRIMARY KEY,
      video_id VARCHAR(50) NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      start_time FLOAT,
      end_time FLOAT,
      embedding VECTOR(1536),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(video_id, chunk_index)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      encrypted BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS collection_logs (
      id SERIAL PRIMARY KEY,
      job_date DATE,
      status VARCHAR(30),
      new_video_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_video_id ON transcript_chunks(video_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON transcript_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `).catch(() => {
    // Index may fail if not enough rows yet; that's OK
  });

  console.log("Migrations completed");
}
