// Is a process on this machine still running? Signal 0 checks without touching it; EPERM means it
// exists but belongs to another user.
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
