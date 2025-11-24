import { execSync } from 'child_process';
import * as fs from 'fs';
import { ListingData, updateCsvStatus } from './csvHelper';
import { Scraper } from './scraper';

/**
 * Calculate similarity score between CSV category path and Facebook dropdown option
 * Returns a score between 0 (no match) and 1 (perfect match)
 * Prioritizes matches where parent categories align
 */
function calculateSimilarity(csvCategory: string, dropdownText: string): number {
  const s1 = csvCategory.toLowerCase().trim();
  const s2 = dropdownText.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Extract category segments from CSV (e.g., "Hand Tools // Wrenches" -> ["Hand Tools", "Wrenches"])
  const csvSegments = s1.split('//').map(s => s.trim()).filter(s => s.length > 0);
  const finalCategory = csvSegments[csvSegments.length - 1]; // "wrenches"
  const parentCategory = csvSegments.length > 1 ? csvSegments[csvSegments.length - 2] : ''; // "hand tools"
  
  // Base word matching score
  const words1 = s1.split(/[\s\/\\,·•]+/).filter(w => w.length > 2); // Filter out very short words
  const words2 = s2.split(/[\s\/\\,·•]+/).filter(w => w.length > 2);
  
  let matchCount = 0;
  let parentCategoryMatch = false;
  let finalCategoryMatch = false;
  
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2 || (word1.length > 3 && word2.includes(word1)) || (word2.length > 3 && word1.includes(word2))) {
        matchCount++;
        
        // Check if this is the parent or final category
        if (parentCategory && word1 === parentCategory.split(/\s+/)[0]) {
          parentCategoryMatch = true;
        }
        if (finalCategory && word1 === finalCategory.split(/\s+/)[0]) {
          finalCategoryMatch = true;
        }
        break;
      }
    }
  }
  
  const wordMatchScore = matchCount / Math.max(words1.length, words2.length);
  
  // Bonus for parent category match (e.g., "Hand Tools" in dropdown when CSV has "Hand Tools")
  let parentBonus = 0;
  if (parentCategory) {
    // Check if the parent category appears in the dropdown text
    const parentWords = parentCategory.split(/\s+/);
    const allParentWordsFound = parentWords.every(pw => 
      s2.includes(pw.toLowerCase())
    );
    if (allParentWordsFound) {
      parentBonus = 0.3; // Strong bonus for parent category match
      parentCategoryMatch = true;
    } else if (parentCategoryMatch) {
      parentBonus = 0.15; // Partial bonus
    }
  }
  
  // Bonus for final category match
  const finalBonus = finalCategoryMatch ? 0.1 : 0;
  
  // Check if one contains the other
  let containsBonus = 0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = Math.max(s1.length, s2.length);
    const shorter = Math.min(s1.length, s2.length);
    containsBonus = (shorter / longer) * 0.1;
  }
  
  // Combine scores: word matching (50%), parent bonus (30%), final bonus (10%), contains bonus (10%)
  return Math.min(1.0, wordMatchScore * 0.5 + parentBonus + finalBonus + containsBonus);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  
  return dp[m][n];
}

export async function updateListings(
  listings: ListingData[],
  type: 'item' | 'vehicle',
  csvFileName: string,
  scraper: Scraper,
  maxPosts?: number
): Promise<void> {
  if (!listings || listings.length === 0) {
    return;
  }

  let postsCount = 0;

  for (const listing of listings) {
    // Check if we've reached the max posts limit
    if (maxPosts !== undefined && postsCount >= maxPosts) {
      console.log(`\n🛑 Reached max posts limit (${maxPosts}). Stopping.`);
      console.log(`📊 Posted ${postsCount} out of ${listings.length} total listings.`);
      break;
    }

    // Skip if already posted (shouldn't happen due to filtering, but double-check)
    if (listing.Status && listing.Status.trim().toLowerCase() === 'posted') {
      console.log(`⏭️  Skipping already posted: "${listing['Title']}"`);
      continue;
    }

    // Publish the listing
    let isPublished = await publishListing(listing, type, csvFileName, scraper);

    // If not published, try again
    if (!isPublished) {
      isPublished = await publishListing(listing, type, csvFileName, scraper);
    }

    // Increment counter if successfully published
    if (isPublished) {
      postsCount++;
      if (maxPosts !== undefined) {
        console.log(`📈 Progress: ${postsCount}/${maxPosts} posts completed`);
      }
    }
  }

  if (maxPosts === undefined || postsCount < maxPosts) {
    console.log(`\n✅ Finished posting all available listings (${postsCount} total).`);
  }
}

async function publishListing(
  data: ListingData,
  listingType: 'item' | 'vehicle',
  csvFileName: string,
  scraper: Scraper
): Promise<boolean> {
  // Navigate to create page
  await scraper.goToPage(`https://facebook.com/marketplace/create/${listingType}`);

  // Wait for the form to load - wait for file input to exist in DOM (it can be hidden)
  await scraper.page!.waitForSelector('input[accept*="image"], input[accept*="video"]', { timeout: 15000, state: 'attached' });

  // Wait a bit for form to fully render
  await scraper.page!.waitForTimeout(1000);

  // Check if we have a video
  // NOTE: Automated video upload is DISABLED - Facebook blocks it with trusted event detection
  // Even CDP (Chrome DevTools Protocol) at browser-engine level + AppleScript doesn't work
  // Facebook detects that events weren't from genuine user interaction
  // Videos must be added manually after the listing is posted
  const ENABLE_VIDEO_UPLOAD = false; // Set to true to attempt (will fail)
  
  const hasVideo = data['Video Name'] && data['Video Name'].trim();
  const videoPath = hasVideo ? generateVideoPath(data['Photos Folder'], data['Video Name']) : null;
  
  if (hasVideo && videoPath && fs.existsSync(videoPath)) {
    if (!ENABLE_VIDEO_UPLOAD) {
      const stats = fs.statSync(videoPath);
      console.log(`📹 Video found (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${videoPath}`);
      console.log(`⚠️  Automated video upload is DISABLED - Facebook blocks it`);
      console.log(`   To add video: manually edit the listing after it's posted`);
      
      // Save video info to items-videos.json for manual upload later
      try {
        const videosJsonPath = './items-videos.json';
        let videosData: Array<{ title: string; videoPath: string; size: string; dateAdded: string }> = [];
        
        // Load existing data if file exists
        if (fs.existsSync(videosJsonPath)) {
          const existingData = fs.readFileSync(videosJsonPath, 'utf8');
          videosData = JSON.parse(existingData);
        }
        
        // Add new entry (check if not already added)
        const existingEntry = videosData.find(v => v.title === data.Title && v.videoPath === videoPath);
        if (!existingEntry) {
          videosData.push({
            title: data.Title,
            videoPath: videoPath,
            size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
            dateAdded: new Date().toISOString()
          });
          
          // Save updated data
          fs.writeFileSync(videosJsonPath, JSON.stringify(videosData, null, 2), 'utf8');
          console.log(`✅ Saved video info to ${videosJsonPath}`);
        }
      } catch (e) {
        console.log(`⚠️  Could not save video info: ${e}`);
      }
    }
  }
  
  if (ENABLE_VIDEO_UPLOAD && hasVideo && videoPath && fs.existsSync(videoPath)) {
    console.log(`📹 Video detected, uploading FIRST: ${videoPath}`);
    const stats = fs.statSync(videoPath);
    console.log(`✅ Video file exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    try {
      // Click "Add Video" to open the file picker
      console.log(`🖱️  Clicking "Add Video" to open file picker...`);
      const addVideoButton = scraper.page!.locator('text=/add.*video/i').first();
      await addVideoButton.click();
      console.log(`✅ Clicked "Add Video"`);
      
      // Wait longer for the file picker dialog to fully appear
      console.log(`⏳ Waiting for file picker dialog to open...`);
      await scraper.page!.waitForTimeout(3000);
      
      // Use AppleScript to select the file
      console.log(`🍎 Using AppleScript to select video file...`);
      
      // Escape the path for AppleScript - need to escape backslashes and quotes
      const escapedPath = videoPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      
      // AppleScript to navigate to file and select it
      // We use Cmd+Shift+G to open "Go to Folder" dialog, type path, and press Enter twice
      const appleScript = `
tell application "System Events"
  delay 1
  keystroke "g" using {command down, shift down}
  delay 1
  keystroke "${escapedPath}"
  delay 1
  keystroke return
  delay 1
  keystroke return
  delay 1
end tell
      `.trim();
      
      // Write AppleScript to a temp file to avoid shell escaping issues
      const tempScriptPath = '/tmp/fb-marketplace-video-upload.scpt';
      fs.writeFileSync(tempScriptPath, appleScript);
      
      // Execute AppleScript synchronously (blocks until complete)
      try {
        execSync(`osascript ${tempScriptPath}`, { 
          stdio: 'pipe',
          timeout: 15000 
        });
        console.log(`✅ AppleScript executed successfully`);
        
        // Clean up temp file
        fs.unlinkSync(tempScriptPath);
      } catch (e: any) {
        console.log(`❌ AppleScript failed: ${e.message}`);
        
        // Clean up temp file
        if (fs.existsSync(tempScriptPath)) {
          fs.unlinkSync(tempScriptPath);
        }
        
        // Throw error to stop the script
        throw new Error(`Video upload failed - AppleScript could not select the file: ${e.message}`);
      }
      
      // Wait for file picker to close by checking if we can interact with the page again
      console.log(`⏳ Waiting for file picker to close...`);
      let dialogClosed = false;
      let attempts = 0;
      while (!dialogClosed && attempts < 15) {
        try {
          // Try to check page state - if file picker is open, this might not work
          await scraper.page!.waitForTimeout(1000);
          const pageTitle = await scraper.page!.title();
          if (pageTitle) {
            dialogClosed = true;
            console.log(`✅ File picker closed, page is responsive`);
          }
        } catch (e) {
          // Still waiting
        }
        attempts++;
      }
      
      if (!dialogClosed) {
        console.log(`⚠️  Waited 15 seconds but couldn't confirm dialog closed, continuing anyway...`);
      }
      
      // Try using CDP (Chrome DevTools Protocol) to set files at the lowest level possible
      console.log(`🔧 Using CDP to set file at browser level...`);
      const videoInput = scraper.page!.locator('input[accept="video/*"]').first();
      
      try {
        // Get CDP session
        const client = await scraper.page!.context().newCDPSession(scraper.page!);
        
        // Enable DOM domain
        await client.send('DOM.enable');
        
        // Get the document root
        const { root } = await client.send('DOM.getDocument');
        
        // Find the video input element using querySelector
        const { nodeId } = await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: 'input[accept="video/*"]'
        });
        
        if (nodeId) {
          // Use CDP's DOM.setFileInputFiles which works at the browser engine level
          await client.send('DOM.setFileInputFiles', {
            files: [videoPath],
            nodeId
          });
          console.log(`✅ Set video file using CDP (node ${nodeId})`);
        } else {
          console.log(`⚠️  Could not find video input via CDP, falling back to Playwright method`);
          await videoInput.setInputFiles([videoPath]);
          console.log(`✅ Set video file using Playwright fallback`);
        }
        
        await client.detach();
      } catch (cdpError) {
        console.log(`⚠️  CDP method failed: ${cdpError}, using Playwright fallback`);
        await videoInput.setInputFiles([videoPath]);
        console.log(`✅ Set video file using Playwright fallback`);
      }
      
      // Trigger events to notify Facebook
      await videoInput.evaluate((input: HTMLInputElement) => {
        input.focus();
        const events = [
          new Event('change', { bubbles: true }),
          new Event('input', { bubbles: true }),
          new InputEvent('input', { bubbles: true }),
        ];
        events.forEach(e => input.dispatchEvent(e));
        input.blur();
      });
      console.log(`✅ Triggered events on video input`);
      
      // Wait for video to start uploading
      console.log(`⏳ Waiting for video upload to start (5 seconds)...`);
      await scraper.page!.waitForTimeout(5000);
      
      // Check if "Add Video" text disappeared
      const addVideoStillVisible = await scraper.page!.locator('text=/add.*video/i').isVisible().catch(() => false);
      if (!addVideoStillVisible) {
        console.log(`✅ "Add Video" text disappeared - video upload started!`);
      } else {
        console.log(`⚠️  "Add Video" text still visible - checking for video preview...`);
        const videoElement = await scraper.page!.locator('video').count();
        if (videoElement > 0) {
          console.log(`✅ Video element found in page - upload started!`);
        } else {
          console.log(`❌ No video element found - upload failed!`);
          throw new Error('Video upload failed - no video element detected after file selection');
        }
      }
      
      // Wait for video to fully upload (videos take time)
      console.log(`⏳ Waiting for video to finish uploading (20 seconds)...`);
      await scraper.page!.waitForTimeout(20000);
    } catch (e) {
      console.log(`❌ Error uploading video with AppleScript: ${e}`);
      // Re-throw the error to stop the entire script
      throw e;
    }
  }

  // Upload images after video (or just images if no video)
  const imagesPaths = generateMultipleImagesPath(data['Photos Folder'], data['Photos Names']);
  if (imagesPaths.length > 0) {
    const fileInput = await scraper.page!.locator('input[accept*="image"], input[accept*="video"]').first();
    await fileInput.setInputFiles(imagesPaths);
    console.log(`📸 Uploaded ${imagesPaths.length} image(s)`);
    await scraper.page!.waitForTimeout(3000); // Wait for images to process
  }
  
  // Fill fields in order: Title, Price, Category, Condition, Description
  if (listingType === 'item') {
    await addFieldsForItem(data, scraper);
  } else {
    await addFieldsForVehicle(data, scraper);
  }

  // Wait a bit for form validation to complete
  await scraper.page!.waitForTimeout(2000);

  // Scroll to bottom to ensure Next button is in view and properly rendered
  await scraper.page!.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await scraper.page!.waitForTimeout(1000);

  // Try to find and click Next button
  let nextButton = null;
  let attempts = 0;
  const maxAttempts = 5;

  while (!nextButton && attempts < maxAttempts) {
    attempts++;
    console.log(`🔍 Attempt ${attempts}/${maxAttempts} to find Next button...`);

    // Look for all buttons with "Next" in them
    const allNextButtons = await scraper.page!.locator('div[role="button"], button').all();
    let foundButton = null;
    
    for (const button of allNextButtons) {
      const text = await button.textContent().catch(() => '');
      const ariaLabel = await button.getAttribute('aria-label').catch(() => '');
      
      if ((text && text.toLowerCase().includes('next')) || 
          (ariaLabel && ariaLabel.toLowerCase().includes('next'))) {
        const isDisabled = await button.getAttribute('aria-disabled').catch(() => null);
        const tabindex = await button.getAttribute('tabindex').catch(() => null);
        
        console.log(`Found button: text="${text}", aria-label="${ariaLabel}", aria-disabled="${isDisabled}", tabindex="${tabindex}"`);
        
        if (isDisabled !== 'true' && tabindex !== '-1') {
          foundButton = button;
          break;
        }
      }
    }
    
    if (foundButton) {
      nextButton = foundButton;
      break;
    }

    // If not found, capture HTML and try again
    if (attempts === 1) {
      console.log('⚠️  No enabled Next button found. Capturing page HTML...');
      const htmlContent = await scraper.page!.content();
      fs.writeFileSync('debug-page.html', htmlContent);
      console.log('📄 Saved page HTML to debug-page.html for inspection');
      
      // Also log button info
      const buttonInfo = await scraper.page!.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
        return buttons
          .filter((b: Element) => {
            const text = b.textContent?.toLowerCase() || '';
            const label = b.getAttribute('aria-label')?.toLowerCase() || '';
            return text.includes('next') || label.includes('next');
          })
          .map((b: Element) => ({
            text: b.textContent,
            ariaLabel: b.getAttribute('aria-label'),
            ariaDisabled: b.getAttribute('aria-disabled'),
            tabindex: b.getAttribute('tabindex'),
            classes: b.className
          }));
      });
      console.log('Next buttons found:', JSON.stringify(buttonInfo, null, 2));
    }
    
    // Scroll up and down to trigger any lazy loading/validation
    await scraper.page!.evaluate(() => window.scrollTo(0, 0));
    await scraper.page!.waitForTimeout(500);
    await scraper.page!.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await scraper.page!.waitForTimeout(2000);
  }

  if (nextButton) {
    // Scroll the button into view
    await nextButton.scrollIntoViewIfNeeded().catch(() => {});
    await scraper.page!.waitForTimeout(500);
    
    await nextButton.click();
    console.log('✅ Clicked Next');
    await scraper.page!.waitForTimeout(5000); // Increased from 1000ms to give page time to transition
    
    // Fill location if it appears after clicking Next
    await fillLocation(data['Location'], scraper);
    
    // Select meetup preferences (Door pickup)
    await selectMeetupPreferences(scraper);
    
    // Click Next again to proceed from delivery method page
    await scraper.page!.waitForTimeout(1000);
    const secondNextButton = scraper.page!.getByRole('button', { name: /next/i }).first();
    if (await secondNextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await secondNextButton.click();
      console.log('✅ Clicked Next (delivery method page)');
      await scraper.page!.waitForTimeout(1000);
    }
    
    // Add listing to multiple groups
    await addListingToMultipleGroups(data, scraper);
  }

  // Check for Close button (error case)
  const closeButton = await scraper.page!.getByRole('button', { name: /close/i }).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (closeButton) {
    await scraper.page!.getByRole('button', { name: /close/i }).first().click();
    await scraper.goToPage('https://facebook.com/marketplace/you/selling');
    return false;
  }

  // Publish
  const publishButton = scraper.page!.getByRole('button', { name: /publish/i }).first();
  await publishButton.click();

  // Handle "Leave Page" if it appears
  const leavePage = await scraper.page!.getByRole('button', { name: /leave page/i }).first().isVisible({ timeout: 15000 }).catch(() => false);
  if (leavePage) {
    await scraper.page!.getByRole('button', { name: /leave page/i }).first().click();
  }

  // Wait for listing to be published
  await waitUntilListingIsPublished(listingType, scraper);

  if (!nextButton) {
    await postListingToMultipleGroups(data, listingType, scraper);
  }

  // Update CSV status to "posted" after successful publication
  if (data._rowIndex !== undefined) {
    updateCsvStatus(csvFileName, data._rowIndex, 'posted');
    console.log(`✅ ✅ ✅ Finished posting listing: "${data['Title']}" - Marked as posted in CSV`);
  }

  return true;
}

async function addFieldsForItem(data: ListingData, scraper: Scraper): Promise<void> {
  // Wait for form to be fully loaded
  await scraper.page!.waitForTimeout(2000);

  // 1. Fill Title - find input within label that contains "Title" text
  try {
    const titleInput = scraper.page!.locator('label:has-text("Title") input[type="text"]').first();
    await titleInput.waitFor({ timeout: 2000, state: 'visible' });
    await titleInput.scrollIntoViewIfNeeded().catch(() => {});
    await titleInput.click();
    await scraper.page!.waitForTimeout(300);
    await titleInput.fill(data['Title']);
    
    // Verify it's filled
    const value = await titleInput.inputValue();
    if (value === data['Title']) {
      console.log('✅ 1/5 - Filled title');
    } else {
      console.log(`⚠️  Title value mismatch. Expected: "${data['Title']}", Got: "${value}"`);
    }
  } catch (e) {
    console.log('⚠️  Could not fill title field:', e);
  }

  // 2. Fill Price - find input within label that contains "Price" text
  try {
    const priceInput = scraper.page!.locator('label:has-text("Price") input[type="text"]').first();
    await priceInput.waitFor({ timeout: 2000, state: 'visible' });
    await priceInput.scrollIntoViewIfNeeded().catch(() => {});
    await priceInput.click();
    await scraper.page!.waitForTimeout(300);
    await priceInput.fill(data['Price']);
    
    // Verify it's filled
    const value = await priceInput.inputValue();
    console.log(`✅ 2/5 - Filled price: ${value}`);
  } catch (e) {
    console.log('⚠️  Could not fill price:', e);
  }

  // 3. Select Category with fuzzy matching and fallback to parent categories
  try {
    const categoryBox = scraper.page!.locator('input[aria-label="Category"]').first();
    await categoryBox.waitFor({ timeout: 2000, state: 'visible' });
    await categoryBox.scrollIntoViewIfNeeded().catch(() => {});
    await categoryBox.click();
    await scraper.page!.waitForTimeout(500);
    
    // Parse category hierarchy (e.g., "Tools & Home Improvement // Tools // Hand Tools // Wrenches")
    const fullCategory = data['Category'];
    const categorySegments = fullCategory.split('//').map(s => s.trim()).filter(s => s.length > 0);
    
    console.log(`🔍 Category hierarchy: ${categorySegments.join(' → ')}`);
    
    let dropdownOptions: any[] = [];
    let categoryToType = '';
    let attemptedCategories: string[] = [];
    
    // Try from most specific to most general
    for (let i = categorySegments.length - 1; i >= 0; i--) {
      categoryToType = categorySegments[i];
      attemptedCategories.push(categoryToType);
      
      console.log(`🔎 Trying category: "${categoryToType}"`);
      
      // Clear and type the search term
      await categoryBox.fill('');
      await scraper.page!.waitForTimeout(300);
      await categoryBox.fill(categoryToType);
      await scraper.page!.waitForTimeout(2000); // Wait for dropdown to populate
      
      // Wait for dropdown to appear - try multiple selectors
      try {
        await scraper.page!.waitForSelector('div[role="option"], ul[role="listbox"] > *, div[role="listbox"] > *', { timeout: 3000, state: 'visible' });
      } catch (e) {
        // Dropdown didn't appear, will check for options anyway
      }
      
      // Get all dropdown options - try multiple selectors
      dropdownOptions = await scraper.page!.locator('div[role="option"]').all();
      
      // Try alternative selectors if first one didn't work
      if (dropdownOptions.length === 0) {
        dropdownOptions = await scraper.page!.locator('ul[role="listbox"] > li, ul[role="listbox"] > div').all();
      }
      if (dropdownOptions.length === 0) {
        dropdownOptions = await scraper.page!.locator('div[role="listbox"] > div').all();
      }
      
      if (dropdownOptions.length > 0) {
        console.log(`✅ Found ${dropdownOptions.length} options for "${categoryToType}"`);
        break; // Success! Use these options
      } else {
        console.log(`⚠️  No options found for "${categoryToType}", trying parent category...`);
      }
    }
    
    if (dropdownOptions.length === 0) {
      console.log('❌ ERROR: No category dropdown options found for any level!');
      console.log(`   Tried: ${attemptedCategories.join(', ')}`);
      
      // Capture HTML for debugging
      const htmlContent = await scraper.page!.content();
      fs.writeFileSync('debug-category-dropdown.html', htmlContent);
      console.log('📄 Saved page HTML to debug-category-dropdown.html');
      
      // Try to find any visible elements that might be options
      const allVisibleDivs = await scraper.page!.locator('div:visible').all();
      console.log(`Found ${allVisibleDivs.length} visible divs on page`);
      
      // Check if we're in headless mode and give specific advice
      console.log('');
      console.log('🔍 TROUBLESHOOTING:');
      console.log('   - If running in --headless mode, Facebook may be blocking the dropdown');
      console.log('   - Try running WITHOUT --headless flag: npm run start');
      console.log('   - Check debug-category-dropdown.html for what\'s actually on the page');
      console.log('');
      
      // Throw error instead of trying to continue with invalid form
      throw new Error('Category dropdown not found - cannot proceed with listing');
    } else {
      console.log(`🔍 Found ${dropdownOptions.length} category options, using fuzzy matching...`);
      
      // Calculate similarity scores for each option using full category path
      const optionsWithScores = await Promise.all(
        dropdownOptions.map(async (option) => {
          const text = await option.textContent().catch(() => '');
          // Use full category path for better matching
          const score = calculateSimilarity(fullCategory, text || '');
          return { option, text, score };
        })
      );
      
      // Sort by score (highest first)
      optionsWithScores.sort((a, b) => b.score - a.score);
      
      // Log top 5 matches for debugging (increased from 3 to see more options)
      console.log('📊 Top category matches:');
      optionsWithScores.slice(0, Math.min(5, optionsWithScores.length)).forEach((item, idx) => {
        console.log(`  ${idx + 1}. "${item.text}" (score: ${(item.score * 100).toFixed(1)}%)`);
      });
      
      // Click the best match
      const bestMatch = optionsWithScores[0];
      if (bestMatch.score > 0.2) { // Lowered threshold from 0.3 to 0.2 for more flexibility
        await bestMatch.option.click();
        console.log(`✅ 3/5 - Selected category: "${bestMatch.text}" (score: ${(bestMatch.score * 100).toFixed(1)}%)`);
        await scraper.page!.waitForTimeout(1000);
      } else {
        console.log(`⚠️  Best match score low (${(bestMatch.score * 100).toFixed(1)}%), but using it anyway`);
        await bestMatch.option.click();
        console.log(`✅ 3/5 - Selected category: "${bestMatch.text}"`);
        await scraper.page!.waitForTimeout(1000);
      }
    }
  } catch (e) {
    console.log('❌ Error during category selection:', e);
    
    // Last-ditch effort: try to click any visible option
    try {
      console.log('🔄 Attempting emergency fallback: clicking first visible category option...');
      const anyOption = scraper.page!.locator('div[role="option"]').first();
      if (await anyOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const optionText = await anyOption.textContent().catch(() => 'unknown');
        await anyOption.click();
        console.log(`✅ 3/5 - Selected category (emergency fallback): "${optionText}"`);
        await scraper.page!.waitForTimeout(1000);
      } else {
        console.log('❌ No category options available at all');
        throw new Error('Failed to select category - no options available');
      }
    } catch (fallbackError) {
      console.log('❌ Emergency fallback also failed:', fallbackError);
      throw new Error('Category selection completely failed - cannot proceed');
    }
  }

  // 4. Select Condition - it's a combobox label, not an input
  try {
    // Click the combobox to open dropdown
    const conditionBox = scraper.page!.locator('label[role="combobox"]:has-text("Condition")').first();
    await conditionBox.waitFor({ timeout: 2000, state: 'visible' });
    await conditionBox.scrollIntoViewIfNeeded().catch(() => {});
    await conditionBox.click();
    await scraper.page!.waitForTimeout(500);
    
    // Click the option with matching text
    const conditionOption = scraper.page!.locator(`div[role="option"]:has-text("${data['Condition']}")`).first();
    await conditionOption.waitFor({ timeout: 2000, state: 'visible' });
    await conditionOption.click();
    await scraper.page!.waitForTimeout(1000); // Wait longer for condition to register
    console.log('✅ 4/5 - Selected condition');
  } catch (e) {
    console.log('⚠️  Could not select condition:', e);
  }

  // 5. Fill Description - find textarea within label that contains "Description"
  try {
    const descInput = scraper.page!.locator('label:has-text("Description") textarea').first();
    await descInput.waitFor({ timeout: 2000, state: 'visible' });
    await descInput.scrollIntoViewIfNeeded().catch(() => {});
    
    // Clear first, then fill using Playwright's fill method which handles React properly
    await descInput.click({ clickCount: 3 }); // Triple-click to select all
    await scraper.page!.waitForTimeout(300);
    await descInput.fill(data['Description']);
    await scraper.page!.waitForTimeout(500); // Wait for React to update
    
    // Verify it's filled by checking the value
    const filledValue = await descInput.inputValue();
    if (filledValue.length > 0) {
      console.log(`✅ 5/5 - Filled description (${filledValue.length} chars)`);
    } else {
      console.log('⚠️  Description appears empty after fill');
    }
  } catch (e) {
    console.log('⚠️  Could not fill description:', e);
  }

  // Add Brand if needed (optional field that may appear for certain categories)
  if (data['Brand'] && data['Brand'].trim()) {
    try {
      const brandInput = scraper.page!.locator('label:has-text("Brand") input[type="text"]').first();
      if (await brandInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await brandInput.click();
        await scraper.page!.waitForTimeout(300);
        await brandInput.fill(data['Brand']);
        console.log('✅ Filled brand (optional)');
      }
    } catch (e) {
      // Brand field is optional, don't log error
    }
  }
}

async function addFieldsForVehicle(data: ListingData, scraper: Scraper): Promise<void> {
  // Vehicle Type
  try {
    await scraper.page!.getByRole('combobox', { name: /vehicle type/i }).first().click();
    await scraper.page!.waitForTimeout(500);
    await scraper.page!.getByRole('option', { name: new RegExp(escapeRegex(data['Vehicle Type']), 'i') }).first().click();
  } catch (e) {
    await scraper.page!.click('xpath=//span[text()="Vehicle type"]');
    await scraper.page!.click(`xpath=//span[text()="${escapeXPathString(data['Vehicle Type'])}"]`);
  }

  // Year
  try {
    await scraper.page!.getByRole('combobox', { name: /year/i }).first().click();
    await scraper.page!.waitForTimeout(500);
    await scraper.page!.getByRole('option', { name: data['Year'] }).first().click();
  } catch (e) {
    await scraper.page!.click('xpath=//span[text()="Year"]');
    await scraper.page!.click(`xpath=//span[text()="${escapeXPathString(data['Year'])}"]`);
  }

  // Make
  try {
    await scraper.page!.getByLabel(/make/i).first().fill(data['Make']);
  } catch (e) {
    await scraper.page!.fill('xpath=//span[text()="Make"]/following-sibling::input[1]', data['Make']);
  }

  // Model
  try {
    await scraper.page!.getByLabel(/model/i).first().fill(data['Model']);
  } catch (e) {
    await scraper.page!.fill('xpath=//span[text()="Model"]/following-sibling::input[1]', data['Model']);
  }

  // Mileage
  try {
    await scraper.page!.getByLabel(/mileage/i).first().fill(data['Mileage']);
  } catch (e) {
    await scraper.page!.fill('xpath=//span[text()="Mileage"]/following-sibling::input[1]', data['Mileage']);
  }

  // Fuel Type
  try {
    await scraper.page!.getByRole('combobox', { name: /fuel type/i }).first().click();
    await scraper.page!.waitForTimeout(500);
    await scraper.page!.getByRole('option', { name: new RegExp(escapeRegex(data['Fuel Type']), 'i') }).first().click();
  } catch (e) {
    await scraper.page!.click('xpath=//span[text()="Fuel type"]');
    await scraper.page!.click(`xpath=//span[text()="${escapeXPathString(data['Fuel Type'])}"]`);
  }
}

async function fillLocation(location: string, scraper: Scraper): Promise<void> {
  try {
    const locationInput = scraper.page!.locator('input[aria-label="Location"]').first();
    await locationInput.waitFor({ timeout: 10000, state: 'visible' }); // Increased from 5000ms to 10000ms
    await locationInput.click();
    await scraper.page!.waitForTimeout(300);
    
    // Only type the portion before the comma (e.g., "Swatara" from "Swatara, PA")
    // Typing the full location with comma can cause matching issues
    const locationToType = location.includes(',') ? location.split(',')[0].trim() : location;
    await locationInput.fill(locationToType);
    
    // Wait 2 seconds for dropdown to populate
    await scraper.page!.waitForTimeout(2000);
    
    // Try to click the first dropdown option
    try {
      // Wait for dropdown options to appear
      await scraper.page!.waitForSelector('div[role="option"], ul[role="listbox"] li', { timeout: 3000, state: 'visible' });
      
      // Get first option and click it
      const firstOption = scraper.page!.locator('div[role="option"]').first();
      if (await firstOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await firstOption.click();
        console.log('✅ Filled location - selected first match from dropdown');
      } else {
        // Fallback: try listbox li selector
        const firstOptionAlt = scraper.page!.locator('ul[role="listbox"] li').first();
        if (await firstOptionAlt.isVisible({ timeout: 1000 }).catch(() => false)) {
          await firstOptionAlt.click();
          console.log('✅ Filled location - selected first match from dropdown (alt selector)');
        } else {
          // Last resort: press Enter
          await locationInput.press('Enter');
          console.log('✅ Filled location - pressed Enter');
        }
      }
    } catch (e) {
      // Fallback: press Enter
      await locationInput.press('Enter');
      console.log('✅ Filled location - pressed Enter (fallback)');
    }
    
    await scraper.page!.waitForTimeout(500);
  } catch (e) {
    console.log('⚠️  Could not fill location:', e);
    // Debug: Check what's actually on the page
    const inputs = await scraper.page!.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(input => ({
        type: input.type,
        placeholder: input.placeholder,
        ariaLabel: input.getAttribute('aria-label'),
        name: input.name,
        id: input.id
      })).slice(0, 10); // Only first 10 to avoid spam
    });
    console.log('🔍 Available inputs on page:', JSON.stringify(inputs, null, 2));
  }
}

async function selectMeetupPreferences(scraper: Scraper): Promise<void> {
  try {
    // Wait a bit for the meetup preferences section to load
    await scraper.page!.waitForTimeout(500);
    
    // Click on "Door pickup" text to select it
    const doorPickupOption = scraper.page!.getByText('Door pickup', { exact: true }).first();
    if (await doorPickupOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await doorPickupOption.click();
      console.log('✅ Selected "Door pickup" meetup preference');
      await scraper.page!.waitForTimeout(500);
    } else {
      console.log('⚠️  "Door pickup" option not found');
    }
  } catch (e) {
    console.log('⚠️  Could not select meetup preference:', e);
  }
}

function generateTitleForListingType(data: ListingData, listingType: 'item' | 'vehicle'): string {
  if (listingType === 'item') {
    return data['Title'];
  } else {
    return `${data['Year']} ${data['Make']} ${data['Model']}`;
  }
}

function generateMultipleImagesPath(path: string, images: string): string[] {
  if (path[path.length - 1] !== '/') {
    path += '/';
  }

  const imageNames = images.split(';').map(name => name.trim()).filter(name => name);
  return imageNames.map(name => path + name);
}

function generateVideoPath(path: string, videoName: string): string {
  if (path[path.length - 1] !== '/') {
    path += '/';
  }
  return path + videoName.trim();
}

function escapeXPathString(text: string): string {
  if (text.includes("'") && text.includes('"')) {
    const parts = text.split("'");
    return `concat(${parts.map((part, i) => `"${part}"${i < parts.length - 1 ? ", \"'\"" : ""}`).join(', ')})`;
  } else if (text.includes("'")) {
    return `"${text}"`;
  } else {
    return `'${text}'`;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findListingByTitle(title: string, scraper: Scraper) {
  try {
    const searchInput = scraper.page!.getByPlaceholder(/search your listings/i).first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('');
      await searchInput.fill(title);
      await scraper.page!.waitForTimeout(1000);
      
      // Try to find the listing by text
      const listing = scraper.page!.getByText(title).first();
      if (await listing.isVisible({ timeout: 5000 }).catch(() => false)) {
        return listing;
      }
    }
  } catch (e) {
    // Fallback to XPath
  }
  
  const searchInput = await scraper.page!.waitForSelector('input[placeholder="Search your listings"]', { timeout: 5000 }).catch(() => null);
  if (!searchInput) {
    return null;
  }

  await searchInput.fill('');
  await searchInput.fill(title);
  await scraper.page!.waitForTimeout(1000);

  return await scraper.page!.waitForSelector(`xpath=//span[text()="${escapeXPathString(title)}"]`, { timeout: 10000 }).catch(() => null);
}

async function addListingToMultipleGroups(data: ListingData, scraper: Scraper): Promise<void> {
  const groupNames = data['Groups'].split(';').map(name => name.trim()).filter(name => name);
  
  for (const groupName of groupNames) {
    try {
      await scraper.page!.getByText(groupName).first().click();
      await scraper.page!.waitForTimeout(500);
    } catch (e) {
      // Fallback to XPath
      await scraper.page!.click(`xpath=//span[text()="${escapeXPathString(groupName)}"]`);
    }
  }
}

async function postListingToMultipleGroups(
  data: ListingData,
  listingType: 'item' | 'vehicle',
  scraper: Scraper
): Promise<void> {
  // Navigate to selling page to find the listing
  await scraper.goToPage('https://facebook.com/marketplace/you/selling');
  
  const title = generateTitleForListingType(data, listingType);
  const titleElement = await findListingByTitle(title, scraper);

  if (!titleElement) {
    return;
  }

  const groupNames = data['Groups'].split(';').map(name => name.trim()).filter(name => name);
  if (groupNames.length === 0) {
    return;
  }

  for (const groupName of groupNames) {
    try {
      // Click Share button
      await scraper.page!.getByRole('button', { name: /share/i }).first().click();
      await scraper.page!.waitForTimeout(1000);
      
      // Click Group option
      await scraper.page!.getByText(/group/i).first().click();
      await scraper.page!.waitForTimeout(1000);
      
      // Search for group
      const searchInput = scraper.page!.getByPlaceholder(/search for groups/i).first();
      await searchInput.fill('');
      await searchInput.fill(groupName.substring(0, 51));
      await scraper.page!.waitForTimeout(1000);
      
      // Click the group
      await scraper.page!.getByText(groupName).first().click();
      await scraper.page!.waitForTimeout(1000);
      
      // Fill description
      const postInput = scraper.page!.getByPlaceholder(/write something|create a public post/i).first();
      await postInput.fill(data['Description']);
      
      // Click Post
      await scraper.page!.getByRole('button', { name: /post/i }).first().click();
      
      // Wait for success
      await scraper.page!.waitForSelector('[role="dialog"]', { state: 'hidden' }).catch(() => {});
      await scraper.page!.waitForSelector('[aria-label="Loading...]"', { state: 'hidden' }).catch(() => {});
      await scraper.page!.waitForSelector('xpath=//span[text()="Shared to your group."]', { timeout: 10000 }).catch(() => null);
    } catch (e) {
      console.log(`⚠️  Error posting to group ${groupName}:`, e);
      // Continue with next group
    }
  }
}

async function waitUntilListingIsPublished(listingType: 'item' | 'vehicle', scraper: Scraper): Promise<void> {
  if (listingType === 'item') {
    await scraper.page!.waitForSelector('xpath=//h1[text()="Item for sale"]', { state: 'hidden' }).catch(() => {});
  } else {
    await scraper.page!.waitForSelector('xpath=//h1[text()="Vehicle for sale"]', { state: 'hidden' }).catch(() => {});
  }
}
