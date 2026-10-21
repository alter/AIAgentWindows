// menu.ts
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { SiteAction } from '../shared/ipc';

export function installMenu(isMac: boolean, navigate: (action: SiteAction) => void): void {
  const goItem = (label: string, accelerator: string, action: SiteAction): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => navigate(action),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        goItem('Back', 'CmdOrCtrl+[', 'back'),
        goItem('Forward', 'CmdOrCtrl+]', 'forward'),
        goItem('Home', 'CmdOrCtrl+Shift+H', 'home'),
        goItem('Reload', 'CmdOrCtrl+R', 'reload'),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
