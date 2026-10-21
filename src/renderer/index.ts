// index.ts
import { api } from './api';
import { Content } from './content';
import { Sidebar } from './sidebar';

document.title = 'AI Agent Windows';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

const content = new Content();
const sidebar = new Sidebar({
  onSelect: (id) => void api.selectAgent(id),
  onAdd: (kind) => void api.addAgent(kind),
});
root.append(sidebar.element, content.element);

api.onPtyData((event) => content.ptyData(event));
api.onPtyExit((event) => content.ptyExit(event.id, event.exitCode));
api.onAgentsChanged((snapshot) => {
  sidebar.render(snapshot);
  content.render(snapshot);
});
void api.listAgents().then((snapshot) => {
  sidebar.render(snapshot);
  content.render(snapshot);
});
