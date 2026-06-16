const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export async function textToSpeech(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<Buffer> {
  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs TTS error: ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function speechToText(
  audioBuffer: Buffer,
  apiKey: string
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" });
  formData.append("audio", blob, "audio.webm");
  formData.append("model_id", "scribe_v1");

  const response = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs STT error: ${err}`);
  }

  const data = await response.json();
  return data.text || "";
}

export async function cloneVoice(
  name: string,
  audioBuffer: Buffer,
  apiKey: string
): Promise<string> {
  const formData = new FormData();
  formData.append("name", name);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
  formData.append("files", blob, "sample.mp3");
  formData.append("description", "User cloned voice");

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voice cloning error: ${err}`);
  }

  const data = await response.json();
  return data.voice_id;
}

export async function listVoices(apiKey: string) {
  const response = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  const data = await response.json();
  return data.voices || [];
}
