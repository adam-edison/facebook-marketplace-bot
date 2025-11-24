import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface Info {
    facebookGroups: string[];
    location?: string;
}

const INFO_FILE = './items-info.json';
const CSV_FILE = './csvs/items.csv';

// Format array as semicolon-separated string (with spaces after semicolons)
function formatArrayAsSemicolonSeparated(arr: string[]): string {
    return arr.map(item => item.trim()).join('; ');
}

// Load items-info.json
function loadInfo(): Info {
    if (!fs.existsSync(INFO_FILE)) {
        console.error(`❌ Error: ${INFO_FILE} not found`);
        process.exit(1);
    }
    
    return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
}

function updateCsvInfo(): void {
    // Load info
    const info = loadInfo();
    const groups = formatArrayAsSemicolonSeparated(info.facebookGroups || []);
    const location = info.location || '';
    
    console.log(`📋 Updating CSV with:`);
    console.log(`   Location: ${location}`);
    console.log(`   Groups: ${groups}`);
    console.log();
    
    // Check if CSV exists
    if (!fs.existsSync(CSV_FILE)) {
        console.error(`❌ Error: ${CSV_FILE} not found`);
        process.exit(1);
    }
    
    // Read and parse CSV
    const fileContent = fs.readFileSync(CSV_FILE, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: false,
        relax_quotes: true
    });
    
    console.log(`📊 Found ${records.length} rows in CSV`);
    
    // Update each row
    let updatedCount = 0;
    for (const record of records) {
        const oldGroups = record['Groups'] || '';
        const oldLocation = record['Location'] || '';
        
        // Update fields if they're different
        const groupsChanged = oldGroups !== groups;
        const locationChanged = oldLocation !== location;
        
        if (groupsChanged || locationChanged) {
            record['Groups'] = groups;
            record['Location'] = location;
            updatedCount++;
        }
    }
    
    if (updatedCount === 0) {
        console.log(`✅ No changes needed - all rows already have correct info`);
        return;
    }
    
    // Create backup
    const backupFile = CSV_FILE.replace('.csv', '.backup.csv');
    fs.copyFileSync(CSV_FILE, backupFile);
    console.log(`💾 Backup created: ${backupFile}`);
    
    // Get column headers
    const columns = Object.keys(records[0] as any);
    
    // Stringify back to CSV
    const csvOutput = stringify(records, {
        header: true,
        columns: columns,
        quoted: true
    });
    
    // Write back to file
    fs.writeFileSync(CSV_FILE, csvOutput, 'utf-8');
    
    console.log(`✅ Updated ${updatedCount} row(s) in ${CSV_FILE}`);
    console.log(`\n🎉 Done!`);
}

// Run the update
updateCsvInfo();

