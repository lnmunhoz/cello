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
    // CEL-108: lower-case names with an unquoted value, as in YAML or a config dump.
    ["a YAML password", "db:\n  password: hunter2hunter2\n", "hunter2hunter2"],
    ["a YAML secret", "secret: s3cr3tvalue99", "s3cr3tvalue99"],
    ["a YAML token", "  token: abcd1234efgh5678", "abcd1234efgh5678"],
    ["an access_token", "access_token: ya29.a0Af8kLm2nOp", "ya29.a0Af8kLm2nOp"],
    ["a spaced name = value", "password = hunter2hunter2", "hunter2hunter2"],
    ["a name, then its value after a space", "apikey abc123def456ghi", "abc123def456ghi"],
    // Headers.
    ["an X-Api-Key header", "curl -H 'X-Api-Key: k3yv4lue99' https://api.example.com", "k3yv4lue99"],
    ["a lower-case x-api-key header", "x-api-key: zz88yy77xx66", "zz88yy77xx66"],
    ["a Basic authorization header", "Authorization: Basic dXNlcjpodW50ZXIy", "dXNlcjpodW50ZXIy"],
    ["a token authorization header", '-H "Authorization: token 0a1b2c3d4e5f"', "0a1b2c3d4e5f"],
    ["a Cookie header", "Cookie: session=abc123sessionvalue; theme=dark", "abc123sessionvalue"],
    ["a Set-Cookie header", "Set-Cookie: sid=s3ss10nvalue; Path=/; HttpOnly", "s3ss10nvalue"],
    // Passwords on a command line.
    ["curl -u", "curl -s -u lucy:hunter2pass https://example.com", "hunter2pass"],
    ["curl --user", "curl --user lucy:hunter2pass https://example.com", "hunter2pass"],
    ["curl --user=", "curl --user=lucy:hunter2pass https://example.com", "hunter2pass"],
    ["mysql -p with the password attached", "mysql -uroot -phunter2pass app", "hunter2pass"],
    ["mysqldump -p", "mysqldump -u root -phunter2pass app > dump.sql", "hunter2pass"],
    ["curl -u on a continued line", "curl -s \\\n  -u lucy:hunter2pass \\\n  https://example.com", "hunter2pass"],
    ["curl -u after a cookie header", "curl -H 'Cookie: a=1; b=2' -u lucy:hunter2pass https://x", "hunter2pass"],
  ])("masks %s", (_, text, secret) => {
    const out = redact(text)
    expect(out.masked).toBe(true)
    expect(out.text).not.toContain(secret)
    // Not even its start, unless it's a key whose start only says what kind it is.
    if (!/^[0-9a-f]{48}$/.test(secret)) expect(out.text).not.toContain(secret.slice(0, 4))
  })

  it("keeps the name and the rest of the line readable around what it masks", () => {
    expect(redact("db:\n  password: hunter2hunter2\n  host: db.internal").text).toBe("db:\n  password: ••••••••\n  host: db.internal")
    expect(redact("curl -u lucy:hunter2pass https://example.com").text).toBe("curl -u lucy:•••••••• https://example.com")
    expect(redact("mysql -uroot -phunter2pass app").text).toBe("mysql -uroot -p•••••••• app")
    expect(redact("Cookie: session=abc123sessionvalue").text).toBe("Cookie: ••••••••")
  })

  it("leaves code and commands that only look like those shapes alone", () => {
    const plain = [
      // a call, a type, a property: the value isn't a literal, or has no digit
      "const token = getToken()",
      "const token = getToken2(session)",
      "token: string",
      "password: z.string().min(8)",
      "secret: process.env.SECRET",
      "  access_token: ${{ secrets.ACCESS_TOKEN }}",
      // counts, not secrets: no letter
      '"input_tokens": 12345678, "cache_read_input_tokens": 98765432',
      // too short to be a password
      "password: hunter2",
      // -u and -p that aren't curl's or mysql's
      "docker run -u 1000:1000 node:22",
      "git push -u origin main",
      "ssh -p2222 lucy@example.com",
      "tar -pxvf archive.tar",
      "mkdir -p apps/server/src",
      // -u and -p in the next command, after a curl or a mysql
      "curl -fsS https://example.com/health && docker run -u 1000:1000 node:22",
      'mysql -e "select 1" || ssh -p2222 lucy@example.com',
      "curl -O https://example.com/a.tar",
      "tar -pxvf a.tar",
      // a header that only names the cookie, a TypeScript type
      "cookie: string",
      "x-api-key header is required",
    ].join("\n")
    expect(redact(plain)).toEqual({ text: plain, masked: false })
  })

  // ReDoS guards. Each line is built to make a pattern backtrack: a pattern that's quadratic on it takes
  // half a minute or more per line (and vitest fails the test as timed out), a linear one milliseconds.
  // No clock here: what's checked is the answer.
  describe("on lines built to make a pattern backtrack", () => {
    const N = 40_000

    it.each([
      ["one long word made of a secret name", "token".repeat(N)],
      ["a long secret-ish name that never reaches = or :", `${"token_".repeat(N)}!`],
      ["a long capital name", `${"TOKEN_".repeat(N)}!`],
      ["a long flag", `--${"token".repeat(N)}`],
      ["a long run of what could start a URL's scheme", "a.".repeat(N)],
      ["cookie: over and over", "cookie:".repeat(N)],
      ["what could start a JWT, over and over", "eyJ-".repeat(N * 4)],
    ])("leaves %s alone, and still masks a secret after it", (_, pump) => {
      expect(redact(pump)).toEqual({ text: pump, masked: false })
      expect(redact(`${pump} password=hunter2pass`).text).toBe(`${pump} password=••••••••`)
    })

    it.each([
      ["token=", "token=".repeat(N), "token=••••••••"],
      ["password, spaced", "password ".repeat(N), "password ".repeat(N)],
      ["-u a: without curl", "-u a:".repeat(N), "-u a:".repeat(N)],
      ["curl -u", "curl -u ".repeat(N), "curl -u ".repeat(N)],
      ["Cookie: a", "Cookie: a".repeat(N), "Cookie: a".repeat(N)],
    ])("answers on %s repeated", (_, pump, expected) => {
      expect(redact(pump).text).toBe(expected)
    })
  })
})
