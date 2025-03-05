document.addEventListener('DOMContentLoaded', () => {
  const substackUrlInput = document.getElementById('substackUrl');
  const downloadDirInput = document.getElementById('downloadDir');
  const publishedDirInput = document.getElementById('publishedDir');
  const form = document.getElementById('settingsForm');
  const backupDraftsButton = document.getElementById('backupDraftsNow');
  const backupPublishedButton = document.getElementById('backupPublishedNow');
  const status = document.getElementById('status');
  
  // Load saved settings
  chrome.storage.sync.get(['substackUrl', 'downloadDir', 'publishedDir'], (data) => {
    if (data.substackUrl) substackUrlInput.value = data.substackUrl;
    if (data.downloadDir) downloadDirInput.value = data.downloadDir;
    if (data.publishedDir) publishedDirInput.value = data.publishedDir || 'substack-published';
  });

  // Save settings
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const substackUrl = substackUrlInput.value;
    const downloadDir = downloadDirInput.value;
    const publishedDir = publishedDirInput.value;

    chrome.storage.sync.set({ substackUrl, downloadDir, publishedDir }, () => {
      showStatus('Settings saved!', 'success');
    });
  });

  // Backup drafts now
  backupDraftsButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'backupNow', contentType: 'drafts' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Drafts backup started! Check your downloads folder when complete.', 'success');
      }
    });
  });
  
  // Backup published posts now
  backupPublishedButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'backupNow', contentType: 'published' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Published posts backup started! Check your downloads folder when complete.', 'success');
      }
    });
  });
  
  // Helper function to show status messages
  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
    status.style.display = 'block';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }
});