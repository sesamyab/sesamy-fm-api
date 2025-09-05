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
  | "audio.uploaded";
