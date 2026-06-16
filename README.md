# Stock Insight Voice Agent

슈카월드 YouTube 채널 기반 AI 주식·경제 정보 서비스

## 기술 스택

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **LLM**: OpenAI GPT-4o
- **Embedding**: OpenAI text-embedding-3-small
- **Vector DB**: PostgreSQL + pgvector
- **STT/TTS**: ElevenLabs API

## 시작하기

### 1. 환경변수 설정

```bash
cp .env.local.example .env.local
```

`.env.local` 에 `DATABASE_URL` 설정:
```
DATABASE_URL=postgresql://user:password@localhost:5432/stock_insight
```

### 2. PostgreSQL + pgvector 설정

```sql
CREATE DATABASE stock_insight;
CREATE EXTENSION vector;
```

### 3. 의존성 설치 및 실행

```bash
npm install --legacy-peer-deps
npm run dev
```

## 화면 구성

| 경로 | 설명 |
|------|------|
| `/` | 메인 대시보드 + Agent 챗봇 (우측 하단 버튼) |
| `/knowledge` | 수집 영상 목록 + RAG 검색 테스트 |
| `/admin` | API 키, 음성, 스케줄 설정 |

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/chat` | Agent 질문 처리 |
| POST | `/api/stt` | 음성→텍스트 (ElevenLabs) |
| POST | `/api/tts` | 텍스트→음성 (ElevenLabs) |
| POST | `/api/voice-clone` | 보이스 클로닝 |
| GET | `/api/videos` | 영상 목록 |
| POST | `/api/collector/run` | 수동 수집 실행 |
| GET | `/api/collector/status` | 수집 상태 |
| POST | `/api/settings` | 설정 저장 |
| POST | `/api/rag/search` | RAG 검색 테스트 |

## 초기 설정 순서

1. `/admin` 접속
2. OpenAI API Key 입력
3. ElevenLabs API Key 입력
4. YouTube Data API v3 Key 입력
5. ElevenLabs Voice ID 입력 (남성/여성)
6. 설정 저장
7. `/knowledge` → 수동 수집 실행
8. 수집 완료 후 우측 하단 챗 버튼으로 대화 시작

## 투자 주의사항

본 서비스는 슈카월드 YouTube 채널 기반 **정보 참고용** 서비스입니다.
투자 판단 및 그에 따른 책임은 전적으로 본인에게 있습니다.
YouTube 콘텐츠 수집 시 YouTube 이용약관을 준수하세요.
