// What a comment says in one line, where its text is shown short (a cursor step on the board). A comment
// can be only screenshots (CEL-73): then it says so instead of showing nothing.

export const commentGist = (comment: { readonly body: string; readonly attachments?: ReadonlyArray<unknown> | undefined }): string => {
  const body = comment.body.trim()
  if (body !== "") return body
  const shots = comment.attachments?.length ?? 0
  return shots === 0 ? "" : shots === 1 ? "(screenshot)" : `(${shots} screenshots)`
}
