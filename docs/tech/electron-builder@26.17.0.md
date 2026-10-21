# electron-builder@26.17.0

- `-p` is the short form of `--publish`; `publish: never` disables publishing unconditionally — https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/electron-builder/src/builder.ts#L271-L276 and https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L54
- Linux `appArmorProfile` option and the `.deb` after-install script install an AppArmor profile (Ubuntu 24+) and a SUID `chrome-sandbox` — https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/src/options/linuxOptions.ts#L160
