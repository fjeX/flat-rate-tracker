// The "remember my vehicle make" preference, as pure functions.
//
// Extracted from useLogRoForm so it can be tested without a renderer. The hook
// holds the React state; these decide what the two visible values actually are.
//
// THE STORAGE MODEL: there is no separate "autofill is on" flag. A saved make
// IS the flag — turning autofill off deletes the key. That is how it has always
// worked, and reading it any other way would misread the entries already sitting
// in users' browsers.

export const DEFAULT_MAKE_KEY = "frt_default_make";

/**
 * Is autofill on?
 *
 * @param choice     what the user toggled in THIS session, or null if untouched
 * @param isEdit     editing an existing RO never autofills — its make is the
 *                   vehicle's, and overwriting that would corrupt the record
 * @param savedMake  the stored default; "" means none
 *
 * `choice` wins once set, and it must: clearing the make field writes "" to
 * storage, and without the pin the checkbox would silently uncheck itself
 * mid-edit just because the field went empty.
 */
export function deriveAutoFill(
  choice: boolean | null,
  isEdit: boolean,
  savedMake: string,
): boolean {
  return choice ?? (!isEdit && savedMake !== "");
}

/**
 * What goes in the Make box.
 *
 * @param makeInput  what the user typed, or null if they have not touched it
 * @param autoFill   result of deriveAutoFill
 * @param savedMake  the stored default
 *
 * null and "" are deliberately different. null means untouched, so the saved
 * default may fill in; "" means the user cleared the box and it must stay clear
 * rather than refilling from storage on the very next render.
 */
export function deriveMake(
  makeInput: string | null,
  autoFill: boolean,
  savedMake: string,
): string {
  return makeInput ?? (autoFill ? savedMake : "");
}
