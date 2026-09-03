// ZipArchive — lightweight read-only zip file access for the RC viewer.
//
// Wraps miniz to list entries and extract file contents into memory.
// Used to bundle an entire presentation (.rc, .webp, .mp4, …) as a
// single .zip file.
#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <algorithm>
#include <iostream>

#include "miniz.h"

class ZipArchive {
public:
    ~ZipArchive() { close(); }

    // Open a zip file. Returns false on failure.
    bool open(const std::string& path) {
        close();
        memset(&mZip, 0, sizeof(mZip));
        if (!mz_zip_reader_init_file(&mZip, path.c_str(), 0)) {
            std::cerr << "ZipArchive: failed to open " << path << "\n";
            return false;
        }
        mOpen = true;

        // Cache the sorted list of entry names.
        int n = (int)mz_zip_reader_get_num_files(&mZip);
        for (int i = 0; i < n; i++) {
            mz_zip_archive_file_stat stat;
            if (!mz_zip_reader_file_stat(&mZip, i, &stat)) continue;
            if (stat.m_is_directory) continue;
            mEntries.push_back(stat.m_filename);
        }
        std::sort(mEntries.begin(), mEntries.end());
        return true;
    }

    void close() {
        if (mOpen) {
            mz_zip_reader_end(&mZip);
            mOpen = false;
        }
        mEntries.clear();
    }

    bool isOpen() const { return mOpen; }

    // Sorted list of file entries (no directories).
    const std::vector<std::string>& entries() const { return mEntries; }

    // Read an entry into a byte vector. Returns false on failure.
    bool read(const std::string& name, std::vector<uint8_t>& out) const {
        if (!mOpen) return false;
        int idx = mz_zip_reader_locate_file(&mZip, name.c_str(), nullptr, 0);
        if (idx < 0) {
            std::cerr << "ZipArchive: entry not found: " << name << "\n";
            return false;
        }
        mz_zip_archive_file_stat stat;
        if (!mz_zip_reader_file_stat(&mZip, idx, &stat)) return false;

        out.resize(static_cast<size_t>(stat.m_uncomp_size));
        if (!mz_zip_reader_extract_to_mem(&mZip, idx, out.data(), out.size(), 0)) {
            std::cerr << "ZipArchive: extract failed: " << name << "\n";
            out.clear();
            return false;
        }
        return true;
    }

    // Extract an entry to a file on disk. Returns false on failure.
    bool extractToFile(const std::string& name, const std::string& destPath) const {
        if (!mOpen) return false;
        int idx = mz_zip_reader_locate_file(&mZip, name.c_str(), nullptr, 0);
        if (idx < 0) return false;
        return mz_zip_reader_extract_to_file(&mZip, idx, destPath.c_str(), 0);
    }

private:
    mutable mz_zip_archive mZip{};
    bool mOpen = false;
    std::vector<std::string> mEntries;
};
