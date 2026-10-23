// index.ts
import { NAV_BAR_HEIGHT, SIDEBAR_WIDTH } from '../shared/site-layout';
import { api } from './api';
import { Content } from './content';
import { Sidebar } from './sidebar';

document.title = 'AI Agent Windows';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

document.documentElement.style.setProperty('--sidebar-width', `${SIDEBAR_WIDTH}px`);
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
  onTheme: (choice) => void api.themeSet(choice),
});
content.watchRooms((state) => sidebar.setRooms(state));
root.append(sidebar.element, content.element);

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
