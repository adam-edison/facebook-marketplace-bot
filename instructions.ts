import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const JSON_FILE = './items.json';
const promptTemplate = fs.readFileSync('./prompt.txt', 'utf8');
const MAX_RETRIES = 3;

// Get directory from command line argument, or use current directory
const DIRECTORY = process.argv[2] || './';

// Standard description lines to prepend
const STANDARD_DESCRIPTION_LINES = [
    "📍 Pickup in Swatara",
    "💵 Cash or Venmo at pickup",
    "🗺️ Address provided after price agreed or pickup time scheduled",
    "⏳ EVERYTHING MUST GO before Monday, Dec 1st"
];

// Helper function to check if output contains errors
function hasError(output: string): boolean {
    if (!output) return true;
    const lowerOutput = output.toLowerCase();
    return lowerOutput.includes('api error') || 
           lowerOutput.includes('error') && (lowerOutput.includes('400') || lowerOutput.includes('invalid_request_error') || lowerOutput.includes('exceeds 5 mb'));
}

// Helper function to validate JSON structure
function isValidItemJSON(obj: any): boolean {
    return obj && 
           typeof obj.title === 'string' &&
           Array.isArray(obj['description lines']) &&
           typeof obj.priceNew === 'string' &&
           typeof obj.condition === 'string' &&
           ['New', 'Used - Like New', 'Used - Good', 'Used - Fair'].includes(obj.condition);
}

// Helper function to calculate sell price
function calculateSellPrice(priceNew: string): string {
    const price = parseFloat(priceNew);
    if (isNaN(price) || price <= 0) {
        return "5";
    }
    const sellPriceRaw = price * 0.3;
    const sellPriceRounded = Math.floor(sellPriceRaw / 5) * 5;
    return Math.max(5, sellPriceRounded).toString();
}

// Helper function to handle retry for image processing
function processImageWithRetry(imagePath: string, baseImagePrompt: string): string | null {
    let retryCount = 0;
    let lastError = '';
    let imagePrompt = baseImagePrompt;
    
    while (retryCount < MAX_RETRIES) {
        const fullPrompt = `${imagePrompt}\n\nImage: ${imagePath}`;
        const result = spawnSync('claude', [
            '--dangerously-skip-permissions',
            '-p', fullPrompt
        ], { 
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'inherit']
        });
        
        if (result.error) {
            lastError = `Process error: ${result.error.message}`;
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
            imagePrompt = `${baseImagePrompt}\n\nPrevious attempt failed: ${lastError}. Please try again and provide a valid description.`;
            continue;
        }
        
        const output = result.stdout ? result.stdout.trim() : '';
        if (!output) {
            lastError = 'No output from Claude';
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
            imagePrompt = `${baseImagePrompt}\n\nPrevious attempt failed: ${lastError}. Please try again and provide a valid description.`;
            continue;
        }
        
        if (hasError(output)) {
            lastError = `Error detected in output: ${output.substring(0, 200)}`;
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
            imagePrompt = `${baseImagePrompt}\n\nPrevious attempt failed: ${lastError}. Please try again and provide a valid description.`;
            continue;
        }
        
        return output;
    }
    
    console.error(`      ✗ Failed after ${MAX_RETRIES} attempts: ${lastError}\n`);
    return null;
}

// Helper function to process a single image
function processImage(folderPath: string, imageFile: string, imgIndex: number, totalImages: number): string | null {
    console.log(`  └─ Image ${imgIndex}/${totalImages}: ${imageFile}`);
    
    const baseImagePrompt = `Analyze this image and provide a detailed description of the item. Identify the item type, brand, and model number if visible. Include as much detail as possible about the item's appearance, features, and any visible text or labels.

IMPORTANT - Condition details: Specifically note the condition of the item. Look for and describe:
- Dust, dirt, or debris on the item
- Shrink wrap or protective packaging
- Original box or packaging materials
- Discoloration, fading, or stains
- Wear, scratches, scuffs, or dents
- Any signs of use or age
- Overall condition assessment`;
    
    const imagePath = path.join(folderPath, imageFile);
    const description = processImageWithRetry(imagePath, baseImagePrompt);
    
    if (!description) return null;
    
    console.log(`      ✓ Success\n`);
    return `Image ${imgIndex} (${imageFile}):\n${description}\n`;
}

// Helper function to process a folder for description generation
function processFolderForDescriptions(folderName: string, index: number, totalFolders: number): void {
    const folderPath = path.join(DIRECTORY, folderName);
    const descriptionPath = path.join(folderPath, 'description.txt');
    
    if (fs.existsSync(descriptionPath)) {
        console.log(`\n[${index + 1}/${totalFolders}] Skipping: ${folderName} (description.txt already exists)\n`);
        return;
    }
    
    const imageFiles = fs.readdirSync(folderPath)
        .filter(name => name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg'))
        .sort((a, b) => a.localeCompare(b));
    
    if (imageFiles.length === 0) {
        console.log(`\n[${index + 1}/${totalFolders}] Skipping: ${folderName} (no .jpg images found)\n`);
        return;
    }
    
    const startTime = Date.now();
    console.log(`\n[${index + 1}/${totalFolders}] Processing: ${folderName}`);
    console.log(`  Images to process: ${imageFiles.length}\n`);
    
    const descriptions: string[] = [];
    
    for (let imgIndex = 0; imgIndex < imageFiles.length; imgIndex++) {
        const imageFile = imageFiles[imgIndex];
        const description = processImage(folderPath, imageFile, imgIndex + 1, imageFiles.length);
        if (description) {
            descriptions.push(description);
        }
    }
    
    if (descriptions.length === 0) {
        console.log(`  ✗ No descriptions generated\n`);
        return;
    }
    
    const fullDescription = descriptions.join('\n---\n\n');
    fs.writeFileSync(descriptionPath, fullDescription, 'utf8');
    console.log(`  ✓ Created description.txt (${descriptions.length} image description(s))`);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`\n  Completed: ${folderName}`);
    console.log(`  Time: ${(duration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`  Estimated remaining: ${((totalFolders - index - 1) * (duration / 1000 / 60)).toFixed(2)} minutes`);
    console.log('\n' + '='.repeat(60) + '\n');
}

// Helper function to handle retry for JSON generation
function generateJSONWithRetry(descriptionContent: string): string | null {
    let retryCount = 0;
    let lastError = '';
    let prompt = promptTemplate.replace('DESCRIPTION_CONTENT', descriptionContent);
    
    while (retryCount < MAX_RETRIES) {
        const result = spawnSync('claude', ['--dangerously-skip-permissions', '-p', prompt], { 
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'inherit']
        });
        
        if (result.error) {
            lastError = `Process error: ${result.error.message}`;
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`  ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}\n`);
            continue;
        }
        
        const output = result.stdout ? result.stdout.trim() : '';
        if (!output) {
            lastError = 'No output from Claude';
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`  ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}\n`);
            continue;
        }
        
        if (hasError(output)) {
            lastError = `Error detected in output: ${output.substring(0, 200)}`;
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`  ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}\n`);
            prompt = `${promptTemplate.replace('DESCRIPTION_CONTENT', descriptionContent)}\n\nPrevious attempt failed: ${lastError}. Please try again and provide valid JSON output matching the required format.`;
            continue;
        }
        
        const cleanedOutput = output.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        
        try {
            const itemData = JSON.parse(cleanedOutput);
            if (!isValidItemJSON(itemData)) {
                lastError = 'JSON does not match required format (missing required fields or invalid condition)';
                retryCount++;
                if (retryCount >= MAX_RETRIES) break;
                console.log(`  ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}\n`);
                prompt = `${promptTemplate.replace('DESCRIPTION_CONTENT', descriptionContent)}\n\nPrevious attempt failed: ${lastError}. The JSON must include: title (string), description lines (array), priceNew (string), and condition (one of: "New", "Used - Like New", "Used - Good", "Used - Fair"). Please provide valid JSON matching this format.`;
                continue;
            }
            return cleanedOutput;
        } catch (parseError) {
            lastError = `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            retryCount++;
            if (retryCount >= MAX_RETRIES) break;
            console.log(`  ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}\n`);
            prompt = `${promptTemplate.replace('DESCRIPTION_CONTENT', descriptionContent)}\n\nPrevious attempt failed: ${lastError}. Please provide valid JSON output only, no markdown, no explanations.`;
            continue;
        }
    }
    
    console.error(`  ✗ Failed after ${MAX_RETRIES} attempts: ${lastError}`);
    return null;
}

// Helper function to process and save item JSON
function processAndSaveItemJSON(jsonOutput: string, itemJsonPath: string, folderName: string): boolean {
    try {
        const itemData = JSON.parse(jsonOutput);
        itemData.sellPrice = calculateSellPrice(itemData.priceNew);
        itemData['description lines'] = [
            ...STANDARD_DESCRIPTION_LINES,
            ...itemData['description lines']
        ];
        fs.writeFileSync(itemJsonPath, JSON.stringify(itemData, null, 2), 'utf8');
        console.log(`  ✓ Successfully created item.json`);
        return true;
    } catch (error) {
        console.error(`  ✗ Error processing JSON:`, error);
        console.error(`  Raw output:`, jsonOutput);
        return false;
    }
}

// Helper function to process a folder for JSON generation
function processFolderForJSON(folderName: string, index: number, totalFolders: number): void {
    const folderPath = path.join(DIRECTORY, folderName);
    const descriptionPath = path.join(folderPath, 'description.txt');
    const itemJsonPath = path.join(folderPath, 'item.json');
    
    if (fs.existsSync(itemJsonPath)) {
        console.log(`[${index + 1}/${totalFolders}] Skipping: ${folderName} (item.json already exists)\n`);
        return;
    }
    
    if (!fs.existsSync(descriptionPath)) {
        console.log(`[${index + 1}/${totalFolders}] Skipping: ${folderName} (description.txt not found)\n`);
        return;
    }
    
    const startTime = Date.now();
    console.log(`\n[${index + 1}/${totalFolders}] Processing: ${folderName}`);
    console.log(`  Started: ${new Date(startTime).toLocaleString()}\n`);
    
    const descriptionContent = fs.readFileSync(descriptionPath, 'utf8');
    const jsonOutput = generateJSONWithRetry(descriptionContent);
    
    if (!jsonOutput) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`\n  Completed: ${folderName} (FAILED)`);
        console.log(`  Time: ${(duration / 1000 / 60).toFixed(2)} minutes`);
        console.log(`  Estimated remaining: ${((totalFolders - index - 1) * (duration / 1000 / 60)).toFixed(2)} minutes`);
        console.log('\n' + '='.repeat(60) + '\n');
        return;
    }
    
    processAndSaveItemJSON(jsonOutput, itemJsonPath, folderName);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`\n  Completed: ${folderName}`);
    console.log(`  Time: ${(duration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`  Estimated remaining: ${((totalFolders - index - 1) * (duration / 1000 / 60)).toFixed(2)} minutes`);
    console.log('\n' + '='.repeat(60) + '\n');
}

// Helper function to assemble all items
function assembleAllItems(folderNames: string[]): void {
    console.log('\n' + '='.repeat(60));
    console.log('FINAL STEP: Assembling all item.json files');
    console.log('='.repeat(60) + '\n');
    
    const allItems: any[] = [];
    
    for (const folderName of folderNames) {
        const folderPath = path.join(DIRECTORY, folderName);
        const itemJsonPath = path.join(folderPath, 'item.json');
        
        if (!fs.existsSync(itemJsonPath)) continue;
        
        try {
            const itemData = JSON.parse(fs.readFileSync(itemJsonPath, 'utf8'));
            allItems.push(itemData);
            console.log(`  ✓ Added: ${folderName}`);
        } catch (error) {
            console.error(`  ✗ Error reading item.json from ${folderName}:`, error);
        }
    }
    
    console.log('');
    
    if (fs.existsSync(JSON_FILE)) {
        fs.unlinkSync(JSON_FILE);
        console.log(`  ✓ Deleted old ${JSON_FILE}`);
    }
    
    fs.writeFileSync(JSON_FILE, JSON.stringify(allItems, null, 2), 'utf8');
    console.log(`  ✓ Created ${JSON_FILE} with ${allItems.length} items`);
    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(60) + '\n');
}

// Main execution
const folderNames = fs.readdirSync(DIRECTORY)
    .filter(name => !name.startsWith('.') && fs.statSync(path.join(DIRECTORY, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));

console.log(`\n${folderNames.length} folders to process`);
console.log(folderNames.join('\n'));
console.log('\n--------------------------------\n');

// FIRST PASS: Generate description.txt for each folder
console.log('FIRST PASS: Generating description.txt files');
console.log('--------------------------------\n');

for (let index = 0; index < folderNames.length; index++) {
    processFolderForDescriptions(folderNames[index], index, folderNames.length);
}

// SECOND PASS: Generate JSON entries from descriptions
console.log('\n' + '='.repeat(60));
console.log(`SECOND PASS: Processing ${folderNames.length} folders`);
console.log('='.repeat(60) + '\n');

for (let index = 0; index < folderNames.length; index++) {
    processFolderForJSON(folderNames[index], index, folderNames.length);
}

// FINAL STEP: Assemble all item.json files into items.json
assembleAllItems(folderNames);
