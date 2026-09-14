# BellBoost 3DS v0.2 SafeMax

A tiny Nintendo 3DS Homebrew Launcher app for editing **your own** Animal Crossing: New Leaf / Welcome amiibo Checkpoint backup.

## One-button behavior

Press **A** once and BellBoost sets the first valid player to the normal in-game limits:

- Wallet: **99,999 Bells**
- Savings account: **999,999,999 Bells**

It deliberately does **not** fill inventory slots with Bell bags, because overwriting inventory is riskier and unnecessary.

## Safety checks

BellBoost is intentionally conservative:

1. Only accepts `garden.dat` and `garden_plus.dat`.
2. Requires the expected save-file size for the edition.
3. Verifies all known AC:NL / Welcome amiibo CRC blocks before editing.
4. Validates the game's encrypted integer format for wallet and savings values.
5. Rejects already-impossible money values instead of trying to repair them.
6. Edits a memory copy first.
7. Recalculates the correct CRC blocks.
8. Re-validates CRCs and decrypts the new values before any replacement.
9. Writes a temporary file and reads it back byte-for-byte.
10. Renames the original to a unique `.bellboost.bak` backup before replacing it.
11. Reads the final file back and validates it again. If that fails, BellBoost attempts to restore the original backup.
12. Disables the A action after a successful write to prevent accidental double presses.

No save editor can promise zero risk. Keep the original Checkpoint backup until you have successfully opened the game and saved normally.

## Supported saves

- Animal Crossing: New Leaf: `garden.dat`
- Animal Crossing: New Leaf - Welcome amiibo: `garden_plus.dat`

BellBoost searches:

- `sdmc:/3ds/BellBoost/`
- common Checkpoint save directories under `sdmc:/3ds/Checkpoint/`

If several matching saves exist, it chooses the newest one by modification time.

## Build

Requires devkitPro/devkitARM and libctru.

```sh
cd BellBoost3DS
make
```

Output:

```text
BellBoost.3dsx
```

This repository also contains a GitHub Actions workflow that builds the `.3dsx` in the official `devkitpro/devkitarm` container and uploads it as an artifact.

## Credits / format notes

The AC:NL encrypted integer layout, player offsets, and save CRC block layout were cross-checked against **Universal-Team/LeafEdit-Core**. BellBoost is an independent minimal editor focused only on wallet/savings values and defensive save handling.

Because the implementation is based on GPL-licensed save-format logic, this BellBoost subproject is provided under **GPL-3.0-or-later**.
