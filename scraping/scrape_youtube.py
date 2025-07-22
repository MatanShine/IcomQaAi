import os
import json
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from dotenv import load_dotenv

# Load .env if exists
load_dotenv()

API_KEY = os.getenv('YOUTUBE_API_KEY') or 'YOUR_API_KEY_HERE'
CHANNEL_ID = 'UCFpIiS_uu-XD-vtg0U-asyg'

def get_all_video_ids(youtube, channel_id):
    video_ids = []
    next_page_token = None
    while True:
        req = youtube.search().list(
            channelId=channel_id,
            part='id',
            maxResults=50,
            order='date',
            type='video',
            pageToken=next_page_token
        )
        res = req.execute()
        for item in res['items']:
            video_ids.append(item['id']['videoId'])
        next_page_token = res.get('nextPageToken')
        if not next_page_token:
            break
    return video_ids

def fetch_transcript(video_id):
    """Return transcript text for the given video or None if unavailable."""
    print(f"  Fetching transcript for {video_id}…")
    try:
        tl = YouTubeTranscriptApi.list_transcripts(video_id)
        transcript = tl.find_transcript(['en']).fetch()
        text = " ".join(seg["text"] for seg in transcript)
        print(f"  → fetched {len(transcript)} segments")
        return text
    except (TranscriptsDisabled, NoTranscriptFound) as e:
        print(f"  → no transcript: {e}")
        try:
            tl = YouTubeTranscriptApi.list_transcripts(video_id)
            langs = [t.language_code for t in tl]
            print(f"  → available languages: {langs}")
        except Exception as e2:
            print(f"  → could not list transcripts: {e2}")
        return None
    except Exception as e:
        print(f"  → error fetching transcript: {e}")
        return None

def main():
    if API_KEY == 'YOUR_API_KEY_HERE':
        print('Please set your YOUTUBE_API_KEY in the environment or script.')
        return
    youtube = build('youtube', 'v3', developerKey=API_KEY)
    channel_id = CHANNEL_ID
    print(f'Channel ID: {channel_id}')
    video_ids = get_all_video_ids(youtube, channel_id)
    print(f'Found {len(video_ids)} videos.')
    # Load existing data
    data_path = os.path.join(os.path.dirname(__file__), '../data/zebra_support_qa.json')
    with open(data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    # For each video, fetch transcript and append
    for vid in video_ids:
        url = f'https://www.youtube.com/watch?v={vid}'
        print(f'Processing {url}...')
        text = fetch_transcript(vid)
        if not text:
            print('No transcript found, skipping.')
            continue
        # Get video title
        req = youtube.videos().list(part='snippet', id=vid)
        res = req.execute()
        title = res['items'][0]['snippet']['title'] if res['items'] else 'YouTube Video'
        # Format as existing data
        entry = {
            'question': f'מה יש בסרטון: {title}?',
            'text': text,
            'url': url
        }
        data.append(entry)
        print('Added.')
    # Save back
    with open(data_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('Done.')

if __name__ == '__main__':
    main() 