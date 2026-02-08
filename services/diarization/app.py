from flask import Flask, request, jsonify
import time

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'diarization'})

@app.route('/process', methods=['POST'])
def process():
    """
    Diarization service - identifies when different speakers are talking
    In a real implementation, this would use pyannote.audio or similar
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        audio_file_id = data.get('audioFileId')
        
        print(f"Processing diarization for job {job_id}")
        
        # Simulate processing time
        time.sleep(2)
        
        # Mock result: segments with speaker labels and timestamps
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
        
        print(f"Diarization completed for job {job_id}: {len(result['segments'])} segments")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in diarization: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
