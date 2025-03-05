document.addEventListener('DOMContentLoaded', () => {
  const substackUrlInput = document.getElementById('substackUrl');
  const downloadDirInput = document.getElementById('downloadDir');
  const publishedDirInput = document.getElementById('publishedDir');
  const form = document.getElementById('settingsForm');
  const backupDraftsButton = document.getElementById('backupDraftsNow');
  const backupPublishedButton = document.getElementById('backupPublishedNow');
  const forceBackupDraftsButton = document.getElementById('forceBackupDraftsNow');
  const forceBackupPublishedButton = document.getElementById('forceBackupPublishedNow');
  const status = document.getElementById('status');
  
  // Load saved settings
  chrome.storage.local.get(['substackUrl', 'downloadDir', 'publishedDir', 'draftsIndex', 'publishedIndex'], (data) => {
    if (data.substackUrl) substackUrlInput.value = data.substackUrl;
    if (data.downloadDir) downloadDirInput.value = data.downloadDir;
    if (data.publishedDir) publishedDirInput.value = data.publishedDir || 'substack-published';
    
    // Update stats in the UI
    updateSyncStats(data.draftsIndex, data.publishedIndex);
  });

  // Save settings
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const substackUrl = substackUrlInput.value;
    const downloadDir = downloadDirInput.value;
    const publishedDir = publishedDirInput.value;

    chrome.storage.local.set({ substackUrl, downloadDir, publishedDir }, () => {
      showStatus('Settings saved!', 'success');
    });
  });

  // Backup drafts now (incremental)
  backupDraftsButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'backupNow', contentType: 'drafts' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Drafts backup started! Only new or changed content will be fetched.', 'success');
      }
    });
  });
  
  // Backup published posts now (incremental)
  backupPublishedButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'backupNow', contentType: 'published' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Published posts backup started! Only new or changed content will be fetched.', 'success');
      }
    });
  });
  
  // Force full backup for drafts
  forceBackupDraftsButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'forceFullBackup', contentType: 'drafts' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Full drafts backup started! All content will be re-fetched.', 'success');
      }
    });
  });
  
  // Force full backup for published posts
  forceBackupPublishedButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    chrome.runtime.sendMessage({ action: 'forceFullBackup', contentType: 'published' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting backup: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Full published posts backup started! All content will be re-fetched.', 'success');
      }
    });
  });
  
  // Helper function to update sync stats in the UI
  function updateSyncStats(draftsIndex, publishedIndex) {
    const draftsStatsElement = document.getElementById('draftsStats');
    const publishedStatsElement = document.getElementById('publishedStats');
    
    if (draftsStatsElement) {
      if (draftsIndex && draftsIndex.length > 0) {
        // Find the most recent update time
        const mostRecent = new Date(Math.max(...draftsIndex.map(item => new Date(item.updatedAt))));
        draftsStatsElement.textContent = `${draftsIndex.length} drafts cached (last updated: ${mostRecent.toLocaleString()})`;
      } else {
        draftsStatsElement.textContent = 'No drafts cached yet';
      }
    }
    
    if (publishedStatsElement) {
      if (publishedIndex && publishedIndex.length > 0) {
        // Find the most recent update time
        const mostRecent = new Date(Math.max(...publishedIndex.map(item => new Date(item.updatedAt || item.publishedAt))));
        publishedStatsElement.textContent = `${publishedIndex.length} published posts cached (last updated: ${mostRecent.toLocaleString()})`;
      } else {
        publishedStatsElement.textContent = 'No published posts cached yet';
      }
    }
  }
  
  // Helper function to show status messages
  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
    status.style.display = 'block';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }
  
  // Refresh stats when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      let draftsIndex, publishedIndex;
      
      if (changes.draftsIndex) {
        draftsIndex = changes.draftsIndex.newValue;
      }
      
      if (changes.publishedIndex) {
        publishedIndex = changes.publishedIndex.newValue;
      }
      
      chrome.storage.local.get(['draftsIndex', 'publishedIndex'], (data) => {
        updateSyncStats(
          draftsIndex || data.draftsIndex, 
          publishedIndex || data.publishedIndex
        );
      });
    }
  });
});