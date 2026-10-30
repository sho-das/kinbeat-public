type SourceKind = 'text' | 'pdf-text' | 'pdf-read' | 'image-read' | 'docx';

// Thrown when the visitor has left, so the reading of their file stops.
export class ExtractCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'ExtractCancelled';
  }
}

export interface Segment {
  file: string;
  page?: number;
  text: string;
  source: SourceKind;
}

export interface FileReport {
  file: string;
  type: string;
  pages?: number;
  imagePages?: number;
  notReadPages?: number[];
  notRead?: boolean;
  notSupportedPages?: number[];
  note?: string;
}

export interface Extraction {
  segments: Segment[];
  report: FileReport;
}

export interface UploadedFile {
  name: string;
  buffer: Buffer;
  fromArchive?: boolean;
  // A name ready to show, already checked for secrets. Used for repository files, where the whole path is kept.
  label?: string;
}

// Text read from a picture can have mistakes, so findings from it start a little lower in confidence.
export const READ_SOURCES: SourceKind[] = ['pdf-read', 'image-read'];
export const READ_CONFIDENCE_DROP = 0.1;
