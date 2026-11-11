import { open } from 'node:fs/promises';

const DEFAULT_CHUNK_BYTES = 1024 * 1024;

/**
 * Reads a file sequentially into one reused buffer.
 *
 * Each yielded chunk is a view of that buffer and is only valid until the next
 * chunk is requested. Reusing the buffer keeps memory flat: a regular read
 * stream allocates a new buffer per chunk and peaked about 70 MB higher on
 * the 1 GB input (see README).
 *
 * @param {string} filePath
 * @param {number} [chunkBytes]
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* readChunks(filePath, chunkBytes = DEFAULT_CHUNK_BYTES) {
  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(chunkBytes);
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length);
      if (bytesRead === 0) return;
      yield buffer.subarray(0, bytesRead);
    }
  } finally {
    await file.close();
  }
}
