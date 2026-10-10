export interface Source {
  id: string;
  name: string;
  emoji: string;
  listUrl: string;
}

export interface ParsedNotice {
  title: string;
  url: string;
  publishedOn: string; // YYYY-MM-DD
  isNew: boolean;
  files: string[];
}

export interface Notice extends ParsedNotice {
  id: string;
  sourceId: string;
}

export interface SourceState {
  failures: number;
  alerted: boolean;
  lastOkAt: number | null;
  lastError: string | null;
}
