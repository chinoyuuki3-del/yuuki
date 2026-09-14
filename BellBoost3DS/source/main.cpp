#include <3ds.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <algorithm>
#include <set>

static constexpr uint32_t WALLET_MAX = 99999;
static constexpr uint32_t BANK_MAX = 999999999;

enum class SaveKind { NL, WA };

struct FoundSave {
    std::string path;
    SaveKind kind;
    time_t mtime;
};

static uint32_t read32(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t read16(const uint8_t* p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static void write32(uint8_t* p, uint32_t v) {
    p[0] = (uint8_t)(v & 0xFF);
    p[1] = (uint8_t)((v >> 8) & 0xFF);
    p[2] = (uint8_t)((v >> 16) & 0xFF);
    p[3] = (uint8_t)((v >> 24) & 0xFF);
}

static uint32_t crcReflected(const uint8_t* data, size_t size) {
    uint32_t crc = 0xFFFFFFFFu;
    constexpr uint32_t poly = 0x82F63B78u;
    for (size_t i = 0; i < size; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b)
            crc = (crc >> 1) ^ ((crc & 1) ? poly : 0);
    }
    return ~crc;
}

static uint32_t crcNormal(const uint8_t* data, size_t size) {
    uint32_t crc = 0;
    constexpr uint32_t poly = 0x04C11DB7u;
    for (size_t i = 0; i < size; ++i) {
        crc ^= (uint32_t)data[i] << 24;
        for (int b = 0; b < 8; ++b)
            crc = (crc << 1) ^ ((crc & 0x80000000u) ? poly : 0);
    }
    return ~crc;
}

static bool checkBlock(const std::vector<uint8_t>& d, size_t start, size_t size, bool normal=false) {
    if (start + 4 + size > d.size()) return false;
    uint32_t stored = read32(&d[start]);
    uint32_t calc = normal ? crcNormal(&d[start + 4], size) : crcReflected(&d[start + 4], size);
    return stored == calc;
}

static void updateBlock(std::vector<uint8_t>& d, size_t start, size_t size, bool normal=false) {
    uint32_t crc = normal ? crcNormal(&d[start + 4], size) : crcReflected(&d[start + 4], size);
    write32(&d[start], crc);
}

static bool validateChecksums(const std::vector<uint8_t>& d, SaveKind k) {
    if (!checkBlock(d, 0x80, 0x1C)) return false;
    if (k == SaveKind::WA) {
        for (int i = 0; i < 4; ++i) {
            size_t p = 0xA0 + 0xA480 * i;
            if (!checkBlock(d, p, 0x6B84)) return false;
            if (!checkBlock(d, p + 0x6B88, 0x38F4)) return false;
        }
        return checkBlock(d, 0x292A0, 0x22BC8) &&
               checkBlock(d, 0x4BE80, 0x44B8) &&
               checkBlock(d, 0x53424, 0x1E4D8) &&
               checkBlock(d, 0x71900, 0x20) &&
               checkBlock(d, 0x71924, 0xBE4) &&
               checkBlock(d, 0x73954, 0x16188) &&
               checkBlock(d, 0x5033C, 0x28F0, true) &&
               checkBlock(d, 0x52C30, 0x7F0, true) &&
               checkBlock(d, 0x7250C, 0x1444, true);
    }
    for (int i = 0; i < 4; ++i) {
        size_t p = 0xA0 + 0x9F10 * i;
        if (!checkBlock(d, p, 0x6B64)) return false;
        if (!checkBlock(d, p + 0x6B68, 0x33A4)) return false;
    }
    return checkBlock(d, 0x27CE0, 0x218B0) &&
           checkBlock(d, 0x495A0, 0x44B8) &&
           checkBlock(d, 0x4DA5C, 0x1E420) &&
           checkBlock(d, 0x6BE80, 0x20) &&
           checkBlock(d, 0x6BEA4, 0x13AF8);
}

static void fixChecksums(std::vector<uint8_t>& d, SaveKind k) {
    updateBlock(d, 0x80, 0x1C);
    if (k == SaveKind::WA) {
        for (int i = 0; i < 4; ++i) {
            size_t p = 0xA0 + 0xA480 * i;
            updateBlock(d, p, 0x6B84);
            updateBlock(d, p + 0x6B88, 0x38F4);
        }
        updateBlock(d, 0x292A0, 0x22BC8);
        updateBlock(d, 0x4BE80, 0x44B8);
        updateBlock(d, 0x53424, 0x1E4D8);
        updateBlock(d, 0x71900, 0x20);
        updateBlock(d, 0x71924, 0xBE4);
        updateBlock(d, 0x73954, 0x16188);
        updateBlock(d, 0x5033C, 0x28F0, true);
        updateBlock(d, 0x52C30, 0x7F0, true);
        updateBlock(d, 0x7250C, 0x1444, true);
    } else {
        for (int i = 0; i < 4; ++i) {
            size_t p = 0xA0 + 0x9F10 * i;
            updateBlock(d, p, 0x6B64);
            updateBlock(d, p + 0x6B68, 0x33A4);
        }
        updateBlock(d, 0x27CE0, 0x218B0);
        updateBlock(d, 0x495A0, 0x44B8);
        updateBlock(d, 0x4DA5C, 0x1E420);
        updateBlock(d, 0x6BE80, 0x20);
        updateBlock(d, 0x6BEA4, 0x13AF8);
    }
}

static uint8_t moneyChecksum(uint32_t low) {
    return (uint8_t)(((low & 0xFF) + ((low >> 8) & 0xFF) + ((low >> 16) & 0xFF) + ((low >> 24) & 0xFF) + 0xBA) & 0xFF);
}

static bool decryptMoney(const uint8_t* p, uint32_t& out) {
    uint32_t low = read32(p);
    uint32_t high = read32(p + 4);
    uint16_t adjust = (uint16_t)(high & 0xFFFF);
    uint8_t shift = (uint8_t)((high >> 16) & 0xFF);
    uint8_t chk = (uint8_t)(high >> 24);
    if (moneyChecksum(low) != chk || shift >= 0x1A) return false;
    uint8_t ls = (uint8_t)(0x1C - shift);
    uint8_t rs = (uint8_t)(0x20 - ls);
    out = ((low << ls) + (low >> rs)) - (adjust + 0x8F187432u);
    return true;
}

static void encryptMoney(uint8_t* p, uint32_t value) {
    uint64_t t = svcGetSystemTick();
    uint16_t adjust = (uint16_t)((t ^ (t >> 16) ^ (t >> 32)) & 0xFFFF);
    uint8_t shift = (uint8_t)(((t >> 8) ^ (t >> 24)) % 0x1A);
    uint32_t enc = value + adjust + 0x8F187432u;
    enc = (enc >> (0x1C - shift)) + (enc << (shift + 4));
    uint32_t meta = ((uint32_t)moneyChecksum(enc) << 24) | ((uint32_t)shift << 16) | adjust;
    write32(p, enc);
    write32(p + 4, meta);
}

static bool readFile(const std::string& path, std::vector<uint8_t>& out) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n <= 0) { fclose(f); return false; }
    out.resize((size_t)n);
    bool ok = fread(out.data(), 1, out.size(), f) == out.size();
    fclose(f);
    return ok;
}

static bool writeFile(const std::string& path, const std::vector<uint8_t>& data) {
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return false;
    bool ok = fwrite(data.data(), 1, data.size(), f) == data.size();
    fflush(f);
    fsync(fileno(f));
    fclose(f);
    return ok;
}

static std::string makeBackupName(const std::string& path) {
    for (int i = 0; i < 100; ++i) {
        std::string p = path + (i == 0 ? ".bellboost.bak" : ".bellboost.bak" + std::to_string(i));
        struct stat st{};
        if (stat(p.c_str(), &st) != 0) return p;
    }
    return path + ".bellboost.last.bak";
}

static bool replaceSafely(const std::string& path, const std::vector<uint8_t>& data, SaveKind kind, std::string& backupOut) {
    std::string tmp = path + ".bellboost.tmp";
    if (!writeFile(tmp, data)) return false;

    std::vector<uint8_t> verify;
    if (!readFile(tmp, verify) || verify != data) {
        remove(tmp.c_str());
        return false;
    }

    backupOut = makeBackupName(path);
    if (rename(path.c_str(), backupOut.c_str()) != 0) {
        remove(tmp.c_str());
        return false;
    }
    if (rename(tmp.c_str(), path.c_str()) != 0) {
        rename(backupOut.c_str(), path.c_str());
        remove(tmp.c_str());
        return false;
    }

    std::vector<uint8_t> finalData;
    if (!readFile(path, finalData) || finalData != data || !validateChecksums(finalData, kind)) {
        remove(path.c_str());
        rename(backupOut.c_str(), path.c_str());
        return false;
    }
    return true;
}

static void scanDir(const std::string& dir, int depth, std::vector<FoundSave>& out) {
    if (depth > 5) return;
    DIR* d = opendir(dir.c_str());
    if (!d) return;
    dirent* e;
    while ((e = readdir(d))) {
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
        std::string p = dir + "/" + e->d_name;
        struct stat st{};
        if (stat(p.c_str(), &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            scanDir(p, depth + 1, out);
        } else if (!strcmp(e->d_name, "garden_plus.dat") || !strcmp(e->d_name, "garden.dat")) {
            out.push_back({p, !strcmp(e->d_name, "garden_plus.dat") ? SaveKind::WA : SaveKind::NL, st.st_mtime});
        }
    }
    closedir(d);
}

static bool findSave(FoundSave& found) {
    std::vector<FoundSave> all;
    scanDir("sdmc:/3ds/BellBoost", 0, all);
    scanDir("sdmc:/3ds/Checkpoint/saves", 0, all);
    scanDir("sdmc:/3ds/Checkpoint", 0, all);
    if (all.empty()) return false;

    std::set<std::string> seen;
    std::vector<FoundSave> unique;
    for (const auto& s : all) {
        if (seen.insert(s.path).second) unique.push_back(s);
    }
    std::sort(unique.begin(), unique.end(), [](const FoundSave& a, const FoundSave& b) {
        return a.mtime > b.mtime;
    });
    found = unique.front();
    return true;
}

static bool boost(const FoundSave& s, uint32_t& walletBefore, uint32_t& bankBefore, int& playerIndex, std::string& backup, std::string& err) {
    std::vector<uint8_t> data;
    if (!readFile(s.path, data)) { err = "Could not read save"; return false; }

    const size_t expectedSize = (s.kind == SaveKind::WA) ? 0x89AE0 : 0x7F9A0;
    if (data.size() != expectedSize) { err = "Unexpected file size; refusing to write"; return false; }
    if (!validateChecksums(data, s.kind)) { err = "CRC check failed; refusing to write"; return false; }

    const size_t stride = (s.kind == SaveKind::WA) ? 0xA480 : 0x9F10;
    const size_t walletRel = (s.kind == SaveKind::WA) ? 0x6F08 : 0x6E38;
    const size_t bankRel = (s.kind == SaveKind::WA) ? 0x6B8C : 0x6B6C;

    playerIndex = -1;
    for (int i = 0; i < 4; ++i) {
        const size_t base = 0xA0 + stride * i;
        if (base + walletRel + 8 > data.size() || base + bankRel + 8 > data.size()) continue;
        const uint16_t playerId = read16(&data[base + 0x55A6]);
        if (playerId == 0) continue;

        uint32_t wallet = 0, bank = 0;
        if (!decryptMoney(&data[base + walletRel], wallet)) continue;
        if (!decryptMoney(&data[base + bankRel], bank)) continue;
        if (wallet > WALLET_MAX || bank > BANK_MAX) continue;

        walletBefore = wallet;
        bankBefore = bank;
        playerIndex = i;
        encryptMoney(&data[base + walletRel], WALLET_MAX);
        encryptMoney(&data[base + bankRel], BANK_MAX);
        break;
    }
    if (playerIndex < 0) { err = "No safely editable player found"; return false; }

    fixChecksums(data, s.kind);
    if (!validateChecksums(data, s.kind)) { err = "CRC re-check failed before write"; return false; }

    const size_t base = 0xA0 + stride * playerIndex;
    uint32_t walletAfter = 0, bankAfter = 0;
    if (!decryptMoney(&data[base + walletRel], walletAfter) || walletAfter != WALLET_MAX ||
        !decryptMoney(&data[base + bankRel], bankAfter) || bankAfter != BANK_MAX) {
        err = "Money value verification failed";
        return false;
    }

    if (!replaceSafely(s.path, data, s.kind, backup)) {
        err = "Safe replace/read-back failed; check backup";
        return false;
    }
    return true;
}

int main(int argc, char** argv) {
    gfxInitDefault();
    consoleInit(GFX_TOP, nullptr);
    consoleClear();

    printf("\x1b[2;4HBellBoost 3DS v0.2 SafeMax\n");
    printf("\x1b[4;4HAnimal Crossing: New Leaf\n");
    printf("\x1b[5;4HOne-button SafeMax Bell booster\n\n");

    FoundSave save{};
    bool found = findSave(save);
    if (found) {
        printf("  Save found:\n  %s\n\n", save.path.c_str());
        printf("  [A] Set wallet + bank to safe max\n");
    } else {
        printf("  garden.dat / garden_plus.dat not found.\n\n");
        printf("  Make a Checkpoint backup, or put the save in\n");
        printf("  sdmc:/3ds/BellBoost/\n");
    }
    printf("  [START] Exit\n\n");
    printf("  Original is preserved as .bellboost.bak\n");

    while (aptMainLoop()) {
        hidScanInput();
        u32 down = hidKeysDown();
        if (down & KEY_START) break;
        if (found && (down & KEY_A)) {
            printf("\n  Checking save...\n");
            uint32_t walletBefore = 0, bankBefore = 0;
            int player = -1;
            std::string backup, err;
            if (boost(save, walletBefore, bankBefore, player, backup, err)) {
                printf("\n  SUCCESS! Player %d\n", player + 1);
                printf("  Wallet: %lu -> %lu\n", (unsigned long)walletBefore, (unsigned long)WALLET_MAX);
                printf("  Bank:   %lu -> %lu\n", (unsigned long)bankBefore, (unsigned long)BANK_MAX);
                printf("  Backup:\n  %s\n", backup.c_str());
                printf("\n  Restore this Checkpoint backup, then start the game.\n");
                found = false;
            } else {
                printf("\n  STOPPED: %s\n", err.c_str());
                printf("  No unsafe write was kept.\n");
            }
        }
        gfxFlushBuffers();
        gfxSwapBuffers();
        gspWaitForVBlank();
    }

    gfxExit();
    return 0;
}
