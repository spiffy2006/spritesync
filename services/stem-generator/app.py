from flask import Flask, request, jsonify
import os
import time
from pydub import AudioSegment

app = Flask(__name__)

UPLOADS_DIR = '/app/uploads'
OUTPUT_DIR = '/app/cache'  # Output pseudo-stems to cache (writable volume)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'stem-generator'})

@app.route('/process', methods=['POST'])
def process():
    """
    Pseudo-stem generation service - creates one WAV per speaker with silence outside assigned segments.
    Input: single mixed WAV + speaker segments with timestamps
    Output: one WAV per speaker with original audio in assigned segments, silence elsewhere.
    All WAVs share: same sample rate, same start time (t=0), same duration.
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        audio_file_id = data.get('audioFileId')
        speaker_segments = data.get('speakerSegments', {})
        
        if not audio_file_id:
            return jsonify({'error': 'audioFileId is required'}), 400
        
        if not speaker_segments or 'identifiedSegments' not in speaker_segments:
            return jsonify({'error': 'speakerSegments with identifiedSegments is required'}), 400
        
        print(f"Processing pseudo-stem generation for job {job_id}")
        
        # Load the original mixed audio file
        audio_path = os.path.join(UPLOADS_DIR, audio_file_id)
        if not os.path.exists(audio_path):
            return jsonify({'error': f'Audio file not found: {audio_file_id}'}), 404
        
        # Load audio and get properties (pydub can handle multiple formats)
        # Determine format from extension
        audio_ext = os.path.splitext(audio_path)[1].lower()
        if audio_ext == '.wav':
            audio = AudioSegment.from_wav(audio_path)
        elif audio_ext == '.mp3':
            audio = AudioSegment.from_mp3(audio_path)
        elif audio_ext in ['.m4a', '.aac']:
            audio = AudioSegment.from_file(audio_path, format='m4a')
        else:
            # Try to auto-detect format
            audio = AudioSegment.from_file(audio_path)
        
        sample_rate = audio.frame_rate
        duration_ms = len(audio)
        duration_sec = duration_ms / 1000.0
        
        print(f"Loaded audio: {duration_sec:.2f}s, {sample_rate}Hz")
        
        # Group segments by speaker name
        speaker_segment_map = {}
        identified_segments = speaker_segments.get('identifiedSegments', [])
        
        for segment in identified_segments:
            speaker_name = segment.get('speakerName')
            if not speaker_name:
                continue
            
            if speaker_name not in speaker_segment_map:
                speaker_segment_map[speaker_name] = []
            
            speaker_segment_map[speaker_name].append({
                'start': segment.get('start', 0),
                'end': segment.get('end', duration_sec)
            })
        
        # Generate one WAV per speaker
        output_stems = {}
        
        for speaker_name, segments in speaker_segment_map.items():
            # Start with silence for the full duration
            speaker_audio = AudioSegment.silent(duration=duration_ms, frame_rate=sample_rate)
            
            # Overlay original audio in assigned segments
            for segment in segments:
                start_sec = max(0, segment['start'])
                end_sec = min(duration_sec, segment['end'])
                
                if start_sec >= end_sec:
                    continue
                
                start_ms = int(start_sec * 1000)
                end_ms = int(end_sec * 1000)
                
                # Extract the segment from original audio
                audio_segment = audio[start_ms:end_ms]
                
                # Overlay onto the silent base
                speaker_audio = speaker_audio.overlay(audio_segment, position=start_ms)
            
            # Export the pseudo-stem
            output_filename = f'stem_{job_id}_{speaker_name}.wav'
            output_path = os.path.join(OUTPUT_DIR, output_filename)
            speaker_audio.export(output_path, format='wav')
            
            output_stems[speaker_name] = output_filename
            print(f"Generated pseudo-stem for {speaker_name}: {output_filename}")
        
        result = {
            'jobId': job_id,
            'stems': output_stems,
            'sampleRate': sample_rate,
            'duration': duration_sec,
            'processedAt': time.time()
        }
        
        print(f"Pseudo-stem generation completed for job {job_id}: {len(output_stems)} stems")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in pseudo-stem generation: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=False)
