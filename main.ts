import * as fs from 'fs';
import * as path from 'path';
import { getDataFromCsv } from './helpers/csvHelper';
import { updateListings } from './helpers/listingHelper';
import { Scraper } from './helpers/scraper';

async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let maxPosts: number | undefined = undefined;
  
  // Check for --max-posts or -n flag
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--max-posts' || args[i] === '-n') && i + 1 < args.length) {
      const value = parseInt(args[i + 1], 10);
      if (!isNaN(value) && value > 0) {
        maxPosts = value;
        console.log(`📊 Max posts limit set to: ${maxPosts}`);
      } else {
        console.error(`❌ Invalid value for ${args[i]}: ${args[i + 1]}`);
        console.log(`Usage: npx tsx main.ts [--max-posts|-n NUMBER]`);
        process.exit(1);
      }
      break;
    }
  }
  
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
    await updateListings(itemListings, 'item', 'items', scraper, maxPosts);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await scraper.close();
  }
}

main();

