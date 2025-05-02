// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'crawlChangelogs') {
    // Get all question links from the main page
    const questionLinks = Array.from(document.querySelectorAll('a.title')).map(link => ({
      url: link.href,
      title: link.textContent.trim()
    }));

    // Send the list of question URLs to the background script for crawling
    chrome.runtime.sendMessage({
      action: 'crawlQuestionsInBackground',
      questionLinks,
      docUrl: request.docUrl
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message to background:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (response && response.received) {
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Failed to crawl questions in background' });
      }
    });
    return true; // Keep the message channel open for async response
  }
}); 