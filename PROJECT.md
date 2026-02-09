# Project Context: Containerized Podcast-to-Video Render System

## Project Goal

Build a local-first, containerized system that converts podcast audio into a full-length animated video using sprite-based lip sync.

This system is a **batch media compiler**, not a video editor.
Humans configure inputs; machines produce video.
No manual timelines, no real-time playback, no UI-based editing.

---

## Core Capabilities

- Generate a podcast-length video (e.g. 60–120 minutes)
- Animate multiple on-screen characters (e.g. 4-panel layout)
- Lip sync characters to speech using phoneme/viseme timing
- Support both new and legacy podcast episodes
- Fully automated, deterministic, reproducible

---

## Supported Modes

### 1. Multitrack Mode (Future Episodes)

- Input: one mono WAV file per speaker
- All WAVs:
  - same sample rate
  - same start time (t = 0)
  - same duration (silence allowed)
- No diarization
- Each WAV is authoritative for that speaker

### 2. Legacy Mode (Past Episodes)

- Input: a single mixed mono WAV
- Required steps:
  1. Speaker diarization
  2. Speaker identification (map diarized speakers → known hosts)
  3. Pseudo-stem generation:
     - one WAV per speaker
     - silence outside assigned segments
     - same length and alignment as original audio
- After pseudo-stem generation, legacy mode must be identical to multitrack mode for all downstream steps

---

## Determinism Requirements

- Identical inputs must produce identical outputs
- No wall-clock timing
- No real-time audio playback
- Animation driven only by:
  - explicit timestamps
  - frame index
- No requestAnimationFrame timing dependence

---

## Architecture Overview

The system is composed of **independent Dockerized services** coordinated by an orchestrator.

Each service:
- has its own Dockerfile
- exposes a minimal HTTP API
- performs exactly one responsibility

---

## Required Services

1. **Web UI (Control Plane)**
2. **Orchestrator**
3. **Diarization Service** (legacy mode only)
4. **Speaker Identification Service** (legacy mode only)
5. **Stem Generator Service**
6. **Lip Sync Service**
7. **Renderer Service (Headless Browser)**
8. **Video Mux Service (FFmpeg)**

---

## Service Responsibilities

### Web UI (Control Plane)

Responsibilities:
- Upload audio assets and sprite assets
- Define and store:
  - speakers
  - sprite sets
  - render configurations
  - episode configurations
- Trigger render jobs via orchestrator
- Display job status and logs

Non-responsibilities:
- No rendering
- No audio processing
- No ML inference
- No timeline editing
- No waveform manipulation

---

### Orchestrator

- Entry point for render jobs
- Decides pipeline path (multitrack vs legacy)
- Calls services in correct order
- Validates outputs between stages
- Tracks job state
- Contains no ML, audio DSP, or rendering logic

---

### Diarization Service (Legacy)

Technology:
- Python
- pyannote.audio

Responsibilities:
- Perform speaker diarization on a mixed WAV
- Handle overlapping speech
- Output:
  - time segments
  - diarized speaker IDs
  - speaker embeddings

Must run offline.

---

### Speaker Identification Service

Responsibilities:
- Match diarized speaker embeddings to known speaker profiles
- Output mapping:
  - diarized speaker ID → speaker name
  - confidence score

Failure policy:
- If confidence < threshold, fail loudly
- No silent fallback or guessing

---

### Stem Generator Service

Responsibilities:
- Generate normalized per-speaker WAV files
- Preserve original timing and duration
- Insert silence where speaker is inactive

Output:
- One WAV per speaker
- All WAVs share:
  - sample rate
  - start time
  - duration

---

### Lip Sync Service

Technology:
- Rhubarb Lip Sync (CLI)

Responsibilities:
- Convert WAV → phoneme/viseme timing data
- Deterministic execution
- Output machine-readable timing data (JSON)

---

## Renderer Service (Headless Browser)

Technology:
- Chromium
- Playwright or Puppeteer
- HTML5 Canvas / WebGL

Core Rendering Engine:
- Based on the open-source browser project:
  https://github.com/Amoner/lipsync-engine

Responsibilities:
- Load sprite assets and viseme timing data
- Animate characters deterministically
- Fixed layout (e.g. four-panel grid)
- No real-time playback
- Support frame-by-frame time stepping

Rendering Model:
- Global clock driven by frame index
- Explicit time → viseme mapping
- No dependency on browser wall-clock timing

Output:
- Sequential image frames (PNG)

---

## Video Mux Service

Technology:
- FFmpeg

Responsibilities:
- Combine rendered frames with final audio
- Produce a single MP4 file

Defaults:
- Video codec: H.264
- Audio codec: AAC
- Frame rate: configurable (default 30fps)
- Resolution: configurable (default 1920x1080)

---

## Storage Model (Mounted Volumes)

- `/assets` – uploaded audio and sprites
- `/profiles` – speaker embeddings
- `/cache` – diarization and lip-sync outputs
- `/outputs` – final rendered videos

Expensive steps (diarization, lip sync) must be cacheable.

---

## Web UI Data Model

The UI must persist:
- Episodes
- Speakers
- Sprite sets
- Render configurations
- Render job history

Each render job must be reproducible using stored configuration and asset hashes.

---

## Failure Policy

The system must fail loudly when:
- Required inputs are missing
- Speaker identification confidence is too low
- Audio durations mismatch
- Services return malformed output
- Rendering stalls or drops frames

Silent failure is unacceptable.

---

## Non-Goals

- No live rendering
- No real-time preview
- No facial tracking
- No AI-generated animation
- No timeline-based editing UI

---

## Summary

This project is a **deterministic, containerized media compiler**.

Audio goes in.
A video comes out.

Humans configure.
Containers compute.

No timelines.
No guessing.
No magic.
