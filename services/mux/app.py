from flask import Flask, request, jsonify
import os
import time
import subprocess
import glob

app = Flask(__name__)

OUTPUTS_DIR = '/app/outputs'
UPLOADS_DIR = '/app/uploads'

# Default settings
DEFAULT_FPS = 30
DEFAULT_RESOLUTION = '1920x1080'
DEFAULT_VIDEO_CODEC = 'libx264'
DEFAULT_AUDIO_CODEC = 'aac'

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
    Creates final MP4 with H.264 video and AAC audio
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        video_frames = data.get('videoFrames')  # Path to frame directory
        audio_file_id = data.get('audioFileId')
        fps = data.get('fps', DEFAULT_FPS)
        resolution = data.get('resolution', DEFAULT_RESOLUTION)
        
        if not video_frames:
            return jsonify({'error': 'videoFrames is required'}), 400
        
        if not audio_file_id:
            return jsonify({'error': 'audioFileId is required'}), 400
        
        print(f"Processing muxing for job {job_id}")
        print(f"  Frames: {video_frames}")
        print(f"  Audio: {audio_file_id}")
        print(f"  FPS: {fps}, Resolution: {resolution}")
        
        # Resolve paths
        frames_dir = video_frames
        if not os.path.isabs(frames_dir):
            frames_dir = os.path.join(OUTPUTS_DIR, frames_dir)
        
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        
        # Validate inputs
        if not os.path.exists(frames_dir):
            return jsonify({'error': f'Frame directory not found: {frames_dir}'}), 404
        
        if not os.path.exists(audio_path):
            return jsonify({'error': f'Audio file not found: {audio_file_id}'}), 404
        
        # Find frame files (PNG images)
        frame_pattern = os.path.join(frames_dir, '*.png')
        frame_files = sorted(glob.glob(frame_pattern))
        
        if len(frame_files) == 0:
            return jsonify({'error': f'No frame files found in {frames_dir}'}), 404
        
        print(f"Found {len(frame_files)} frame files")
        
        # Create output directory
        output_dir = os.path.join(OUTPUTS_DIR, job_id)
        os.makedirs(output_dir, exist_ok=True)
        
        output_path = os.path.join(output_dir, 'final_video.mp4')
        
        # Parse resolution
        width, height = map(int, resolution.split('x'))
        
        # Build FFmpeg command
        # Use pattern for input frames
        frame_pattern_input = os.path.join(frames_dir, '%04d.png')
        
        # Check if frames are numbered starting from 0 or 1
        first_frame = frame_files[0]
        frame_basename = os.path.basename(first_frame)
        frame_number = int(os.path.splitext(frame_basename)[0])
        
        if frame_number == 0:
            frame_pattern_input = os.path.join(frames_dir, '%04d.png')
        else:
            # Use start_number parameter
            frame_pattern_input = os.path.join(frames_dir, '%04d.png')
        
        ffmpeg_cmd = [
            'ffmpeg',
            '-y',  # Overwrite output file
            '-framerate', str(fps),
            '-i', frame_pattern_input,
            '-i', audio_path,
            '-c:v', DEFAULT_VIDEO_CODEC,
            '-pix_fmt', 'yuv420p',
            '-crf', '23',  # Quality setting (lower = better quality)
            '-preset', 'medium',
            '-c:a', DEFAULT_AUDIO_CODEC,
            '-b:a', '192k',  # Audio bitrate
            '-vf', f'scale={width}:{height}',
            '-shortest',  # Finish encoding when shortest input ends
            output_path
        ]
        
        # If frames don't start at 0000, add start_number
        if frame_number != 0:
            ffmpeg_cmd.insert(ffmpeg_cmd.index('-i') + 1, '-start_number')
            ffmpeg_cmd.insert(ffmpeg_cmd.index('-start_number') + 1, str(frame_number))
        
        print(f"Running FFmpeg command: {' '.join(ffmpeg_cmd)}")
        
        # Execute FFmpeg
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout
        )
        
        if result.returncode != 0:
            error_msg = result.stderr or result.stdout
            print(f"FFmpeg error: {error_msg}")
            return jsonify({
                'error': 'FFmpeg muxing failed',
                'details': error_msg
            }), 500
        
        # Verify output file exists
        if not os.path.exists(output_path):
            return jsonify({'error': 'Output file was not created'}), 500
        
        # Get file size
        file_size = os.path.getsize(output_path)
        
        result = {
            'jobId': job_id,
            'outputVideo': output_path,
            'format': 'mp4',
            'codec': DEFAULT_VIDEO_CODEC,
            'audioCodec': DEFAULT_AUDIO_CODEC,
            'fps': fps,
            'resolution': resolution,
            'frameCount': len(frame_files),
            'fileSize': file_size,
            'processedAt': time.time()
        }
        
        print(f"Muxing completed for job {job_id}: {output_path} ({file_size} bytes)")
        
        return jsonify(result)
    
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'FFmpeg muxing timed out'}), 500
    except Exception as e:
        print(f"Error in muxing: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=False)
