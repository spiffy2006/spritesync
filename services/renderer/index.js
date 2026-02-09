const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5004;

app.use(express.json());

const UPLOADS_DIR = '/app/uploads';
const OUTPUTS_DIR = '/app/outputs';

// Default settings
const DEFAULT_FPS = 30;
const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };

let browser = null;

// Initialize browser on startup
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: true,
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

// Generate HTML for deterministic rendering
function generateRenderHTML(speakers, fps, resolution) {
  const speakerCount = speakers.length;
  const gridCols = Math.ceil(Math.sqrt(speakerCount));
  const gridRows = Math.ceil(speakerCount / gridCols);
  const panelWidth = resolution.width / gridCols;
  const panelHeight = resolution.height / gridRows;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      width: ${resolution.width}px;
      height: ${resolution.height}px;
      background: #1a1a1a;
      overflow: hidden;
    }
    #canvas {
      width: ${resolution.width}px;
      height: ${resolution.height}px;
    }
  </style>
</head>
<body>
  <canvas id="canvas" width="${resolution.width}" height="${resolution.height}"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const fps = ${fps};
    const frameTime = 1.0 / fps;
    
    // Speaker data
    const speakers = ${JSON.stringify(speakers)};
    const gridCols = ${gridCols};
    const gridRows = ${gridRows};
    const panelWidth = ${panelWidth};
    const panelHeight = ${panelHeight};
    
    // Sprite images (loaded by renderer)
    const spriteImages = {};
    
    // Lipsync-engine integration
    // This will be populated with viseme data from lipsync-engine
    const visemeData = {};
    
    // Deterministic rendering - frame index to time
    function getTimeFromFrame(frameIndex) {
      return frameIndex * frameTime;
    }
    
    // Get active speakers at a given time
    function getActiveSpeakers(time) {
      return speakers.filter(speaker => {
        return speaker.segments.some(seg => 
          time >= seg.start && time <= seg.end
        );
      });
    }
    
    // Get viseme for speaker at time (from lipsync-engine)
    function getViseme(speakerName, time) {
      if (!window.visemeData || !window.visemeData[speakerName]) {
        return 'rest';
      }
      const visemes = window.visemeData[speakerName];
      if (!visemes || visemes.length === 0) {
        return 'rest';
      }
      // Find the most recent viseme at or before this time
      for (let i = visemes.length - 1; i >= 0; i--) {
        if (time >= visemes[i].time) {
          return visemes[i].viseme;
        }
      }
      // If time is before first viseme, return first viseme
      if (visemes.length > 0 && time < visemes[0].time) {
        return visemes[0].viseme;
      }
      return 'rest';
    }
    
    // Render a single frame
    function renderFrame(frameIndex) {
      const time = getTimeFromFrame(frameIndex);
      
      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Render each speaker panel
      speakers.forEach((speaker, index) => {
        const col = index % gridCols;
        const row = Math.floor(index / gridCols);
        const x = col * panelWidth;
        const y = row * panelHeight;
        
        // Check if speaker is active at this time
        const isActive = speaker.segments.some(seg => 
          time >= seg.start && time <= seg.end
        );
        
        // Determine which viseme to use
        let viseme = 'rest'; // Default to rest
        if (isActive) {
          // Get viseme from lipsync-engine when active
          viseme = getViseme(speaker.name, time);
        }
        // When inactive, always use 'rest'
        
        // Draw sprite with appropriate viseme
        // Try exact match first, then fallback to 'rest', then 'default'
        const spriteKey = speaker.name + '_' + viseme;
        let sprite = window.spriteImages[spriteKey];
        if (!sprite && viseme !== 'rest') {
          // Fallback to rest if specific viseme not found
          sprite = window.spriteImages[speaker.name + '_rest'];
        }
        if (!sprite) {
          sprite = window.spriteImages[speaker.name + '_default'];
        }
        
        if (sprite) {
          ctx.drawImage(sprite, x, y, panelWidth, panelHeight);
        } else {
          // Fallback: draw speaker name and viseme for debugging
          ctx.fillStyle = '#ffffff';
          ctx.font = '48px Arial';
          ctx.textAlign = 'center';
          const status = isActive ? 'active' : 'inactive';
          ctx.fillText(speaker.name + ' (' + viseme + ', ' + status + ')', x + panelWidth / 2, y + panelHeight / 2);
        }
      });
    }
    
    // Export render function for puppeteer
    window.renderFrame = renderFrame;
  </script>
</body>
</html>
  `;
}

app.post('/process', async (req, res) => {
  try {
    const { 
      jobId, 
      configId, 
      spriteFiles, 
      spriteMappings,
      speakerSegments, 
      stems,
      audioFileId,
      fps = DEFAULT_FPS,
      resolution = '1920x1080'
    } = req.body;
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    
    if (!speakerSegments || !speakerSegments.identifiedSegments) {
      return res.status(400).json({ error: 'speakerSegments with identifiedSegments is required' });
    }
    
    console.log(`Processing rendering for job ${jobId}`);
    
    // Parse resolution
    const [width, height] = resolution.split('x').map(Number);
    const resolutionObj = { width, height };
    
    // Create output directory
    const outputDir = path.join(OUTPUTS_DIR, jobId, 'frames');
    await fs.mkdir(outputDir, { recursive: true });
    
    // Organize speakers and their segments
    const speakerMap = new Map();
    const identifiedSegments = speakerSegments.identifiedSegments || [];
    
    identifiedSegments.forEach(seg => {
      const speakerName = seg.speakerName;
      if (!speakerMap.has(speakerName)) {
        speakerMap.set(speakerName, {
          name: speakerName,
          segments: [],
          audioFile: stems && stems[speakerName] ? stems[speakerName] : null
        });
      }
      speakerMap.get(speakerName).segments.push({
        start: seg.start,
        end: seg.end
      });
    });
    
    const speakers = Array.from(speakerMap.values());
    console.log(`Rendering ${speakers.length} speakers`);
    
    // Load sprite images with proper mapping
    const spriteImages = {};
    
    // Helper function to get MIME type from file extension
    const getMimeType = (filename) => {
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
      };
      return mimeTypes[ext] || 'image/png'; // Default to PNG if unknown
    };
    
    // Use spriteMappings if available (new organized format)
    if (spriteMappings && Object.keys(spriteMappings).length > 0) {
      for (const [speakerName, visemeMap] of Object.entries(spriteMappings)) {
        for (const [viseme, fileId] of Object.entries(visemeMap)) {
          const spritePath = path.join(UPLOADS_DIR, fileId);
          try {
            const spriteData = await fs.readFile(spritePath);
            const base64 = spriteData.toString('base64');
            const mimeType = getMimeType(fileId);
            const spriteKey = `${speakerName}_${viseme}`;
            spriteImages[spriteKey] = `data:${mimeType};base64,${base64}`;
            console.log(`Loaded sprite: ${spriteKey} from ${fileId} (${mimeType})`);
          } catch (error) {
            console.warn(`Could not load sprite ${fileId} for ${speakerName}_${viseme}: ${error.message}`);
          }
        }
      }
    } 
    // Fallback to old spriteFiles format for backward compatibility
    else if (spriteFiles && Array.isArray(spriteFiles)) {
      for (const spriteFile of spriteFiles) {
        const spritePath = path.join(UPLOADS_DIR, spriteFile);
        try {
          const spriteData = await fs.readFile(spritePath);
          const base64 = spriteData.toString('base64');
          const mimeType = getMimeType(spriteFile);
          spriteImages[spriteFile] = `data:${mimeType};base64,${base64}`;
        } catch (error) {
          console.warn(`Could not load sprite ${spriteFile}: ${error.message}`);
        }
      }
    }
    
    // Create page with render HTML
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    
    const html = generateRenderHTML(speakers, fps, resolutionObj);
    await page.setContent(html);
    
    // Load sprite images into page
    // Pass base64 data URLs to the page and load them in the browser context
    console.log(`Loading ${Object.keys(spriteImages).length} sprite images into page...`);
    await page.evaluate((imageData) => {
      window.spriteImages = {};
      const loadPromises = Object.entries(imageData).map(([key, dataUrl]) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            window.spriteImages[key] = img;
            console.log(`Loaded sprite: ${key}`);
            resolve();
          };
          img.onerror = () => {
            console.warn(`Failed to load sprite: ${key}`);
            resolve(); // Skip failed images
          };
          img.src = dataUrl;
        });
      });
      return Promise.all(loadPromises);
    }, spriteImages);
    console.log('Sprite images loaded');
    
    // Process audio files with lipsync-engine to get viseme data
    // For now, we'll need to integrate lipsync-engine here
    // This is a placeholder - actual integration would process audio files
    const visemeData = {};
    for (const speaker of speakers) {
      visemeData[speaker.name] = [];
      // Generate viseme data for each segment
      speaker.segments.forEach(seg => {
        const duration = seg.end - seg.start;
        // Generate viseme changes every 0.1 seconds (10 times per second)
        const visemeInterval = 0.1;
        let currentTime = seg.start;
        let visemeIndex = 0;
        
        while (currentTime < seg.end) {
          // Cycle through visemes: A, E, I, O, U, rest
          const visemes = ['A', 'E', 'I', 'O', 'U', 'rest'];
          visemeData[speaker.name].push({
            time: currentTime,
            viseme: visemes[visemeIndex % visemes.length]
          });
          currentTime += visemeInterval;
          visemeIndex++;
        }
      });
      
      // Sort visemes by time (important for binary search/lookup)
      visemeData[speaker.name].sort((a, b) => a.time - b.time);
      console.log(`Generated ${visemeData[speaker.name].length} viseme keyframes for ${speaker.name}`);
    }
    
    // Inject viseme data
    await page.evaluate((data) => {
      window.visemeData = data;
      console.log('Viseme data injected:', Object.keys(data));
      // Log first few visemes for debugging
      for (const [speaker, visemes] of Object.entries(data)) {
        if (visemes.length > 0) {
          console.log(`${speaker} first viseme:`, visemes[0], 'last:', visemes[visemes.length - 1]);
          // Log a sample of visemes to verify they're changing
          if (visemes.length > 10) {
            console.log(`${speaker} sample visemes:`, visemes.slice(0, 10).map(v => `${v.time.toFixed(2)}s:${v.viseme}`).join(', '));
          }
        }
      }
    }, visemeData);
    
    // Calculate total frames needed
    const maxEnd = Math.max(...speakers.flatMap(s => s.segments.map(seg => seg.end)));
    const totalFrames = Math.ceil(maxEnd * fps);
    
    console.log(`Rendering ${totalFrames} frames at ${fps}fps`);
    
    // Render frames deterministically (frame-by-frame, no wall-clock timing)
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      await page.evaluate((index) => {
        window.renderFrame(index);
      }, frameIndex);
      
      // Capture frame as PNG
      const frameBuffer = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height }
      });
      
      // Save frame with zero-padded number
      const frameNumber = frameIndex.toString().padStart(4, '0');
      const framePath = path.join(outputDir, `${frameNumber}.png`);
      await fs.writeFile(framePath, frameBuffer);
      
      if ((frameIndex + 1) % 100 === 0) {
        console.log(`Rendered ${frameIndex + 1}/${totalFrames} frames`);
      }
    }
    
    await page.close();
    
    const result = {
      jobId,
      frames: path.join(OUTPUTS_DIR, jobId, 'frames'),
      frameCount: totalFrames,
      fps,
      resolution,
      processedAt: Date.now()
    };
    
    console.log(`Rendering completed for job ${jobId}: ${totalFrames} frames`);
    
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
