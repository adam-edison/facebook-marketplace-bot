import { spawnSync } from 'child_process';
import fs from 'fs';

const JSON_FILE = './items.json';
const CATEGORIES_FILE = './categories.txt';
const MAX_RETRIES = 3;

interface Item {
    title: string;
    'description lines': string[];
    priceNew: string;
    condition: string;
    sellPrice: string;
    category?: string;
}

interface RetryResult {
    success: boolean;
    category?: string;
    error?: string;
    lastResponse?: string;
    shouldRetry: boolean;
}

// Helper function to check if output contains errors
function hasError(output: string): boolean {
    if (!output) return true;
    
    const lowerOutput = output.toLowerCase();
    const hasApiError = lowerOutput.includes('api error');
    const hasErrorCode = lowerOutput.includes('error') && (
        lowerOutput.includes('400') || 
        lowerOutput.includes('invalid_request_error') || 
        lowerOutput.includes('exceeds 5 mb')
    );
    
    return hasApiError || hasErrorCode;
}

// Helper function to validate category exists in categories.txt using grep
function validateCategory(category: string): boolean {
    const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const result = spawnSync('grep', ['-Fx', escapedCategory, CATEGORIES_FILE], {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe']
    });
    
    return result.status === 0 && result.stdout.trim() !== '';
}

// Clean category output from markdown formatting
function cleanCategoryOutput(output: string): string {
    return output
        .replace(/^```.*?\n/i, '')
        .replace(/\n```$/i, '')
        .replace(/^`/g, '')
        .replace(/`$/g, '')
        .trim();
}

// Build initial prompt for category selection
function buildInitialPrompt(item: Item): string {
    const itemInfo = `Title: ${item.title}\nCondition: ${item.condition}\nDescription: ${item['description lines'].slice(4).join('\n')}`;
    
    return `You are categorizing items for Facebook Marketplace. 

Given the following item information, select the MOST SPECIFIC and ACCURATE category from the categories.txt file.

Item Information:
${itemInfo}

IMPORTANT:
- You must respond with ONLY the exact category string as it appears in categories.txt
- Use the most specific category available (prefer subcategories over general categories)
- The category must match EXACTLY including any forward slashes (//) used for hierarchy
- Do not include any explanations, just the category name
- Example format: "Tools & Home Improvement//Tools//Hand Tools//Wrenches"

Respond with only the category name:`;
}

// Add retry context to prompt based on error type
function addRetryContext(prompt: string, error: string, lastResponse?: string): string {
    let retryMessage = `\n\nPrevious attempt failed: ${error}.`;
    
    if (lastResponse) {
        retryMessage += `\n\nYour last response was: "${lastResponse}"`;
    }
    
    if (error.includes('Category not found')) {
        return `${prompt}${retryMessage}\n\nThe category you provided does not exist in categories.txt. Please check the file and provide an EXACT match from the available categories. Make sure to use the exact format including forward slashes if it's a subcategory.`;
    }
    
    if (error.includes('No output')) {
        return `${prompt}${retryMessage}\n\nPlease provide a category name.`;
    }
    
    return `${prompt}${retryMessage}\n\nPlease try again and provide a valid category name that exists in categories.txt.`;
}

// Handle process error
function handleProcessError(error: Error, retryCount: number, lastResponse?: string): RetryResult {
    const lastError = `Process error: ${error.message}`;
    const shouldRetry = retryCount < MAX_RETRIES;
    
    if (shouldRetry) {
        console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
    }
    
    return {
        success: false,
        error: lastError,
        lastResponse,
        shouldRetry
    };
}

// Handle empty output
function handleEmptyOutput(retryCount: number, lastResponse?: string): RetryResult {
    const lastError = 'No output from Claude';
    const shouldRetry = retryCount < MAX_RETRIES;
    
    if (shouldRetry) {
        console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
    }
    
    return {
        success: false,
        error: lastError,
        lastResponse,
        shouldRetry
    };
}

// Handle API error in output
function handleApiError(output: string, retryCount: number): RetryResult {
    const lastError = `Error detected in output: ${output.substring(0, 200)}`;
    const shouldRetry = retryCount < MAX_RETRIES;
    
    if (shouldRetry) {
        console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
    }
    
    return {
        success: false,
        error: lastError,
        lastResponse: output,
        shouldRetry
    };
}

// Handle invalid category
function handleInvalidCategory(category: string, retryCount: number, lastResponse?: string): RetryResult {
    const lastError = `Category not found in categories.txt: "${category}"`;
    const shouldRetry = retryCount < MAX_RETRIES;
    
    if (shouldRetry) {
        console.log(`      ⚠️  Retry ${retryCount}/${MAX_RETRIES}: ${lastError}`);
    }
    
    return {
        success: false,
        error: lastError,
        lastResponse: lastResponse || category,
        shouldRetry
    };
}

// Attempt to get category from Claude
function attemptGetCategory(prompt: string, retryCount: number): RetryResult {
    const result = spawnSync('claude', [
        '--dangerously-skip-permissions',
        '-p', prompt
    ], { 
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit']
    });
    
    if (result.error) {
        return handleProcessError(result.error, retryCount + 1);
    }
    
    const output = result.stdout ? result.stdout.trim() : '';
    if (!output) {
        return handleEmptyOutput(retryCount + 1);
    }
    
    if (hasError(output)) {
        return handleApiError(output, retryCount + 1);
    }
    
    const cleanedCategory = cleanCategoryOutput(output);
    if (!validateCategory(cleanedCategory)) {
        return handleInvalidCategory(cleanedCategory, retryCount + 1, output);
    }
    
    return {
        success: true,
        category: cleanedCategory,
        lastResponse: output,
        shouldRetry: false
    };
}

// Get category with retry logic
function getCategoryWithRetry(item: Item): string | null {
    let prompt = buildInitialPrompt(item);
    let lastError = '';
    let lastResponse: string | undefined;
    
    for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
        const result = attemptGetCategory(prompt, retryCount);
        
        if (result.success && result.category) {
            return result.category;
        }
        
        lastError = result.error || 'Unknown error';
        lastResponse = result.lastResponse;
        
        if (!result.shouldRetry) {
            break;
        }
        
        prompt = addRetryContext(prompt, lastError, lastResponse);
    }
    
    console.error(`      ✗ Failed after ${MAX_RETRIES} attempts: ${lastError}`);
    return null;
}

// Statistics tracking
interface Statistics {
    added: number;
    skipped: number;
    errored: number;
}

// Load items from JSON file
function loadItems(): Item[] {
    if (!fs.existsSync(JSON_FILE)) {
        console.error(`Error: ${JSON_FILE} not found`);
        process.exit(1);
    }
    
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
}

// Process a single item
function processItem(item: Item, items: Item[], index: number, totalItems: number, stats: Statistics): void {
    if (item.category) {
        const titlePreview = item.title.substring(0, 60);
        console.log(`[${index + 1}/${totalItems}] Skipping: ${titlePreview}... (category already exists: ${item.category})`);
        stats.skipped++;
        return;
    }
    
    const titlePreview = item.title.substring(0, 60);
    console.log(`[${index + 1}/${totalItems}] Processing: ${titlePreview}...`);
    
    const category = getCategoryWithRetry(item);
    
    if (!category) {
        console.log(`      ✗ Failed to assign category\n`);
        stats.errored++;
        return;
    }
    
    item.category = category;
    console.log(`      ✓ Category: ${category}\n`);
    stats.added++;
    
    // Save items after each successful category assignment
    saveItems(items);
}

// Save items to JSON file
function saveItems(items: Item[]): void {
    fs.writeFileSync(JSON_FILE, JSON.stringify(items, null, 2), 'utf8');
}

// Print summary statistics
function printSummary(stats: Statistics, totalItems: number, duration: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total items: ${totalItems}`);
    console.log(`Categories added: ${stats.added}`);
    console.log(`Skipped (already had category): ${stats.skipped}`);
    console.log(`Errored: ${stats.errored}`);
    console.log(`Time: ${(duration / 1000 / 60).toFixed(2)} minutes`);
    console.log('='.repeat(60) + '\n');
}

// Main execution
function main(): void {
    console.log('\n' + '='.repeat(60));
    console.log('CATEGORIZER: Adding categories to items');
    console.log('='.repeat(60) + '\n');
    
    const items = loadItems();
    console.log(`Found ${items.length} items to process\n`);
    
    const stats: Statistics = {
        added: 0,
        skipped: 0,
        errored: 0
    };
    
    const startTime = Date.now();
    
    items.forEach((item, index) => {
        processItem(item, items, index + 1, items.length, stats);
    });
    
    // Final save (redundant but safe - items are already saved after each success)
    saveItems(items);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    printSummary(stats, items.length, duration);
}

main();

