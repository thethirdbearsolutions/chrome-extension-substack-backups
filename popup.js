document.addEventListener('DOMContentLoaded', () => {
  const backupDraftsButton = document.getElementById('backupDraftsNow');
  const backupPublishedButton = document.getElementById('backupPublishedNow');
  const forceBackupDraftsButton = document.getElementById('forceBackupDraftsNow');
  const forceBackupPublishedButton = document.getElementById('forceBackupPublishedNow');
  const openSettingsLink = document.getElementById('openSettings');
  const status = document.getElementById('status');
  const configStatus = document.getElementById('configStatus');
  const backupOptions = document.getElementById('backupOptions');
  const resultsContainer = document.getElementById('resultsContainer');
  
  // Load settings and update UI
  checkConfiguration();
  updateBackupResults();
  
  // Poll for backup status updates
  const statusInterval = setInterval(updateBackupResults, 2000);
  
  // Clear interval when popup closes
  window.addEventListener('unload', () => {
    clearInterval(statusInterval);
  });
  
  // Open settings page
  openSettingsLink.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Backup drafts (incremental)
  backupDraftsButton.addEventListener('click', () => {
    startBackup('drafts', false);
  });
  
  // Backup published posts (incremental)
  backupPublishedButton.addEventListener('click', () => {
    startBackup('published', false);
  });
  
  // Force full backup for drafts
  forceBackupDraftsButton.addEventListener('click', () => {
    startBackup('drafts', true);
  });
  
  // Force full backup for published posts
  forceBackupPublishedButton.addEventListener('click', () => {
    startBackup('published', true);
  });
  
  // Function to start backup and show status
  function startBackup(contentType, forceFullBackup) {
    const action = forceFullBackup ? 'forceFullBackup' : 'backupNow';
    const contentName = contentType === 'drafts' ? 'drafts' : 'published posts';
    const backupType = forceFullBackup ? 'Full' : 'Incremental';
    
    showStatus(`Starting ${backupType.toLowerCase()} backup of ${contentName}...`, 'info');
    
    // Start the backup
    chrome.runtime.sendMessage({ 
      action: action, 
      contentType: contentType 
    }, (backupResponse) => {
      if (chrome.runtime.lastError) {
        console.error("Error starting backup:", chrome.runtime.lastError);
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        console.log("Successfully started backup");
        showStatus(`${backupType} backup of ${contentName} in progress...`, 'info');
        
        // Immediately check status
        updateBackupResults();
      }
    });
  }
  
  // Helper function to update backup results in the UI
  function updateBackupResults() {
    chrome.runtime.sendMessage({ action: 'getBackupResults' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.results) {
        console.error("Error getting backup results:", chrome.runtime.lastError);
        return;
      }
      
      const results = response.results;
      
      // Update results display
      if (resultsContainer) {
        let html = '<h3>Recent Backup Results</h3>';
        
        // Drafts results
        html += '<div class="result-item">';
        html += '<strong>Drafts: </strong>';
        
        if (results.drafts.inProgress) {
          html += '<span class="badge in-progress">In Progress</span>';
        } else if (results.drafts.lastResult === 'success') {
          html += '<span class="badge success">Success</span> ';
          html += `<span class="result-details">${results.drafts.itemCount} items in ${results.drafts.duration}s`;
          if (results.drafts.lastTime) {
            html += ` (${formatTimeAgo(results.drafts.lastTime)})`;
          }
          html += '</span>';
        } else if (results.drafts.lastResult === 'error') {
          html += '<span class="badge error">Error</span> ';
          html += `<span class="result-details">${results.drafts.error}`;
          if (results.drafts.lastTime) {
            html += ` (${formatTimeAgo(results.drafts.lastTime)})`;
          }
          html += '</span>';
        } else {
          html += '<span class="result-details">No recent backups</span>';
        }
        html += '</div>';
        
        // Published results
        html += '<div class="result-item">';
        html += '<strong>Published: </strong>';
        
        if (results.published.inProgress) {
          html += '<span class="badge in-progress">In Progress</span>';
        } else if (results.published.lastResult === 'success') {
          html += '<span class="badge success">Success</span> ';
          html += `<span class="result-details">${results.published.itemCount} items in ${results.published.duration}s`;
          if (results.published.lastTime) {
            html += ` (${formatTimeAgo(results.published.lastTime)})`;
          }
          html += '</span>';
        } else if (results.published.lastResult === 'error') {
          html += '<span class="badge error">Error</span> ';
          html += `<span class="result-details">${results.published.error}`;
          if (results.published.lastTime) {
            html += ` (${formatTimeAgo(results.published.lastTime)})`;
          }
          html += '</span>';
        } else {
          html += '<span class="result-details">No recent backups</span>';
        }
        html += '</div>';
        
        resultsContainer.innerHTML = html;
      }
    });
  }
  
  // Helper function to format time ago
  function formatTimeAgo(timeStr) {
    const date = new Date(timeStr);
    const now = new Date();
    const diffMs = now - date;
    
    // Convert to seconds
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) {
      return 'just now';
    } else if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffSec / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  }
  
  // Helper function to show status messages
  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
    status.style.display = 'block';
  }
  
  // Helper function to check configuration and update UI
  function checkConfiguration() {
    chrome.storage.local.get(['substackUrl', 'downloadDir', 'publishedDir', 'draftsIndex', 'publishedIndex'], (data) => {
      // Check if the extension is properly configured
      if (!data.substackUrl || !data.downloadDir || !data.publishedDir) {
        configStatus.innerHTML = `
          <div class="status error">
            <strong>Extension not fully configured.</strong><br>
            Please open settings to set up your Substack URL and backup locations.
          </div>
        `;
        backupOptions.style.display = 'none';
      } else {
        configStatus.innerHTML = '';
        backupOptions.style.display = 'block';
        
        // Update stats in the UI
        updateSyncStats(data.draftsIndex, data.publishedIndex);
      }
    });
  }
  
  // Helper function to update sync stats in the UI
  function updateSyncStats(draftsIndex, publishedIndex) {
    const draftsStatsElement = document.getElementById('draftsStats');
    const publishedStatsElement = document.getElementById('publishedStats');
    
    if (draftsIndex && draftsIndex.length > 0) {
      // Find the most recent update time
      const mostRecent = new Date(Math.max(...draftsIndex.map(item => new Date(item.updatedAt))));
      draftsStatsElement.textContent = `${draftsIndex.length} drafts cached (last updated: ${mostRecent.toLocaleString()})`;
    } else {
      draftsStatsElement.textContent = 'No drafts cached yet';
    }
    
    if (publishedIndex && publishedIndex.length > 0) {
      // Find the most recent update time
      const mostRecent = new Date(Math.max(...publishedIndex.map(item => new Date(item.updatedAt || item.publishedAt))));
      publishedStatsElement.textContent = `${publishedIndex.length} published posts cached (last updated: ${mostRecent.toLocaleString()})`;
    } else {
      publishedStatsElement.textContent = 'No published posts cached yet';
    }
  }
});