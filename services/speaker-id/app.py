from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
import os
import time
import json
import pickle
import numpy as np
from pathlib import Path

app = Flask(__name__)

PROFILES_DIR = '/app/profiles'
UPLOADS_DIR = '/app/uploads'
CACHE_DIR = '/app/cache'
CONFIDENCE_THRESHOLD = 0.7  # Minimum confidence to accept a match

# Configure file upload
ALLOWED_AUDIO_EXTENSIONS = {'wav', 'mp3', 'flac', 'ogg', 'm4a'}

# Initialize speaker recognition model
SpeakerRecognition = None
verification_model = None
model_loading_error = None

try:
    # Try different import paths for different speechbrain versions
    # speechbrain 0.5.16 uses pretrained, newer versions use inference
    try:
        # Try newer API first (0.5.17+)
        from speechbrain.inference.speaker import SpeakerRecognition
        print("SpeechBrain imported from speechbrain.inference.speaker")
    except ImportError:
        try:
            # Fallback to older API (0.5.16 and earlier)
            from speechbrain.pretrained import SpeakerRecognition
            print("SpeechBrain imported from speechbrain.pretrained")
        except ImportError as e2:
            # Check if speechbrain is installed at all
            try:
                import speechbrain
                print(f"SpeechBrain version: {speechbrain.__version__}")
                raise ImportError(f"Could not find SpeakerRecognition class. Error: {e2}")
            except ImportError:
                raise ImportError("speechbrain package not installed")
    import torchaudio
    print("SpeechBrain and torchaudio imported successfully")
except ImportError as e:
    print(f"WARNING: speechbrain not available: {e}")
    print("Falling back to mock mode - speaker profiles cannot be created from audio")
    import traceback
    traceback.print_exc()
    SpeakerRecognition = None
    model_loading_error = f"Import error: {str(e)}"

def get_verification_model():
    """Get or load the speaker recognition model"""
    global verification_model, model_loading_error
    
    if SpeakerRecognition is None:
        return None
    
    if verification_model is not None:
        return verification_model
    
    try:
        print("Loading speaker recognition model from HuggingFace...")
        print("Note: First load may take time to download the model (~100MB)")
        
        # Create savedir if it doesn't exist
        savedir = "pretrained_models/spkrec-ecapa-voxceleb"
        os.makedirs(savedir, exist_ok=True)
        
        verification_model = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=savedir
        )
        print("Speaker recognition model loaded successfully")
        model_loading_error = None
        return verification_model
    except Exception as e:
        error_msg = str(e)
        print(f"ERROR: Failed to load speaker recognition model: {error_msg}")
        import traceback
        traceback.print_exc()
        
        # Provide more helpful error messages
        if "401" in error_msg or "authentication" in error_msg.lower():
            model_loading_error = "Model requires HuggingFace authentication. Set HF_TOKEN environment variable."
        elif "timeout" in error_msg.lower() or "connection" in error_msg.lower():
            model_loading_error = "Failed to download model from HuggingFace. Check internet connection."
        else:
            model_loading_error = f"Model loading error: {error_msg}"
        
        verification_model = None
        return None

@app.route('/health', methods=['GET'])
def health():
    status = 'healthy'
    model_available = False
    
    if SpeakerRecognition is None:
        status = 'degraded (speechbrain not available)'
    else:
        # Try to get the model to check if it's actually loaded
        model = get_verification_model()
        if model is None:
            status = 'degraded (model failed to load)'
        else:
            model_available = True
    
    return jsonify({
        'status': status, 
        'service': 'speaker-id',
        'model_available': model_available,
        'error': model_loading_error if model_loading_error else None
    })

def load_speaker_profiles():
    """Load all speaker profiles from /profiles directory"""
    profiles = {}
    
    if not os.path.exists(PROFILES_DIR):
        print(f"Profiles directory does not exist: {PROFILES_DIR}")
        return profiles
    
    for filename in os.listdir(PROFILES_DIR):
        if filename.endswith('.pkl') or filename.endswith('.json'):
            speaker_name = os.path.splitext(filename)[0]
            profile_path = os.path.join(PROFILES_DIR, filename)
            
            try:
                if filename.endswith('.pkl'):
                    with open(profile_path, 'rb') as f:
                        profile_data = pickle.load(f)
                else:
                    with open(profile_path, 'r') as f:
                        profile_data = json.load(f)
                
                # Extract embedding vector
                if isinstance(profile_data, dict):
                    embedding = profile_data.get('embedding', profile_data.get('vector'))
                else:
                    embedding = profile_data
                
                if embedding is not None:
                    profiles[speaker_name] = np.array(embedding)
                    print(f"Loaded profile for speaker: {speaker_name}")
            except Exception as e:
                print(f"Error loading profile {filename}: {e}")
    
    return profiles

def extract_segment_audio(audio_path, start_sec, end_sec):
    """Extract audio segment from file"""
    try:
        import torchaudio
        import subprocess
        
        # Convert to WAV if needed (torchaudio may not support all formats)
        audio_ext = os.path.splitext(audio_path)[1].lower()
        temp_wav_path = None
        
        if audio_ext != '.wav':
            # Convert to WAV using ffmpeg
            temp_wav_path = os.path.join(CACHE_DIR, f'temp_segment_{int(time.time())}.wav')
            print(f"Converting {audio_ext} to WAV for segment extraction...")
            subprocess.run([
                'ffmpeg', '-i', audio_path,
                '-ar', '16000',  # Resample to 16kHz
                '-ac', '1',      # Mono
                '-y',            # Overwrite output
                temp_wav_path
            ], check=True, capture_output=True)
            audio_path = temp_wav_path
        
        print(f"Loading audio file: {audio_path}")
        waveform, sample_rate = torchaudio.load(audio_path)
        print(f"Audio loaded: sample_rate={sample_rate}, waveform shape={waveform.shape}")
        
        start_sample = int(start_sec * sample_rate)
        end_sample = int(end_sec * sample_rate)
        
        # Ensure we don't go beyond the audio length
        if end_sample > waveform.shape[1]:
            end_sample = waveform.shape[1]
        if start_sample >= end_sample:
            print(f"WARNING: Invalid segment range: {start_sample} >= {end_sample}")
            return None, None
        
        segment = waveform[:, start_sample:end_sample]
        print(f"Extracted segment: {start_sec:.2f}s - {end_sec:.2f}s ({end_sample - start_sample} samples)")
        
        # Clean up temp file if created
        if temp_wav_path and os.path.exists(temp_wav_path):
            try:
                os.unlink(temp_wav_path)
            except:
                pass
        
        return segment, sample_rate
    except subprocess.CalledProcessError as e:
        error_msg = f"FFmpeg conversion failed: {e.stderr.decode() if e.stderr else str(e)}"
        print(f"ERROR: {error_msg}")
        return None, None
    except Exception as e:
        print(f"Error extracting audio segment: {e}")
        import traceback
        traceback.print_exc()
        return None, None

def compute_speaker_embedding(audio_path, start_sec, end_sec):
    """Compute speaker embedding for a segment"""
    if SpeakerRecognition is None:
        return None
    
    try:
        segment, sample_rate = extract_segment_audio(audio_path, start_sec, end_sec)
        if segment is None:
            return None
        
        # Save segment to temp file for model
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            torchaudio.save(tmp.name, segment, sample_rate)
            tmp_path = tmp.name
        
        try:
            # Use the same method as create_embedding_from_audio_file
            embedding = create_embedding_from_audio_file(tmp_path)
            return embedding
        finally:
            os.unlink(tmp_path)
    except Exception as e:
        print(f"Error computing embedding: {e}")
        return None

def create_embedding_from_audio_file(audio_path):
    """Create speaker embedding from an entire audio file"""
    if SpeakerRecognition is None:
        return None
    
    try:
        model = get_verification_model()
        if model is None:
            return None
        
        # Convert audio to WAV if needed (torchaudio may not support all formats)
        import subprocess
        import tempfile
        
        # Check if file needs conversion (not WAV)
        audio_ext = os.path.splitext(audio_path)[1].lower()
        temp_wav_path = None
        
        if audio_ext != '.wav':
            # Convert to WAV using ffmpeg
            temp_wav_path = os.path.join(CACHE_DIR, f'temp_convert_{int(time.time())}.wav')
            try:
                subprocess.run([
                    'ffmpeg', '-i', audio_path,
                    '-ar', '16000',  # Resample to 16kHz
                    '-ac', '1',      # Mono
                    '-y',            # Overwrite output
                    temp_wav_path
                ], check=True, capture_output=True)
                audio_path = temp_wav_path
            except subprocess.CalledProcessError as e:
                print(f"FFmpeg conversion failed: {e.stderr.decode()}")
                return None
        else:
            # Even for WAV, resample to 16kHz if needed
            temp_wav_path = None
        
        # Load audio file
        import torchaudio
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Resample to 16kHz if needed (speechbrain models typically expect 16kHz)
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            sample_rate = 16000
        
        # Try different API methods
        embedding = None
        
        # Method 1: Try encode_batch (most common)
        if hasattr(model, 'encode_batch'):
            try:
                # Add batch dimension if needed
                if waveform.dim() == 1:
                    waveform = waveform.unsqueeze(0)
                embedding = model.encode_batch(waveform)
                if embedding.dim() > 1:
                    embedding = embedding.squeeze(0)
            except Exception as e:
                print(f"encode_batch failed: {e}")
        
        # Method 2: Try encode_file (newer API)
        if embedding is None and hasattr(model, 'encode_file'):
            try:
                embedding = model.encode_file(audio_path)
            except Exception as e:
                print(f"encode_file failed: {e}")
        
        # Method 3: Try using the encoder module directly
        if embedding is None and hasattr(model, 'mods'):
            try:
                # Access the encoder through the model's modules
                encoder = model.mods.get('encoder', None)
                if encoder is not None:
                    # Prepare input
                    if waveform.dim() == 1:
                        waveform = waveform.unsqueeze(0)
                    # Get embedding
                    embedding = encoder(waveform)
                    if embedding.dim() > 1:
                        embedding = embedding.squeeze(0)
            except Exception as e:
                print(f"Direct encoder access failed: {e}")
        
        if embedding is None:
            print("All encoding methods failed. Available methods:", dir(model))
            return None
        
        # Convert to numpy
        if hasattr(embedding, 'cpu'):
            embedding = embedding.cpu()
        if hasattr(embedding, 'numpy'):
            embedding = embedding.numpy()
        elif hasattr(embedding, 'squeeze'):
            embedding = embedding.squeeze()
        
        return np.array(embedding)
    except Exception as e:
        print(f"Error creating embedding from audio file: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        # Clean up temporary WAV file if created
        if 'temp_wav_path' in locals() and temp_wav_path and os.path.exists(temp_wav_path):
            try:
                os.unlink(temp_wav_path)
            except:
                pass

def save_speaker_profile(speaker_name, embedding):
    """Save speaker profile to disk"""
    if not os.path.exists(PROFILES_DIR):
        os.makedirs(PROFILES_DIR, exist_ok=True)
    
    # Save as pickle (more efficient for numpy arrays)
    profile_path = os.path.join(PROFILES_DIR, f"{secure_filename(speaker_name)}.pkl")
    
    profile_data = {
        'speaker_name': speaker_name,
        'embedding': embedding.tolist(),  # Convert numpy array to list for JSON compatibility
        'created_at': time.time()
    }
    
    try:
        with open(profile_path, 'wb') as f:
            pickle.dump(profile_data, f)
        print(f"Saved speaker profile: {profile_path}")
        return profile_path
    except Exception as e:
        print(f"Error saving profile: {e}")
        return None

def match_speaker(embedding, profiles):
    """Match embedding to known speaker profiles"""
    if embedding is None or len(profiles) == 0:
        return None, 0.0
    
    # Ensure embedding is 1D
    embedding = np.array(embedding)
    if embedding.ndim > 1:
        embedding = embedding.flatten()
    
    best_match = None
    best_score = 0.0
    
    # Compute cosine similarity with each profile
    embedding_norm = embedding / (np.linalg.norm(embedding) + 1e-8)
    
    for speaker_name, profile_embedding in profiles.items():
        # Ensure profile embedding is 1D
        profile_emb = np.array(profile_embedding)
        if profile_emb.ndim > 1:
            profile_emb = profile_emb.flatten()
        
        profile_norm = profile_emb / (np.linalg.norm(profile_emb) + 1e-8)
        similarity = np.dot(embedding_norm, profile_norm)
        
        if similarity > best_score:
            best_score = similarity
            best_match = speaker_name
    
    return best_match, float(best_score)

@app.route('/process', methods=['POST'])
def process():
    """
    Speaker identification service - maps diarized segments to named speakers
    Uses speaker embeddings and similarity matching
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        diarization_result = data.get('diarizationResult', {})
        audio_file_id = data.get('audioFileId')
        
        if not diarization_result:
            return jsonify({'error': 'diarizationResult is required'}), 400
        
        if not audio_file_id:
            return jsonify({'error': 'audioFileId is required'}), 400
        
        print(f"Processing speaker identification for job {job_id}")
        
        # Load speaker profiles
        profiles = load_speaker_profiles()
        
        if len(profiles) == 0:
            return jsonify({
                'error': 'No speaker profiles found. Please create speaker profiles from audio samples first using the "Create Profile from Audio Sample" feature in the Web UI.'
            }), 400
        
        print(f"Loaded {len(profiles)} speaker profiles: {list(profiles.keys())}")
        
        # Get diarized segments
        segments = diarization_result.get('segments', [])
        
        if len(segments) == 0:
            return jsonify({'error': 'No segments found in diarization result'}), 400
        
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        if not os.path.exists(audio_path):
            return jsonify({'error': f'Audio file not found: {audio_file_id}'}), 404
        
        # Process each segment
        identified_segments = []
        speaker_mapping = {}
        low_confidence_segments = []
        
        # Group segments by diarized speaker ID
        speaker_groups = {}
        for segment in segments:
            speaker_id = segment.get('speaker')
            if speaker_id not in speaker_groups:
                speaker_groups[speaker_id] = []
            speaker_groups[speaker_id].append(segment)
        
        # Identify each unique diarized speaker
        for speaker_id, group_segments in speaker_groups.items():
            # Use the first segment to identify the speaker
            first_segment = group_segments[0]
            start_sec = first_segment.get('start', 0)
            end_sec = first_segment.get('end', 0)
            
            if SpeakerRecognition is None:
                # Mock mode - simple mapping
                speaker_name = f"Speaker_{speaker_id[-2:]}"
                confidence = 0.85
            else:
                # Extract embedding and match
                print(f"Extracting embedding for {speaker_id} from segment {start_sec:.2f}s - {end_sec:.2f}s")
                embedding = compute_speaker_embedding(audio_path, start_sec, end_sec)
                
                if embedding is None:
                    error_msg = f'Failed to extract embedding for diarized speaker {speaker_id} from segment {start_sec:.2f}s - {end_sec:.2f}s'
                    print(f"ERROR: {error_msg}")
                    return jsonify({'error': error_msg}), 500
                
                print(f"Embedding extracted (shape: {embedding.shape if hasattr(embedding, 'shape') else 'unknown'}), matching against {len(profiles)} profiles...")
                speaker_name, confidence = match_speaker(embedding, profiles)
                print(f"Match result: {speaker_name} (confidence: {confidence:.3f})")
            
            if speaker_name is None:
                available_profiles = list(profiles.keys())
                error_msg = f'Could not identify speaker for diarized speaker {speaker_id}. No matching profile found. Available profiles: {available_profiles}'
                print(f"ERROR: {error_msg}")
                return jsonify({'error': error_msg}), 500
            
            # Check confidence threshold
            if confidence < CONFIDENCE_THRESHOLD:
                low_confidence_segments.append({
                    'speakerId': speaker_id,
                    'speakerName': speaker_name,
                    'confidence': confidence,
                    'threshold': CONFIDENCE_THRESHOLD
                })
                # Fail loudly as per PROJECT.md
                return jsonify({
                    'error': f'Speaker identification confidence too low for {speaker_id}',
                    'details': {
                        'speakerName': speaker_name,
                        'confidence': confidence,
                        'threshold': CONFIDENCE_THRESHOLD,
                        'message': 'Speaker identification confidence is below threshold. Please ensure speaker profiles are accurate.'
                    }
                }), 400
            
            speaker_mapping[speaker_id] = speaker_name
            print(f"Mapped {speaker_id} -> {speaker_name} (confidence: {confidence:.3f})")
        
        # Create identified segments
        for segment in segments:
            speaker_id = segment.get('speaker')
            speaker_name = speaker_mapping.get(speaker_id, 'Unknown')
            
            identified_segments.append({
                'speakerName': speaker_name,
                'speakerId': speaker_id,
                'start': segment.get('start'),
                'end': segment.get('end')
            })
        
        result = {
            'jobId': job_id,
            'identifiedSegments': identified_segments,
            'speakerMapping': speaker_mapping,
            'processedAt': time.time()
        }
        
        print(f"Speaker identification completed for job {job_id}: {len(identified_segments)} segments")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in speaker identification: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/create-profile', methods=['POST'])
def create_profile():
    """
    Create a speaker profile from an audio sample
    Accepts audio file upload and speaker name, extracts embedding and saves profile
    """
    try:
        # Check if audio file is provided
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        speaker_name = request.form.get('speakerName', '').strip()
        
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'No audio file selected'}), 400
        
        if not speaker_name:
            return jsonify({'error': 'Speaker name is required'}), 400
        
        # Save uploaded file temporarily to cache directory (writable)
        # Ensure cache directory exists
        if not os.path.exists(CACHE_DIR):
            os.makedirs(CACHE_DIR, exist_ok=True)
        
        temp_audio_path = os.path.join(CACHE_DIR, f'temp_profile_{int(time.time())}_{secure_filename(audio_file.filename)}')
        audio_file.save(temp_audio_path)
        
        try:
            print(f"Creating profile for speaker: {speaker_name}")
            
            # Extract embedding from audio file
            if SpeakerRecognition is None:
                error_msg = 'Speaker recognition model not available. '
                if model_loading_error:
                    error_msg += f'Error: {model_loading_error}'
                else:
                    error_msg += 'SpeechBrain library is not installed or failed to import.'
                return jsonify({'error': error_msg}), 500
            
            # Try to get the model
            model = get_verification_model()
            if model is None:
                error_msg = 'Failed to load speaker recognition model. '
                if model_loading_error:
                    error_msg += f'Error: {model_loading_error}'
                else:
                    error_msg += 'Model may need to be downloaded from HuggingFace.'
                return jsonify({'error': error_msg}), 500
            
            embedding = create_embedding_from_audio_file(temp_audio_path)
            
            if embedding is None:
                return jsonify({'error': 'Failed to extract embedding from audio file'}), 500
            
            # Save profile
            profile_path = save_speaker_profile(speaker_name, embedding)
            
            if profile_path is None:
                return jsonify({'error': 'Failed to save speaker profile'}), 500
            
            result = {
                'success': True,
                'speakerName': speaker_name,
                'profilePath': profile_path,
                'embeddingSize': len(embedding),
                'createdAt': time.time()
            }
            
            print(f"Successfully created profile for {speaker_name}")
            return jsonify(result)
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_audio_path):
                try:
                    os.unlink(temp_audio_path)
                except:
                    pass
    
    except Exception as e:
        print(f"Error creating speaker profile: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)
