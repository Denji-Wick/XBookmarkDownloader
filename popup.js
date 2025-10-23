document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-export');
  const saveButton = document.getElementById('save-file');
  const statusElement = document.getElementById('status');

  startButton.addEventListener('click', () => {
    statusElement.textContent = 'Export in progress...';
    startButton.style.display = 'none'; // Hide start button
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
        }
        break;

      case 'export-complete':
        statusElement.textContent = message.status;
        saveButton.style.display = 'block'; // Show save button
        break;
    }
  });
});
