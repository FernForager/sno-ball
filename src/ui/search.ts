/**
 * The search box: one labelled form where the visitor types a Washington
 * address, a submit button, a row of example chips, and the credit line
 * Nominatim's usage policy asks for.
 *
 * The form never looks anything up as the visitor types (Nominatim forbids
 * autocomplete); it only calls `onSubmit` when they press Enter, click the
 * button or tap an example. The page decides what to do with the query and
 * reports back through `setBusy` (while a lookup runs) and `setError`
 * (when it fails), so this module holds no network code at all.
 */

import { el } from './ring-card';

export interface SearchExample {
  /** What the chip says, e.g. "The Space Needle" */
  label: string;
  /** What is submitted when it is tapped, e.g. "400 Broad St, Seattle" */
  query: string;
}

export interface SearchOptions {
  /** Called with the trimmed query whenever the visitor submits one. */
  onSubmit(query: string): void;
  /** Ready-made searches shown as chips under the box. */
  examples: SearchExample[];
}

export interface SearchHandle {
  /** Disable the controls and show "Looking it up" while a search runs. */
  setBusy(b: boolean): void;
  /** Show a message under the box, or clear it with null. */
  setError(msg: string | null): void;
}

export const SEARCH_PLACEHOLDER = 'Any address in Washington';
export const SUBMIT_LABEL = 'Tell me its story';
const BUSY_LABEL = 'Looking it up…';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/';

/**
 * Render the search form into `root` and return the handle the page uses
 * to reflect progress. The form has a visible label, a search input with
 * the placeholder "Any address in Washington" and browser autocomplete
 * off, a "Tell me its story" button, one button per example, an error line
 * tied to the input with aria-describedby, and the "Search by OpenStreetMap
 * Nominatim" credit. Submitting with an empty box shows a hint instead of
 * calling onSubmit.
 */
export function mountSearch(root: HTMLElement, opts: SearchOptions): SearchHandle {
  const inputId = 'search-query';
  const errorId = 'search-error';

  const input = el('input', {
    id: inputId,
    class: 'search__input',
    type: 'search',
    name: 'q',
    placeholder: SEARCH_PLACEHOLDER,
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-describedby': errorId,
  });
  const button = el('button', { type: 'submit', class: 'button search__submit' }, [SUBMIT_LABEL]);
  const error = el('p', { id: errorId, class: 'search__error', role: 'alert', hidden: '' });

  const chips = opts.examples.map((example) =>
    el('button', { type: 'button', class: 'chip', 'data-query': example.query }, [example.label]),
  );
  const examples = el('div', { class: 'search__examples', role: 'group', 'aria-label': 'Try an example' }, [
    el('span', { class: 'search__examples-label muted' }, ['Try:']),
    ...chips,
  ]);

  const credit = el('p', { class: 'search__credit muted' }, [
    'Search by ',
    el('a', { href: NOMINATIM_URL, target: '_blank', rel: 'noopener noreferrer' }, ['OpenStreetMap Nominatim']),
  ]);

  const form = el('form', { class: 'search', role: 'search', 'aria-label': 'Find a place in Washington' }, [
    el('label', { for: inputId, class: 'search__label' }, ['Address']),
    el('div', { class: 'search__row' }, [input, button]),
    error,
    opts.examples.length > 0 ? examples : null,
    credit,
  ]);

  let busy = false;

  const setError: SearchHandle['setError'] = (msg) => {
    if (msg) {
      error.textContent = msg;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      error.textContent = '';
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  };

  const setBusy: SearchHandle['setBusy'] = (b) => {
    busy = b;
    button.disabled = b;
    button.textContent = b ? BUSY_LABEL : SUBMIT_LABEL;
    for (const chip of chips) chip.disabled = b;
    if (b) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
  };

  /** Hand a query to the page, after the two checks that belong here. */
  const submit = (raw: string): void => {
    if (busy) return;
    const query = raw.trim();
    if (!query) {
      setError('Type an address to begin.');
      input.focus();
      return;
    }
    setError(null);
    opts.onSubmit(query);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  });

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const query = chip.dataset['query'] ?? chip.textContent ?? '';
      input.value = query;
      submit(query);
    });
  }

  root.replaceChildren(form);
  return { setBusy, setError };
}
