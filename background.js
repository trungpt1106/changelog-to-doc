// Store the last crawl time
let lastCrawlTime = null;

console.log('Background service worker loaded');

// Function to format question data for Google Docs
function formatQuestionData(questions) {
  let formattedText = '';
  
  questions.forEach((question, index) => {
    formattedText += `Question ${index + 1}: ${question.title}\n`;
    formattedText += `Author: ${question.author}\n`;
    formattedText += `Date: ${question.date}\n\n`;
    formattedText += `Content:\n${question.content}\n\n`;
    
    if (question.answers.length > 0) {
      formattedText += 'Answers:\n';
      question.answers.forEach((answer, ansIndex) => {
        formattedText += `\nAnswer ${ansIndex + 1}${answer.isAccepted ? ' (Accepted)' : ''}:\n`;
        formattedText += `Author: ${answer.author}\n`;
        formattedText += `Date: ${answer.date}\n`;
        formattedText += `Content:\n${answer.content}\n`;
      });
    }
    
    formattedText += '\n---\n\n';
  });
  
  return formattedText;
}

// Move saveToDoc logic into a reusable async function
async function saveQuestionsToDoc(data, docUrl) {
  const formattedText = formatQuestionData(data);
  try {
    const match = docUrl.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('Invalid Google Doc URL');
    const DOCUMENT_ID = match[1];
    const token = await getAuthToken();
    const tokenStr = typeof token === 'string' ? token : (token && token.token ? token.token : '');
    if (!tokenStr) throw new Error('Could not obtain authentication token');
    const docResponse = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOCUMENT_ID}`,
      { headers: { 'Authorization': `Bearer ${tokenStr}`, 'Content-Type': 'application/json' } }
    );
    if (!docResponse.ok) {
      const errorData = await docResponse.json();
      throw new Error(`Failed to get document: ${errorData.error?.message || 'Unknown error'}`);
    }
    const docData = await docResponse.json();
    let currentIndex = docData.body.content[docData.body.content.length - 1].endIndex - 1;
    const requests = [{
      insertText: {
        location: { index: currentIndex },
        text: formattedText
      }
    }];
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOCUMENT_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenStr}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      }
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to save to Google Doc: ${errorData.error?.message || 'Unknown error'}`);
    }
    return { received: true };
  } catch (error) {
    console.error('Error saving to Google Doc:', error);
    return { received: false, error: error.message };
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);

  if (request.action === 'saveToDoc') {
    return new Promise(async (resolve) => {
      let resolved = false;
      function safeResolve(obj) {
        if (!resolved) {
          resolved = true;
          console.log('Resolving saveToDoc:', obj);
          resolve(obj);
        }
      }
      setTimeout(() => safeResolve({ received: false, error: 'Timeout' }), 30000);
      const { data, docUrl } = request;
      const result = await saveQuestionsToDoc(data, docUrl);
      safeResolve(result);
    });
  }

  if (request.action === 'crawlQuestionsInBackground') {
    return new Promise((resolve) => {
      let resolved = false;
      function safeResolve(obj) {
        if (!resolved) {
          resolved = true;
          console.log('Resolving crawlQuestionsInBackground:', obj);
          resolve(obj);
        }
      }
      setTimeout(() => safeResolve({ received: false, error: 'Timeout' }), 30000);
      const { questionLinks, docUrl } = request;
      const results = [];
      let completed = 0;
      let errored = false;
      function finish() {
        if (!errored) {
          saveQuestionsToDoc(results, docUrl).then(result => {
            safeResolve({ received: !!result.received, error: result.error });
          });
        }
      }
      questionLinks.forEach((q, idx) => {
        chrome.tabs.create({ url: q.url, active: false }, tab => {
          function tryInject(retries = 0) {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                function htmlToTextWithLineBreaks(node) {
                  if (!node) return '';
                  const clone = node.cloneNode(true);
                  // Replace <br> with newlines
                  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                  // Add newlines after block elements
                  const blockTags = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
                  blockTags.forEach(tag => {
                    clone.querySelectorAll(tag).forEach(el => {
                      el.insertAdjacentText('afterend', '\n');
                    });
                  });
                  // Get the text content, collapse multiple newlines
                  return clone.textContent.replace(/\n{2,}/g, '\n').replace(/\n +/g, '\n').trim();
                }
                try {
                  const mainQ = document.querySelector('#js-main-question');
                  const title = mainQ?.querySelector('.header .title span')?.textContent.trim() || '';
                  const author = mainQ?.querySelector('.header .info em')?.textContent.trim() || '';
                  const dateText = mainQ?.querySelector('.header .info')?.textContent || '';
                  const dateMatch = dateText.match(/Đặt câu hỏi lúc (.*?) bởi/);
                  const date = dateMatch ? dateMatch[1].trim() : '';
                  const contentNode = mainQ?.querySelector('.content.text-editor');
                  const content = contentNode ? htmlToTextWithLineBreaks(contentNode) : '';
                  const votes = mainQ?.querySelector('.vote-area .count')?.textContent.trim() || '';
                  const tags = Array.from(mainQ?.querySelectorAll('.footer-tags .ui-tag') || []).map(tag => tag.textContent.trim());
                  const answerElements = document.querySelectorAll('.answer-wrap');
                  const answers = Array.from(answerElements).map(answerEl => {
                    const isAccepted = answerEl.querySelector('.answer.js-answer-main.-accepted, .accepted-header') !== null;
                    const answerMain = answerEl.querySelector('.answer.js-answer-main');
                    const userinfo = answerEl.querySelector('.userinfo');
                    const author = userinfo?.querySelector('.name')?.textContent.trim() || '';
                    let date = '';
                    const footerLinks = answerEl.querySelector('.footer .links');
                    if (footerLinks) {
                      const dateMatch = footerLinks.textContent.match(/Đã gửi (.*?) ·/);
                      if (dateMatch) date = dateMatch[1].trim();
                    }
                    if (!date) {
                      const acceptedLabel = answerEl.querySelector('.accepted-header .label');
                      if (acceptedLabel) {
                        const match = acceptedLabel.textContent.match(/lúc (.*?)$/);
                        if (match) date = match[1].trim();
                      }
                    }
                    const contentNode = answerEl.querySelector('.content .text-editor');
                    const content = contentNode ? htmlToTextWithLineBreaks(contentNode) : '';
                    const votes = answerEl.querySelector('.vote-area .count')?.textContent.trim() || '0';
                    return {
                      isAccepted,
                      author,
                      date,
                      content,
                      votes: parseInt(votes, 10)
                    };
                  });
                  return {
                    title,
                    author,
                    date,
                    content,
                    votes,
                    tags,
                    answers
                  };
                } catch (error) {
                  return null;
                }
              },
            }, async (injectionResults) => {
              let data = null;
              if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                data = injectionResults[0].result;
              }
              if (data && data.title) {
                results[idx] = data;
                chrome.tabs.remove(tab.id);
                completed++;
                if (completed === questionLinks.length) finish();
              } else if (retries < 5) {
                setTimeout(() => tryInject(retries + 1), 800);
              } else {
                results[idx] = null;
                chrome.tabs.remove(tab.id);
                completed++;
                if (completed === questionLinks.length) finish();
              }
            });
          }
          setTimeout(() => tryInject(0), 1200);
        });
      });
    });
  }

  if (request.action === 'startFullCrawl') {
    const { squareUrl, docUrl } = request;
    return new Promise((resolve) => {
      let resolved = false;
      function safeResolve(obj) {
        if (!resolved) {
          resolved = true;
          console.log('Resolving startFullCrawl:', obj);
          resolve(obj);
        }
      }
      setTimeout(() => safeResolve({ success: false, error: 'Timeout' }), 30000);
      try {
        console.log('startFullCrawl: About to create tab for', squareUrl);
        chrome.tabs.create({ url: squareUrl, active: false }, function(mainTab) {
          console.log('startFullCrawl: chrome.tabs.create callback', mainTab, chrome.runtime.lastError);
          if (chrome.runtime.lastError || !mainTab) {
            console.log('startFullCrawl: Tab creation failed');
            safeResolve({ success: false, error: 'Failed to open main page tab.' });
            return;
          }
          function tryExtractLinks(retries = 0) {
            console.log('startFullCrawl: About to executeScript for links, retry', retries);
            chrome.scripting.executeScript({
              target: { tabId: mainTab.id },
              func: () => {
                return Array.from(document.querySelectorAll('a.title')).map(link => ({
                  url: link.href,
                  title: link.textContent.trim()
                }));
              }
            }, function(results) {
              console.log('startFullCrawl: Results from executeScript', results, chrome.runtime.lastError);
              if (chrome.runtime.lastError || !results || !results[0] || !Array.isArray(results[0].result) || results[0].result.length === 0) {
                if (retries < 5) {
                  setTimeout(() => tryExtractLinks(retries + 1), 1000);
                  return;
                }
                console.log('startFullCrawl: Failed to extract question links from main page');
                safeResolve({ success: false, error: 'Failed to extract question links from main page.' });
                chrome.tabs.remove(mainTab.id);
                return;
              }
              const questionLinks = results[0].result;
              const resultsArr = [];
              let completed = 0;
              if (questionLinks.length === 0) {
                console.log('startFullCrawl: No question links found');
                safeResolve({ success: false, error: 'No question links found.' });
                chrome.tabs.remove(mainTab.id);
                return;
              }
              questionLinks.forEach((q, idx) => {
                console.log('startFullCrawl: About to create tab for question', q.url);
                chrome.tabs.create({ url: q.url, active: false }, function(tab) {
                  console.log('startFullCrawl: chrome.tabs.create for question callback', tab, chrome.runtime.lastError);
                  if (chrome.runtime.lastError || !tab) {
                    resultsArr[idx] = null;
                    completed++;
                    if (completed === questionLinks.length) {
                      chrome.tabs.remove(mainTab.id);
                      saveQuestionsToDoc(resultsArr, docUrl).then(result => {
                        console.log('startFullCrawl: Resolving after saveToDoc', result);
                        safeResolve({ success: !!result.received, error: result.error });
                      });
                    }
                    return;
                  }
                  function tryExtractQuestion(retriesQ = 0) {
                    console.log('startFullCrawl: About to executeScript for question, retry', retriesQ);
                    chrome.scripting.executeScript({
                      target: { tabId: tab.id },
                      func: () => {
                        function htmlToTextWithLineBreaks(node) {
                          if (!node) return '';
                          const clone = node.cloneNode(true);
                          // Replace <br> with newlines
                          clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                          // Add newlines after block elements
                          const blockTags = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
                          blockTags.forEach(tag => {
                            clone.querySelectorAll(tag).forEach(el => {
                              el.insertAdjacentText('afterend', '\n');
                            });
                          });
                          // Get the text content, collapse multiple newlines
                          return clone.textContent.replace(/\n{2,}/g, '\n').replace(/\n +/g, '\n').trim();
                        }
                        try {
                          const mainQ = document.querySelector('#js-main-question');
                          const title = mainQ?.querySelector('.header .title span')?.textContent.trim() || '';
                          const author = mainQ?.querySelector('.header .info em')?.textContent.trim() || '';
                          const dateText = mainQ?.querySelector('.header .info')?.textContent || '';
                          const dateMatch = dateText.match(/Đặt câu hỏi lúc (.*?) bởi/);
                          const date = dateMatch ? dateMatch[1].trim() : '';
                          const contentNode = mainQ?.querySelector('.content.text-editor');
                          const content = contentNode ? htmlToTextWithLineBreaks(contentNode) : '';
                          const votes = mainQ?.querySelector('.vote-area .count')?.textContent.trim() || '';
                          const tags = Array.from(mainQ?.querySelectorAll('.footer-tags .ui-tag') || []).map(tag => tag.textContent.trim());
                          const answerElements = document.querySelectorAll('.answer-wrap');
                          const answers = Array.from(answerElements).map(answerEl => {
                            const isAccepted = answerEl.querySelector('.answer.js-answer-main.-accepted, .accepted-header') !== null;
                            const answerMain = answerEl.querySelector('.answer.js-answer-main');
                            const userinfo = answerEl.querySelector('.userinfo');
                            const author = userinfo?.querySelector('.name')?.textContent.trim() || '';
                            let date = '';
                            const footerLinks = answerEl.querySelector('.footer .links');
                            if (footerLinks) {
                              const dateMatch = footerLinks.textContent.match(/Đã gửi (.*?) ·/);
                              if (dateMatch) date = dateMatch[1].trim();
                            }
                            if (!date) {
                              const acceptedLabel = answerEl.querySelector('.accepted-header .label');
                              if (acceptedLabel) {
                                const match = acceptedLabel.textContent.match(/lúc (.*?)$/);
                                if (match) date = match[1].trim();
                              }
                            }
                            const contentNode = answerEl.querySelector('.content .text-editor');
                            const content = contentNode ? htmlToTextWithLineBreaks(contentNode) : '';
                            const votes = answerEl.querySelector('.vote-area .count')?.textContent.trim() || '0';
                            return {
                              isAccepted,
                              author,
                              date,
                              content,
                              votes: parseInt(votes, 10)
                            };
                          });
                          return {
                            title,
                            author,
                            date,
                            content,
                            votes,
                            tags,
                            answers
                          };
                        } catch (error) {
                          return null;
                        }
                      }
                    }, function(qResults) {
                      console.log('startFullCrawl: Results from executeScript for question', qResults, chrome.runtime.lastError);
                      let data = null;
                      if (qResults && qResults[0] && qResults[0].result) {
                        data = qResults[0].result;
                      }
                      if (data && data.title) {
                        resultsArr[idx] = data;
                        chrome.tabs.remove(tab.id);
                        completed++;
                        if (completed === questionLinks.length) {
                          chrome.tabs.remove(mainTab.id);
                          saveQuestionsToDoc(resultsArr, docUrl).then(result => {
                            console.log('startFullCrawl: Resolving after saveToDoc', result);
                            safeResolve({ success: !!result.received, error: result.error });
                          });
                        }
                      } else if (retriesQ < 5) {
                        setTimeout(() => tryExtractQuestion(retriesQ + 1), 1000);
                      } else {
                        resultsArr[idx] = null;
                        chrome.tabs.remove(tab.id);
                        completed++;
                        if (completed === questionLinks.length) {
                          chrome.tabs.remove(mainTab.id);
                          saveQuestionsToDoc(resultsArr, docUrl).then(result => {
                            console.log('startFullCrawl: Resolving after saveToDoc', result);
                            safeResolve({ success: !!result.received, error: result.error });
                          });
                        }
                      }
                    });
                  }
                  setTimeout(() => tryExtractQuestion(0), 1200);
                });
              });
            });
          }
          setTimeout(() => tryExtractLinks(0), 1500);
        });
      } catch (error) {
        console.log('startFullCrawl: Exception', error);
        safeResolve({ success: false, error: error.message });
      }
    });
  }

  if (request.action === 'getLastCrawlTime') {
    sendResponse({
      lastCrawlTime: lastCrawlTime ? lastCrawlTime.toLocaleString() : 'Never',
      timestamp: lastCrawlTime ? lastCrawlTime.getTime() : null
    });
    return true;
  }

  return false;
});

// Function to get OAuth token
async function getAuthToken() {
  try {
    const token = await chrome.identity.getAuthToken({ interactive: true });
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

function formatQuestionForDoc(question) {
  let formattedText = '';
  
  // Add question title
  formattedText += `Câu hỏi: ${question.title}\n\n`;
  
  // Add question details
  formattedText += `Người hỏi: ${question.author}\n`;
  formattedText += `Ngày đăng: ${question.date}\n\n`;
  
  // Add question content
  formattedText += `Nội dung câu hỏi:\n${question.content}\n\n`;
  
  // Add answers
  if (question.answers.length > 0) {
    formattedText += 'Các câu trả lời:\n\n';
    question.answers.forEach((answer, index) => {
      formattedText += `Câu trả lời ${index + 1}${answer.isAccepted ? ' (Đã được chấp nhận)' : ''}:\n`;
      formattedText += `Người trả lời: ${answer.author}\n`;
      formattedText += `Ngày trả lời: ${answer.date}\n`;
      formattedText += `Số lượt thích: ${answer.votes}\n\n`;
      formattedText += `Nội dung trả lời:\n${answer.content}\n\n`;
      formattedText += '----------------------------------------\n\n';
    });
  } else {
    formattedText += 'Chưa có câu trả lời nào.\n\n';
  }
  
  return formattedText;
} 