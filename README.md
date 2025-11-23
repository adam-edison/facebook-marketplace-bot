# Facebook Marketplace Bot

Facebook marketplace bot that automatically removes and then uploads listings from CSV Files. You can define all of the information about the items and vehicles that will be posted automatically so you will save time removing and publishing them every single time. We are doing this to show the listings on the top of the marketplace or groups in order to be seen by more people and that leads to selling the items or vehicles faster.

## Table of Contents
- [Technologies used](#technologies-used)
- [Functionalities](#functionalities)
- [Installation](#installation)
- [TypeScript Scripts Workflow](#typescript-scripts-workflow)
- [How to Use](#how-to-use)

## Technologies Used
- Python
- Selenium
- Pickle

## Functionalities
- You can add multiple items or vehicles in the csv files that are in folder `csvs`. Note that for now the program only works with listing type `Item` or `Vehicle`
- Added items or vehicles in csv files are first checked if they exist by the title. The existing items or vehicles are first being removed and then they are published again.
- The item or vehicle can also be posted to multiple groups that you can define in the csv files

## Installation
1. You will need to have [Python](https://www.python.org/downloads/) and [pip](https://pip.pypa.io/en/stable/installation/) installed (on Mac they are already installed)
2. You will need to install the following packages with `pip`:
    - Mac commands:
      ```
      pip3 install selenium
      pip3 install webdriver-manager
      ```
    - Linux commands:
      ```
      pip install selenium
      pip install pickle-mixin
      pip install webdriver-manager
      ```
    - Windows commands:
      ```
      python -m pip install selenium
      python -m pip install pickle-mixin
      python -m pip install webdriver-manager
      ```
3. Install the `Google Chrome` browser if you don't have it already - https://www.google.com/chrome/.
4. Install Node.js and npm if you don't have them already - https://nodejs.org/
5. Install TypeScript execution tool:
   ```bash
   npm install -g tsx
   ```
   Or use `npx tsx` without global installation.

## TypeScript Scripts Workflow

Before uploading items to Facebook Marketplace, you need to prepare your items data using the TypeScript scripts. Run these scripts in order:

### 1. Generate Item Data (`instructions.ts`)
This script processes folders containing item photos and generates `items.json` with item descriptions, titles, prices, and conditions.

**Usage:**
```bash
# Use current directory (where folders with photos are located)
npx tsx instructions.ts

# Or specify a directory containing item folders
npx tsx instructions.ts "/path/to/photos/directory"
```

This script will:
- Process images in each folder to generate descriptions
- Create `item.json` files in each folder
- Assemble all items into `items.json`

### 2. Categorize Items (`categorizer.ts`)
This script adds categories to each item in `items.json` using AI categorization.

**Usage:**
```bash
# Normal mode (skips items that already have categories)
npx tsx categorizer.ts

# Overwrite mode (updates existing categories)
npx tsx categorizer.ts --overwrite
# Or use short flag
npx tsx categorizer.ts -o
```

This script will:
- Read `items.json`
- Assign appropriate categories to each item
- Update `items.json` with category information
- Skip items that already have categories (unless `--overwrite` is used)

### 3. Add Photo Information (`add_photos.ts`)
This script adds photo folder paths and photo filenames to each item in `items.json`.

**Usage:**
```bash
# Use current directory (where folders with photos are located)
npx tsx add_photos.ts

# Or specify a directory containing item folders
npx tsx add_photos.ts "/path/to/photos/directory"

# Overwrite mode (updates existing photo entries)
npx tsx add_photos.ts --overwrite
# Or use short flag
npx tsx add_photos.ts -o
```

This script will:
- Match folders to items by index
- Add `photosFolder` (folder path) to each item
- Add `photosNames` (array of filenames) to each item
- Skip files with "resized" in the filename
- Skip items that already have photos (unless `--overwrite` is used)

### 4. Add Video Information (`add_videos.ts`)
This script adds video filenames to each item in `items.json` (max 1 video per item).

**Usage:**
```bash
# Use current directory (where folders with videos are located)
npx tsx add_videos.ts

# Or specify a directory containing item folders
npx tsx add_videos.ts "/path/to/photos/directory"

# Overwrite mode (updates existing video entries)
npx tsx add_videos.ts --overwrite
# Or use short flag
npx tsx add_videos.ts -o
```

This script will:
- Match folders to items by index
- Find the first video file in each folder
- Add `videoName` (filename) to each item
- Skip files with "resized" in the filename
- Skip items that already have videos (unless `--overwrite` is used)
- Supports common video formats: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`

**Note:** Videos use the same folder as photos (`photosFolder`).

### 5. Generate CSV (`json_to_csv.ts`)
This script converts `items.json` to CSV format for the marketplace bot.

**Usage:**
```bash
npx tsx json_to_csv.ts
```

This script will:
- Read `items.json` and `items-info.json`
- Convert items to CSV format
- Append rows to `csvs/items.csv`

**Note:** Make sure `items-info.json` contains your Facebook groups:
```json
{
  "facebookGroups": ["Group name 1", "Group name 2"]
}
```

The CSV will include:
- Photos folder paths (from each item's `photosFolder`)
- Photo names formatted as semicolon-separated strings
- Video name (single filename, if present)
- Facebook groups from `items-info.json` formatted as semicolon-separated strings

## How to Use
1. Open folder where this project is saved on your local machine
2. Open the `csvs` folder
3. Add items or vehicles in the `items.csv` and `vehicles.csv` files. You can open these files with programs like `Microsoft Excel`, `LibreOffice Calc`, etc
4. Please note these things for the csv columns:
	- `Photos Folder` column contains the folder path for the photos (automatically populated by `add_photos.ts`)
	- `Photos Names` column contains the names of photos separated with this symbol `;` like this `Photo 1.JPG; Photo 2.png; Photo3.jpg` (automatically populated by `add_photos.ts`)
	- `Video Name` column contains a single video filename (automatically populated by `add_videos.ts`, max 1 video per item)
	- Marketplace fields that you have to select an option like `Category`, `Condition`, `Vehicle Type`, `Fuel Type`. You have to type the exact name of the option that you want to choose.
	- `Groups` column contains multiple groups separated by this symbol `;`. Example - `Group name 1; Group name 2; Group name` (automatically populated from `items-info.json`)
5. Open terminal inside the main project folder
6. Run main.py with this command:
    - Windows / Linux
        ```
        python main.py
        ```
    - Mac
        ```
        python3 main.py
        ```
7. The first time that you use the program, you will have to log in manually in the browser that have opened. After that the program will log in you automatically using the cookies from the first log in.
