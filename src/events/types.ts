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
  | "episode.audio_processing_workflow_started"
  | "episode.encoding_completed"
  | "audio.uploaded"
  | "campaign.created"
  | "campaign.updated"
  | "campaign.deleted"
  | "campaign.show.added"
  | "campaign.show.removed"
  | "creative.created"
  | "creative.updated"
  | "creative.deleted"
  | "creative.audio.uploaded"
  | "creative.video.uploaded"
  | "creative.image.uploaded"
  | "ad_marker.created"
  | "ad_marker.updated"
  | "ad_marker.deleted"
  | "chapter.created"
  | "chapter.updated"
  | "chapter.deleted";
