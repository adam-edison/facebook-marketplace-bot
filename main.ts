import * as fs from 'fs';
import * as path from 'path';
import { getDataFromCsv } from './helpers/csvHelper';
import { updateListings } from './helpers/listingHelper';
import { Scraper } from './helpers/scraper';

async function main() {
  const scraper = new Scraper();
  
  try {
    // Try to load saved login state
    const storageStatePath = path.join('cookies', 'facebook.json');
    const hasSavedState = fs.existsSync(storageStatePath);
    
    // Initialize browser with saved state if available - go directly to marketplace
    await scraper.init('https://facebook.com/marketplace', hasSavedState ? storageStatePath : undefined);
    
    // Ensure we're logged in (will use saved state or prompt for login)
    await scraper.ensureLoggedIn(
      'https://facebook.com/marketplace',
      'svg[aria-label="Your profile"]',
      'facebook.json'
    );
    
    // Get data for item type listings
    const itemListings = getDataFromCsv('items');
    await updateListings(itemListings, 'item', 'items', scraper);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await scraper.close();
  }
}

main();

