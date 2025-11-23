#!/usr/bin/env python3
"""
Script to resize images > 4 MB to half their dimensions.
Saves resized copies as (filename)_resized.jpg

Usage:
    python3 resize_images.py <root_directory>
    
    Example:
        python3 resize_images.py "your_path_to_directory"
    
    The script will:
    1. Recursively scan all subfolders for image files
    2. Check file size for each image
    3. Resize images > 4 MB to half their dimensions (width/2, height/2)
    4. Save resized copies as (filename)_resized.jpg in the same directory
    
    Supported formats: .jpg, .jpeg, .png, .gif, .bmp, .tiff, .webp, .heic, .heif
"""

import argparse
import os
import sys
from pathlib import Path
from PIL import Image

# 4 MB in bytes
MAX_SIZE_BYTES = 4 * 1024 * 1024

# Supported image extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.heic', '.heif'}


def get_image_files(root_dir):
    """Recursively find all image files in the directory tree."""
    image_files = []
    root_path = Path(root_dir)
    
    if not root_path.exists():
        print(f"Error: Directory does not exist: {root_dir}")
        return []
    
    for file_path in root_path.rglob('*'):
        if file_path.is_file():
            ext = file_path.suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                # Skip already resized files
                if '_resized' not in file_path.stem.lower():
                    image_files.append(file_path)
    
    return image_files


def resize_image(image_path):
    """Resize image to half its dimensions and save as _resized.jpg"""
    try:
        # Open the image
        with Image.open(image_path) as img:
            # Get original dimensions
            original_width, original_height = img.size
            
            # Calculate new dimensions (half size)
            new_width = original_width // 2
            new_height = original_height // 2
            
            # Resize the image
            resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # Convert to RGB if necessary (for JPEG compatibility)
            if resized_img.mode in ('RGBA', 'LA', 'P'):
                # Create a white background
                background = Image.new('RGB', resized_img.size, (255, 255, 255))
                if resized_img.mode == 'P':
                    resized_img = resized_img.convert('RGBA')
                background.paste(resized_img, mask=resized_img.split()[-1] if resized_img.mode == 'RGBA' else None)
                resized_img = background
            elif resized_img.mode != 'RGB':
                resized_img = resized_img.convert('RGB')
            
            # Create output filename
            output_path = image_path.parent / f"{image_path.stem}_resized.jpg"
            
            # Save with high quality
            resized_img.save(output_path, 'JPEG', quality=85, optimize=True)
            
            return output_path, original_width, original_height, new_width, new_height
            
    except Exception as e:
        print(f"  Error processing {image_path.name}: {str(e)}")
        return None, None, None, None, None


def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description='Resize images > 4 MB to half their dimensions',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 resize_images.py "/path/to/directory"
  python3 resize_images.py "/Users/aedison/Library/CloudStorage/GoogleDrive-alter.edison@gmail.com/My Drive/Facebook Marketplace"
        """
    )
    parser.add_argument(
        'root_dir',
        type=str,
        help='Root directory to scan for images (will scan all subfolders recursively)'
    )
    
    args = parser.parse_args()
    root_dir = args.root_dir
    
    print(f"Scanning for images in: {root_dir}")
    print("=" * 80)
    
    # Find all image files
    image_files = get_image_files(root_dir)
    
    if not image_files:
        print("No image files found.")
        return
    
    print(f"Found {len(image_files)} image file(s)\n")
    
    # Process each image
    processed_count = 0
    resized_count = 0
    skipped_count = 0
    error_count = 0
    
    for image_path in image_files:
        file_size = image_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        
        print(f"Processing: {image_path.relative_to(Path(root_dir))}")
        print(f"  Size: {file_size_mb:.2f} MB")
        
        processed_count += 1
        
        if file_size > MAX_SIZE_BYTES:
            print(f"  ✓ File is > 4 MB, resizing...")
            result = resize_image(image_path)
            
            if result[0]:
                output_path, orig_w, orig_h, new_w, new_h = result
                new_size_mb = output_path.stat().st_size / (1024 * 1024)
                print(f"  ✓ Resized: {orig_w}x{orig_h} → {new_w}x{new_h}")
                print(f"  ✓ Saved: {output_path.name} ({new_size_mb:.2f} MB)")
                resized_count += 1
            else:
                error_count += 1
        else:
            print(f"  ⊘ Skipped (≤ 4 MB)")
            skipped_count += 1
        
        print()
    
    # Summary
    print("=" * 80)
    print("Summary:")
    print(f"  Total images processed: {processed_count}")
    print(f"  Resized: {resized_count}")
    print(f"  Skipped (≤ 4 MB): {skipped_count}")
    print(f"  Errors: {error_count}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nError: {str(e)}")
        sys.exit(1)

