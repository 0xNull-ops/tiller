# Tiller Mac releases

## Cut a release

1. Merge the release changes, and use a clean checkout of `origin/main` on the Apple Silicon release Mac. Run `vp i` once for a new checkout.
2. Run `node scripts/fork-release.ts --version 1.0.1` with a stable version higher than the latest public release. No version commit or shell exports are needed. The driver loads missing Apple credentials from `~/.config/tiller-release/env.sh` and selects the Xcode toolchain below.
3. Review the printed notes (by default, merged PRs since the previous published release). Use `--notes-file /path/to/notes.md` to supply your own, or `--since YYYY-MM-DD` to change the boundary.
4. After the build, signing, notarization and artifact checks pass, type `publish` once. Publication runs in order: GitHub, npm `tiller-app`, Homebrew cask, then a matching source tag in the private repo. Read the final PASS/FAIL for each channel.

Run the command in a real terminal. npm publishing needs passkey approval: press ENTER
when npm asks, then approve in the browser.

Releases are deliberate.
The landing page uses the stable latest-download URL ending in `Tiller-arm64.dmg`;
its links need no change per release.

If preflight fails, fix the reported toolchain, credentials or access before retrying.
If building fails, move the failed output folder aside and rerun. If publication
fails, keep `release/tiller-<version>/` intact and run the same command with
`--resume`. It verifies the saved artifacts and source commit, skips completed
channels, and reconciles remote state if a command succeeded before interruption.
GitHub assets are uploaded to a draft and downloaded for byte verification before
the draft is published. A failed upload cannot expose a feed with missing assets.
Do not run simultaneous releases or builds in the same checkout.

To pull a bad release, immediately mark it as a draft in GitHub and explicitly
mark the previous good release as latest. Confirm its `latest-mac.yml` and downloads.
Deprecate the bad npm version (`npm deprecate tiller-app@<version> "Withdrawn; use <good-version>"`)
and move npm's `latest` dist-tag to the good version. Revert the cask release commit
in the tap and push main. Keep the source tag as an audit record. Installed
apps do not downgrade automatically; cut a higher fixed version promptly.

## Build machine

The driver checks Rust 1.95 or newer (preferring rustup in `~/.cargo/bin`), Xcode,
the Developer ID Application identity for the release team, notarization credentials,
GitHub access to both public repositories, npm authentication (skipped with
`--no-publish`), clean source before building. `gh` must also access the source repository.
Set `APPLE_API_KEY` to a readable `.p8` path, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`
in the environment or the local credential file. Never commit that file.
If macOS asks to unlock the signing keychain, approve the prompt locally.

The driver uses this Xcode selection by default and derives SDKROOT, CC and CXX with xcrun:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

`--no-publish` builds, signs, notarizes and verifies everything, then stops without
a prompt. For testing unmerged changes only, combine it with `--allow-branch` on
a clean branch. It still checks remote versions and credentials. `--dry-run`
uses ad hoc executable signatures and skips Developer ID signing and notarization;
it never publishes. Outputs use `release/tiller-<version>[-dry-run]/`.

The app is signed, notarized and stapled before the ZIP and DMG are made. The DMG
is then signed, notarized and stapled itself. The stable DMG is a byte copy of the
versioned DMG. The CLI archive's executable is checked with `--version`, signature
verification and notarization; bare CLI binaries use online tickets and cannot be stapled.

## Installer artwork

`scripts/dmg/render.py` renders Space Grotesk from the fork brand assets into
640×420 and 1280×840 backgrounds. The driver combines them into a multi-resolution
TIFF. `scripts/dmg/settings.py` writes the Finder layout directly using dmgbuild,
without Apple Events or a logged-in Finder. Icon centers are (180,230) and (460,230),
with 96-point icons. `installer-proof.png` in the output folder composites the real
app and system Applications icons at those coordinates; it does not launch the app.
To regenerate the artwork alone, create a Python venv, install
`scripts/dmg/requirements.txt`, and run `python scripts/dmg/render.py /output/path`.
