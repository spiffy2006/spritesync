from flask import Flask, request, jsonify
import time

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'stem-generator'})

@app.route('/process', methods=['POST'])
def process():
    """
    Stem generation service - separates audio into stems (vocals, background, etc.)
    In a real implementation, this would use Demucs or Spleeter
    """
    try:
        data = request.json
        job_id = data.get('jobId')
        audio_file_id = data.get('audioFileId')
        
        print(f"Processing stem generation for job {job_id}")
        
        # Simulate processing time (stem separation is slow)
        time.sleep(3)
        
        # Mock result: separated audio stems
        result = {
            'jobId': job_id,
            'stems': {
                'vocals': f'stem_{job_id}_vocals.wav',
                'background': f'stem_{job_id}_background.wav',
                'bass': f'stem_{job_id}_bass.wav',
                'drums': f'stem_{job_id}_drums.wav'
            },
            'processedAt': time.time()
        }
        
        print(f"Stem generation completed for job {job_id}")
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in stem generation: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)
