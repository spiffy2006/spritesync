# Development Guide

## Architecture Overview

### Service Communication Flow

```
┌─────────────┐
│   Browser   │
│  (User UI)  │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────────────────────────────────────────────┐
│  Web UI Service (Port 3000)                         │
│  - Static HTML/CSS/JS frontend                      │
│  - Express API backend                              │
│  - File upload handling (multer)                    │
│  - Config storage                                   │
│  - Job triggering proxy                             │
└──────┬──────────────────────────────────────────────┘
       │ HTTP POST /api/jobs
       ▼
┌─────────────────────────────────────────────────────┐
│  Orchestrator Service (Port 4000)                   │
│  - Job queue management                             │
│  - Pipeline coordination                            │
│  - Service health monitoring                        │
└──────┬──────────────────────────────────────────────┘
       │
       │ Sequential Processing Pipeline
       │
       ├─────► Diarization (5000)
       │       └─ Identify speaker segments
       │
       ├─────► Speaker ID (5001)
       │       └─ Map segments to names
       │
       ├─────► Stem Generator (5002)
       │       └─ Separate audio components
       │
       ├─────► Lipsync (5003)
       │       └─ Generate mouth animations
       │
       ├─────► Renderer (5004)
       │       └─ Create video frames
       │
       └─────► Mux (5005)
               └─ Combine frames + audio
                  ↓
             Final Video
```

## Service Responsibilities

### Web UI (`services/web-ui`)
- **Technology**: Node.js, Express
- **Purpose**: Control plane - no rendering logic
- **Key Features**:
  - File upload endpoints (audio, sprites)
  - Configuration management (CRUD operations)
  - Job triggering (proxy to orchestrator)
  - Job status monitoring
  - Static file serving for UI

### Orchestrator (`services/orchestrator`)
- **Technology**: Node.js, Express
- **Purpose**: Pipeline coordination
- **Key Features**:
  - Sequential job processing
  - Service orchestration
  - Error handling and retry logic
  - Job state management
  - Service health checks

### Diarization (`services/diarization`)
- **Technology**: Python, Flask
- **Purpose**: Speaker diarization
- **Algorithm**: Would use pyannote.audio in production
- **Mock Output**: Speaker segments with timestamps

### Speaker ID (`services/speaker-id`)
- **Technology**: Python, Flask
- **Purpose**: Speaker identification
- **Algorithm**: Would use voice embeddings in production
- **Mock Output**: Named speaker segments

### Stem Generator (`services/stem-generator`)
- **Technology**: Python, Flask
- **Purpose**: Audio source separation
- **Algorithm**: Would use Demucs/Spleeter in production
- **Mock Output**: Vocal and instrumental stems

### Lipsync (`services/lipsync`)
- **Technology**: Python, Flask
- **Purpose**: Lip sync animation generation
- **Algorithm**: Would use Wav2Lip/Rhubarb in production
- **Mock Output**: Keyframes with mouth shapes

### Renderer (`services/renderer`)
- **Technology**: Node.js, Puppeteer
- **Purpose**: Video frame generation
- **Algorithm**: Headless browser rendering
- **Mock Output**: Video frame sequences

### Mux (`services/mux`)
- **Technology**: Python, FFmpeg
- **Purpose**: Final video assembly
- **Algorithm**: FFmpeg for video/audio muxing
- **Mock Output**: Final MP4 video file

## Data Flow

1. **Upload Phase**:
   - User uploads audio file → stored in shared `uploads` volume
   - User uploads sprite images → stored in shared `uploads` volume
   - User saves configuration → stored in `configs` volume

2. **Processing Phase**:
   - Job created in orchestrator
   - Each service reads from `uploads` volume
   - Each service processes and passes results to next
   - Renderer and Mux write to `output` volume

3. **Output Phase**:
   - Final video available in `output` volume
   - Can be downloaded via web UI (future enhancement)

## Volume Mounts

- `uploads`: Shared across all services (read-only for processing services)
- `configs`: Used by web-ui for configuration storage
- `output`: Used by renderer and mux for final output

## API Endpoints Summary

### Web UI Service
```
GET  /api/health              - Health check
POST /api/upload/audio        - Upload audio file
POST /api/upload/sprite       - Upload single sprite
POST /api/upload/sprites      - Upload multiple sprites
POST /api/config              - Create configuration
GET  /api/config/:id          - Get configuration
GET  /api/configs             - List all configs
POST /api/jobs/trigger        - Trigger new job
GET  /api/jobs/:id            - Get job status
GET  /api/jobs                - List all jobs
```

### Orchestrator Service
```
GET  /api/health              - Health check
POST /api/jobs                - Create and process job
GET  /api/jobs/:id            - Get job details
GET  /api/jobs                - List all jobs
```

### Processing Services (all similar)
```
GET  /health                  - Health check
POST /process                 - Process job data
```

## Development Workflow

### Local Development (Individual Service)

1. Navigate to service directory
2. Install dependencies
3. Run locally
4. Test with curl or Postman

Example for web-ui:
```bash
cd services/web-ui
npm install
PORT=3000 ORCHESTRATOR_URL=http://localhost:4000 npm start
```

Example for diarization:
```bash
cd services/diarization
pip install -r requirements.txt
python app.py
```

### Docker Development

1. Build specific service:
```bash
docker compose build web-ui
```

2. Start specific service:
```bash
docker compose up web-ui
```

3. View logs:
```bash
docker compose logs -f web-ui
```

### Testing the Full Pipeline

1. Start all services:
```bash
docker compose up -d
```

2. Access web UI at http://localhost:3000

3. Create a test job:
   - Upload a test audio file
   - Upload test sprite images
   - Configure job settings
   - Trigger the job

4. Monitor progress:
   - Watch job status in UI
   - Check orchestrator logs: `docker compose logs -f orchestrator`
   - Check individual service logs as needed

## Adding New Services

To add a new service to the pipeline:

1. Create service directory: `services/new-service/`
2. Create Dockerfile
3. Create application code
4. Add service to `docker-compose.yml`
5. Update orchestrator to call new service
6. Update this documentation

## Troubleshooting

### Service won't start
- Check logs: `docker compose logs <service-name>`
- Verify Dockerfile syntax
- Check for port conflicts

### Service can't communicate
- Verify network configuration in docker-compose.yml
- Check service URLs in environment variables
- Ensure services are on same network

### File upload fails
- Check volume mounts
- Verify file size limits
- Check disk space

### Pipeline hangs
- Check orchestrator logs for errors
- Verify all services are healthy
- Check timeout settings

## Performance Considerations

- **Diarization**: CPU-intensive, may need GPU in production
- **Stem Generation**: Very CPU-intensive, benefits from GPU
- **Lipsync**: Moderate CPU usage
- **Renderer**: Memory-intensive, needs sufficient RAM
- **Mux**: I/O-intensive, needs fast disk

## Security Considerations

- File upload validation (type, size)
- Input sanitization
- Rate limiting (future)
- Authentication (future)
- HTTPS in production
- Secret management (future)

## Future Enhancements

- [ ] Real ML model integration
- [ ] Database for persistent storage
- [ ] Job queue with Redis
- [ ] WebSocket for real-time updates
- [ ] User authentication
- [ ] Video preview
- [ ] Multiple output formats
- [ ] Cloud storage integration
- [ ] Horizontal scaling
- [ ] Kubernetes deployment
