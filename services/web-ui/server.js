const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://orchestrator:4000';
const SPEAKER_ID_URL = process.env.SPEAKER_ID_URL || 'http://speaker-id:5001';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads, configs, and profiles directories exist
const UPLOADS_DIR = '/app/uploads';
const CONFIGS_DIR = '/app/configs';
const PROFILES_DIR = '/app/profiles';
[UPLOADS_DIR, CONFIGS_DIR, PROFILES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'web-ui' });
});

// Upload audio file
app.post('/api/upload/audio', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    res.json({
      success: true,
      fileId: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      path: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload sprite/image file
app.post('/api/upload/sprite', upload.single('sprite'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No sprite file provided' });
    }
    
    const speakerName = req.body.speakerName || 'Unknown';
    const viseme = req.body.viseme || 'default';
    
    res.json({
      success: true,
      fileId: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      path: `/uploads/${req.file.filename}`,
      speakerName: speakerName,
      viseme: viseme
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload multiple sprites
app.post('/api/upload/sprites', upload.array('sprites', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No sprite files provided' });
    }
    const files = req.files.map(file => ({
      fileId: file.filename,
      originalName: file.originalname,
      size: file.size,
      path: `/uploads/${file.filename}`
    }));
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save job configuration
// NOTE: Rate limiting should be added in production (e.g., express-rate-limit)
app.post('/api/config', (req, res) => {
  try {
    const configId = uuidv4();
    const config = {
      id: configId,
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    const configPath = path.join(CONFIGS_DIR, `${configId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    res.json({ success: true, configId, config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get configuration
// NOTE: Rate limiting should be added in production (e.g., express-rate-limit)
app.get('/api/config/:configId', (req, res) => {
  try {
    const configPath = path.join(CONFIGS_DIR, `${req.params.configId}.json`);
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all configurations
// NOTE: Rate limiting should be added in production (e.g., express-rate-limit)
app.get('/api/configs', (req, res) => {
  try {
    const files = fs.readdirSync(CONFIGS_DIR);
    const configs = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const content = fs.readFileSync(path.join(CONFIGS_DIR, f), 'utf8');
        return JSON.parse(content);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger job via orchestrator
app.post('/api/jobs/trigger', async (req, res) => {
  try {
    const { configId, audioFileId, spriteFiles, spriteMappings } = req.body;
    
    if (!configId || !audioFileId) {
      return res.status(400).json({ error: 'configId and audioFileId are required' });
    }
    
    // Forward to orchestrator
    const response = await axios.post(`${ORCHESTRATOR_URL}/api/jobs`, {
      configId,
      audioFileId,
      spriteFiles: spriteFiles || [], // Keep for backward compatibility
      spriteMappings: spriteMappings || {}, // New organized sprite mappings
      triggeredAt: new Date().toISOString()
    });
    
    res.json({
      success: true,
      jobId: response.data.jobId,
      status: response.data.status
    });
  } catch (error) {
    console.error('Error triggering job:', error.message);
    res.status(500).json({ 
      error: 'Failed to trigger job',
      details: error.response?.data || error.message 
    });
  }
});

// Get job status (proxy to orchestrator)
app.get('/api/jobs/:jobId', async (req, res) => {
  try {
    const response = await axios.get(`${ORCHESTRATOR_URL}/api/jobs/${req.params.jobId}`);
    res.json(response.data);
  } catch (error) {
    console.error('Error getting job status:', error.message);
    res.status(500).json({ 
      error: 'Failed to get job status',
      details: error.response?.data || error.message 
    });
  }
});

// List all jobs (proxy to orchestrator)
app.get('/api/jobs', async (req, res) => {
  try {
    const response = await axios.get(`${ORCHESTRATOR_URL}/api/jobs`);
    res.json(response.data);
  } catch (error) {
    console.error('Error listing jobs:', error.message);
    res.status(500).json({ 
      error: 'Failed to list jobs',
      details: error.response?.data || error.message 
    });
  }
});

// Retry a failed job (proxy to orchestrator)
app.post('/api/jobs/:jobId/retry', async (req, res) => {
  try {
    const response = await axios.post(`${ORCHESTRATOR_URL}/api/jobs/${req.params.jobId}/retry`);
    res.json(response.data);
  } catch (error) {
    console.error('Error retrying job:', error.message);
    res.status(500).json({ 
      error: 'Failed to retry job',
      details: error.response?.data || error.message 
    });
  }
});

// Upload speaker profile
app.post('/api/upload/profile', upload.single('profile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No profile file provided' });
    }
    
    // Extract speaker name from filename or request body
    const speakerName = req.body.speakerName || path.parse(req.file.originalname).name;
    
    // Rename file to speaker name with appropriate extension
    const extension = path.extname(req.file.filename);
    const profileFilename = `${speakerName}${extension}`;
    const profilePath = path.join(PROFILES_DIR, profileFilename);
    
    // Move file to profiles directory
    fs.renameSync(req.file.path, profilePath);
    
    res.json({
      success: true,
      speakerName,
      filename: profileFilename,
      path: `/profiles/${profileFilename}`,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all speaker profiles
app.get('/api/profiles', (req, res) => {
  try {
    const files = fs.readdirSync(PROFILES_DIR);
    const profiles = files
      .filter(f => f.endsWith('.pkl') || f.endsWith('.json'))
      .map(f => {
        const speakerName = path.parse(f).name;
        const filePath = path.join(PROFILES_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          speakerName,
          filename: f,
          size: stats.size,
          uploadedAt: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => a.speakerName.localeCompare(b.speakerName));
    res.json(profiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete speaker profile
app.delete('/api/profiles/:speakerName', (req, res) => {
  try {
    const speakerName = req.params.speakerName;
    
    // Try both .pkl and .json extensions
    let deleted = false;
    for (const ext of ['.pkl', '.json']) {
      const profilePath = path.join(PROFILES_DIR, `${speakerName}${ext}`);
      if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
        deleted = true;
        break;
      }
    }
    
    if (!deleted) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json({ success: true, speakerName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create speaker profile from audio sample (proxy to speaker-id service)
app.post('/api/profiles/create', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    const speakerName = req.body.speakerName || req.body.speaker_name;
    if (!speakerName) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Speaker name is required' });
    }
    
    // Forward to speaker-id service
    const formData = new FormData();
    formData.append('audio', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    formData.append('speakerName', speakerName);
    
    try {
      const response = await axios.post(`${SPEAKER_ID_URL}/api/create-profile`, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.json(response.data);
    } catch (error) {
      // Clean up uploaded file on error
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      console.error('Error from speaker-id service:', error.response?.data || error.message);
      throw error;
    }
  } catch (error) {
    console.error('Error creating profile from audio:', error.message);
    res.status(500).json({ 
      error: 'Failed to create profile from audio',
      details: error.response?.data || error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web UI server running on port ${PORT}`);
  console.log(`Orchestrator URL: ${ORCHESTRATOR_URL}`);
});
