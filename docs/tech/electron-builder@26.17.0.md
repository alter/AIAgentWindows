# electron-builder@26.17.0

- `-p` is the short form of `--publish` — https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/electron-builder/src/builder.ts#L271-L276
- Without an explicit `--publish`, electron-builder publishes implicitly when the npm lifecycle event is `release`, when CI has a git tag, or when CI is detected (warned as going away in v27); `--publish never` disables publishing; the config's `publish` key holds providers, not this policy — https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L85-L104
- Linux `appArmorProfile` option and the `.deb` after-install script install an AppArmor profile (Ubuntu 24+) and a SUID `chrome-sandbox` — https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/src/options/linuxOptions.ts#L160
