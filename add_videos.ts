import fs from 'fs';
import path from 'path';

interface Item {
    title: string;
    'description lines': string[];
    priceNew: string;
    condition: string;
    sellPrice: string;
    category?: string;
    photosNames?: string[];
    photosFolder?: string;
    videoName?: string;
}

const JSON_FILE = './items.json';

// Statistics tracking
interface Statistics {
    updated: number;
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

// Save items to JSON file
function saveItems(items: Item[]): void {
    fs.writeFileSync(JSON_FILE, JSON.stringify(items, null, 2), 'utf8');
}

// Get video filename from a folder (returns first video found, max 1 video per item)
function getVideoFile(folderPath: string): string | null {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    const files = fs.readdirSync(folderPath)
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            const isVideo = videoExtensions.includes(ext);
            const hasResized = file.toLowerCase().includes('resized');
            return isVideo && !hasResized;
        })
        .sort((a, b) => a.localeCompare(b));
    
    // Return first video found (max 1 video per item)
    return files.length > 0 ? files[0] : null;
}

// Process a single item
function processItem(item: Item, items: Item[], folderPath: string, folderName: string, index: number, totalItems: number, stats: Statistics, overwrite: boolean): void {
    if (!overwrite && item.videoName) {
        const titlePreview = item.title.substring(0, 60);
        console.log(`[${index + 1}/${totalItems}] Skipping: ${titlePreview}... (videoName already exists: ${item.videoName})`);
        stats.skipped++;
        return;
    }
    
    const titlePreview = item.title.substring(0, 60);
    console.log(`[${index + 1}/${totalItems}] Processing: ${titlePreview}...`);
    console.log(`  Folder: ${folderName}`);
    
    const videoFile = getVideoFile(folderPath);
    
    if (!videoFile) {
        console.log(`      ⚠️  No video found\n`);
        stats.errored++;
        return;
    }
    
    item.videoName = videoFile;
    console.log(`      ✓ Found video: ${videoFile}\n`);
    stats.updated++;
    
    // Save items after each successful update
    saveItems(items);
}

// Print summary statistics
function printSummary(stats: Statistics, totalItems: number, duration: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total items: ${totalItems}`);
    console.log(`Videos added: ${stats.updated}`);
    console.log(`Skipped (already had video): ${stats.skipped}`);
    console.log(`Errored (no video found): ${stats.errored}`);
    console.log(`Time: ${(duration / 1000 / 60).toFixed(2)} minutes`);
    console.log('='.repeat(60) + '\n');
}

// Main execution
function main(): void {
    console.log('\n' + '='.repeat(60));
    console.log('ADD VIDEOS: Adding video names to items');
    console.log('='.repeat(60) + '\n');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const overwrite = args.includes('--overwrite') || args.includes('-o');
    const directoryArg = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));
    const directory = directoryArg || './';
    
    if (overwrite) {
        console.log('⚠️  Overwrite mode enabled - will update existing video entries\n');
    }
    
    console.log(`Directory: ${directory}\n`);
    
    if (!fs.existsSync(directory)) {
        console.error(`Error: Directory does not exist: ${directory}`);
        process.exit(1);
    }
    
    // Get all folders in the directory (same pattern as instructions.ts)
    const folderNames = fs.readdirSync(directory)
        .filter(name => !name.startsWith('.') && fs.statSync(path.join(directory, name)).isDirectory())
        .sort((a, b) => a.localeCompare(b));
    
    console.log(`Found ${folderNames.length} folders\n`);
    
    const items = loadItems();
    console.log(`Found ${items.length} items in ${JSON_FILE}\n`);
    
    if (folderNames.length !== items.length) {
        console.warn(`⚠️  Warning: Number of folders (${folderNames.length}) does not match number of items (${items.length})\n`);
    }
    
    const stats: Statistics = {
        updated: 0,
        skipped: 0,
        errored: 0
    };
    
    const startTime = Date.now();
    
    // Process each folder, matching to items by index
    folderNames.forEach((folderName, index) => {
        if (index >= items.length) {
            console.log(`[${index + 1}/${folderNames.length}] Skipping folder ${folderName} (no matching item)\n`);
            return;
        }
        
        const folderPath = path.join(directory, folderName);
        const item = items[index];
        processItem(item, items, folderPath, folderName, index, Math.min(folderNames.length, items.length), stats, overwrite);
    });
    
    // Final save (redundant but safe - items are already saved after each success)
    saveItems(items);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    printSummary(stats, Math.min(folderNames.length, items.length), duration);
}

main();

