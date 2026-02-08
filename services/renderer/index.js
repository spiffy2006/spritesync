const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5004;

app.use(express.json());

let browser = null;

// Initialize browser on startup
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  console.log('Puppeteer browser initialized');
}

initBrowser().catch(console.error);

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'renderer' });
});

app.post('/process', async (req, res) => {
  try {
    const { jobId, configId, spriteFiles, lipsyncData, speakerSegments } = req.body;
    
    console.log(`Processing rendering for job ${jobId}`);
    
    // Simulate frame rendering
    // In a real implementation, this would:
    // 1. Create an HTML canvas scene
    // 2. Position sprites based on speaker data
    // 3. Animate sprites based on lipsync keyframes
    // 4. Capture each frame as an image
    // 5. Save frames to disk
    
    const outputDir = `/app/output/${jobId}`;
    
    // Simulate rendering time
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Mock result
    const result = {
      jobId,
      frames: `${outputDir}/frames`,
      frameCount: 900, // 30 seconds at 30fps
      fps: 30,
      resolution: '1920x1080',
      processedAt: Date.now()
    };
    
    console.log(`Rendering completed for job ${jobId}`);
    
    res.json(result);
  } catch (error) {
    console.error('Error in rendering:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Renderer service running on port ${PORT}`);
});
