export interface AppFilesStatus {
  /** Why nothing can be kept here, or null. */
  unavailable: string | null;
  /** A worker is installed for this page, and controls it now. */
  installed: boolean;
  controlling: boolean;
  /** The files it keeps and their bytes, of every version it has kept. */
  files: number;
  bytes: number;
}

