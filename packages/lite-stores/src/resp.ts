// SPDX-License-Identifier: AGPL-3.0-only
// RESP2 wire format: incremental command parsing and reply encoding.

/** A reply sent as `+text`, as opposed to a plain string, which is sent as a bulk string. */
export interface SimpleString {
  simple: string;
}

export interface ReplyError {
  error: string;
}

/** The `*-1` reply: XREAD and EXEC answer it, and clients read it differently from an empty array. */
export const NULL_ARRAY = Symbol('null array');

export type Reply = null | number | string | SimpleString | ReplyError | typeof NULL_ARRAY | Reply[];

export const OK: SimpleString = { simple: 'OK' };

export class ProtocolError extends Error {}

const CRLF = '\r\n';

export function encodeReply(reply: Reply): string {
  if (reply === null) return `$-1${CRLF}`;
  if (reply === NULL_ARRAY) return `*-1${CRLF}`;
  if (typeof reply === 'number') return `:${reply}${CRLF}`;
  if (typeof reply === 'string') return `$${Buffer.byteLength(reply)}${CRLF}${reply}${CRLF}`;
  if (Array.isArray(reply)) return `*${reply.length}${CRLF}${reply.map(encodeReply).join('')}`;
  if ('simple' in reply) return `+${reply.simple}${CRLF}`;
  return `-${reply.error}${CRLF}`;
}

/** Splits a byte stream into commands; a command split across chunks waits for the rest. */
export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): string[][] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const commands: string[][] = [];
    let offset = 0;
    for (;;) {
      const parsed = this.parseCommand(offset);
      if (!parsed) break;
      offset = parsed.next;
      if (parsed.args.length > 0) commands.push(parsed.args);
    }
    this.buffer = this.buffer.subarray(offset);
    return commands;
  }

  private parseCommand(start: number): { args: string[]; next: number } | null {
    if (start >= this.buffer.length) return null;
    const lineEnd = this.buffer.indexOf(CRLF, start);
    if (lineEnd === -1) return null;
    const line = this.buffer.toString('utf8', start, lineEnd);
    if (line[0] !== '*') {
      return { args: line.split(/\s+/).filter(Boolean), next: lineEnd + 2 };
    }
    const count = Number(line.slice(1));
    if (!Number.isInteger(count)) throw new ProtocolError('invalid multibulk length');
    const args: string[] = [];
    let cursor = lineEnd + 2;
    for (let i = 0; i < count; i += 1) {
      const headerEnd = this.buffer.indexOf(CRLF, cursor);
      if (headerEnd === -1) return null;
      if (this.buffer[cursor] !== 0x24) throw new ProtocolError("expected '$'");
      const length = Number(this.buffer.toString('utf8', cursor + 1, headerEnd));
      if (!Number.isInteger(length) || length < 0) throw new ProtocolError('invalid bulk length');
      const dataStart = headerEnd + 2;
      if (this.buffer.length < dataStart + length + 2) return null;
      args.push(this.buffer.toString('utf8', dataStart, dataStart + length));
      cursor = dataStart + length + 2;
    }
    return { args, next: cursor };
  }
}
