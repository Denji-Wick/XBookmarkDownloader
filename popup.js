document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-export');
  const statusElement = document.getElementById('status');

  startButton.addEventListener('click', () => {
    statusElement.textContent = 'Exporting...';
    browser.runtime.sendMessage({ action: 'start-export' });
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'export-status') {
      statusElement.textContent = message.status;
    }
  });
});
