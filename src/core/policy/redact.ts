const secretPatterns: RegExp[] = [
  /OPENAI_API_KEY=[^\s]+/gi,
  /GITHUB_TOKEN=[^\s]+/gi,
  /SUPABASE_KEY=[^\s]+/gi,
  /AWS_SECRET_ACCESS_KEY=[^\s]+/gi,
  /password\s*=\s*[^\s]+/gi,
  /token\s*=\s*[^\s]+/gi,
];

const replacement = "[REDACTED_SECRET]";

export function redactSecretsInText(text: string): string {
  let redacted = text;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
