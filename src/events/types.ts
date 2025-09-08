export interface CloudEvent {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: string;
  data: any;
}

export type PodcastEventType =
  | "show.created"
  | "show.updated"
  | "show.deleted"
  | "episode.created"
  | "episode.updated"
  | "episode.deleted"
  | "episode.published"
  | "episode.transcription_requested"
  | "episode.transcription_completed"
  | "episode.audio_processing_workflow_started"
  | "episode.encoding_completed"
  | "audio.uploaded";
