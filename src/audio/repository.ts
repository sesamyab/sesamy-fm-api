import { eq, and } from "drizzle-orm";
import { getDatabase } from "../database/client";
import { audioUploads, episodes } from "../database/schema";
import { NotFoundError } from "../common/errors";

export interface AudioUploadData {
  id: string;
  episodeId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
}

export class AudioRepository {
  private db;

  constructor(database?: D1Database) {
    this.db = getDatabase(database);
  }
  async findByEpisodeId(showId: string, episodeId: string) {
    // First check if episode exists and belongs to the show
    const episodeCheck = await this.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, showId), eq(episodes.id, episodeId)))
      .limit(1);

    if (!episodeCheck[0]) {
      throw new NotFoundError("Episode not found");
    }

    const result = await this.db
      .select()
      .from(audioUploads)
      .where(eq(audioUploads.episodeId, episodeId))
      .limit(1);

    return result[0] || null;
  }

  async create(data: AudioUploadData) {
    const now = new Date().toISOString();

    const newAudioUpload = {
      ...data,
      uploadedAt: now,
    };

    await this.db.insert(audioUploads).values(newAudioUpload);
    return newAudioUpload;
  }

  async delete(episodeId: string) {
    await this.db
      .delete(audioUploads)
      .where(eq(audioUploads.episodeId, episodeId));
    return true;
  }
}
