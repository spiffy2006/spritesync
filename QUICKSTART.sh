#!/bin/bash

# Quick Start Guide for SpriteSync

echo "================================"
echo "SpriteSync Quick Start Guide"
echo "================================"
echo ""

echo "Step 1: Build all services (this may take 5-10 minutes)"
echo "  docker compose build"
echo ""

echo "Step 2: Start all services"
echo "  docker compose up -d"
echo ""

echo "Step 3: Check service health"
echo "  docker compose ps"
echo ""

echo "Step 4: View logs"
echo "  docker compose logs -f web-ui"
echo ""

echo "Step 5: Access the web UI"
echo "  Open http://localhost:3000 in your browser"
echo ""

echo "Step 6: To stop all services"
echo "  docker compose down"
echo ""

echo "Step 7: To stop and remove volumes (clean slate)"
echo "  docker compose down -v"
echo ""

echo "================================"
echo "Service Architecture"
echo "================================"
echo "web-ui:        http://localhost:3000 (Web Interface & API)"
echo "orchestrator:  http://localhost:4000 (Job Coordinator)"
echo "diarization:   Internal service (Port 5000)"
echo "speaker-id:    Internal service (Port 5001)"
echo "stem-generator: Internal service (Port 5002)"
echo "lipsync:       Internal service (Port 5003)"
echo "renderer:      Internal service (Port 5004)"
echo "mux:           Internal service (Port 5005)"
echo ""

echo "================================"
echo "Testing Individual Services"
echo "================================"
echo "# Test web-ui health"
echo "curl http://localhost:3000/api/health"
echo ""
echo "# Test orchestrator health"
echo "curl http://localhost:4000/api/health"
echo ""

echo "================================"
echo "Troubleshooting"
echo "================================"
echo "# View logs for a specific service"
echo "docker compose logs <service-name>"
echo ""
echo "# Restart a specific service"
echo "docker compose restart <service-name>"
echo ""
echo "# Rebuild a specific service"
echo "docker compose build <service-name>"
echo ""
