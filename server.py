from flask import Flask, request, jsonify
from flask_cors import CORS
import mlx_whisper
import tempfile
import os
import uuid
import numpy as np

import sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

app = Flask(__name__)
CORS(app)

MODEL_REPO = "mlx-community/whisper-large-v3-turbo"

# Scope that allows creating and editing events
SCOPES = ["https://www.googleapis.com/auth/calendar.events"]

def get_calendar_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=8080)
        with open("token.json", "w") as token:
            token.write(creds.to_json())
    try:
        service = build("calendar", "v3", credentials=creds)
        return service
    except HttpError as error:
        print(f"An error occurred: {error}")
        return None

# Warm up model
print(f"Loading MLX Whisper model ({MODEL_REPO})...")
mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=MODEL_REPO, language="he")
print("Model loaded successfully!")

import traceback

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'no audio file'}), 400
    
    file = request.files['audio']
    tmp_path = f"/tmp/{uuid.uuid4()}.webm"
    file.save(tmp_path)
    
    try:
        result = mlx_whisper.transcribe(tmp_path, path_or_hf_repo=MODEL_REPO, language="he")
        text = result.get('text', '').strip()
        return jsonify({'text': text})
    except Exception as e:
        print("❌ Error during transcription:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.route('/sync_calendar', methods=['POST'])
def sync_calendar():
    data = request.json
    events = data.get('events', [])
    
    service = get_calendar_service()
    if not service:
         return jsonify({'error': 'Google authentication failed'}), 500

    results = []
    for ev in events:
        event_body = {
            'summary': ev['title'],
            'start': {'dateTime': ev['start']},
            'end': {'dateTime': ev['end']}
        }
        try:
            created = service.events().insert(calendarId='primary', body=event_body).execute()
            results.append(created.get('htmlLink'))
        except Exception as e:
            print(f"Error syncing event: {e}")
            
    return jsonify({'success': True, 'links': results})

if __name__ == '__main__':
    print("\n🚀 Server is ready and listening on http://127.0.0.1:5001\n")
    app.run(host='0.0.0.0', port=5001, debug=False)
