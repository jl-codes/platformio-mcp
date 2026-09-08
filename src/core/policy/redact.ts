const secretPatterns: RegExp[] = [
  /OPENAI_API_KEY=[^\s]+/gi,
  /GITHUB_TOKEN=[^\s]+/gi,
  /SUPABASE_KEY=[^\s]+/gi,
  /AWS_SECRET_ACCESS_KEY=[^\s]+/gi,
  /(?:wifi|wi-fi|wlan)[_-]?(?:password|pass|psk)\s*[:=]\s*[^\s,;]+/gi,
  /(?:api[_-]?key|client[_-]?secret|provisioning[_-]?(?:key|secret))\s*[:=]\s*[^\s,;]+/gi,
  /authorization\s*:\s*bearer\s+[^\s]+/gi,
  /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gi,
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
