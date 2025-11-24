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
  scraper: Scraper
): Promise<void> {
  if (!listings || listings.length === 0) {
    return;
  }

  for (const listing of listings) {
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

  // Collect all files to upload (images + video)
  const imagesPaths = generateMultipleImagesPath(data['Photos Folder'], data['Photos Names']);
  const allFilePaths = [...imagesPaths];
  
  // Add video to the file list if present
  if (data['Video Name'] && data['Video Name'].trim()) {
    const videoPath = generateVideoPath(data['Photos Folder'], data['Video Name']);
    allFilePaths.push(videoPath);
    console.log(`📹 Adding video: ${videoPath}`);
  }
  
  // Upload all files (images + video) at once
  if (allFilePaths.length > 0) {
    // Directly interact with the hidden file input (no need to click button)
    // Facebook accepts both images and videos in the same input
    const fileInput = await scraper.page!.locator('input[accept*="image"], input[accept*="video"]').first();
    await fileInput.setInputFiles(allFilePaths);
    
    // Wait longer for files to upload (especially for video)
    const hasVideo = data['Video Name'] && data['Video Name'].trim();
    const uploadWaitTime = hasVideo ? 5000 : 2000;
    console.log(`⏳ Waiting ${uploadWaitTime}ms for ${allFilePaths.length} file(s) to upload...`);
    await scraper.page!.waitForTimeout(uploadWaitTime);
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
    await scraper.page!.waitForTimeout(1000);
    
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

  // 3. Select Category with fuzzy matching
  try {
    const categoryBox = scraper.page!.locator('input[aria-label="Category"]').first();
    await categoryBox.waitFor({ timeout: 2000, state: 'visible' });
    await categoryBox.scrollIntoViewIfNeeded().catch(() => {});
    await categoryBox.click();
    await scraper.page!.waitForTimeout(500);
    
    // Extract last segment of category to use as search term
    const fullCategory = data['Category']; // e.g., "Hand Tools // Wrenches"
    let categoryToType = fullCategory;
    if (categoryToType.includes('//')) {
      const segments = categoryToType.split('//');
      categoryToType = segments[segments.length - 1].trim();
    }
    
    // Type the search term to trigger dropdown
    await categoryBox.fill(categoryToType);
    await scraper.page!.waitForTimeout(1000); // Wait for dropdown to populate
    
    // Wait for dropdown to appear - try multiple selectors
    let dropdownVisible = false;
    try {
      await scraper.page!.waitForSelector('div[role="option"], ul[role="listbox"] > *, div[role="listbox"] > *', { timeout: 3000, state: 'visible' });
      dropdownVisible = true;
    } catch (e) {
      console.log('⚠️  Dropdown did not appear, checking if options exist anyway...');
    }
    
    // Get all dropdown options - try multiple selectors
    let dropdownOptions = await scraper.page!.locator('div[role="option"]').all();
    
    // Try alternative selectors if first one didn't work
    if (dropdownOptions.length === 0) {
      dropdownOptions = await scraper.page!.locator('ul[role="listbox"] > li, ul[role="listbox"] > div').all();
    }
    if (dropdownOptions.length === 0) {
      dropdownOptions = await scraper.page!.locator('div[role="listbox"] > div').all();
    }
    
    if (dropdownOptions.length === 0) {
      console.log('⚠️  No category dropdown options found, capturing HTML for debugging...');
      
      // Capture HTML for debugging
      const htmlContent = await scraper.page!.content();
      fs.writeFileSync('debug-category-dropdown.html', htmlContent);
      console.log('📄 Saved page HTML to debug-category-dropdown.html');
      
      // Try to find any visible elements that might be options
      const allVisibleDivs = await scraper.page!.locator('div:visible').all();
      console.log(`Found ${allVisibleDivs.length} visible divs on page`);
      
      // Fallback: press Enter
      console.log('⚠️  Pressing Enter as fallback');
      await categoryBox.press('Enter');
      await scraper.page!.waitForTimeout(1000);
    } else {
      console.log(`🔍 Found ${dropdownOptions.length} category options, using fuzzy matching...`);
      
      // Calculate similarity scores for each option
      const optionsWithScores = await Promise.all(
        dropdownOptions.map(async (option) => {
          const text = await option.textContent().catch(() => '');
          const score = calculateSimilarity(fullCategory, text || '');
          return { option, text, score };
        })
      );
      
      // Sort by score (highest first)
      optionsWithScores.sort((a, b) => b.score - a.score);
      
      // Log top 3 matches for debugging
      console.log('📊 Top category matches:');
      optionsWithScores.slice(0, 3).forEach((item, idx) => {
        console.log(`  ${idx + 1}. "${item.text}" (score: ${(item.score * 100).toFixed(1)}%)`);
      });
      
      // Click the best match
      const bestMatch = optionsWithScores[0];
      if (bestMatch.score > 0.3) { // Minimum threshold
        await bestMatch.option.click();
        console.log(`✅ 3/5 - Selected category: "${bestMatch.text}" (score: ${(bestMatch.score * 100).toFixed(1)}%)`);
        await scraper.page!.waitForTimeout(1000);
      } else {
        console.log(`⚠️  Best match score too low (${(bestMatch.score * 100).toFixed(1)}%), using first option`);
        await bestMatch.option.click();
        await scraper.page!.waitForTimeout(1000);
      }
    }
  } catch (e) {
    console.log('⚠️  Could not select category:', e);
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
    await locationInput.waitFor({ timeout: 5000, state: 'visible' });
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
