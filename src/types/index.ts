export interface Video {
  id: number;
  video_id: string;
  title: string;
  url: string;
  published_at: string;
  duration: number;
  transcript_status: "pending" | "processing" | "done" | "failed";
  chunk_count?: number;
  created_at: string;
}

export interface TranscriptChunk {
  id: number;
  video_id: string;
  chunk_index: number;
  chunk_text: string;
  start_time: number;
  end_time: number;
  created_at: string;
}

export interface Source {
  title: string;
  url: string;
  start_time: number;
  video_id: string;
  chunk_text: string;
  similarity: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  risk_points?: string[];
  audio_url?: string;
  timestamp: Date;
}

export interface AgentResponse {
  answer: string;
  sources: Source[];
  risk_points: string[];
  audio_url?: string;
}

export interface CollectionLog {
  id: number;
  job_date: string;
  status: "running" | "completed" | "failed";
  new_video_count: number;
  error_message?: string;
  created_at: string;
}

export interface Settings {
  openai_api_key?: string;
  elevenlabs_api_key?: string;
  male_voice_id?: string;
  female_voice_id?: string;
  default_voice?: "male" | "female";
  collection_schedule?: string;
}
