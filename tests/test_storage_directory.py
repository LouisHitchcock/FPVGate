"""Exercise the production directory listing with an unopenable first entry."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

HARNESS = r'''
#include <cassert>
#include <string>
#include <vector>
struct String {
 std::string value;
 String(const char* s=""):value(s){}
 String(std::string s):value(s){}
 size_t length()const{return value.size();}
 int lastIndexOf(char c)const{auto p=value.rfind(c);return p==std::string::npos?-1:(int)p;}
 String substring(size_t p)const{return value.substr(p);}
};
struct Entry {const char* name;bool directory;bool openable;};
struct File {
 std::vector<Entry>* entries=nullptr;size_t position=0;bool valid=false, directory=false;
 const char* entryName="";
 explicit operator bool()const{return valid;}
 bool isDirectory()const{return directory;}
 const char* name()const{return entryName;}
 File openNextFile(){
  if(!entries || position==entries->size())return {};
  auto e=(*entries)[position++];return {nullptr,0,e.openable,e.directory,e.name};
 }
 String getNextFileName(bool* isDir){
  if(!entries || position==entries->size())return "";
  auto e=(*entries)[position++];*isDir=e.directory;return e.name;
 }
};
struct FS {
 std::vector<Entry> entries;bool exists=true,directory=true;
 File open(const String&){return {&entries,0,exists,directory,""};}
} SD,LittleFS;
int locks=0;
void spiMutexTake(){++locks;}
void spiMutexGive(){--locks;}
struct Storage {bool sdAvailable=true;bool listDir(const String&,std::vector<String>&);};
PRODUCTION
int main(){
 Storage storage;std::vector<String> files={"stale"};
 // Native SD evidence: opening '?' fails, but later JSON/RSSI files exist.
 SD.entries={{"/races/?",false,false},{"/races/subdir",true,true},
             {"/races/051026-113230.json",false,true},{"/races/051026-113230.rssi",false,true}};
 assert(storage.listDir("/races",files));assert(locks==0);
 assert(files.size()==3 && files[0].value=="?" && files[1].value=="051026-113230.json" && files[2].value=="051026-113230.rssi");
 SD.exists=false;assert(!storage.listDir("/missing",files));assert(files.empty() && locks==0);
 SD.exists=true;SD.directory=false;assert(!storage.listDir("/not-a-directory",files));assert(locks==0);
 storage.sdAvailable=false;
 LittleFS.entries={{"/races/?",false,false},{"/races/subdir",true,true},{"/races/test.json",false,true}};
 assert(storage.listDir("/races",files));assert(files.size()==2 && files[1].value=="test.json");
 LittleFS.entries.clear();assert(storage.listDir("/empty",files));assert(files.empty());
 LittleFS.directory=false;assert(!storage.listDir("/not-a-directory",files));
}
'''


class StorageDirectoryTests(unittest.TestCase):
    def test_unopenable_entry_does_not_hide_later_files_on_either_backend(self):
        text = (ROOT / 'lib/STORAGE/storage.cpp').read_text(encoding='utf-8')
        start = text.index('bool Storage::listDir(')
        body = text[start:text.index('uint64_t Storage::getTotalBytes(', start)]
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-directory-') as folder:
            source, binary = Path(folder) / 'directory.cpp', Path(folder) / 'directory.exe'
            source.write_text(HARNESS.replace('PRODUCTION', body), encoding='utf-8')
            subprocess.run([compiler, '-std=c++17', '-DHAS_SD_CARD_SUPPORT', str(source), '-o', str(binary)],
                           check=True, capture_output=True)
            subprocess.run([str(binary)], check=True, capture_output=True)
