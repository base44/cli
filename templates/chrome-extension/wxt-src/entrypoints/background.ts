export default defineBackground(() => {
  console.log('Bookmark Extension background loaded');

  // Listen for messages from popup or content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CURRENT_TAB') {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) {
          sendResponse({
            url: tabs[0].url,
            title: tabs[0].title,
            favicon: tabs[0].favIconUrl,
          });
        }
      });
      return true; // Keep message channel open for async response
    }
  });
});
