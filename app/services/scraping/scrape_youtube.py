import os
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from .base_scraper import BaseScraper
from dotenv import load_dotenv

class YoutubeScraper(BaseScraper):
    __channel_id = 'UCFpIiS_uu-XD-vtg0U-asyg'  # Zebra CRM youtube channel

    def __init__(self, base_url: str, logger):
        super().__init__(base_url, logger)
        load_dotenv()
        self.youtube = build('youtube', 'v3', developerKey=os.getenv('YOUTUBE_API_KEY'))

    def get_urls(self):
        urls = set()
        next_page_token = None
        while True:
            req = self.youtube.search().list(
                channelId=self.__channel_id,
                part='id',
                maxResults=50,
                order='date',
                type='video',
                pageToken=next_page_token
            )
            res = req.execute()
            for item in res['items']:
                id = item['id']['videoId']
                urls.add(f"https://www.youtube.com/watch?v={id}")
            next_page_token = res.get('nextPageToken')
            if not next_page_token:
                break
        self.logger.info(f"Found {len(urls)} videos.")
        return urls

    def get_answer(self, url):
        """Return transcript text for the given video or None if unavailable."""
        video_id = url.split("=")[1]
        self.logger.info(f"Fetching transcript for {video_id}…")
        
        try:
            ytt_api = YouTubeTranscriptApi()
            fetched_transcript = ytt_api.fetch(video_id, ['iw', 'en'])
            text = ' '.join([snippet.text for snippet in fetched_transcript])
            return text
        except (TranscriptsDisabled, NoTranscriptFound) as e:
            self.logger.info(f"  → no transcript: {e}")
            return ""
        except Exception as e:
            self.logger.info(f"  → error fetching transcript: {e}")
            return ""

    def get_question(self, url):
        req = self.youtube.videos().list(part='snippet', id=url.split("=")[1])
        res = req.execute()
        title = res['items'][0]['snippet']['title'] if res['items'] else ""
        return title
