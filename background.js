// Set up recurring alarms when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchDraftsAlarm', { periodInMinutes: 60 });
  chrome.alarms.create('fetchPublishedAlarm', { periodInMinutes: 120 });
});

// Keep track of backup status and results
const backupResults = {
  drafts: {
    inProgress: false,
    lastResult: null,
    lastTime: null,
    itemCount: 0,
    duration: 0
  },
  published: {
    inProgress: false,
    lastResult: null,
    lastTime: null,
    itemCount: 0,
    duration: 0
  }
};

// Listen for alarms and fetch appropriate content
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchDraftsAlarm') {
    fetchAndSaveContent('drafts');
  } else if (alarm.name === 'fetchPublishedAlarm') {
    fetchAndSaveContent('published');
  }
});

// Listen for manual backup requests and other messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'backupNow') {
    fetchAndSaveContent(message.contentType || 'drafts');
    sendResponse({ success: true });
  } else if (message.action === 'forceFullBackup') {
    fetchAndSaveContent(message.contentType || 'drafts', true);
    sendResponse({ success: true });
  } else if (message.action === 'getBackupStatus') {
    // Return current backup job status
    sendResponse({ 
      drafts: backupResults.drafts.inProgress,
      published: backupResults.published.inProgress
    });
  } else if (message.action === 'getBackupResults') {
    // Return all backup results
    sendResponse({ results: backupResults });
  }
  return true;
});

async function fetchAndSaveContent(contentType, forceFullBackup = false) {
  console.log(`Starting ${forceFullBackup ? 'full' : 'incremental'} backup of ${contentType}`);
  
  // Mark the job as active
  backupResults[contentType].inProgress = true;
  backupResults[contentType].lastResult = null;
  
  // Update badge
  updateBadge();
  
  chrome.storage.local.get(['substackUrl', 'downloadDir', 'publishedDir', 'draftsIndex', 'publishedIndex'], async (settings) => {
    // Determine the appropriate API endpoint and directory based on content type
    let endpoint = contentType === 'drafts' 
      ? 'drafts' 
      : 'published';
    
    let directory = contentType === 'drafts' 
      ? settings.downloadDir 
      : settings.publishedDir;
    
    // Get cached index
    let cachedIndex = contentType === 'drafts' 
      ? settings.draftsIndex || [] 
      : settings.publishedIndex || [];
    
    if (!directory) {
      console.error(`Directory for ${contentType} not set`);
      
      // Update results with error
      backupResults[contentType] = {
        inProgress: false,
        lastResult: 'error',
        lastTime: new Date(),
        itemCount: 0,
        duration: 0,
        error: 'Directory not set'
      };
      
      // Update badge
      updateBadge();
      return;
    }

    let allContent = [];
    let contentToFetch = [];
    let offset = 0;
    const limit = 25;
    let fetchedCount = 0;
    let fetchStartTime = Date.now();

    try {
      // First pass: fetch all content listings to determine what's new or changed
      while (true) {
        // Fetch content list
        const listResponse = await fetch(
          `https://${settings.substackUrl}/api/v1/post_management/${endpoint}?offset=${offset}&limit=${limit}&order_by=${contentType === 'drafts' ? 'draft_updated_at' : 'post_date'}&order_direction=desc`
        );
      
        if (!listResponse.ok) {
          throw new Error(`Failed to fetch ${contentType} list: ${listResponse.status}`);
        }
        
        const content = await listResponse.json();
        
        // If no more content, break the loop
        if (!content.posts || !content.posts.length) {
          break;
        }
        
        // Compare with cached index to find new or updated items
        for (const item of content.posts) {
          const cachedItem = cachedIndex.find(cached => cached.id === item.id);
          
          // For drafts, check update timestamps
          if (contentType === 'drafts') {
            // If item is new or has been updated since last fetch
            if (!cachedItem || 
                new Date(item.draft_updated_at) > new Date(cachedItem.updatedAt) ||
                forceFullBackup) {
              contentToFetch.push(item);
            }
          } 
          // For published posts, check if it's new or modified
          else {
            // For published posts, we might need to check additional properties
            if (!cachedItem || 
                (item.updated_at && new Date(item.updated_at) > new Date(cachedItem.updatedAt)) ||
                forceFullBackup) {
              contentToFetch.push(item);
            }
          }
        }
        
        offset += limit;
      }
      
      console.log(`Content to fetch: ${contentToFetch.length} out of ${offset} items`);
      
      // Second pass: fetch detailed content for new or changed items
      for (const item of contentToFetch) {
        let itemDetail;
        let bodyContent;
        
        if (contentType === 'published') {
          // For published posts, we need to fetch by slug
          const detailUrl = `https://${settings.substackUrl}/api/v1/posts/${item.slug}`;
          const detailResponse = await fetch(detailUrl);
          
          if (!detailResponse.ok) {
            console.error(`Failed to fetch published post ${item.slug}: ${detailResponse.status}`);
            continue;
          }
          
          itemDetail = await detailResponse.json();
          
          // Now also fetch the draft version to get the unrendered JSON
          const draftUrl = `https://${settings.substackUrl}/api/v1/drafts/${item.id}`;
          const draftResponse = await fetch(draftUrl);
          
          if (draftResponse.ok) {
            const draftDetail = await draftResponse.json();
            bodyContent = draftDetail.draft_body || draftDetail.body || itemDetail.body;
          } else {
            console.error(`Failed to fetch draft version of published post ${item.id}: ${draftResponse.status}`);
            bodyContent = itemDetail.body;
          }
          
          const contentItem = {
            id: item.id,
            title: itemDetail.title,
            body: bodyContent,
            slug: item.slug || '',
            updatedAt: itemDetail.updated_at,
            publishedAt: itemDetail.post_date,
            coverImage: item.cover_image || null
          };
          
          allContent.push(contentItem);
          fetchedCount++;
        } else {
          // For drafts, fetch by ID
          const detailUrl = `https://${settings.substackUrl}/api/v1/drafts/${item.id}`;
          const detailResponse = await fetch(detailUrl);
          
          if (!detailResponse.ok) {
            console.error(`Failed to fetch draft ${item.id}: ${detailResponse.status}`);
            continue;
          }
          
          itemDetail = await detailResponse.json();
          
          const contentItem = {
            id: item.id,
            title: itemDetail.draft_title,
            body: itemDetail.draft_body,
            slug: item.slug || '',
            updatedAt: itemDetail.draft_updated_at,
            coverImage: item.cover_image || null
          };
          
          allContent.push(contentItem);
          fetchedCount++;
        }
      }
      
      // If nothing has changed, we're done but still consider it a success
      if (allContent.length === 0) {
        console.log(`No new or updated ${contentType} content to save`);
        
        // Update results with success (0 items)
        backupResults[contentType] = {
          inProgress: false,
          lastResult: 'success',
          lastTime: new Date(),
          itemCount: 0,
          duration: Math.round((Date.now() - fetchStartTime) / 1000),
          message: 'No new content to back up'
        };
        
        // Update badge
        updateBadge();
        return;
      }
      
      console.log(`Finished fetching ${allContent.length} items`);
      
      // Need to merge with existing items that we didn't need to re-fetch
      let mergedContent = [...allContent];
      
      // Get the IDs of items we just fetched
      const fetchedIds = new Set(allContent.map(item => item.id));
      
      // Add items from cached index that weren't re-fetched
      if (cachedIndex.length > 0) {
        for (const cachedItem of cachedIndex) {
          if (!fetchedIds.has(cachedItem.id)) {
            // Create a content item similar to those we would have just fetched
            const contentItem = {
              id: cachedItem.id,
              title: cachedItem.title,
              body: null, // We don't have the body in the cached index
              slug: cachedItem.slug || '',
              updatedAt: cachedItem.updatedAt
            };
            
            if (contentType === 'published' && cachedItem.publishedAt) {
              contentItem.publishedAt = cachedItem.publishedAt;
              contentItem.coverImage = cachedItem.coverImage;
            }
            
            mergedContent.push(contentItem);
          }
        }
      }
      
      // Sort content before saving
      if (contentType === 'drafts') {
        mergedContent.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      } else {
        mergedContent.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
      }
      
      // Generate and save index.json
      const updatedIndex = await generateAndSaveIndex(mergedContent, directory, contentType);
      
      // Save updated index to storage
      if (contentType === 'drafts') {
        chrome.storage.local.set({ draftsIndex: updatedIndex });
      } else {
        chrome.storage.local.set({ publishedIndex: updatedIndex });
      }
      
      // Save individual content files for newly fetched content
      if (allContent.length > 0) {
        await saveContentToFile(allContent, directory, contentType);
      }
      
      // Calculate fetch duration
      const fetchDuration = Math.round((Date.now() - fetchStartTime) / 1000);
      
      // Update results with success
      backupResults[contentType] = {
        inProgress: false,
        lastResult: 'success',
        lastTime: new Date(),
        itemCount: fetchedCount,
        duration: fetchDuration
      };
      
      // Update badge
      updateBadge();
      
    } catch (error) {
      console.error(`Error fetching Substack ${contentType}`, error);
      
      // Update results with error
      backupResults[contentType] = {
        inProgress: false,
        lastResult: 'error',
        lastTime: new Date(),
        itemCount: 0,
        duration: 0,
        error: error.message
      };
      
      // Update badge
      updateBadge();
    }
  });
}

// Helper function to update the extension badge
function updateBadge() {
  // Check if any backups are in progress
  const anyInProgress = backupResults.drafts.inProgress || backupResults.published.inProgress;
  
  if (anyInProgress) {
    // Show a badge indicating backup in progress
    chrome.action.setBadgeText({ text: "⏳" });
    chrome.action.setBadgeBackgroundColor({ color: "#0366d6" });
  } else {
    // Check if we have any recent results
    const draftsSuccess = backupResults.drafts.lastResult === 'success';
    const publishedSuccess = backupResults.published.lastResult === 'success';
    const draftsError = backupResults.drafts.lastResult === 'error';
    const publishedError = backupResults.published.lastResult === 'error';
    
    if (draftsSuccess || publishedSuccess) {
      // Show success badge
      chrome.action.setBadgeText({ text: "✓" });
      chrome.action.setBadgeBackgroundColor({ color: "#28a745" });
      
      // Clear badge after 30 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "" });
      }, 30000);
    } else if (draftsError || publishedError) {
      // Show error badge
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });
    } else {
      // Clear badge
      chrome.action.setBadgeText({ text: "" });
    }
  }
}

async function generateAndSaveIndex(contentItems, directory, contentType) {
  console.log('generating index');
  
  // Create index array with metadata
  const indexData = contentItems.map(item => {
    // Create filename - add published date for published posts
    let fileName = '';
    if (contentType === 'published' && item.publishedAt) {
      const publishDate = new Date(item.publishedAt);
      const dateStr = publishDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      fileName += `${dateStr}_`;
    }
    
    fileName += `${(item.title || 'untitled')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()}_${item.id}.json`;
    
    // Build index object based on content type
    const indexItem = {
      id: item.id,
      title: item.title || 'Untitled',
      slug: item.slug || '',
      fileName: fileName,
      updatedAt: item.updatedAt
    };
    
    // Add published-specific fields
    if (contentType === 'published') {
      indexItem.publishedAt = item.publishedAt;
      indexItem.coverImage = item.coverImage;
    }
    
    return indexItem;
  });

  // Save the index file
  const indexJson = JSON.stringify(indexData, null, 2);
  const blobUrl = `data:application/json;charset=utf-8,${encodeURIComponent(indexJson)}`;
  const indexFileName = `${directory}/index.json`;

  console.log('about to save index');
  
  try {
    await chrome.downloads.setUiOptions({ enabled: false });
    await chrome.downloads.setShelfEnabled(false);
    
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: indexFileName,
      saveAs: false,
      conflictAction: "overwrite",
    });
    
    await chrome.downloads.setUiOptions({ enabled: true });
  } catch (error) {
    console.error(`Error saving index file for ${contentType}:`, error);
  }
  
  // Return the index data for caching in storage
  return indexData;
}

async function saveContentToFile(contentItems, directory, contentType) {
  await chrome.downloads.setUiOptions({ enabled: false });
  await chrome.downloads.setShelfEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 100)); // Add a short delay

  for (let item of contentItems) {
    try {
      // Skip items with no body content (these were cached)
      if (!item.body) continue;
      
      // Parse and re-stringify to ensure proper JSON formatting
      const itemContent = JSON.stringify(JSON.parse(item.body), null, 2);
      const blobUrl = `data:application/json;charset=utf-8,${encodeURIComponent(itemContent)}`;
      
      // Create filename - add published date for published posts
      let fileName = `${directory}/`;
      if (contentType === 'published' && item.publishedAt) {
        const publishDate = new Date(item.publishedAt);
        const dateStr = publishDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        fileName += `${dateStr}_`;
      }
      
      fileName += `${(item.title || 'untitled')
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()}_${item.id}.json`;

      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename: fileName,
        saveAs: false,
        conflictAction: "overwrite",
      });
      
    } catch (error) {
      console.error(`Error saving ${contentType} file:`, error);
    }
  }

  await new Promise(resolve => setTimeout(resolve, 1000)); // Add a short delay  
  await chrome.downloads.setShelfEnabled(false);  
  await chrome.downloads.setUiOptions({ enabled: true });
}