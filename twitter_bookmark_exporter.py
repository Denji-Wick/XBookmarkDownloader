#!/usr/bin/env python3
"""
Twitter Bookmarks to Markdown Exporter
A tool to export your Twitter/X bookmarks to markdown format without using the API
"""

import asyncio
import json
import os
import re
from datetime import datetime
from typing import List, Dict, Optional
from dataclasses import dataclass
from pathlib import Path
import logging

from playwright.async_api import async_playwright, Page, Browser, TimeoutError as PlaywrightTimeout

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class Tweet:
    """Represents a single tweet with all its relevant data"""
    id: str
    author_name: str
    author_handle: str
    text: str
    timestamp: str
    url: str
    images: List[str]
    videos: List[str]
    quoted_tweet: Optional['Tweet'] = None

class TwitterBookmarksExporter:
    """Main class that handles the export process"""

    def __init__(self, config: Dict):
        """
        Initialize exporter with configuration

        Args:
            config: Dictionary containing:
                - output_dir: Directory to save markdown files
                - tweets_per_file: Number of tweets per markdown file
                - include_images: Whether to embed images in markdown
                - browser_profile: Path to browser profile (optional)
                - headless: Whether to run browser in headless mode
                - scroll_retries: Number of times to retry scrolling if no new tweets are found
                - scroll_delay_ms: Delay in milliseconds to wait after each scroll operation
                - download_images_locally: Whether to download images locally
        """
        self.output_dir = Path(config.get('output_dir', 'twitter_bookmarks'))
        self.tweets_per_file = config.get('tweets_per_file', 100)
        self.include_images = config.get('include_images', True)
        self.browser_profile = config.get('browser_profile', None)
        self.headless = config.get('headless', False)
        self.scroll_retries = config.get('scroll_retries', 3)
        self.scroll_delay_ms = config.get('scroll_delay_ms', 2000)
        self.download_images_locally = config.get('download_images_locally', False)
        self.tweets_collected = []

        # Create output directory
        self.output_dir.mkdir(exist_ok=True)
        if self.download_images_locally:
            self.image_dir = self.output_dir / "images"
            self.image_dir.mkdir(exist_ok=True)

    async def start(self):
        """Main entry point for the export process"""
        async with async_playwright() as p:
            browser = await self._setup_browser(p)
            page = await browser.new_page()

            try:
                # Navigate to Twitter and ensure we're logged in
                await self._ensure_logged_in(page)

                # Go to bookmarks and collect all tweets
                await self._navigate_to_bookmarks(page)
                await self._collect_all_bookmarks(page)

                # Process and save the collected tweets
                await self._save_to_markdown(page) # Pass page object

                logger.info(f"Successfully exported {len(self.tweets_collected)} bookmarks!")

            except Exception as e:
                logger.error(f"Error during export: {e}")
                raise
            finally:
                await browser.close()

    async def _setup_browser(self, playwright):
        """Setup browser with appropriate configuration"""
        browser_args = {
            'headless': self.headless,
            'args': ['--disable-blink-features=AutomationControlled']
        }

        # Use existing browser profile if specified
        if self.browser_profile:
            browser_args['user_data_dir'] = self.browser_profile
            logger.info(f"Using browser profile from: {self.browser_profile}")

        # Launch Chromium (you can change to firefox or webkit)
        browser = await playwright.chromium.launch_persistent_context(**browser_args)
        return browser

    async def _ensure_logged_in(self, page: Page):
        """Handles the login process by prompting the user for manual login."""
        logger.info("Navigating to Twitter login page...")
        await page.goto('https://twitter.com/login', wait_until='networkidle')

        logger.info("Please log in manually in the browser window. Ensure you land on the Twitter home page.")
        logger.info("The script will automatically continue once login is successful.")

        # Wait for a reliable indicator of successful login (e.g., main navigation or home timeline)
        # Using a robust selector for the primary navigation menu or home timeline
        try:
            await page.wait_for_selector('nav[aria-label="Primary"], [aria-label="Timeline: Your Home Timeline"]', timeout=300000)  # 5 minute timeout
            logger.info("Login successful! Proceeding with bookmark export.")
        except PlaywrightTimeout:
            logger.error("Login timeout. Please ensure you have logged in successfully and landed on the Twitter home page.")
            raise Exception("Login timed out after 5 minutes.")

    async def _navigate_to_bookmarks(self, page: Page):
        """Navigate to the bookmarks page"""
        logger.info("Navigating to bookmarks...")

        # Try direct navigation first
        await page.goto('https://twitter.com/i/bookmarks', wait_until='networkidle')

        # Wait for bookmarks to start loading
        await page.wait_for_selector('article[data-testid="tweet"]', timeout=30000)
        logger.info("Bookmarks page loaded!")

    async def _collect_all_bookmarks(self, page: Page):
        """Scroll through and collect all bookmarked tweets"""
        logger.info("Starting to collect bookmarks...")

        tweets_seen = set()
        no_new_tweets_count = 0
        last_height = 0

        while True:
            # Extract tweets currently visible on page
            new_tweets = await self._extract_tweets_from_page(page)

            # Track unique tweets
            new_count = 0
            for tweet in new_tweets:
                if tweet.id not in tweets_seen:
                    tweets_seen.add(tweet.id)
                    self.tweets_collected.append(tweet)
                    new_count += 1

            logger.info(f"Collected {len(self.tweets_collected)} unique tweets so far...")

            # TODO: Implement more robust 'end of bookmarks' detection here.
            # This might involve looking for a specific element or message on the page
            # that indicates all bookmarks have been loaded.
            # Check if we're still finding new tweets
            if new_count == 0:
                no_new_tweets_count += 1
                if no_new_tweets_count >= self.scroll_retries:
                    logger.info("No new tweets found after multiple scrolls. Assuming all bookmarks collected.")
                    break
            else:
                no_new_tweets_count = 0

            # TODO: Implement rate limit detection and handling.
            # This could involve checking for specific error messages or status codes
            # and pausing the script if rate limits are encountered.
            # Scroll down to load more tweets
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')

            # Wait for potential new content to load
            await page.wait_for_timeout(self.scroll_delay_ms)

            # Check if page height changed (new content loaded)
            new_height = await page.evaluate('document.body.scrollHeight')
            if new_height == last_height:
                no_new_tweets_count += 1
            last_height = new_height

            # Periodically save progress for large collections
            if len(self.tweets_collected) % 500 == 0 and len(self.tweets_collected) > 0:
                logger.info("Saving intermediate progress...")
                await self._save_to_markdown(page) # Pass page object

    async def _extract_tweets_from_page(self, page: Page) -> List[Tweet]:
        """Extract tweet data from the current page"""
        tweets = []

        # Find all tweet articles on the page
        tweet_elements = await page.locator('article[data-testid="tweet"]').all()

        for tweet_element in tweet_elements:
            try:
                tweet_data = await self._parse_tweet_element(tweet_element, page)
                if tweet_data:
                    tweets.append(tweet_data)
            except Exception as e:
                logger.warning(f"Error parsing tweet: {e}")
                continue

        return tweets

    async def _parse_tweet_element(self, tweet_element, page: Page) -> Optional[Tweet]:
        """Parse a single tweet element and extract its data"""
        try:
            # Extract tweet URL and ID
            link_element = await tweet_element.locator('a[href*="/status/"]').first
            tweet_url = await link_element.get_attribute('href') if link_element else None

            if not tweet_url:
                return None

            tweet_id = tweet_url.split('/status/')[-1].split('?')[0]

            # Extract author information
            author_element = await tweet_element.locator('[data-testid="User-Name"]').first
            author_text = await author_element.inner_text() if author_element else "Unknown"
            author_parts = author_text.strip().split('
')
            author_name = author_parts[0] if author_parts else "Unknown"
            author_handle = author_parts[1] if len(author_parts) > 1 else "@unknown"

            # Extract tweet text
            text_element = await tweet_element.locator('[data-testid="tweetText"]').first
            tweet_text = await text_element.inner_text() if text_element else ""

            # Extract timestamp
            time_element = await tweet_element.locator('time').first
            timestamp = await time_element.get_attribute('datetime') if time_element else ""

            # Extract images
            images = []
            image_elements = await tweet_element.locator('img[src*="pbs.twimg.com/media"]').all()
            for img in image_elements:
                src = await img.get_attribute('src')
                if src:
                    # Get higher quality version
                    high_quality_src = re.sub(r'&name=\w+', '&name=large', src)
                    images.append(high_quality_src)

            # Extract videos (as URLs) - New multi-stage logic
            videos = []
            
            # 1. Check for iframe embeds (e.g., YouTube, Vimeo)
            iframe_selectors = [
                'iframe[src*="youtube.com/embed/"]',
                'iframe[src*="player.vimeo.com/video/"]'
            ]
            for selector in iframe_selectors:
                iframe_elements = await tweet_element.locator(selector).all()
                for iframe_el in iframe_elements:
                    src = await iframe_el.get_attribute('src')
                    if src and src not in videos:
                        videos.append(src)
            
            # 2. If no iframe videos, check for video links in cards
            if not videos:
                card_link_elements = await tweet_element.locator('[data-testid="card.wrapper"] a[href]').all()
                if card_link_elements: # Ensure elements were found before iterating
                    for link_el in card_link_elements:
                        href = await link_el.get_attribute('href')
                        if href:
                            # Basic check for common video domains
                            if any(domain in href for domain in ["youtu.be", "youtube.com", "vimeo.com", "dailymotion.com"]):
                                if href not in videos:
                                    videos.append(href)
            
            # 3. If still no videos, fall back to native Twitter video detection
            if not videos:
                native_video_elements = await tweet_element.locator('video').all() # Check for <video> tags
                if native_video_elements:
                    # If native <video> tags are present, it's a Twitter video.
                    # The tweet URL itself is the best link for it.
                    video_url_for_native = f"https://twitter.com{tweet_url}" # tweet_url is defined in the outer scope
                    if video_url_for_native not in videos:
                         videos.append(video_url_for_native)
            # --- End Video Extraction ---

            # --- Quoted Tweet Extraction ---
            parsed_quoted_tweet = None
            # Look for a specific div container that usually wraps quoted tweets
            quote_container_div = await tweet_element.locator("div[role='link'][tabindex='0']").first

            if await quote_container_div.count() > 0:
                potential_quoted_tweet_el = await quote_container_div.locator("article[data-testid='tweet']").first
                if await potential_quoted_tweet_el.count() > 0:
                    # Recursively parse the found element
                    temp_parsed_quote = await self._parse_tweet_element(potential_quoted_tweet_el, page)
                    if temp_parsed_quote and temp_parsed_quote.id != tweet_id:
                        parsed_quoted_tweet = temp_parsed_quote
            # --- End Quoted Tweet Extraction ---

            return Tweet(
                id=tweet_id,
                author_name=author_name,
                author_handle=author_handle,
                text=tweet_text,
                timestamp=timestamp,
                url=f"https://twitter.com{tweet_url}",
                images=images,
                videos=videos,
                quoted_tweet=parsed_quoted_tweet
            )

        except Exception as e:
            logger.warning(f"Error parsing tweet element: {e}")
            return None

    async def _download_image(self, page: Page, img_url: str, local_path: Path) -> bool:
        """Downloads an image from img_url and saves it to local_path using the given page."""
        try:
            response = await page.goto(img_url, wait_until='networkidle') # Use networkidle to ensure content is loaded
            if response and response.ok:
                await local_path.write_bytes(await response.body())
                logger.info(f"Successfully downloaded image: {img_url} to {local_path}")
                return True
            else:
                logger.error(f"Failed to download image: {img_url}. Status: {response.status if response else 'No response'}")
                return False
        except Exception as e:
            logger.error(f"Exception during image download {img_url}: {e}")
            return False

    async def _save_to_markdown(self, page: Page): # Accept page object
        """Save collected tweets to markdown files"""
        if not self.tweets_collected:
            logger.warning("No tweets to save!")
            return

        # Sort tweets by timestamp (newest first)
        self.tweets_collected.sort(key=lambda t: t.timestamp, reverse=True)

        # Determine overall metadata if tweets exist
        total_tweets = 0
        newest_tweet_date_str = "unknown"
        oldest_tweet_date_str = "unknown"
        if self.tweets_collected:
            total_tweets = len(self.tweets_collected)
            newest_tweet_timestamp = self.tweets_collected[0].timestamp
            oldest_tweet_timestamp = self.tweets_collected[-1].timestamp
            
            if newest_tweet_timestamp:
                newest_tweet_date_str = newest_tweet_timestamp[:10]
            if oldest_tweet_timestamp:
                oldest_tweet_date_str = oldest_tweet_timestamp[:10]

        # Split tweets into chunks
        for i in range(0, len(self.tweets_collected), self.tweets_per_file):
            chunk = self.tweets_collected[i:i + self.tweets_per_file]
            file_number = (i // self.tweets_per_file) + 1

            # Generate filename with date range
            if chunk:
                first_date = chunk[0].timestamp[:10] if chunk[0].timestamp else "unknown"
                last_date = chunk[-1].timestamp[:10] if chunk[-1].timestamp else "unknown"
                filename = f"bookmarks_{file_number:03d}_{first_date}_to_{last_date}.md"
            else:
                filename = f"bookmarks_{file_number:03d}.md"

            filepath = self.output_dir / filename

            # Write markdown content
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(f"# Twitter Bookmarks - Part {file_number}

")
                f.write(f"*Exported on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*

")
                
                # Add additional metadata for the first file if tweets exist
                if file_number == 1 and self.tweets_collected:
                    f.write(f"**Total Bookmarks in Export:** {total_tweets}

")
                    f.write(f"**Overall Date Range:** {oldest_tweet_date_str} to {newest_tweet_date_str}

")

                f.write(f"**Tweets in this file:** {len(chunk)}

")
                f.write("---

")

                for tweet in chunk:
                    await self._write_tweet_to_markdown(f, tweet, page) # Pass page object

            logger.info(f"Saved {len(chunk)} tweets to {filename}")

    async def _write_tweet_to_markdown(self, file, tweet: Tweet, page: Page): # Accept page object
        """Write a single tweet to the markdown file"""
        # Write tweet header
        file.write(f"## {tweet.author_name} ({tweet.author_handle})

")

        # Write timestamp and link
        if tweet.timestamp:
            formatted_time = datetime.fromisoformat(tweet.timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M:%S')
            file.write(f"*[{formatted_time}]({tweet.url})*

")
        else:
            file.write(f"*[Link]({tweet.url})*

")

        # Write tweet text
        file.write(f"{tweet.text}

")

        # Include images if configured
        if self.include_images and tweet.images:
            file.write("**Images:**

")
            for img_url in tweet.images:
                if self.download_images_locally:
                    basename = re.sub(r'[?&=:]', '_', img_url.split('/')[-1])
                    local_filename = f"{tweet.id}_{basename}"
                    local_image_path = self.image_dir / local_filename
                    
                    download_successful = await self._download_image(page, img_url, local_image_path)
                    if download_successful:
                        file.write(f"![Image](./images/{local_filename})

")
                    else:
                        file.write(f"![Image (Failed to download)]({img_url})

") # Fallback
                else:
                    file.write(f"![Image]({img_url})

")

        # Include video links
        if tweet.videos:
            file.write("**Videos:**

")
            for video_url in tweet.videos:
                file.write(f"- [Video Link]({video_url})
")
            file.write("
")

        # --- Write Quoted Tweet ---
        if tweet.quoted_tweet:
            qt = tweet.quoted_tweet
            file.write("\n\n> **Quoted Tweet:**\n")
            file.write(f"> **{qt.author_name} ({qt.author_handle})**\n\n")
            
            # Write quoted tweet text with blockquote formatting
            quoted_text_lines = qt.text.split('\n')
            for line in quoted_text_lines:
                file.write(f"> {line}\n")
            file.write("\n")

            if qt.timestamp:
                formatted_quoted_time = datetime.fromisoformat(qt.timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M:%S')
                file.write(f"> *[{formatted_quoted_time}]({qt.url})*\n\n")
            else:
                file.write(f"> *[Link]({qt.url})*\n\n")

            if self.include_images and qt.images:
                file.write("> **Images (quoted):**\n\n")
                for img_url in qt.images:
                    if self.download_images_locally:
                        basename = re.sub(r'[?&=:]', '_', img_url.split('/')[-1])
                        local_filename = f"qt_{qt.id}_{basename}" # Prefix for quoted tweet images
                        local_image_path = self.image_dir / local_filename
                        
                        download_successful = await self._download_image(page, img_url, local_image_path)
                        if download_successful:
                            file.write(f"> ![Quoted Image](./images/{local_filename})\n\n")
                        else:
                            file.write(f"> ![Quoted Image (Failed to download)]({img_url})\n\n") # Fallback
                    else:
                        file.write(f"> ![Quoted Image]({img_url})\n\n")
            
            if qt.videos:
                file.write("> **Videos (quoted):**\n\n")
                for video_url in qt.videos:
                    file.write(f"> - [Quoted Video Link]({video_url})\n")
                file.write("\n")
        # --- End Write Quoted Tweet ---

        # Add separator
        file.write("---

")

async def main():
    """Main function to run the exporter"""
    default_config = {
        'output_dir': 'twitter_bookmarks',
        'tweets_per_file': 100,
        'include_images': True,
        'browser_profile': None,
        'headless': False,
        'scroll_retries': 3,
        'scroll_delay_ms': 2000,
        'download_images_locally': False
    }

    final_config = default_config.copy() # Start with defaults

    try:
        with open('config.json', 'r', encoding='utf-8') as f:
            file_config = json.load(f)
            final_config.update(file_config) # Merge, file_config overrides defaults
            logger.info("Loaded configuration from config.json")
    except FileNotFoundError:
        logger.info("config.json not found, using default settings.")
    except json.JSONDecodeError as e:
        logger.warning(f"Error reading config.json: {e}. Using default settings.")
    
    # Create and run exporter
    exporter = TwitterBookmarksExporter(final_config)
    await exporter.start()

if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())
