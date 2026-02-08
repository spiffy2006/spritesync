const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://orchestrator:4000';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads and configs directories exist
const UPLOADS_DIR = '/app/uploads';
const CONFIGS_DIR = '/app/configs';
[UPLOADS_DIR, CONFIGS_DIR].forEach(dir => {
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
    const { configId, audioFileId, spriteFiles } = req.body;
    
    if (!configId || !audioFileId) {
      return res.status(400).json({ error: 'configId and audioFileId are required' });
    }
    
    // Forward to orchestrator
    const response = await axios.post(`${ORCHESTRATOR_URL}/api/jobs`, {
      configId,
      audioFileId,
      spriteFiles: spriteFiles || [],
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web UI server running on port ${PORT}`);
  console.log(`Orchestrator URL: ${ORCHESTRATOR_URL}`);
});
