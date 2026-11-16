// Small pieces of plain English shared by the CLI, the history lines and the web app.

/** "a", "a and b", "a, b and c". */
export const andList = (items: ReadonlyArray<string>): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
