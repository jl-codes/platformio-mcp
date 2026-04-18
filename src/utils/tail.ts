import fs from "node:fs";

/**
 * Safely reads the tail of a file without loading the entire
 * file into memory. It bounds the read to the end of the file.
 * We restrict max bytes read (default 1MB) to prevent massive memory payloads causing OOM faults.
 */
export async function tailFileBounded(filePath: string, maxBytes: number = 1024 * 1024): Promise<string[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size === 0) return [];

  const sizeToRead = Math.min(stat.size, maxBytes);
  const startPos = stat.size - sizeToRead;

  const stream = fs.createReadStream(filePath, { start: startPos, encoding: 'utf8' });
  let content = "";
  for await (const chunk of stream) {
    content += chunk;
  }
  
  return content.split('\n');
}
