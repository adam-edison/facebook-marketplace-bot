import fs from 'fs';

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

interface Info {
    facebookGroups: string[];
}

const JSON_FILE = './items.json';
const INFO_FILE = './items-info.json';
const CSV_FILE = './csvs/items.csv';

// Load items-info.json
function loadInfo(): Info {
    if (!fs.existsSync(INFO_FILE)) {
        console.error(`Error: ${INFO_FILE} not found`);
        process.exit(1);
    }
    
    return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
}

// Escape CSV field - wrap in quotes and escape internal quotes
function escapeCsvField(field: string): string {
    // Replace double quotes with two double quotes
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
}

// Format array as semicolon-separated string (with spaces after semicolons)
function formatArrayAsSemicolonSeparated(arr: string[]): string {
    return arr.map(item => item.trim()).join('; ');
}

function jsonToCsv(): void {
    // Load items-info.json
    const info = loadInfo();
    const groups = formatArrayAsSemicolonSeparated(info.facebookGroups || []);
    
    // Read items.json
    const jsonContent = fs.readFileSync(JSON_FILE, 'utf-8');
    const items: Item[] = JSON.parse(jsonContent);
    
    // Open CSV file in append mode
    const csvStream = fs.createWriteStream(CSV_FILE, { flags: 'a', encoding: 'utf-8' });
    
    // Process each item
    for (const item of items) {
        const title = item.title || '';
        const photosFolder = item.photosFolder || '';
        const photosNames = formatArrayAsSemicolonSeparated(item.photosNames || []);
        const videoName = item.videoName || '';
        const price = item.sellPrice || '';
        const category = item.category || '';
        const condition = item.condition || '';
        const brand = '';
        const description = (item['description lines'] || []).join('\n');
        const location = '';
        
        // Format row according to CSV format
        const row = [
            escapeCsvField(title),
            escapeCsvField(photosFolder),
            escapeCsvField(photosNames),
            escapeCsvField(videoName),
            escapeCsvField(price),
            escapeCsvField(category),
            escapeCsvField(condition),
            escapeCsvField(brand),
            escapeCsvField(description),
            escapeCsvField(location),
            escapeCsvField(groups)
        ].join(',') + '\n';
        
        csvStream.write(row);
    }
    
    csvStream.end();
    console.log(`Successfully appended ${items.length} items to ${CSV_FILE}`);
}

jsonToCsv();

