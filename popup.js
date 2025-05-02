document.addEventListener('DOMContentLoaded', function() {
  const crawlButton = document.getElementById('crawlButton');
  const squareUrlInput = document.getElementById('squareUrl');
  const docUrlInput = document.getElementById('docUrl');
  const statusDiv = document.getElementById('status');

  // Load saved URLs
  chrome.storage.local.get(['squareUrl', 'docUrl'], function(data) {
    if (data.squareUrl) squareUrlInput.value = data.squareUrl;
    if (data.docUrl) docUrlInput.value = data.docUrl;
  });

  crawlButton.addEventListener('click', async function() {
    console.log('Button clicked');
    const squareUrl = squareUrlInput.value.trim();
    const docUrl = docUrlInput.value.trim();

    if (!squareUrl || !docUrl) {
      showStatus('Please enter both URLs', 'error');
      return;
    }

    if (!docUrl.includes('docs.google.com/document')) {
      showStatus('Please enter a valid Google Doc URL', 'error');
      return;
    }

    // Save URLs
    chrome.storage.local.set({
      squareUrl: squareUrl,
      docUrl: docUrl
    });

    // Disable button and show loading state
    crawlButton.disabled = true;
    showStatus('Crawling and saving to Doc...', 'info');

    let responded = false;
    chrome.runtime.sendMessage({
      action: 'startFullCrawl',
      squareUrl,
      docUrl
    }, function(response) {
      responded = true;
      console.log('Popup received response:', response);
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        crawlButton.disabled = false;
        return;
      }
      if (response && response.error) {
        showStatus('Error: ' + response.error, 'error');
      } else if (response && response.success) {
        showStatus('Data saved successfully to Google Doc!', 'success');
      }
      crawlButton.disabled = false;
    });
    setTimeout(() => {
      if (!responded) {
        console.error('Popup: No response from background script (timeout)');
        showStatus('Error: No response from background script (timeout)', 'error');
        crawlButton.disabled = false;
      }
    }, 10000); // 10 seconds
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    
    // Hide status after 5 seconds if it's a success message
    if (type === 'success') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 5000);
    }
  }
}); 