# SpriteSync - Podcast to Video Render System

An audio and sprite to video app with ability to have multiple speakers. This is a containerized microservices architecture that processes podcasts and converts them into animated videos with synchronized character sprites.

## Architecture

The system consists of 8 microservices:

1. **web-ui** (Port 3000) - Web interface and API for uploading assets, managing configurations, and triggering jobs
2. **orchestrator** (Port 4000) - Coordinates the entire rendering pipeline
3. **diarization** (Port 5000) - Identifies when different speakers are talking
4. **speaker-id** (Port 5001) - Maps diarized segments to named speakers
5. **stem-generator** (Port 5002) - Separates audio into components (vocals, background, etc.)
6. **lipsync** (Port 5003) - Generates mouth animation data for sprites
7. **renderer** (Port 5004) - Renders video frames using a headless browser (Puppeteer)
8. **mux** (Port 5005) - Combines video frames and audio into final output (FFmpeg)

## Pipeline Flow

```
Audio + Sprites Upload (web-ui)
    ↓
Job Creation (orchestrator)
    ↓
Diarization → Speaker ID → Stem Generator → Lipsync → Renderer → Mux
    ↓
Final Video Output
```

## Getting Started

### Prerequisites

- Docker
- Docker Compose

### Installation

1. Clone the repository:
```bash
git clone https://github.com/spiffy2006/spritesync.git
cd spritesync
```

2. Build and start all services:
```bash
docker-compose up --build
```

3. Access the web UI at: http://localhost:3000

### Usage

1. Open http://localhost:3000 in your browser
2. Enter a job name
3. Upload an audio file (podcast episode)
4. Upload sprite images for each speaker
5. Enter speaker names (comma-separated)
6. Configure video settings (resolution, background color)
7. Click "Create & Trigger Job"
8. Monitor job progress in the "Recent Jobs" panel

## API Endpoints

### Web UI Service (Port 3000)

- `GET /api/health` - Health check
- `POST /api/upload/audio` - Upload audio file
- `POST /api/upload/sprite` - Upload single sprite image
- `POST /api/upload/sprites` - Upload multiple sprite images
- `POST /api/config` - Save job configuration
- `GET /api/config/:configId` - Get configuration
- `GET /api/configs` - List all configurations
- `POST /api/jobs/trigger` - Trigger a new rendering job
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs` - List all jobs

### Orchestrator Service (Port 4000)

- `GET /api/health` - Health check
- `POST /api/jobs` - Create and process a new job
- `GET /api/jobs/:jobId` - Get job details
- `GET /api/jobs` - List all jobs

## Development

### Running Individual Services

Each service can be run independently for development:

#### Web UI
```bash
cd services/web-ui
npm install
npm start
```

#### Orchestrator
```bash
cd services/orchestrator
npm install
npm start
```

#### Python Services (diarization, speaker-id, stem-generator, lipsync, mux)
```bash
cd services/<service-name>
pip install -r requirements.txt
python app.py
```

#### Renderer
```bash
cd services/renderer
npm install
npm start
```

## Configuration

Environment variables can be set in `docker-compose.yml` or via `.env` file:

- `PORT` - Service port
- `ORCHESTRATOR_URL` - URL of orchestrator service
- Various `*_URL` - URLs for downstream services

## Volumes

- `uploads` - Stores uploaded audio and sprite files
- `configs` - Stores job configurations
- `output` - Stores rendered video frames and final output

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js (Express), Python (Flask)
- **Containerization**: Docker, Docker Compose
- **Media Processing**: FFmpeg (mux service)
- **Browser Automation**: Puppeteer (renderer service)

## Future Enhancements

- Integrate real ML models:
  - pyannote.audio for diarization
  - Speaker recognition models
  - Demucs/Spleeter for stem separation
  - Wav2Lip or Rhubarb for lipsync
- Add database for persistent storage
- Implement job queue with Redis/RabbitMQ
- Add authentication and user management
- Support for real-time progress updates via WebSockets
- Video preview and editing capabilities
- Export to multiple video formats
- Cloud storage integration

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
