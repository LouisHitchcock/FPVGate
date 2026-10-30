#pragma once
#include "Arduino.h"
#include <map>
#include <vector>
#include <algorithm>
class Storage {
public:
    std::map<std::string, std::vector<uint8_t>> files;
    bool failWrite = false, failReplace = false, failDelete = false;
    bool exists(const String& p) { return files.count(p); }
    bool fileSize(const String& p, size_t& n) { if (!exists(p)) return false; n = files[p].size(); return true; }
    size_t readBinaryRange(const String& p, size_t at, uint8_t* out, size_t n) {
        if (!exists(p) || at >= files[p].size()) return 0;
        n = std::min(n, files[p].size() - at); std::copy_n(files[p].data() + at, n, out); return n;
    }
    bool writeBinaryFile(const String& p, const uint8_t* data, size_t n) {
        if (failWrite) return false;
        files[p].clear(); if (n) files[p].assign(data, data + n); return true;
    }
    bool appendBinaryFile(const String& p, const uint8_t* data, size_t n) {
        if (failWrite) return false;
        if (n) files[p].insert(files[p].end(), data, data + n);
        return true;
    }
    bool deleteFile(const String& p) { return !failDelete && files.erase(p); }
    bool replaceFileSafely(const String& from, const String& to) {
        if (failReplace || !exists(from)) return false;
        files[to] = files[from]; files.erase(from); return true;
    }
    bool recoverFile(const String&) { return true; }
};
