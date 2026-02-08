const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;

// Service URLs
const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:5000';
const SPEAKER_ID_URL = process.env.SPEAKER_ID_URL || 'http://speaker-id:5001';
const STEM_GENERATOR_URL = process.env.STEM_GENERATOR_URL || 'http://stem-generator:5002';
const LIPSYNC_URL = process.env.LIPSYNC_URL || 'http://lipsync:5003';
const RENDERER_URL = process.env.RENDERER_URL || 'http://renderer:5004';
const MUX_URL = process.env.MUX_URL || 'http://mux:5005';

app.use(express.json());

// In-memory job store (in production, use a database)
const jobs = new Map();

// Job status enum
const JobStatus = {
  PENDING: 'pending',
  DIARIZING: 'diarizing',
  IDENTIFYING_SPEAKERS: 'identifying_speakers',
  GENERATING_STEMS: 'generating_stems',
  LIPSYNCING: 'lipsyncing',
  RENDERING: 'rendering',
  MUXING: 'muxing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'orchestrator' });
});

// Create a new job
app.post('/api/jobs', async (req, res) => {
  try {
    const { configId, audioFileId, spriteFiles } = req.body;
    
    const jobId = uuidv4();
    const job = {
      id: jobId,
      configId,
      audioFileId,
      spriteFiles,
      status: JobStatus.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pipeline: {
        diarization: { status: 'pending', result: null },
        speakerId: { status: 'pending', result: null },
        stemGenerator: { status: 'pending', result: null },
        lipsync: { status: 'pending', result: null },
        renderer: { status: 'pending', result: null },
        mux: { status: 'pending', result: null }
      }
    };
    
    jobs.set(jobId, job);
    
    // Start the pipeline asynchronously
    processPipeline(jobId).catch(err => {
      console.error(`Pipeline error for job ${jobId}:`, err);
      updateJobStatus(jobId, JobStatus.FAILED, { error: err.message });
    });
    
    res.json({
      success: true,
      jobId,
      status: job.status
    });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(jobs.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobList);
});

// Update job status helper
function updateJobStatus(jobId, status, additionalData = {}) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    Object.assign(job, additionalData);
    jobs.set(jobId, job);
  }
}

// Update pipeline stage helper
function updatePipelineStage(jobId, stage, status, result = null) {
  const job = jobs.get(jobId);
  if (job) {
    job.pipeline[stage] = { status, result, updatedAt: new Date().toISOString() };
    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }
}

// Main pipeline processing
async function processPipeline(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  
  console.log(`Starting pipeline for job ${jobId}`);
  
  try {
    // Step 1: Diarization - identify when each speaker is talking
    updateJobStatus(jobId, JobStatus.DIARIZING);
    updatePipelineStage(jobId, 'diarization', 'processing');
    const diarizationResult = await callService(DIARIZATION_URL, '/process', {
      jobId,
      audioFileId: job.audioFileId
    });
    updatePipelineStage(jobId, 'diarization', 'completed', diarizationResult);
    
    // Step 2: Speaker Identification - match diarized segments to specific speakers
    updateJobStatus(jobId, JobStatus.IDENTIFYING_SPEAKERS);
    updatePipelineStage(jobId, 'speakerId', 'processing');
    const speakerIdResult = await callService(SPEAKER_ID_URL, '/process', {
      jobId,
      diarizationResult
    });
    updatePipelineStage(jobId, 'speakerId', 'completed', speakerIdResult);
    
    // Step 3: Stem Generation - separate audio into components if needed
    updateJobStatus(jobId, JobStatus.GENERATING_STEMS);
    updatePipelineStage(jobId, 'stemGenerator', 'processing');
    const stemResult = await callService(STEM_GENERATOR_URL, '/process', {
      jobId,
      audioFileId: job.audioFileId
    });
    updatePipelineStage(jobId, 'stemGenerator', 'completed', stemResult);
    
    // Step 4: Lipsync - generate lipsync data for each speaker
    updateJobStatus(jobId, JobStatus.LIPSYNCING);
    updatePipelineStage(jobId, 'lipsync', 'processing');
    const lipsyncResult = await callService(LIPSYNC_URL, '/process', {
      jobId,
      speakerSegments: speakerIdResult,
      audioFileId: job.audioFileId
    });
    updatePipelineStage(jobId, 'lipsync', 'completed', lipsyncResult);
    
    // Step 5: Render - create video frames with sprites
    updateJobStatus(jobId, JobStatus.RENDERING);
    updatePipelineStage(jobId, 'renderer', 'processing');
    const renderResult = await callService(RENDERER_URL, '/process', {
      jobId,
      configId: job.configId,
      spriteFiles: job.spriteFiles,
      lipsyncData: lipsyncResult,
      speakerSegments: speakerIdResult
    });
    updatePipelineStage(jobId, 'renderer', 'completed', renderResult);
    
    // Step 6: Mux - combine video frames with audio using FFmpeg
    updateJobStatus(jobId, JobStatus.MUXING);
    updatePipelineStage(jobId, 'mux', 'processing');
    const muxResult = await callService(MUX_URL, '/process', {
      jobId,
      videoFrames: renderResult.frames,
      audioFileId: job.audioFileId
    });
    updatePipelineStage(jobId, 'mux', 'completed', muxResult);
    
    // Job complete!
    updateJobStatus(jobId, JobStatus.COMPLETED, {
      outputVideo: muxResult.outputVideo
    });
    
    console.log(`Pipeline completed for job ${jobId}`);
  } catch (error) {
    console.error(`Pipeline failed for job ${jobId}:`, error);
    updateJobStatus(jobId, JobStatus.FAILED, {
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

// Helper to call downstream services
async function callService(baseUrl, endpoint, data) {
  try {
    console.log(`Calling ${baseUrl}${endpoint}`);
    const response = await axios.post(`${baseUrl}${endpoint}`, data, {
      timeout: 300000 // 5 minute timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Error calling ${baseUrl}${endpoint}:`, error.message);
    throw new Error(`Service call failed: ${baseUrl}${endpoint} - ${error.message}`);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Orchestrator service running on port ${PORT}`);
  console.log('Connected services:');
  console.log(`  - Diarization: ${DIARIZATION_URL}`);
  console.log(`  - Speaker ID: ${SPEAKER_ID_URL}`);
  console.log(`  - Stem Generator: ${STEM_GENERATOR_URL}`);
  console.log(`  - Lipsync: ${LIPSYNC_URL}`);
  console.log(`  - Renderer: ${RENDERER_URL}`);
  console.log(`  - Mux: ${MUX_URL}`);
});
