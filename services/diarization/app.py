from flask import Flask, request, jsonify
import os
import time
import hashlib

app = Flask(__name__)

UPLOADS_DIR = '/app/uploads'
CACHE_DIR = '/app/cache'

# Initialize pyannote.audio pipeline
try:
    from pyannote.audio import Pipeline
    import torch
    
    # Use a pre-trained pipeline model
    # Note: In production, you may need to set HF_TOKEN environment variable
    # and accept model terms on HuggingFace
    PIPELINE_MODEL = "pyannote/speaker-diarization-3.1"
    pipeline = None
    
    def get_pipeline():
        global pipeline
        if pipeline is None:
            try:
                print("Loading pyannote.audio pipeline...")
                # Get HuggingFace token from environment
                hf_token = os.environ.get('HF_TOKEN')
                
                if hf_token:
                    print(f"Using HF_TOKEN for authentication (token length: {len(hf_token)})")
                    # Try with use_auth_token (older API for huggingface_hub < 0.20.0)
                    try:
                        print("Attempting to load pipeline with use_auth_token...")
                        pipeline = Pipeline.from_pretrained(PIPELINE_MODEL, use_auth_token=hf_token)
                        print("Pipeline object created successfully")
                    except TypeError as e:
                        # Fallback to token parameter (newer API)
                        print(f"Trying with 'token' parameter instead of 'use_auth_token': {e}")
                        try:
                            pipeline = Pipeline.from_pretrained(PIPELINE_MODEL, token=hf_token)
                        except Exception as e2:
                            error_msg = f"Failed to load pipeline with token parameter: {e2}"
                            print(f"ERROR: {error_msg}")
                            raise RuntimeError(error_msg)
                    except Exception as e:
                        # Provide more helpful error message
                        error_msg = str(e)
                        if "'NoneType' object has no attribute 'eval'" in error_msg or "NoneType" in error_msg:
                            error_msg = (
                                "Underlying model failed to load (returned None). "
                                "The pyannote/speaker-diarization-3.1 pipeline requires several models. "
                                "You MUST accept terms for ALL of these on HuggingFace:\n\n"
                                "1. https://hf.co/pyannote/speaker-diarization-3.1\n"
                                "2. https://hf.co/pyannote/segmentation-3.0 (likely the failing one)\n"
                                "3. https://hf.co/pyannote/embedding\n"
                                "4. https://hf.co/pyannote/speaker-diarization\n\n"
                                "Visit each link, sign in with your HuggingFace account, "
                                "and click 'Agree and access repository' for each one.\n"
                                f"Original error: {e}"
                            )
                        else:
                            error_msg = f"Failed to load pipeline: {e}"
                        print(f"ERROR: {error_msg}")
                        import traceback
                        traceback.print_exc()
                        raise RuntimeError(error_msg)
                else:
                    print("WARNING: No HF_TOKEN provided. Pipeline may require authentication.")
                    print("Attempting to load without token (will likely fail for gated models)...")
                    pipeline = Pipeline.from_pretrained(PIPELINE_MODEL)
                
                # Verify pipeline was actually loaded
                if pipeline is None:
                    raise RuntimeError("Pipeline.from_pretrained returned None - this usually means you need to accept the model terms at https://hf.co/pyannote/speaker-diarization-3.1")
                
                if torch.cuda.is_available():
                    pipeline = pipeline.to(torch.device("cuda"))
                print("Pipeline loaded successfully")
            except Exception as e:
                print(f"ERROR: Failed to load diarization pipeline: {e}")
                import traceback
                traceback.print_exc()
                pipeline = None  # Explicitly set to None on error
        return pipeline
except ImportError:
    print("WARNING: pyannote.audio not available, falling back to mock")
    Pipeline = None

# Try to load pipeline on module import (when gunicorn starts)
print("=" * 60)
print("Diarization service module loaded")
print("=" * 60)
if Pipeline is not None:
    print("Attempting to pre-load pipeline...")
    try:
        # This will trigger pipeline loading
        test_pipeline = get_pipeline()
        if test_pipeline is None:
            print("ERROR: Pipeline is None after get_pipeline() call")
        else:
            print("SUCCESS: Pipeline pre-loaded successfully")
    except Exception as e:
        print(f"ERROR: Failed to pre-load pipeline: {e}")
        import traceback
        traceback.print_exc()
else:
    print("WARNING: Pipeline class is None (pyannote.audio not available)")
print("=" * 60)

@app.route('/health', methods=['GET'])
def health():
    status = 'healthy'
    pipeline_loaded = False
    error = None
    
    if Pipeline is None:
        status = 'degraded (pyannote.audio not available)'
    else:
        # Try to get the pipeline to see if it's actually loaded
        pipeline = get_pipeline()
        if pipeline is None:
            status = 'degraded (pipeline failed to load)'
            error = 'Pipeline loading failed. Check service logs for details.'
        else:
            pipeline_loaded = True
    
    return jsonify({
        'status': status, 
        'service': 'diarization',
        'pipeline_loaded': pipeline_loaded,
        'error': error
    })

def compute_file_hash(file_path):
    """Compute SHA-256 hash of file"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def get_cached_result(audio_file_id):
    """Check cache for existing diarization result"""
    try:
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        if not os.path.exists(audio_path):
            return None
        
        file_hash = compute_file_hash(audio_path)
        cache_path = os.path.join(CACHE_DIR, 'diarization', f'{file_hash}.json')
        
        if os.path.exists(cache_path):
            import json
            with open(cache_path, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error reading cache: {e}")
    return None

def save_cached_result(audio_file_id, result):
    """Save diarization result to cache"""
    try:
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        file_hash = compute_file_hash(audio_path)
        cache_dir = os.path.join(CACHE_DIR, 'diarization')
        os.makedirs(cache_dir, exist_ok=True)
        
        cache_path = os.path.join(cache_dir, f'{file_hash}.json')
        import json
        with open(cache_path, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"Cached diarization result: {cache_path}")
    except Exception as e:
        print(f"Error saving cache: {e}")

@app.route('/process', methods=['POST'])
def process():
    """
    Diarization service - identifies when different speakers are talking
    Uses pyannote.audio for speaker diarization
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        audio_file_id = data.get('audioFileId')
        
        if not audio_file_id:
            return jsonify({'error': 'audioFileId is required'}), 400
        
        print(f"Processing diarization for job {job_id}, audio: {audio_file_id}")
        
        # Check cache first
        cached_result = get_cached_result(audio_file_id)
        if cached_result:
            print(f"Using cached diarization result for job {job_id}")
            return jsonify(cached_result)
        
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        if not os.path.exists(audio_path):
            return jsonify({'error': f'Audio file not found: {audio_file_id}'}), 404
        
        # Perform diarization
        if Pipeline is None:
            # Fallback to mock if pyannote.audio not available
            print("WARNING: Using mock diarization (pyannote.audio not available)")
            time.sleep(2)
            result = {
                'jobId': job_id,
                'segments': [
                    {'speaker': 'SPEAKER_00', 'start': 0.0, 'end': 5.2},
                    {'speaker': 'SPEAKER_01', 'start': 5.5, 'end': 12.3},
                    {'speaker': 'SPEAKER_00', 'start': 12.8, 'end': 18.5},
                    {'speaker': 'SPEAKER_02', 'start': 19.0, 'end': 25.7},
                    {'speaker': 'SPEAKER_01', 'start': 26.2, 'end': 32.0}
                ],
                'processedAt': time.time()
            }
        else:
            # Real diarization with pyannote.audio
            print(f"Running pyannote.audio diarization on {audio_path}")
            diarization_pipeline = get_pipeline()
            if diarization_pipeline is None:
                error_msg = 'Diarization pipeline failed to load. Check service logs for details.'
                print(f"ERROR: {error_msg}")
                print("Pipeline is None - this means get_pipeline() returned None")
                return jsonify({'error': error_msg}), 500
            
            # Convert audio to WAV if needed (pyannote.audio works better with WAV, especially for MP3)
            import subprocess
            temp_wav_path = None
            try:
                audio_ext = os.path.splitext(audio_path)[1].lower()
                if audio_ext != '.wav':
                    # Convert to WAV using ffmpeg
                    temp_wav_path = os.path.join(CACHE_DIR, f'temp_diarization_{int(time.time())}.wav')
                    print(f"Converting {audio_ext} to WAV for diarization...")
                    subprocess.run([
                        'ffmpeg', '-i', audio_path,
                        '-ar', '16000',  # Resample to 16kHz (pyannote.audio standard)
                        '-ac', '1',      # Mono
                        '-y',            # Overwrite output
                        temp_wav_path
                    ], check=True, capture_output=True)
                    audio_path = temp_wav_path
                    print(f"Audio converted to WAV: {temp_wav_path}")
                
                print(f"Calling diarization pipeline on {audio_path}")
                diarization = diarization_pipeline(audio_path)
                print(f"Diarization pipeline completed, processing results...")
            except subprocess.CalledProcessError as e:
                error_msg = f"FFmpeg conversion failed: {e.stderr.decode() if e.stderr else str(e)}"
                print(f"ERROR: {error_msg}")
                return jsonify({'error': error_msg}), 500
            except Exception as pipeline_error:
                error_msg = f"Error running diarization pipeline: {str(pipeline_error)}"
                print(f"ERROR: {error_msg}")
                import traceback
                traceback.print_exc()
                return jsonify({'error': error_msg}), 500
            finally:
                # Clean up temporary WAV file if created
                if temp_wav_path and os.path.exists(temp_wav_path):
                    try:
                        os.unlink(temp_wav_path)
                    except:
                        pass
            
            # Convert pyannote.audio output to our format
            segments = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append({
                    'speaker': speaker,
                    'start': round(turn.start, 2),
                    'end': round(turn.end, 2)
                })
            
            result = {
                'jobId': job_id,
                'segments': segments,
                'processedAt': time.time()
            }
        
        # Save to cache
        save_cached_result(audio_file_id, result)
        
        print(f"Diarization completed for job {job_id}: {len(result['segments'])} segments")
        
        return jsonify(result)
    
    except Exception as e:
        error_msg = f"Error in diarization: {str(e)}"
        print(f"ERROR: {error_msg}")
        import traceback
        print("Full traceback:")
        traceback.print_exc()
        return jsonify({
            'error': error_msg,
            'type': type(e).__name__
        }), 500

# Try to load pipeline on startup to catch errors early
if __name__ == '__main__':
    print("=" * 60)
    print("Diarization service starting...")
    print("=" * 60)
    if Pipeline is not None:
        print("Attempting to load pipeline on startup...")
        try:
            test_pipeline = get_pipeline()
            if test_pipeline is None:
                print("WARNING: Pipeline is None after get_pipeline() call")
            else:
                print("SUCCESS: Pipeline loaded on startup")
        except Exception as e:
            print(f"ERROR: Failed to load pipeline on startup: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("WARNING: Pipeline class is None (pyannote.audio not available)")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=False)
