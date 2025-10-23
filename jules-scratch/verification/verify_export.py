
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        extension_path = '.'

        browser_context = await p.chromium.launch_persistent_context(
            '',
            headless=True,
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
            ]
        )

        page = await browser_context.new_page()
        await page.goto('https://twitter.com/i/bookmarks')

        # Give the content script a moment to load and start the export
        await page.wait_for_timeout(2000)

        # Wait for the progress bar to appear
        await page.wait_for_selector('#tbe-progress-container', timeout=5000)

        # Take a screenshot
        await page.screenshot(path='jules-scratch/verification/verification.png')

        await browser_context.close()

if __name__ == '__main__':
    asyncio.run(main())
