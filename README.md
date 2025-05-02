# Square to Doc Chrome Extension

## Description

**Square to Doc** is a Chrome extension that crawls questions and answers from Square Base (https://square.base.vn) and saves them as readable plain text to a specified Google Doc. It is designed for teams and users who want to archive or process Q&A content from Square Base in a structured, accessible format.

## Features
- Extracts all questions and answers from a Square Base topic page
- Visits each question's detail page to get full content and all answers
- Converts HTML content to readable plain text with proper line breaks
- Saves the extracted data to a Google Doc using the Google Docs API
- Simple popup UI for entering the Square Base URL and Google Doc URL
- Handles Google OAuth2 authentication automatically

## Installation
1. Clone this repository:
   ```sh
   git clone https://github.com/trungpt1106/square-to-doc.git
   cd square-to-doc
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `square-to-doc` directory

## Usage
1. Open the Square Base topic page you want to crawl (e.g., https://square.base.vn/stack/8?topic=598)
2. Open your Google Doc and copy its URL
3. Click the Square to Doc extension icon in Chrome
4. Paste the Square Base URL and Google Doc URL into the popup
5. Click "Crawl and Save to Doc"
6. Wait for the process to complete. Success or error messages will be shown in the popup.
7. Check your Google Doc for the results!

## Permissions
- **identity**: For Google OAuth2 authentication
- **scripting, tabs**: To open and crawl Square Base pages in the background
- **storage**: To remember your last-used URLs
- **host permissions**: For Square Base and Google Docs API access

## Contribution
Pull requests and issues are welcome! Please open an issue if you find a bug or want to suggest a feature.

## License
MIT 