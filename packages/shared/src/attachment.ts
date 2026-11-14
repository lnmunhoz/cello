// Where the server serves a stored file (review evidence, a page's images): GET /attachments/<id>.
export const attachmentPath = (id: string): string => `/attachments/${id}`
