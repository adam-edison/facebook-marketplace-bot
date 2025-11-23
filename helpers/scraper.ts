import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export class Scraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  public page: Page | null = null;
  private storageStateFolder = 'cookies';

  /**
   * Initialize the browser with optional storage state (saved login)
   */
  async init(
    url: string = 'https://facebook.com',
    storageStatePath?: string
  ): Promise<void> {
    this.browser = await chromium.launch({
      headless: false,
      // Add options to make it look less like a bot and fix rendering
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    // Load storage state if provided (includes cookies, localStorage, sessionStorage)
    const contextOptions: any = {
      viewport: { width: 1280, height: 900 }, // Smaller, more standard viewport
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (storageStatePath && fs.existsSync(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
      console.log(`✅ Loaded saved login state from ${storageStatePath}`);
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    await this.page.goto(url);
  }

  /**
   * Check if user is logged in and optionally save login state
   */
  async ensureLoggedIn(
    loginUrl: string,
    isLoggedInSelector: string,
    storageStateFileName: string = 'facebook.json'
  ): Promise<void> {
    const storageStatePath = path.join(this.storageStateFolder, storageStateFileName);

    // Check if we're already logged in (from loaded storage state)
    const isLoggedIn = await this.page!.waitForSelector(isLoggedInSelector, { timeout: 5000 }).catch(() => null);
    
    if (isLoggedIn) {
      console.log('✅ Already logged in!');
      return;
    }

    // Not logged in - check if we have saved state
    if (fs.existsSync(storageStatePath)) {
      console.log('⚠️  Saved login state found but session expired. Please log in again.');
    } else {
      console.log('ℹ️  No saved login state found. Please log in.');
    }

    // Navigate to login page
    await this.page!.goto(loginUrl);

    // Wait for manual login
    console.log('\n📝 Please log in manually in the browser window.');
    console.log('⏱️  Waiting up to 5 minutes for login...\n');
    
    const loggedIn = await this.page!.waitForSelector(isLoggedInSelector, { timeout: 300000 }).catch(() => null);
    
    if (!loggedIn) {
      console.error('❌ Login timeout. Exiting.');
      process.exit(1);
    }

    // Save storage state for next time
    await this.saveStorageState(storageStatePath);
    console.log(`✅ Login successful! Saved state to ${storageStatePath}`);
  }

  /**
   * Save storage state (cookies + localStorage + sessionStorage)
   * This is better than just cookies - it preserves the full session
   */
  async saveStorageState(storageStatePath: string): Promise<void> {
    if (!fs.existsSync(this.storageStateFolder)) {
      fs.mkdirSync(this.storageStateFolder, { recursive: true });
    }

    await this.context!.storageState({ path: storageStatePath });
  }

  async goToPage(url: string): Promise<void> {
    await this.waitRandomTime();
    await this.page!.goto(url);
  }

  async waitRandomTime(min: number = 200, max: number = 1200): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.page!.waitForTimeout(delay);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

