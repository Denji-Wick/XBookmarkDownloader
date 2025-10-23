document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-export');
  const saveButton = document.getElementById('save-file');
  const statusElement = document.getElementById('status');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');

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
