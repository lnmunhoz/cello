// Where a claim leaves a task. The server applies it when a session claims a task and when the human's
// comment reopens one for the session that last held it (CEL-110); the web app uses it to say beforehand
// whether a comment reopens the task or only gives it back.

/** Started (In Progress, In Review) or waiting on the human's answers (Needs input): a claim leaves the task there. Anything else moves to In Progress. */
export const claimKeepsStatus = (category: string | undefined): boolean => category === "started" || category === "waiting"
