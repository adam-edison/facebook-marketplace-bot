import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export interface ListingData {
  Title: string;
  'Photos Folder': string;
  'Photos Names': string;
  'Video Name': string;
  Price: string;
  Category: string;
  Condition: string;
  Brand: string;
  Description: string;
  Location: string;
  Groups: string;
  Status?: string;
  _rowIndex?: number; // Internal field to track CSV row index
  [key: string]: any; // Allow additional fields for vehicles and other listing types
}

export function getDataFromCsv(csvFileName: string): ListingData[] {
  const filePath = path.join('csvs', `${csvFileName}.csv`);
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Parse CSV using csv-parse library (handles multi-line fields properly)
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: false,
      relax_quotes: true
    });
    
    // Parse data rows
    const data: ListingData[] = [];
    let skippedCount = 0;
    
    for (let i = 0; i < records.length; i++) {
      const row = records[i] as any;
      
      // Skip entries that are already posted
      const status = (row['Status'] || '').trim().toLowerCase();
      if (status === 'posted') {
        skippedCount++;
        continue;
      }
      
      // Store row index for updating later (accounting for header row, +1 for 0-based index)
      row._rowIndex = i + 1;
      
      data.push(row as ListingData);
    }
    
    console.log(`📊 Loaded ${data.length} listing(s) to process, skipped ${skippedCount} already posted`);
    
    return data;
  } catch (error) {
    console.error(`Error reading CSV file ${filePath}:`, error);
    process.exit(1);
  }
}

export function updateCsvStatus(csvFileName: string, rowIndex: number, status: string): void {
  const filePath = path.join('csvs', `${csvFileName}.csv`);
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Parse entire CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: false,
      relax_quotes: true
    });
    
    if (rowIndex < 1 || rowIndex > records.length) {
      console.error(`Invalid row index ${rowIndex} for CSV file ${filePath}`);
      return;
    }
    
    // Update the status field (rowIndex is 1-based, array is 0-based)
    (records[rowIndex - 1] as any)['Status'] = status;
    
    // Get column headers
    const columns = Object.keys(records[0] as any);
    
    // Ensure Status column exists
    if (!columns.includes('Status')) {
      columns.push('Status');
    }
    
    // Stringify back to CSV
    const csvOutput = stringify(records, {
      header: true,
      columns: columns,
      quoted: true
    });
    
    // Write back to file
    fs.writeFileSync(filePath, csvOutput, 'utf-8');
  } catch (error) {
    console.error(`Error updating CSV file ${filePath}:`, error);
  }
}

