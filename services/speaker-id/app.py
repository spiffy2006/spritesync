from flask import Flask, request, jsonify
import time

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'speaker-id'})

@app.route('/process', methods=['POST'])
def process():
    """
    Speaker identification service - maps diarized segments to named speakers
    In a real implementation, this would use voice embeddings and speaker recognition
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        diarization_result = data.get('diarizationResult', {})
        
        print(f"Processing speaker identification for job {job_id}")
        
        # Simulate processing time
        time.sleep(1.5)
        
        # Mock result: map speaker labels to names
        segments = diarization_result.get('segments', [])
        
        # Simple mapping (in reality, would use ML models)
        speaker_mapping = {
            'SPEAKER_00': 'Alice',
            'SPEAKER_01': 'Bob',
            'SPEAKER_02': 'Charlie'
        }
        
        identified_segments = []
        for segment in segments:
            identified_segments.append({
                'speakerName': speaker_mapping.get(segment['speaker'], 'Unknown'),
                'speakerId': segment['speaker'],
                'start': segment['start'],
                'end': segment['end']
            })
        
        result = {
            'jobId': job_id,
            'identifiedSegments': identified_segments,
            'speakerMapping': speaker_mapping,
            'processedAt': time.time()
        }
        
        print(f"Speaker identification completed for job {job_id}")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in speaker identification: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)
