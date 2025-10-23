# XBookmarkDownloader

A Firefox browser extension to download your Twitter bookmarks to a markdown file.

## Features

-   **Export to Markdown:** Save all your Twitter bookmarks in a clean, readable markdown format.
-   **No Duplicates:** The add-on automatically remembers which bookmarks you've already exported and only includes new ones in subsequent downloads.
-   **Media Links:** Includes direct links to images and videos within the markdown file.
-   **Automatic Scraping:** Automatically scrolls through all your bookmarks to ensure a complete export.

## How to Install for Local Testing

Since this add-on is not on the official Firefox Add-on store, you can load it for testing purposes by following these steps:

1.  **Open Firefox** and navigate to the following URL: `about:debugging`
2.  In the left-hand menu, click on **"This Firefox"**.
3.  Click the **"Load Temporary Add-on..."** button.
4.  In the file selection dialog, navigate to the directory where you have the add-on's files, and select the `manifest.json` file.

The add-on will now be installed for your current browser session and will appear in your browser's toolbar.

## How to Use

1.  Log in to your Twitter account.
2.  Navigate to your bookmarks page: [https://twitter.com/i/bookmarks](https://twitter.com/i/bookmarks)
3.  Click on the XBookmarkDownloader icon in your browser's toolbar.
4.  Click the **"Start Export"** button.
5.  The add-on will begin scraping your bookmarks. You will see status updates in the popup.
6.  Once the export is complete, a "Save As" dialog will appear, allowing you to save your markdown file.
