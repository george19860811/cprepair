export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: any[];
  webSearchQueries?: string[];
}

export interface RepairAnalysis {
  diagnosis: string;
  rawText: string;
  sources: GroundingChunk[];
}

export enum AppState {
  IDLE,
  ANALYZING,
  SUCCESS,
  ERROR
}

export interface RepairRequest {
  description: string;
}