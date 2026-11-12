import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

/** What the menu can do besides the built-in edit roles (supplied by the window that owns it). */
export interface EditMenuActions {
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  copyText: (text: string) => void;
  openExternal: (url: string) => void;
}

type MenuParams = Pick<
  ContextMenuParams,
  'isEditable' | 'selectionText' | 'editFlags' | 'misspelledWord' | 'dictionarySuggestions' | 'linkURL'
>;

/**
 * The right-click menu for the Studio window: spelling suggestions, then Undo/Redo and
 * Cut/Copy/Paste/Select All in text fields, Copy for selected text elsewhere, and Copy Link /
 * Open in Browser for web links. Returns an empty list when there's nothing useful to show.
 */
export function buildEditContextMenu(params: MenuParams, actions: EditMenuActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const flags = params.editFlags;
  const hasSelection = params.selectionText.trim().length > 0;
  const separate = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  };

  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, 5);
    for (const word of suggestions) {
      items.push({ label: word, click: () => actions.replaceMisspelling(word) });
    }
    if (!suggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
    items.push({
      label: 'Add to Dictionary',
      click: () => actions.addToDictionary(params.misspelledWord),
    });
    separate();
  }

  if (params.isEditable) {
    items.push(
      { role: 'undo', label: 'Undo', enabled: flags.canUndo },
      { role: 'redo', label: 'Redo', enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Cut', enabled: flags.canCut },
      { role: 'copy', label: 'Copy', enabled: flags.canCopy },
      { role: 'paste', label: 'Paste', enabled: flags.canPaste },
      { role: 'delete', label: 'Delete', enabled: flags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select All', enabled: flags.canSelectAll },
    );
  } else if (hasSelection) {
    items.push({ role: 'copy', label: 'Copy', enabled: flags.canCopy || hasSelection });
  }

  const link = params.linkURL;
  if (link && /^https?:\/\//i.test(link)) {
    separate();
    items.push(
      { label: 'Copy Link Address', click: () => actions.copyText(link) },
      { label: 'Open Link in Browser', click: () => actions.openExternal(link) },
    );
  } else if (link && /^webring:/i.test(link)) {
    separate();
    items.push({ label: 'Copy Link Address', click: () => actions.copyText(link) });
  }

  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  return items;
}
