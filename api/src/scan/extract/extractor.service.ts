import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readDocx } from './docx';
import { PictureBudget, PictureReader } from './picture-reader';
import { readPdf } from './pdf';
import { cleanName, sniff } from './sniff';
import { maskName } from '../scrubber';
import { ExtractCancelled, Extraction, FileReport, Segment, UploadedFile } from './types';
import { readSlackMessages } from './slack';
import { readZip } from './zip';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;
const MAX_ARCHIVE_FILES = 100;
const MAX_ARCHIVE_IMAGES = 20;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_CHARS = 10_000_000;

// A zip is any file whose first bytes say it is one, whatever its name. sniff decides.
const isZipFile = (file: UploadedFile) => {
  const result = sniff(file.name, file.buffer);
  return result.ok && result.kind === 'zip';
};

@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);

  constructor(private readonly reader: PictureReader) {}

  check(files: UploadedFile[]): void {
    if (files.length === 0) throw new BadRequestException('Send one file, in the field "file".');
    for (const file of files) {
      if (file.buffer.length > MAX_FILE_BYTES) {
        throw new BadRequestException(`File "${cleanName(file.name)}" is larger than 10 MB.`);
      }
      const result = sniff(file.name, file.buffer);
      if (!result.ok) throw new BadRequestException(result.error);
    }
  }

  expand(files: UploadedFile[]): { files: UploadedFile[]; reports: FileReport[] } {
    const out: UploadedFile[] = [];
    const reports: FileReport[] = [];
    let images = 0;
    let textChars = 0;
    for (const file of files) {
      if (!isZipFile(file)) {
        out.push(file);
        continue;
      }
      const zipName = cleanName(file.name);
      let read;
      try {
        read = readZip(file.buffer, { maxEntries: MAX_ARCHIVE_FILES, maxEntryBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_ARCHIVE_BYTES });
      } catch (error) {
        throw new BadRequestException(`File "${zipName}": ${(error as Error).message}`);
      }
      const skipped = { ...read.skipped };
      const bump = (reason: string) => {
        skipped[reason] = (skipped[reason] ?? 0) + 1;
      };
      let used = 0;
      for (const entry of read.entries) {
        const kind = sniff(entry.name, entry.data);
        if (!kind.ok) {
          bump('type not supported');
          continue;
        }
        if (kind.kind === 'zip') {
          bump('zip inside a zip');
          continue;
        }
        if (kind.kind === 'text') {
          const scanned = Math.min(entry.data.length, MAX_TEXT_CHARS);
          if (textChars + scanned > MAX_ARCHIVE_TEXT_CHARS) {
            bump('over the text limit');
            continue;
          }
          textChars += scanned;
        }
        if (kind.kind === 'png' || kind.kind === 'jpg' || kind.kind === 'webp') {
          if (images >= MAX_ARCHIVE_IMAGES) {
            bump('over the image limit');
            continue;
          }
          images++;
        }
        const label = maskName(`${zipName} > ${entry.name.split(/[\\/]/).join(' > ')}`);
        out.push({ name: label.length > 100 ? label.slice(-100) : label, buffer: entry.data, fromArchive: true });
        used++;
      }
      const skippedText = Object.entries(skipped).map(([reason, n]) => `${n} ${reason}`).join(', ');
      reports.push({ file: zipName, type: 'zip', note: `Read ${used} file${used === 1 ? '' : 's'}.${skippedText ? ` Skipped: ${skippedText}.` : ''}` });
    }
    return { files: out, reports };
  }

  async extract(file: UploadedFile, signal?: AbortSignal, pictures: PictureBudget = new PictureBudget()): Promise<Extraction> {
    const name = file.label ?? cleanName(file.name);
    const sniffed = sniff(file.name, file.buffer);
    if (!sniffed.ok) throw new BadRequestException(sniffed.error);
    try {
      if (sniffed.kind === 'text') {
        let text = file.buffer.toString('utf8').replace(/^﻿/, '');
        const slack = name.toLowerCase().endsWith('.json') ? readSlackMessages(text) : null;
        if (slack) text = slack.text;
        const truncated = text.length > MAX_TEXT_CHARS;
        if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
        const notes = [slack ? `Read as ${slack.messages} Slack messages, one per line.` : '', truncated ? `Only the first ${MAX_TEXT_CHARS} characters were scanned.` : ''].filter(Boolean);
        return {
          segments: [{ file: name, text, source: 'text' }],
          report: { file: name, type: slack ? 'slack' : 'text', ...(notes.length ? { note: notes.join(' ') } : {}) },
        };
      }
      if (sniffed.kind === 'docx') {
        const text = await readDocx(file.buffer);
        return { segments: [{ file: name, text, source: 'docx' }], report: { file: name, type: 'docx' } };
      }
      if (sniffed.kind === 'pdf') return await this.extractPdf(name, file.buffer, signal, pictures);
      const read = await this.readPicture(name, file.buffer, 'image-read', undefined, signal, pictures);
      return { segments: read.segments, report: { file: name, type: sniffed.kind, ...(read.notRead ? { note: `Not read: ${read.notRead}`, notRead: true } : {}) } };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ExtractCancelled) throw error;
      this.logger.warn(`extract failed type=${sniffed.kind} error=${(error as Error).name}`);
      if ((error as Error).name === 'PasswordException') throw new BadRequestException(`File "${name}" is password protected, so it was not read. Remove the password and upload it again.`);
      throw new BadRequestException(`File "${name}" could not be read as a ${sniffed.kind} file.`);
    }
  }

  // Muse reads one picture or one scanned page. When it cannot, the reason is returned, so the result never says "clean".
  private async readPicture(file: string, image: Buffer, source: 'image-read' | 'pdf-read', page: number | undefined, signal: AbortSignal | undefined, pictures: PictureBudget): Promise<{ segments: Segment[]; notRead?: string }> {
    if (!pictures.take()) return { segments: [], notRead: 'The picture limit for one scan was reached.' };
    const read = await this.reader.read(image, signal);
    if (read.status === 'not-read') return { segments: [], notRead: read.reason };
    return { segments: read.text ? [{ file, ...(page !== undefined ? { page } : {}), source, text: read.text }] : [] };
  }

  private async extractPdf(name: string, buffer: Buffer, signal: AbortSignal | undefined, pictures: PictureBudget): Promise<Extraction> {
    const read = await readPdf(buffer, signal);
    const segments: Extraction['segments'] = [];
    const notSupportedPages: number[] = [];
    let imagePages = 0;
    const notReadPages: number[] = [];
    let notReadReason = '';
    for (const page of read.pages) {
      if (page.notSupported) {
        notSupportedPages.push(page.page);
      } else if (page.png) {
        const read = await this.readPicture(name, page.png, 'pdf-read', page.page, signal, pictures);
        if (read.notRead) {
          notReadPages.push(page.page);
          notReadReason = read.notRead;
        } else {
          imagePages++;
          segments.push(...read.segments);
        }
      } else {
        segments.push({ file: name, page: page.page, text: page.text, source: 'pdf-text' });
      }
      if (page.annotations) segments.push({ file: name, page: page.page, text: page.annotations, source: 'pdf-text' });
    }
    return {
      segments,
      report: {
        file: name,
        type: 'pdf',
        pages: read.totalPages,
        imagePages,
        ...(notReadPages.length ? { notReadPages, note: `Not read: ${notReadReason}` } : {}),
        ...(notSupportedPages.length ? { notSupportedPages, note: `${notReadPages.length ? `Not read: ${notReadReason} ` : ''}Some pages were not read: page limits reached. Those pages are not supported in this scan.` } : {}),
      },
    };
  }
}
