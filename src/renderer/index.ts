// index.ts
import { NAV_BAR_HEIGHT } from '../shared/site-layout';
import { api } from './api';
import { Content } from './content';
import { Sidebar } from './sidebar';
import { SidebarResizer } from './sidebar-resizer';

document.title = 'AI Agent Windows';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

document.documentElement.style.setProperty('--nav-bar-height', `${NAV_BAR_HEIGHT}px`);

const content = new Content();
const sidebar = new Sidebar({
  onSelect: (id) => void api.selectAgent(id),
  onRoom: () => void api.roomSelect(),
  onRoomOpen: (id) => content.roomOpen(id),
  onRoomNew: () => content.roomNew(),
  onRoomRename: (id, title) => content.roomRename(id, title),
  onAdd: (kind) => void api.addAgent(kind),
  onClose: (id) => void api.closeAgent(id),
  onRename: (id, title) => void api.renameAgent(id, title),
  onTheme: (choice) => void api.themeSet(choice),
});
content.watchRooms((state) => sidebar.setRooms(state));
void api.layoutGet().then((stored) => {
  const resizer = new SidebarResizer(stored, (width) => void api.layoutSidebar(width));
  root.append(sidebar.element, resizer.element, content.element);
  if (resizer.currentWidth() !== stored) void api.layoutSidebar(resizer.currentWidth());
});

api.onPtyData((event) => content.ptyData(event));
api.onRoomEvent((event) => content.roomEvent(event));
api.onRoomTerminalData((event) => content.roomTerminalData(event));
api.onSiteState((event) => content.siteState(event));
api.onPtyExit((event) => content.ptyExit(event.id, event.exitCode));
api.onAgentsChanged((snapshot) => {
  sidebar.render(snapshot);
  content.render(snapshot);
});
void api.listAgents().then((snapshot) => {
  sidebar.render(snapshot);
  content.render(snapshot);
});
void api.themeGet().then((choice) => sidebar.setTheme(choice));
void api.roomState().then((snapshot) => content.roomLoad(snapshot));
