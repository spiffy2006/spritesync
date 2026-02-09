const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Service URLs
const DIARIZATION_URL = process.env.DIARIZATION_URL || 'http://diarization:5000';
const SPEAKER_ID_URL = process.env.SPEAKER_ID_URL || 'http://speaker-id:5001';
const STEM_GENERATOR_URL = process.env.STEM_GENERATOR_URL || 'http://stem-generator:5002';
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

// Pipeline modes
const PipelineMode = {
  LEGACY: 'legacy',      // Single mixed WAV - requires diarization
  MULTITRACK: 'multitrack' // Multiple WAV files - one per speaker
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'orchestrator' });
});

// Detect pipeline mode based on job data
function detectPipelineMode(job) {
  // If multiple audio files provided, it's multitrack mode
  if (job.audioFiles && Array.isArray(job.audioFiles) && job.audioFiles.length > 1) {
    return PipelineMode.MULTITRACK;
  }
  // If single audio file, it's legacy mode
  if (job.audioFileId) {
    return PipelineMode.LEGACY;
  }
  // Default to legacy if unclear
  return PipelineMode.LEGACY;
}

// Create a new job
app.post('/api/jobs', async (req, res) => {
  try {
    const { configId, audioFileId, audioFiles, spriteFiles, spriteMappings } = req.body;
    
    // Validate input
    if (!audioFileId && (!audioFiles || audioFiles.length === 0)) {
      return res.status(400).json({ error: 'audioFileId or audioFiles is required' });
    }
    
    const jobId = uuidv4();
    const job = {
      id: jobId,
      configId,
      audioFileId,  // For legacy mode
      audioFiles,   // For multitrack mode
      spriteFiles: spriteFiles || [], // Keep for backward compatibility
      spriteMappings: spriteMappings || {}, // New organized sprite mappings
      status: JobStatus.PENDING,
      mode: null,  // Will be set during pipeline processing
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pipeline: {
        diarization: { status: 'pending', result: null },
        speakerId: { status: 'pending', result: null },
        stemGenerator: { status: 'pending', result: null },
        renderer: { status: 'pending', result: null },
        mux: { status: 'pending', result: null }
      }
    };
    
    // Detect mode
    job.mode = detectPipelineMode(job);
    console.log(`Job ${jobId} detected mode: ${job.mode}`);
    
    jobs.set(jobId, job);
    
    // Start the pipeline asynchronously
    processPipeline(jobId).catch(err => {
      console.error(`Pipeline error for job ${jobId}:`, err);
      updateJobStatus(jobId, JobStatus.FAILED, { error: err.message });
    });
    
    res.json({
      success: true,
      jobId,
      status: job.status,
      mode: job.mode
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

// Retry a failed job
app.post('/api/jobs/:jobId/retry', async (req, res) => {
  try {
    const originalJobId = req.params.jobId;
    const originalJob = jobs.get(originalJobId);
    
    if (!originalJob) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Create a new job with the same parameters
    const newJobId = uuidv4();
    const newJob = {
      id: newJobId,
      configId: originalJob.configId,
      audioFileId: originalJob.audioFileId,
      audioFiles: originalJob.audioFiles,
      spriteFiles: originalJob.spriteFiles || [],
      spriteMappings: originalJob.spriteMappings || {},
      status: JobStatus.PENDING,
      mode: originalJob.mode || detectPipelineMode(originalJob),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pipeline: {
        diarization: { status: 'pending', result: null },
        speakerId: { status: 'pending', result: null },
        stemGenerator: { status: 'pending', result: null },
        renderer: { status: 'pending', result: null },
        mux: { status: 'pending', result: null }
      }
    };
    
    jobs.set(newJobId, newJob);
    
    // Start processing the new job
    processPipeline(newJobId).catch(err => {
      console.error(`Pipeline error for retried job ${newJobId}:`, err);
      updateJobStatus(newJobId, JobStatus.FAILED, { error: err.message });
    });
    
    res.json({
      success: true,
      jobId: newJobId,
      originalJobId: originalJobId,
      status: newJob.status,
      mode: newJob.mode
    });
  } catch (error) {
    console.error('Error retrying job:', error);
    res.status(500).json({ error: error.message });
  }
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
  
  // Ensure mode is set
  if (!job.mode) {
    job.mode = detectPipelineMode(job);
  }
  
  console.log(`Starting ${job.mode} mode pipeline for job ${jobId}`);
  
  try {
    let diarizationResult = null;
    let speakerIdResult = null;
    let stemResult = null;
    
    if (job.mode === PipelineMode.LEGACY) {
      // Legacy mode: single mixed WAV requires diarization and speaker ID
      
      // Step 1: Diarization - identify when each speaker is talking
      updateJobStatus(jobId, JobStatus.DIARIZING);
      updatePipelineStage(jobId, 'diarization', 'processing');
      
      // Check cache first
      diarizationResult = await getCachedDiarization(job.audioFileId);
      
      if (diarizationResult) {
        console.log(`Using cached diarization result for job ${jobId}`);
      } else {
        // Call service if not cached
        diarizationResult = await callService(DIARIZATION_URL, '/process', {
          jobId,
          audioFileId: job.audioFileId
        });
        // Save to cache
        await saveCachedDiarization(job.audioFileId, diarizationResult);
      }
      
      updatePipelineStage(jobId, 'diarization', 'completed', diarizationResult);
      
      // Step 2: Speaker Identification - match diarized segments to specific speakers
      updateJobStatus(jobId, JobStatus.IDENTIFYING_SPEAKERS);
      updatePipelineStage(jobId, 'speakerId', 'processing');
      speakerIdResult = await callService(SPEAKER_ID_URL, '/process', {
        jobId,
        diarizationResult,
        audioFileId: job.audioFileId
      });
      updatePipelineStage(jobId, 'speakerId', 'completed', speakerIdResult);
      
      // Step 3: Stem Generation - create pseudo-stems (one WAV per speaker)
      updateJobStatus(jobId, JobStatus.GENERATING_STEMS);
      updatePipelineStage(jobId, 'stemGenerator', 'processing');
      stemResult = await callService(STEM_GENERATOR_URL, '/process', {
        jobId,
        audioFileId: job.audioFileId,
        speakerSegments: speakerIdResult
      });
      updatePipelineStage(jobId, 'stemGenerator', 'completed', stemResult);
      
    } else if (job.mode === PipelineMode.MULTITRACK) {
      // Multitrack mode: multiple WAV files, one per speaker
      // Skip diarization and speaker ID, but still need to create speaker segments
      // For now, we'll mark these as skipped
      updatePipelineStage(jobId, 'diarization', 'skipped', { reason: 'multitrack mode - not needed' });
      updatePipelineStage(jobId, 'speakerId', 'skipped', { reason: 'multitrack mode - speakers already known' });
      
      // In multitrack mode, stems are the input files themselves
      // We'll need to map audioFiles to speaker names
      // For now, this is a placeholder - full implementation would require speaker mapping
      stemResult = {
        stems: {},
        // Map audioFiles to stems
      };
      updatePipelineStage(jobId, 'stemGenerator', 'skipped', { reason: 'multitrack mode - using input files as stems' });
      
      // TODO: Create speaker segments from multitrack files
      speakerIdResult = {
        identifiedSegments: [] // Would be populated from multitrack files
      };
    }
    
    // Step 4: Render - create video frames with sprites (lipsync-engine handles audio-to-viseme)
    updateJobStatus(jobId, JobStatus.RENDERING);
    updatePipelineStage(jobId, 'renderer', 'processing');
    const renderResult = await callService(RENDERER_URL, '/process', {
      jobId,
      configId: job.configId,
      spriteFiles: job.spriteFiles, // Keep for backward compatibility
      spriteMappings: job.spriteMappings, // New organized sprite mappings
      speakerSegments: speakerIdResult,
      stems: stemResult ? stemResult.stems : null,
      audioFileId: job.audioFileId,
      audioFiles: job.audioFiles
    });
    updatePipelineStage(jobId, 'renderer', 'completed', renderResult);
    
    // Step 5: Mux - combine video frames with audio using FFmpeg
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
    
    console.log(`Pipeline completed for job ${jobId} (${job.mode} mode)`);
  } catch (error) {
    console.error(`Pipeline failed for job ${jobId}:`, error);
    updateJobStatus(jobId, JobStatus.FAILED, {
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

// Cache directory (mounted volume)
const CACHE_DIR = '/app/cache';

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.warn('Could not create cache directory:', error.message);
  }
}

// Compute SHA-256 hash of file
async function computeFileHash(filePath) {
  try {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch (error) {
    console.error(`Error computing hash for ${filePath}:`, error.message);
    return null;
  }
}

// Check cache for diarization result
async function getCachedDiarization(audioFileId) {
  try {
    const audioPath = `/app/uploads/${audioFileId}`;
    const hash = await computeFileHash(audioPath);
    if (!hash) return null;
    
    const cachePath = path.join(CACHE_DIR, 'diarization', `${hash}.json`);
    const cacheData = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(cacheData);
  } catch (error) {
    // Cache miss or error - return null
    return null;
  }
}

// Save diarization result to cache
async function saveCachedDiarization(audioFileId, result) {
  try {
    const audioPath = `/app/uploads/${audioFileId}`;
    const hash = await computeFileHash(audioPath);
    if (!hash) return;
    
    const cacheDir = path.join(CACHE_DIR, 'diarization');
    await fs.mkdir(cacheDir, { recursive: true });
    
    const cachePath = path.join(cacheDir, `${hash}.json`);
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2));
    console.log(`Cached diarization result: ${cachePath}`);
  } catch (error) {
    console.warn('Could not save diarization cache:', error.message);
  }
}

// Helper to call downstream services
async function callService(baseUrl, endpoint, data, customTimeout = null) {
  try {
    console.log(`Calling ${baseUrl}${endpoint}`);
    
    // Service-specific timeouts (in milliseconds)
    // Renderer can take a very long time for many frames, so give it much more time
    const serviceTimeouts = {
      [RENDERER_URL]: 1800000,  // 30 minutes for renderer (rendering can be slow)
      [MUX_URL]: 600000,         // 10 minutes for mux (video encoding can be slow)
      default: 300000            // 5 minutes for other services
    };
    
    // Determine timeout: custom > service-specific > default
    let timeout = customTimeout;
    if (!timeout) {
      timeout = serviceTimeouts[baseUrl] || serviceTimeouts.default;
    }
    
    const response = await axios.post(`${baseUrl}${endpoint}`, data, {
      timeout: timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Error calling ${baseUrl}${endpoint}:`, error.message);
    throw new Error(`Service call failed: ${baseUrl}${endpoint} - ${error.message}`);
  }
}

// Initialize cache directory on startup
ensureCacheDir().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Orchestrator service running on port ${PORT}`);
    console.log('Connected services:');
    console.log(`  - Diarization: ${DIARIZATION_URL}`);
    console.log(`  - Speaker ID: ${SPEAKER_ID_URL}`);
    console.log(`  - Stem Generator: ${STEM_GENERATOR_URL}`);
    console.log(`  - Renderer: ${RENDERER_URL}`);
    console.log(`  - Mux: ${MUX_URL}`);
  });
});
