import { describe, expect, it } from "vitest"
import { redact } from "./redact.ts"

// Invented values in the shapes real keys take; none of them is a real credential.
const OPENAI = "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"
const ANTHROPIC = "sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe"
const GITHUB = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
const AWS = "AKIAIOSFODNN7EXAMPLE"
const SLACK = "xoxb-123456789012-abcdefABCDEF"
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"

describe("redact", () => {
  it.each([
    ["an OpenAI-style key", `export OPENAI_API_KEY=${OPENAI}`, OPENAI],
    ["an Anthropic key", `key: ${ANTHROPIC}`, ANTHROPIC],
    ["a GitHub token", `git push https://${GITHUB}@github.com/x/y`, GITHUB],
    ["an AWS access key id", `aws_access_key_id = ${AWS}`, AWS],
    ["a Slack token", `token ${SLACK}`, SLACK],
    ["a JWT", `Authorization: Bearer ${JWT}`, JWT],
  ])("masks %s and says so", (_, text, secret) => {
    const out = redact(text)
    expect(out.masked).toBe(true)
    expect(out.text).not.toContain(secret)
    // The start stays, so the human can tell which key it was.
    expect(out.text).toContain(secret.slice(0, 4))
    expect(out.text).toContain("•")
  })

  it("masks the value of a secret-named variable, whatever it looks like", () => {
    const out = redact('DATABASE_PASSWORD="correct horse battery"\nSTRIPE_SECRET=abc123def456\nAPI_TOKEN: tok_live_9988')
    expect(out.masked).toBe(true)
    expect(out.text).not.toMatch(/correct|horse|battery/)
    expect(out.text).not.toContain("abc123def456")
    expect(out.text).not.toContain("tok_live_9988")
    expect(out.text).toContain("DATABASE_PASSWORD=")
  })

  it("masks a long random-looking string, but not commit hashes, paths, ids or ordinary words", () => {
    const random = "Q2hlY2tPdXRUaGlzVmVyeUxvbmdTZWNyZXRWYWx1ZTEyMzQ1Njc4OTA"
    expect(redact(`secret blob ${random} end`).text).not.toContain(random)
    const plain = [
      "commit 875c32b1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7 merged",
      "/Users/someone/projects/cello/apps/server/src/agentLog/AgentLogService.ts",
      "toolu_01BUf7XocSvLkzJhmsfr7YyZ and msg_011Ch6S6Rkf7dZrvBzDENNW7",
      "01M7HXQ345F49BF4Y4X1XRZEJD",
      "d0d47d35-b2df-44ed-a02f-890eefdc1a58",
      "The quick brown fox jumps over the lazy dog, again and again and again.",
      "bun run test:docker:e2e -- e2e/agents-page.spec.ts",
      "const token = getToken(session); passwordField: string",
      "image sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "if (password === undefined) return",
    ].join("\n")
    expect(redact(plain)).toEqual({ text: plain, masked: false })
  })

  it.each([
    ["a bearer token", "curl -H 'Authorization: Bearer abc123def456ghi789jkl'", "abc123def456ghi789jkl"],
    ["a password in a URL", "git clone https://lucy:hunter2pass@example.com/repo.git", "hunter2pass"],
    ["a database URL", "DATABASE_URL=postgres://app:s3cretpw@db.internal:5432/app", "s3cretpw"],
    ["a --password flag", "mysql --password=hunter2pass -u root", "hunter2pass"],
    ["a --token flag", "gh auth login --token tokvalue123456", "tokvalue123456"],
    ["a lower-case password=", "login password=hunter2pass ok", "hunter2pass"],
    ["a JSON api_key", '{ "api_key": "k-123456789abcdef" }', "k-123456789abcdef"],
    ["an ini secret", "[default]\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE\n", "wJalrXUtnFEMI"],
    ["a 48-character hex key", "key 0123456789abcdef0123456789abcdef0123456789abcdef end", "0123456789abcdef0123456789abcdef0123456789abcdef"],
  ])("masks %s", (_, text, secret) => {
    const out = redact(text)
    expect(out.masked).toBe(true)
    expect(out.text).not.toContain(secret)
    // Not even its start, unless it's a key whose start only says what kind it is.
    if (!/^[0-9a-f]{48}$/.test(secret)) expect(out.text).not.toContain(secret.slice(0, 4))
  })
})
