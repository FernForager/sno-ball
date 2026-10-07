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
  /**
   * Called when the visitor taps "Forget my searches". When given, a short
   * privacy note (what is sent where, what the page URL contains) and that
   * link are shown under the credit line. Resolves when the memory is clear.
   */
  onForget?: () => Promise<void>;
}

export interface SearchHandle {
  /** Mark the controls busy and show "Looking it up" while a search runs. */
  setBusy(b: boolean): void;
  /** Show a message under the box, or clear it with null. */
  setError(msg: string | null): void;
  /** Put text in the box without submitting it (used when a share link opens a story). */
  setQuery(query: string): void;
}

export const SEARCH_PLACEHOLDER = 'Any address in Washington';
export const SUBMIT_LABEL = 'Tell me its story';
const BUSY_LABEL = 'Looking it up…';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const PRIVACY_NOTE =
  'The address you type is sent to the map services above and remembered in this browser for 30 days; ' +
  'the page address then holds the spot\u2019s coordinates so you can share it.';
export const FORGET_LABEL = 'Forget my searches';

/**
 * Render the search form into `root` and return the handle the page uses
 * to reflect progress. The form has a visible label, a search input with
 * the placeholder "Any address in Washington" and browser autocomplete
 * off, a "Tell me its story" button, one button per example, an error line
 * tied to the input with aria-describedby, and the credit line ("Search by
 * Nominatim · Data © OpenStreetMap contributors, ODbL") that the geocoder's
 * policy and the data licence ask for. Submitting with an empty box shows
 * a hint instead of calling onSubmit.
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
    el('a', { href: NOMINATIM_URL, target: '_blank', rel: 'noopener noreferrer' }, ['Nominatim']),
    ' · Data © ',
    el('a', { href: OSM_COPYRIGHT_URL, target: '_blank', rel: 'noopener noreferrer' }, ['OpenStreetMap contributors']),
    ', ',
    el('a', { href: 'https://opendatacommons.org/licenses/odbl/1-0/', target: '_blank', rel: 'license noopener noreferrer' }, ['ODbL']),
  ]);

  // The privacy note and the "forget" link, only when the page can forget.
  let privacy: HTMLElement | null = null;
  if (opts.onForget) {
    const onForget = opts.onForget;
    const forget = el('button', { type: 'button', class: 'search__forget link-button' }, [FORGET_LABEL]);
    const done = el('span', { class: 'search__forgot', role: 'status', 'aria-live': 'polite' });
    forget.addEventListener('click', () => {
      done.textContent = '';
      onForget().then(
        () => {
          done.textContent = 'Forgotten.';
        },
        () => {
          done.textContent = 'Nothing was stored.';
        },
      );
    });
    privacy = el('p', { class: 'search__privacy muted' }, [PRIVACY_NOTE, ' ', forget, ' ', done]);
  }

  const form = el('form', { class: 'search', role: 'search', 'aria-label': 'Find a place in Washington' }, [
    el('label', { for: inputId, class: 'search__label' }, ['Address']),
    el('div', { class: 'search__row' }, [input, button]),
    error,
    opts.examples.length > 0 ? examples : null,
    credit,
    privacy,
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

  // The controls are marked busy with aria-disabled rather than `disabled`:
  // a disabled element drops keyboard focus, which would strand a visitor
  // who just pressed Enter on a chip. submit() ignores input while busy.
  const setBusy: SearchHandle['setBusy'] = (b) => {
    busy = b;
    button.textContent = b ? BUSY_LABEL : SUBMIT_LABEL;
    for (const control of [button, ...chips]) {
      if (b) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
    }
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

  const setQuery: SearchHandle['setQuery'] = (query) => {
    input.value = query;
  };

  root.replaceChildren(form);
  return { setBusy, setError, setQuery };
}
