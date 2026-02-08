from flask import Flask, request, jsonify
import time
import subprocess

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    # Check if ffmpeg is available
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        ffmpeg_available = True
    except:
        ffmpeg_available = False
    
    return jsonify({
        'status': 'healthy',
        'service': 'mux',
        'ffmpeg_available': ffmpeg_available
    })

@app.route('/process', methods=['POST'])
def process():
    """
    Mux service - combines video frames and audio using FFmpeg
    In a real implementation, this would use FFmpeg to create the final video
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        video_frames = data.get('videoFrames')
        audio_file_id = data.get('audioFileId')
        
        print(f"Processing muxing for job {job_id}")
        
        # Simulate muxing time
        time.sleep(2)
        
        # In a real implementation, would run something like:
        # ffmpeg -framerate 30 -i frames/%04d.png -i audio.wav \
        #        -c:v libx264 -pix_fmt yuv420p -c:a aac output.mp4
        
        output_path = f'/app/output/{job_id}/final_video.mp4'
        
        result = {
            'jobId': job_id,
            'outputVideo': output_path,
            'format': 'mp4',
            'codec': 'h264',
            'audioCodec': 'aac',
            'processedAt': time.time()
        }
        
        print(f"Muxing completed for job {job_id}: {output_path}")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in muxing: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=True)
