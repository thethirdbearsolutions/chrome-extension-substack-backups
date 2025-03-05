// Set up recurring alarms when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchDraftsAlarm', { periodInMinutes: 60 });
  chrome.alarms.create('fetchPublishedAlarm', { periodInMinutes: 120 });
});

// Listen for alarms and fetch appropriate content
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchDraftsAlarm') {
    fetchAndSaveContent('drafts');
  } else if (alarm.name === 'fetchPublishedAlarm') {
    fetchAndSaveContent('published');
  }
});

// Listen for manual backup requests from options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'backupNow') {
    fetchAndSaveContent(message.contentType || 'drafts');
    sendResponse({ success: true });
  }
  return true;
});

async function fetchAndSaveContent(contentType) {
  chrome.storage.sync.get(['substackUrl', 'downloadDir', 'publishedDir'], async (settings) => {
    // Determine the appropriate API endpoint and directory based on content type
    let endpoint = contentType === 'drafts' 
      ? 'drafts' 
      : 'published';
    
    let directory = contentType === 'drafts' 
      ? settings.downloadDir 
      : settings.publishedDir;
    
    if (!directory) {
      console.error(`Directory for ${contentType} not set`);
      return;
    }

    let allContent = [];
    let offset = 0;
    const limit = 25;

    try {
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
        
        // Fetch individual content details
        for (const item of content.posts) {
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
            
            // Extract text excerpt from HTML
            let bodyText = "";
            try {
              bodyText = itemDetail.body_html
                .replace(/<[^>]*>?/gm, '') // Strip HTML tags
                .slice(0, 150) + '...';
            } catch (e) {
              console.error('Error extracting text from HTML body', e);
            }
            
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
              textExcerpt: bodyText,
              slug: item.slug || '',
              updatedAt: itemDetail.updated_at,
              publishedAt: itemDetail.post_date,
              coverImage: item.cover_image || null
            };
            
            allContent.push(contentItem);
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
          }
        }
        
        offset += limit;
      }
    } catch (error) {
      console.error(`Error fetching Substack ${contentType}`, error);
    }

    console.log('Got it all! Num:', allContent.length);
    
    // Sort content before saving
    if (contentType === 'drafts') {
      allContent.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } else {
      allContent.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    // Generate and save index.json
    generateAndSaveIndex(allContent, directory, contentType);
    
    // Save individual content files
    saveContentToFile(allContent, directory, contentType);
  });
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
      indexItem.textExcerpt = item.textExcerpt;
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
}

async function saveContentToFile(contentItems, directory, contentType) {
  await chrome.downloads.setUiOptions({ enabled: false });
  await chrome.downloads.setShelfEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 100)); // Add a short delay

  for (let item of contentItems) {
    try {
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
