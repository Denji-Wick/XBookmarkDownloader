// Extract tweet IDs from markdown file
const extractTweetIdsFromMarkdown = (markdownText) => {
  const tweetIds = [];
  // Match URLs like https://twitter.com/.../status/1234567890 or https://x.com/.../status/1234567890
  const urlPattern = /https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/g;
  let match;

  while ((match = urlPattern.exec(markdownText)) !== null) {
    tweetIds.push(match[1]);
  }

  return [...new Set(tweetIds)]; // Remove duplicates
};

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-export');
  const saveButton = document.getElementById('save-file');
  const statusElement = document.getElementById('status');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const resumeFileInput = document.getElementById('resume-file');
  const resumeStatus = document.getElementById('resume-status');

  // Handle resume file upload
  resumeFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
      resumeStatus.textContent = '';
      return;
    }

    try {
      const text = await file.text();
      const tweetIds = extractTweetIdsFromMarkdown(text);

      if (tweetIds.length > 0) {
        // Merge with existing stored IDs
        const data = await browser.storage.local.get('exportedTweetIds');
        const existingIds = new Set(data.exportedTweetIds || []);
        tweetIds.forEach(id => existingIds.add(id));

        await browser.storage.local.set({ exportedTweetIds: Array.from(existingIds) });
        resumeStatus.textContent = `✓ Loaded ${tweetIds.length} tweet IDs. Total stored: ${existingIds.size}`;
        resumeStatus.style.color = 'green';
      } else {
        resumeStatus.textContent = '⚠ No tweet IDs found in file';
        resumeStatus.style.color = 'orange';
      }
    } catch (err) {
      console.error('Error reading file:', err);
      resumeStatus.textContent = '✗ Error reading file';
      resumeStatus.style.color = 'red';
    }
  });

  startButton.addEventListener('click', () => {
    statusElement.textContent = 'Starting export... Please wait.';
    startButton.style.display = 'none'; // Hide start button
    progressContainer.style.display = 'block';
    browser.runtime.sendMessage({ action: 'start-export' });
  });

  saveButton.addEventListener('click', () => {
    statusElement.textContent = 'Saving file...';
    saveButton.style.display = 'none';
    browser.runtime.sendMessage({ action: 'save-file' });
  });

  browser.runtime.onMessage.addListener((message) => {
    switch (message.action) {
      case 'export-status':
        statusElement.textContent = message.status;
        if (message.status.includes('Error')) {
            startButton.style.display = 'block'; // Show start button on error
            progressContainer.style.display = 'none';
        }
        break;

      case 'export-progress':
        statusElement.textContent = message.status;
        if (message.total > 0) {
          progressBar.value = message.progress;
          progressBar.max = message.total;
          progressLabel.textContent = `${message.progress} / ${message.total}`;
        }
        break;

      case 'export-complete':
        statusElement.textContent = message.status;
        progressContainer.style.display = 'none';
        saveButton.style.display = 'block'; // Show save button
        break;
    }
  });
});
