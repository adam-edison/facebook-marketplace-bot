/**
 * Helper script to save your Facebook login state
 * Run this once to log in and save your session
 * 
 * Usage: npm run login
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';

async function saveLogin() {
  const storageStatePath = path.join('cookies', 'facebook.json');
  
  console.log('🚀 Opening browser...');
  console.log('📝 Please log in to Facebook in the browser window.');
  console.log('⏱️  Waiting for login...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  await page.goto('https://facebook.com');

  // Wait for login indicator (profile icon)
  try {
    await page.waitForSelector('svg[aria-label="Your profile"]', { timeout: 300000 });
    console.log('✅ Login detected!');

    // Save storage state
    if (!fs.existsSync('cookies')) {
      fs.mkdirSync('cookies', { recursive: true });
    }

    await context.storageState({ path: storageStatePath });
    console.log(`✅ Login state saved to ${storageStatePath}`);
    console.log('🎉 You can now run the bot without logging in again!');
    console.log('   (Until the session expires - usually weeks/months)');

  } catch (error) {
    console.error('❌ Login timeout or error:', error);
    console.log('💡 Make sure you log in within 5 minutes');
  } finally {
    await browser.close();
  }
}

saveLogin();

