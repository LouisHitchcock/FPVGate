#!/usr/bin/env python3
"""
Upload a canonical voice folder to ESP32-S3 SD card via web interface.
This script uploads all MP3 files from SD_Card/voice_default_en to the ESP32 SD card.
"""

import os
import time
import requests
from pathlib import Path

# Configuration
ESP32_IP = "192.168.4.1"  # Default FPVGate AP IP
SOUNDS_DIR = Path("SD_Card/voice_default_en")
UPLOAD_URL = f"http://{ESP32_IP}/upload"

def wait_for_esp32(timeout=30):
    """Wait for ESP32 to be accessible"""
    print(f"Waiting for ESP32 at {ESP32_IP}...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            response = requests.get(f"http://{ESP32_IP}/", timeout=2)
            if response.status_code == 200:
                print("✅ ESP32 is ready!")
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)
    print(f"❌ Timeout waiting for ESP32")
    return False

def upload_sounds():
    """Upload all sound files to SD card"""
    
    if not SOUNDS_DIR.exists():
        print(f"❌ Error: {SOUNDS_DIR} directory not found!")
        print("Make sure SD_Card/voice_default_en exists with MP3 files")
        return False
    
    # Get list of MP3 files
    mp3_files = sorted(SOUNDS_DIR.glob("*.mp3"))
    
    if not mp3_files:
        print(f"❌ No MP3 files found in {SOUNDS_DIR}")
        return False
    
    print(f"\n📁 Found {len(mp3_files)} MP3 files to upload")
    print(f"📤 Uploading to: {UPLOAD_URL}\n")
    
    success_count = 0
    error_count = 0
    
    for i, mp3_file in enumerate(mp3_files, 1):
        filename = mp3_file.name
        remote_path = f"/voice_default_en/{filename}"
        
        print(f"[{i}/{len(mp3_files)}] Uploading: {filename} ({mp3_file.stat().st_size // 1024} KB)...", end=" ")
        
        try:
            with open(mp3_file, 'rb') as f:
                files = {'upload': (remote_path, f, 'audio/mpeg')}
                response = requests.post(UPLOAD_URL, files=files, timeout=30)
                
                if response.status_code in [200, 303]:
                    print("✅ OK")
                    success_count += 1
                else:
                    print(f"❌ FAIL (HTTP {response.status_code})")
                    error_count += 1
        except Exception as e:
            print(f"❌ ERROR: {e}")
            error_count += 1
        
        # Small delay to not overwhelm the ESP32
        time.sleep(0.1)
    
    print(f"\n{'='*60}")
    print(f"✅ Successfully uploaded: {success_count}/{len(mp3_files)}")
    if error_count > 0:
        print(f"❌ Errors: {error_count}")
    print(f"{'='*60}\n")
    
    return error_count == 0

def main():
    print("\n" + "="*60)
    print("🎵 FPVGate - Upload Sounds to SD Card")
    print("="*60 + "\n")
    
    print("Instructions:")
    print("1. Connect to FPVGate WiFi network (FPVGate_XXXX)")
    print("2. Make sure SD card is inserted in ESP32")
    print("3. Press ENTER when ready to start upload...\n")
    
    input()
    
    if not wait_for_esp32():
        print("\n⚠️  Could not connect to ESP32")
        print("Please check:")
        print("  - You're connected to FPVGate WiFi")
        print("  - ESP32 is powered on")
        print("  - IP address is correct (default: 192.168.4.1)")
        return
    
    if upload_sounds():
        print("🎉 All sounds uploaded successfully!")
        print("The sounds are now on the SD card and will be served automatically.")
    else:
        print("⚠️  Some files failed to upload. Check the ESP32 serial output for details.")

if __name__ == "__main__":
    main()
