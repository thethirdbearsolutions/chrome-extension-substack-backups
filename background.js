// Set up a recurring alarm every 60 minutes
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchDraftsAlarm', { periodInMinutes: 1 });
});

// Listen for the alarm and fetch drafts
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchDraftsAlarm') {
    fetchAndSaveDrafts();
  }
});

async function fetchAndSaveDrafts() {
  chrome.storage.sync.get(['substackUrl', 'downloadDir'], async (settings) => {

    let allDrafts = [];
    let offset = 0;
    const limit = 25;

    try {
      while (true) {
        // Fetch draft list
        const listResponse = await fetch(
          `https://${settings.substackUrl}/api/v1/post_management/drafts?offset=${offset}&limit=${limit}&order_by=draft_updated_at&order_direction=desc`
        );
      
        if (!listResponse.ok) {
          throw new Error(`Failed to fetch drafts list: ${listResponse.status}`);
        }
        
        const drafts = await listResponse.json();
        
        // If no more drafts, break the loop
        if (!drafts.posts.length) {
          break;
        }
        
        // Fetch individual draft details
        for (const draft of drafts.posts) {
          const detailResponse = await fetch(`https://${settings.substackUrl}/api/v1/drafts/${draft.id}`);
          
          if (!detailResponse.ok) {
            console.error(`Failed to fetch draft ${draft.id}: ${detailResponse.status}`);
            continue;
          }
          
          const draftDetail = await detailResponse.json();
          allDrafts.push({
            id: draft.id,
            title: draftDetail.draft_title,
            body: draftDetail.draft_body
          });
        }
        
        offset += limit;
      }
    } catch (error) {
      console.error('Error fetching Substack drafts', error);
    }

    saveDraftsToFile(allDrafts, settings.downloadDir);
  });
}

async function saveDraftsToFile(drafts, downloadDir) {
  await chrome.downloads.setUiOptions({ enabled: false });
  await chrome.downloads.setShelfEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 100)); // Add a short delay

  for (let draft of drafts) {
    const draftContent = JSON.stringify(JSON.parse(draft.body), null, 2);
    const blobUrl = `data:application/json;charset=utf-8,${encodeURIComponent(draftContent)}`;
    const fileName = `${downloadDir}/${(draft.title || 'untitled draft').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${draft.id}.json`;

    const result = await chrome.downloads.download({
      url: blobUrl,
      filename: fileName,
      saveAs: false,
      conflictAction: "overwrite",
    }).then(() => chrome.downloads.erase({ filenameRegex: fileName }));
  }

  await new Promise(resolve => setTimeout(resolve, 1000)); // Add a short delay  
  await chrome.downloads.setShelfEnabled(false);  
  await chrome.downloads.setUiOptions({ enabled: true });
}
