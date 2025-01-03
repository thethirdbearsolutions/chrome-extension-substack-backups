document.addEventListener('DOMContentLoaded', () => {
  const substackUrlInput = document.getElementById('substackUrl');
  const downloadDirInput = document.getElementById('downloadDir');
  const form = document.getElementById('settingsForm');

  // Load saved settings
  chrome.storage.sync.get(['substackUrl', 'downloadDir'], (data) => {
    if (data.substackUrl) substackUrlInput.value = data.substackUrl;
    if (data.downloadDir) downloadDirInput.value = data.downloadDir;
  });

  // Save settings
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const substackUrl = substackUrlInput.value;
    const downloadDir = downloadDirInput.value;

    chrome.storage.sync.set({ substackUrl, downloadDir }, () => {
      alert('Settings saved!');
    });
  });
});
