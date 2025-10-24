// background.js

// --- STATE MANAGEMENT ---
let collectedTweets = [];
let storedTweetIds = new Set();
let markdownContent = ''; // To store the generated markdown

// Load stored tweet IDs on startup
browser.storage.local.get('exportedTweetIds').then((data) => {
  if (data.exportedTweetIds) {
    storedTweetIds = new Set(data.exportedTweetIds);
    console.log(`Loaded ${storedTweetIds.size} previously exported tweet IDs.`);
  }
});


// --- MESSAGE HANDLING ---
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === 'start-export') {
    handleStartExport(sender.tab);
  } else if (message.action === 'export-data') {
    await handleExportData(message.data);
  } else if (message.action === 'save-file') {
    await handleSaveFile();
  }
});

const handleStartExport = async (tab) => {
    // Check if the URL is correct
    if (!tab.url.includes("twitter.com/i/bookmarks") && !tab.url.includes("x.com/i/bookmarks")) {
        browser.runtime.sendMessage({
            action: 'export-status',
            status: 'Error: Please navigate to twitter.com/i/bookmarks or x.com/i/bookmarks'
        });
        return;
    }

    // Reset state for a new export
    collectedTweets = [];
    markdownContent = '';

    // Send message to content script to start scraping
    // Content script is already injected via manifest.json
    await browser.tabs.sendMessage(tab.id, { action: 'start-export-in-page' });
};

const handleExportData = async (newTweets) => {
  if (!newTweets || newTweets.length === 0) {
    console.log("No new bookmarks to export.");
    browser.runtime.sendMessage({ action: 'export-status', status: 'No new bookmarks found.' });
    return;
  }

  // Filter out any tweets that might have been stored since the scrape began
  const uniqueNewTweets = newTweets.filter(tweet => !storedTweetIds.has(tweet.id));

  if (uniqueNewTweets.length === 0) {
    console.log("All scraped tweets were already exported.");
    browser.runtime.sendMessage({ action: 'export-status', status: 'No new bookmarks found.' });
    return;
  }

  collectedTweets = uniqueNewTweets;
  console.log(`Processing ${collectedTweets.length} new tweets.`);

  // Generate and store markdown
  markdownContent = generateMarkdown(collectedTweets);

  // Notify the popup that the export is complete and ready to be saved
  browser.runtime.sendMessage({
      action: 'export-complete',
      status: `Export of ${collectedTweets.length} new bookmarks is ready.`
  });
};

const handleSaveFile = async () => {
  await saveMarkdownToFile(markdownContent);

  // Update stored tweet IDs
  const newTweetIds = collectedTweets.map(t => t.id);
  const updatedTweetIds = new Set([...storedTweetIds, ...newTweetIds]);
  await browser.storage.local.set({ exportedTweetIds: Array.from(updatedTweetIds) });

  // Update in-memory set
  storedTweetIds = updatedTweetIds;

  console.log(`Export complete. Stored ${storedTweetIds.size} total tweet IDs.`);
  browser.runtime.sendMessage({ action: 'export-status', status: `Exported ${collectedTweets.length} new bookmarks!` });

  // Reset state after saving
  collectedTweets = [];
  markdownContent = '';
};


// --- MARKDOWN GENERATION ---
const generateMarkdown = (tweets) => {
  if (!tweets || tweets.length === 0) return "";

  // Sort tweets by timestamp (newest first)
  tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  let md = `# Twitter Bookmarks Export\n\n`;
  md += `*Exported on: ${new Date().toUTCString()}*\n`;
  md += `*Total new bookmarks in this file: ${tweets.length}*\n\n---\n\n`;

  for (const tweet of tweets) {
    md += formatTweetToMarkdown(tweet);
  }

  return md;
};

const formatTweetToMarkdown = (tweet) => {
  let content = `## ${tweet.author_name} (${tweet.author_handle})\n\n`;

  const formattedTime = new Date(tweet.timestamp).toLocaleString();
  content += `*[${formattedTime}](${tweet.url})*\n\n`;

  content += `${tweet.text.replace(/\n/g, '\n\n')}\n\n`;

  if (tweet.images && tweet.images.length > 0) {
    content += "**Images:**\n";
    for (const imgUrl of tweet.images) {
      content += `![Image](${imgUrl})\n`;
    }
    content += "\n";
  }

  if (tweet.videos && tweet.videos.length > 0) {
    content += "**Videos:**\n";
    for (const videoUrl of tweet.videos) {
      content += `- [Video Link](${videoUrl})\n`;
    }
    content += "\n";
  }

  if (tweet.quoted_tweet) {
      content += `> **Quoted Tweet:**\n`
      content += formatQuotedTweet(tweet.quoted_tweet);
  }

  content += "---\n\n";
  return content;
};

const formatQuotedTweet = (qt) => {
    let quotedContent = `> **${qt.author_name} (${qt.author_handle})**\n`;
    const formattedQuotedTime = new Date(qt.timestamp).toLocaleString();
    quotedContent += `> *[${formattedQuotedTime}](${qt.url})*\n\n`;

    // Add blockquote to each line of the text
    const quotedTextLines = qt.text.split('\n');
    for (const line of quotedTextLines) {
        quotedContent += `> ${line}\n`;
    }
    quotedContent += "\n";

    if (qt.images && qt.images.length > 0) {
        quotedContent += "> **Images (quoted):**\n";
        for (const imgUrl of qt.images) {
            quotedContent += `> ![Quoted Image](${imgUrl})\n`;
        }
        quotedContent += "\n";
    }

    return quotedContent;
};


// --- FILE SAVING ---
const saveMarkdownToFile = async (content) => {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const filename = `twitter-bookmarks-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}.md`;

    await browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true, // Prompt user for save location
    });

    URL.revokeObjectURL(url); // Clean up the object URL
    console.log("Markdown file download initiated.");

  } catch (err) {
    console.error("Error saving markdown file:", err);
    browser.runtime.sendMessage({ action: 'export-status', status: 'Error saving file.' });
  }
};
