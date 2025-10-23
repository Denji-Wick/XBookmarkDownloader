// content_script.js

(async () => {
  // --- UTILITY FUNCTIONS ---
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getStoredTweetIds = async () => {
    const data = await browser.storage.local.get('exportedTweetIds');
    return new Set(data.exportedTweetIds || []);
  };

  // --- PARSING LOGIC ---
  const parseTweetElement = (tweetElement) => {
    try {
      const linkElement = tweetElement.querySelector('a[href*="/status/"]');
      if (!linkElement) return null;

      const tweetUrl = linkElement.href;
      if (!tweetUrl) return null;

      const tweetId = tweetUrl.split('/status/')[1].split('?')[0];

      const authorElement = tweetElement.querySelector('[data-testid="User-Name"]');
      const authorText = authorElement ? authorElement.innerText : "Unknown";
      const authorParts = authorText.trim().split('\n');
      const authorName = authorParts[0] || "Unknown";
      const authorHandle = authorParts[1] || "@unknown";

      const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
      const tweetText = textElement ? textElement.innerText : "";

      const timeElement = tweetElement.querySelector('time');
      const timestamp = timeElement ? timeElement.getAttribute('datetime') : "";

      const images = Array.from(tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media"]'))
        .map(img => img.src.replace(/&name=\w+/, '&name=large'));

      let videos = [];
      const videoElements = tweetElement.querySelectorAll('video');
      if (videoElements.length > 0) {
        videos.push(`https://twitter.com${tweetUrl}`);
      }

      const cardLinks = tweetElement.querySelectorAll('[data-testid="card.wrapper"] a[href]');
      cardLinks.forEach(link => {
        const href = link.href;
        if (href && (href.includes('youtu.be') || href.includes('youtube.com') || href.includes('vimeo.com'))) {
          videos.push(href);
        }
      });

      let quotedTweet = null;
      const quoteContainer = tweetElement.querySelector("div[role='link'][tabindex='0']");
      if (quoteContainer) {
        const quotedArticle = quoteContainer.querySelector("article[data-testid='tweet']");
        if (quotedArticle) {
          quotedTweet = parseTweetElement(quotedArticle);
        }
      }

      return {
        id: tweetId,
        author_name: authorName,
        author_handle: authorHandle,
        text: tweetText,
        timestamp: timestamp,
        url: tweetUrl,
        images: images,
        videos: [...new Set(videos)], // Remove duplicates
        quoted_tweet: quotedTweet,
      };

    } catch (e) {
      console.warn("Error parsing tweet element:", e, tweetElement);
      return null;
    }
  };

  // --- PROGRESS BAR MANAGEMENT ---
  const injectProgressBar = async () => {
    const response = await fetch(browser.runtime.getURL('progress.html'));
    const html = await response.text();
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = browser.runtime.getURL('progress.css');
    document.head.appendChild(link);
  };

  const updateProgressBar = (progress, total, status) => {
    const progressBar = document.getElementById('tbe-progress-bar');
    const progressLabel = document.getElementById('tbe-progress-label');
    if (progressBar && progressLabel) {
      progressBar.style.width = `${(progress / total) * 100}%`;
      progressLabel.textContent = status;
    }
  };

  const removeProgressBar = () => {
    const container = document.getElementById('tbe-progress-container');
    if (container) {
      container.parentElement.remove();
    }
  };


  // --- MAIN SCRAPING FUNCTION ---
  const scrapeBookmarks = async () => {
    console.log("Starting bookmark collection...");
    await injectProgressBar();

    // --- PRE-SCAN FOR TOTAL COUNT ---
    let totalBookmarks = 0;
    const prescanTweets = new Set();
    let lastHeight = 0;
    let noChangeCount = 0;
    const prescanScrollDelay = 1500; // Faster scroll for pre-scan

    while (noChangeCount < 3) { // Stop if height doesn't change for a few scrolls
      const elements = document.querySelectorAll('article[data-testid="tweet"]');
      elements.forEach(el => {
        const id = parseTweetElement(el)?.id;
        if(id) prescanTweets.add(id);
      });
      totalBookmarks = prescanTweets.size;

      updateProgressBar(0, totalBookmarks, `Found ${totalBookmarks} total bookmarks. Starting scrape...`);

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(prescanScrollDelay);

      const newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
      }
      lastHeight = newHeight;
    }
     window.scrollTo(0, 0); // Scroll back to the top
     await sleep(1000); // Wait for page to settle

    // --- DETAILED SCRAPE ---
    const storedTweetIds = await getStoredTweetIds();
    const collectedTweets = [];
    const tweetsSeenOnPage = new Set();
    let noNewTweetsCount = 0;
    const scrollRetries = 5;
    const scrollDelayMs = 2500;

    while (true) {
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
      let newTweetsFoundThisScroll = 0;

      for (const tweetElement of tweetElements) {
        const tweetData = parseTweetElement(tweetElement);
        if (tweetData && !tweetsSeenOnPage.has(tweetData.id)) {
          tweetsSeenOnPage.add(tweetData.id);

          if (!storedTweetIds.has(tweetData.id)) {
             collectedTweets.push(tweetData);
             newTweetsFoundThisScroll++;
          }
        }
      }

      console.log(`Collected ${collectedTweets.length} new unique tweets so far...`);
      updateProgressBar(tweetsSeenOnPage.size, totalBookmarks, `Scraped ${tweetsSeenOnPage.size} of ${totalBookmarks} bookmarks...`);

      if (newTweetsFoundThisScroll === 0) {
        noNewTweetsCount++;
        console.log(`No new tweets found on this scroll. Attempt ${noNewTweetsCount}/${scrollRetries}`);
        if (noNewTweetsCount >= scrollRetries) {
          console.log("No new tweets found after multiple scrolls. Assuming all bookmarks collected.");
          break;
        }
      } else {
        noNewTweetsCount = 0; // Reset counter if we find new tweets
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(scrollDelayMs);
    }

    // Send final data to background script
    console.log(`Finished scraping. Sending ${collectedTweets.length} new tweets to be exported.`);
    browser.runtime.sendMessage({ action: 'export-data', data: collectedTweets });

    // Clean up
    removeProgressBar();
  };

  // --- EVENT LISTENER ---
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'start-export-in-page') {
      scrapeBookmarks();
    }
  });

})();
